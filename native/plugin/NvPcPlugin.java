package be.brokeuh.nightvault;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Take with me: the connection to the owner's PC (Nightvault PC app, "Phone access", vault_phone.py) on the home network.
 * The page asks /_nvpc_/nv/... on its own address; Android fetches it from the paired PC (plain http on the home network,
 * which the web view itself may not load) and hands it back - with byte ranges for files, so songs can be skipped through.
 * Lesson from NvFiles: the web view applies the Range of an intercepted request itself (asks available() for the size, then
 * skips), so a file answer is the whole file seen from byte 0, and the PC is only asked for the part that is really read.
 */
@CapacitorPlugin(name = "NvPc")
public class NvPcPlugin extends Plugin {
    static final String PREFIX = "/_nvpc_/";

    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences("nvpc", Context.MODE_PRIVATE); }

    /** the paired PC: base like http://192.168.1.20:8766 and the pairing code */
    @PluginMethod
    public void set(PluginCall call) {
        String base = call.getString("base", ""), key = call.getString("key", "");
        prefs(getContext()).edit().putString("base", base.replaceAll("/+$", "")).putString("key", key).apply();
        call.resolve();
    }

    @PluginMethod
    public void get(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        JSObject o = new JSObject();
        o.put("base", p.getString("base", ""));
        o.put("key", p.getString("key", ""));
        call.resolve(o);
    }

    @PluginMethod
    public void forget(PluginCall call) { prefs(getContext()).edit().clear().apply(); call.resolve(); }

    /** ask a PC (paired or not yet) who it is: used while pairing and to see if it is reachable */
    @PluginMethod
    public void hello(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        String base = call.getString("base", p.getString("base", "")).replaceAll("/+$", ""), key = call.getString("key", p.getString("key", ""));
        int timeout = call.getInt("timeout", 4000);
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + "/nv/hello?k=" + Uri.encode(key)).openConnection();
                c.setConnectTimeout(timeout); c.setReadTimeout(timeout);
                int code = c.getResponseCode();
                String body = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
                if (code >= 400) { call.reject(code == 401 ? "Wrong code" : "The PC answered " + code, String.valueOf(code)); return; }
                call.resolve(new JSObject(body));
            } catch (Exception e) {
                call.reject("Can't reach the PC: " + e.getMessage(), "offline");
            } finally { if (c != null) c.disconnect(); }
        }).start();
    }

    /** download a file from the PC straight into a folder on the phone (a folder the owner picked, e.g. on the SD card) */
    @PluginMethod
    public void saveToFolder(PluginCall call) {
        String tree = call.getString("tree", ""), folder = call.getString("folder", ""), name = call.getString("name", "file"),
               path = call.getString("path", ""), mime = call.getString("mime", "application/octet-stream");
        Context ctx = getContext();
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                ContentResolver cr = ctx.getContentResolver();
                Uri t = Uri.parse(tree);
                String docId = DocumentsContract.getTreeDocumentId(t);
                for (String seg : folder.split("/")) {
                    if (seg.trim().isEmpty()) continue;
                    String child = findChild(cr, t, docId, seg);
                    if (child == null) {
                        Uri made = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, docId), DocumentsContract.Document.MIME_TYPE_DIR, seg);
                        if (made == null) throw new IOException("Could not make the folder " + seg);
                        child = DocumentsContract.getDocumentId(made);
                    }
                    docId = child;
                }
                String have = findChild(cr, t, docId, name);
                Uri file = have != null ? DocumentsContract.buildDocumentUriUsingTree(t, have)
                        : DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, docId), mime, name);
                if (file == null) throw new IOException("Could not make the file " + name);
                c = open(ctx, path, null);
                int code = c.getResponseCode();
                if (code >= 400) throw new IOException("The PC answered " + code);
                long total = c.getContentLengthLong(), done = 0, last = 0;
                try (InputStream in = c.getInputStream(); OutputStream out = cr.openOutputStream(file, "wt")) {
                    if (out == null) throw new IOException("Could not write " + name);
                    byte[] b = new byte[131072];
                    int n;
                    while ((n = in.read(b)) > 0) {
                        out.write(b, 0, n);
                        done += n;
                        if (done - last > 1048576) { last = done; JSObject e = new JSObject(); e.put("name", name); e.put("done", done); e.put("total", total); notifyListeners("saveProgress", e); }
                    }
                }
                JSObject o = new JSObject();
                o.put("uri", file.toString());
                o.put("size", done);
                call.resolve(o);
            } catch (Exception e) {
                Log.w("NvPc", "saveToFolder failed", e);
                call.reject("Could not save " + name + ": " + e.getMessage());
            } finally { if (c != null) c.disconnect(); }
        }).start();
    }

    private static String findChild(ContentResolver cr, Uri tree, String parentId, String name) {
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        try (Cursor q = cr.query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (q == null) return null;
            while (q.moveToNext()) if (name.equals(q.getString(1))) return q.getString(0);
        } catch (Exception e) { return null; }
        return null;
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        in.close();
        return o.toString("UTF-8");
    }

    /** a request to the paired PC: path like /nv/file?id=..; the pairing code is added */
    static HttpURLConnection open(Context ctx, String path, String range) throws IOException {
        SharedPreferences p = prefs(ctx);
        String base = p.getString("base", ""), key = p.getString("key", "");
        if (base.isEmpty()) throw new IOException("No PC paired");
        String url = base + (path.startsWith("/") ? path : "/" + path);
        url += (url.contains("?") ? "&" : "?") + "k=" + Uri.encode(key);
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(5000);
        c.setReadTimeout(60000);
        if (range != null) c.setRequestProperty("Range", range);
        return c;
    }

    /* ---------- serving /_nvpc_/... to the page (called from MainActivity's web view client) ---------- */
    static WebResourceResponse serve(Context ctx, WebResourceRequest req) {
        Uri url = req.getUrl();
        String path = url.getPath();
        if (path == null || !path.startsWith(PREFIX)) return null;
        String target = path.substring(PREFIX.length() - 1) + (url.getEncodedQuery() != null ? "?" + url.getEncodedQuery() : "");
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        try {
            String range = null;
            for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            if (target.startsWith("/nv/file")) {
                // learn the size and type with a one-byte request, then answer like a local file
                HttpURLConnection c0 = open(ctx, target, "bytes=0-0");
                int code0 = c0.getResponseCode();
                if (code0 >= 400) { String err = readAll(c0.getErrorStream()); c0.disconnect(); return text(code0, err, h); }
                String cr = c0.getHeaderField("Content-Range"), mime = c0.getContentType();
                long size = -1;
                if (cr != null && cr.contains("/")) size = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
                else size = c0.getContentLengthLong();
                c0.disconnect();
                if (mime == null) mime = "application/octet-stream";
                if (size < 0) throw new IOException("unknown size");
                long start = 0, end = size - 1;
                boolean partial = range != null && range.startsWith("bytes=") && size > 0;
                if (partial) {
                    String[] p = range.substring(6).split(",")[0].trim().split("-", -1);
                    if (p[0].isEmpty()) { long n = Long.parseLong(p[1]); start = Math.max(0, size - n); }
                    else { start = Long.parseLong(p[0]); if (p.length > 1 && !p[1].isEmpty()) end = Math.min(Long.parseLong(p[1]), size - 1); }
                    if (start >= size) { h.put("Content-Range", "bytes */" + size); return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0])); }
                }
                h.put("Accept-Ranges", "bytes");
                h.put("Content-Length", String.valueOf(Math.max(0, end - start + 1)));
                if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
                return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, new PcStream(ctx, target, size, partial ? start : 0, end));
            }
            HttpURLConnection c = open(ctx, target, null);
            int code = c.getResponseCode();
            String mime = c.getContentType();
            if (mime == null) mime = "application/octet-stream";
            String ct = mime.contains(";") ? mime.substring(0, mime.indexOf(';')).trim() : mime, cs = mime.toLowerCase().contains("charset=") ? "utf-8" : null;
            InputStream body = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return new WebResourceResponse(ct, cs, code, code >= 400 ? "Error" : "OK", h, body != null ? body : new ByteArrayInputStream(new byte[0]));
        } catch (Exception e) {
            Log.w("NvPc", "serve failed for " + target, e);
            return text(502, "{\"error\":\"Can't reach the PC: " + String.valueOf(e.getMessage()).replace("\"", "'") + "\",\"offline\":true}", h);
        }
    }

    private static WebResourceResponse text(int code, String body, Map<String, String> h) {
        return new WebResourceResponse("application/json", "utf-8", code, "Error", h, new ByteArrayInputStream(body.getBytes()));
    }

    /** a file on the PC seen from byte 0: skip() only moves the position; reading asks the PC for that part */
    private static class PcStream extends InputStream {
        private final Context ctx; private final String target; private final long size, start, end;
        private long pos = 0; private boolean skipped = false; private InputStream in = null; private HttpURLConnection conn = null; private long inPos = -1;
        PcStream(Context ctx, String target, long size, long start, long end) { this.ctx = ctx; this.target = target; this.size = size; this.start = start; this.end = end; }
        private void ensure() throws IOException {
            if (!skipped && pos == 0 && start > 0) pos = start;          // the web view did not skip: go to the range ourselves
            skipped = true;
            if (in == null || inPos != pos) {
                closeIn();
                conn = open(ctx, target, "bytes=" + pos + "-" + end);
                int code = conn.getResponseCode();
                if (code >= 400) throw new IOException("The PC answered " + code);
                in = conn.getInputStream();
                if (code == 200 && pos > 0) { long left = pos; while (left > 0) { long k = in.skip(left); if (k <= 0) break; left -= k; } }
                inPos = pos;
            }
        }
        private void closeIn() { if (in != null) try { in.close(); } catch (Exception e) {} if (conn != null) conn.disconnect(); in = null; conn = null; }
        @Override public int available() { return (int) Math.min(Integer.MAX_VALUE, Math.max(0, size - pos)); }
        @Override public long skip(long n) { if (n <= 0) return 0; long k = Math.min(n, Math.max(0, size - pos)); pos += k; skipped = true; return k; }
        @Override public int read() throws IOException { byte[] b = new byte[1]; int n = read(b, 0, 1); return n <= 0 ? -1 : b[0] & 0xff; }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (len == 0) return 0;
            if (pos > end) return -1;
            ensure();
            int n = in.read(b, off, (int) Math.min(len, end - pos + 1));
            if (n > 0) { pos += n; inPos = pos; }
            return n;
        }
        @Override public void close() { closeIn(); }
    }
}
