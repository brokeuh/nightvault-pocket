package be.brokeuh.nightvault;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Folders on the phone that Nightvault may read (Android's folder picker; the permission is kept after a restart).
 * Files in them are NOT copied: the page reads and plays them through the address /_nvfile_/<id>/<name>, served by
 * {@link #serve} with proper byte ranges, so jumping around in a big audiobook only reads that part of the file.
 * Used by Nightvault Audio; meant for Bookcase / Music too.
 */
@CapacitorPlugin(name = "NvFiles")
public class NvFilesPlugin extends Plugin {
    static final String PREFIX = "/_nvfile_/";

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult r) {
        if (call == null) return;
        if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null || r.getData().getData() == null) { call.reject("No folder picked", "cancel"); return; }
        Uri tree = r.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) { /* some file apps give no lasting permission: it then works until the app restarts */ }
        JSObject o = new JSObject();
        o.put("tree", tree.toString());
        o.put("name", nameOf(tree));
        call.resolve(o);
    }

    private String nameOf(Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        String n = id.substring(id.lastIndexOf(':') + 1);
        n = n.substring(n.lastIndexOf('/') + 1);
        return n.isEmpty() ? id : n;
    }

    /** every file in the folder and its sub-folders: [{uri, path, name, size, mime, modified}] */
    @PluginMethod
    public void list(PluginCall call) {
        String t = call.getString("tree");
        if (t == null) { call.reject("No folder"); return; }
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(t);
                JSArray out = new JSArray();
                listStop = false; listFolders = 0; listAudio = 0; lastNote = 0;
                walk(getContext().getContentResolver(), tree, DocumentsContract.getTreeDocumentId(tree), nameOf(tree), out, 0);
                note(out, "", true);
                JSObject o = new JSObject();
                o.put("files", out);
                o.put("stopped", listStop);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("Nightvault may no longer read this folder - pick it again", "permission");
            } catch (Exception e) {
                call.reject("Could not read the folder: " + e.getMessage());
            }
        }).start();
    }

    /* progress while listing a big folder (an SD card can take minutes): event "listProgress" about twice a second */
    private volatile boolean listStop = false;
    private int listFolders = 0, listAudio = 0;
    private long lastNote = 0;
    private static final java.util.regex.Pattern AUDIO = java.util.regex.Pattern.compile("(?i).*\\.(mp3|m4a|m4b|mp4|aac|ogg|oga|opus|flac|wav|webm|mka)$");
    private void note(JSArray out, String path, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastNote < 450) return;
        lastNote = now;
        JSObject e = new JSObject();
        e.put("files", out.length()); e.put("audio", listAudio); e.put("folders", listFolders); e.put("at", path);
        notifyListeners("listProgress", e);
    }

    /** stops a running list() - it then answers with stopped: true */
    @PluginMethod
    public void stopList(PluginCall call) { listStop = true; call.resolve(); }

    private void walk(ContentResolver cr, Uri tree, String docId, String path, JSArray out, int depth) {
        if (listStop || depth > 8 || out.length() > 20000) return;
        listFolders++; note(out, path, false);
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try (Cursor c = cr.query(kids, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                if (listStop) return;
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { walk(cr, tree, id, path + "/" + name, out, depth + 1); continue; }
                JSObject f = new JSObject();
                f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                f.put("path", path + "/" + name);
                f.put("name", name);
                f.put("size", c.isNull(3) ? 0 : c.getLong(3));
                f.put("mime", mime == null ? "" : mime);
                f.put("modified", c.isNull(4) ? 0 : c.getLong(4));
                out.put(f);
                if (AUDIO.matcher(name).matches()) listAudio++;
            }
        }
    }

    /** the folders Nightvault may read */
    @PluginMethod
    public void folders(PluginCall call) {
        JSArray a = new JSArray();
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (!p.isReadPermission()) continue;
            JSObject o = new JSObject();
            o.put("tree", p.getUri().toString());
            try { o.put("name", nameOf(p.getUri())); } catch (Exception e) { o.put("name", p.getUri().getLastPathSegment()); }
            a.put(o);
        }
        JSObject r = new JSObject();
        r.put("folders", a);
        call.resolve(r);
    }

    @PluginMethod
    public void forget(PluginCall call) {
        try { getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(call.getString("tree", "")), Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception e) {}
        call.resolve();
    }

    /** a piece of a file, as base64 (for reading tags when the /_nvfile_/ address does not work) */
    @PluginMethod
    public void read(PluginCall call) {
        String u = call.getString("uri");
        long off = call.getLong("offset", 0L);
        int len = (int) Math.min(call.getLong("length", 65536L), 16L * 1024 * 1024);
        new Thread(() -> {
            try (InputStream in = open(getContext(), Uri.parse(u), off)) {
                byte[] b = new byte[Math.max(0, len)];
                int n = 0, r;
                while (n < len && (r = in.read(b, n, len - n)) > 0) n += r;
                JSObject o = new JSObject();
                o.put("data", Base64.encodeToString(b, 0, n, Base64.NO_WRAP));
                o.put("size", sizeOf(getContext(), Uri.parse(u)));
                call.resolve(o);
            } catch (Exception e) { call.reject("Cannot read the file: " + e); }
        }).start();
    }

    /** what Android says about one file (for the "Check the file" screen) */
    @PluginMethod
    public void probe(PluginCall call) {
        Uri u = Uri.parse(call.getString("uri", ""));
        JSObject o = new JSObject();
        o.put("authority", u.getAuthority());
        try { o.put("mime", getContext().getContentResolver().getType(u)); } catch (Exception e) { o.put("mimeError", e.toString()); }
        o.put("size", sizeOf(getContext(), u));
        try (ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(u, "r")) {
            o.put("statSize", pfd == null ? -2 : pfd.getStatSize());
        } catch (Exception e) { o.put("openError", e.toString()); }
        try (InputStream in = getContext().getContentResolver().openInputStream(u)) {
            byte[] b = new byte[12]; int n = in == null ? -1 : in.read(b);
            o.put("firstBytes", n > 0 ? Base64.encodeToString(b, 0, n, Base64.NO_WRAP) : "");
        } catch (Exception e) { o.put("streamError", e.toString()); }
        o.put("serveHooked", served);
        call.resolve(o);
    }

    static volatile int served = 0;    // how many /_nvfile_/ requests reached Android (shows whether the web view hook works)

    static long sizeOf(Context ctx, Uri u) {
        try (Cursor c = ctx.getContentResolver().query(u, new String[]{DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception e) {}
        return -1;
    }

    /** the file from byte 'start': a real file when possible (fast jumps), else a stream that skips ahead */
    static InputStream open(Context ctx, Uri u, long start) throws IOException {
        ParcelFileDescriptor pfd = null;
        try { pfd = ctx.getContentResolver().openFileDescriptor(u, "r"); } catch (Exception e) { pfd = null; }
        if (pfd != null && pfd.getStatSize() >= 0) {
            FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
            try { if (start > 0) fis.getChannel().position(start); }
            catch (Exception e) { long left = start; while (left > 0) { long k = fis.skip(left); if (k <= 0) break; left -= k; } }
            return new Bounded(fis, Long.MAX_VALUE, pfd);
        }
        if (pfd != null) try { pfd.close(); } catch (Exception e) {}
        InputStream in = ctx.getContentResolver().openInputStream(u);
        if (in == null) throw new IOException("cannot open");
        long left = start; while (left > 0) { long k = in.skip(left); if (k <= 0) break; left -= k; }
        return in;
    }

    /* ---------- serving the files to the page (called from MainActivity's web view client) ---------- */

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("mp3", "audio/mpeg"); MIME.put("m4a", "audio/mp4"); MIME.put("m4b", "audio/mp4"); MIME.put("mp4", "audio/mp4");
        MIME.put("aac", "audio/aac"); MIME.put("ogg", "audio/ogg"); MIME.put("oga", "audio/ogg"); MIME.put("opus", "audio/ogg");
        MIME.put("flac", "audio/flac"); MIME.put("wav", "audio/wav"); MIME.put("webm", "audio/webm"); MIME.put("mka", "audio/webm");
        MIME.put("jpg", "image/jpeg"); MIME.put("jpeg", "image/jpeg"); MIME.put("png", "image/png"); MIME.put("webp", "image/webp");
        MIME.put("pdf", "application/pdf"); MIME.put("epub", "application/epub+zip"); MIME.put("cbz", "application/zip");
    }

    static WebResourceResponse serve(Context ctx, WebResourceRequest req) {
        Uri url = req.getUrl();
        String path = url.getPath();
        if (path == null || !path.startsWith(PREFIX)) return null;
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Cache-Control", "no-store");
        try {
            String rest = path.substring(PREFIX.length());
            int slash = rest.indexOf('/');
            String enc = slash >= 0 ? rest.substring(0, slash) : rest, name = slash >= 0 ? rest.substring(slash + 1) : "";
            Uri doc = Uri.parse(new String(Base64.decode(enc, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), "UTF-8"));
            String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : ctx.getContentResolver().getType(doc);
            if (mime == null) mime = "application/octet-stream";
            served++;
            long size;
            try (ParcelFileDescriptor p0 = ctx.getContentResolver().openFileDescriptor(doc, "r")) { size = p0 == null ? -1 : p0.getStatSize(); }
            catch (Exception e) { size = -1; }
            if (size < 0) size = sizeOf(ctx, doc);
            if (size < 0) throw new IOException("unknown size");
            long start = 0, end = size - 1;
            String range = null;
            for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            boolean partial = range != null && range.startsWith("bytes=") && size > 0;
            if (partial) {
                String[] p = range.substring(6).split(",")[0].trim().split("-", -1);
                if (p[0].isEmpty()) { long n = Long.parseLong(p[1]); start = Math.max(0, size - n); }
                else { start = Long.parseLong(p[0]); if (p.length > 1 && !p[1].isEmpty()) end = Math.min(Long.parseLong(p[1]), size - 1); }
                if (start >= size) {
                    h.put("Content-Range", "bytes */" + size);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new java.io.ByteArrayInputStream(new byte[0]));
                }
            }
            long len = Math.max(0, end - start + 1);
            h.put("Content-Length", String.valueOf(len));
            if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            // Android's web view applies the Range itself (it asks available() for the size and skips to the start), so the answer is the
            // whole file seen from byte 0; RangeStream also copes with a web view that does not skip, and stops after the range.
            InputStream body = new RangeStream(ctx, doc, size, partial ? start : 0, end);
            Log.d("NvFiles", "serve " + name + " " + (range == null ? "(no range)" : range) + " -> " + (partial ? 206 : 200) + " " + start + "-" + end + "/" + size + " " + mime);
            return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
        } catch (SecurityException e) {
            Log.w("NvFiles", "serve: no permission for " + path, e);
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", h, new java.io.ByteArrayInputStream("no permission".getBytes()));
        } catch (Exception e) {
            Log.w("NvFiles", "serve failed for " + path, e);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new java.io.ByteArrayInputStream(("not found: " + e.getMessage()).getBytes()));
        }
    }

    /** The file from byte 0 as far as the web view can see: skip() really jumps (fast, no reading), reading stops after 'end'.
        If the web view reads without skipping first, it starts at 'start' itself. */
    private static class RangeStream extends InputStream {
        private final Context ctx; private final Uri doc; private final long size, start, end;
        private long pos = 0; private boolean skipped = false; private InputStream in = null; private long inPos = -1;
        RangeStream(Context ctx, Uri doc, long size, long start, long end) { this.ctx = ctx; this.doc = doc; this.size = size; this.start = start; this.end = end; }
        private void ensure() throws IOException {
            if (!skipped && pos == 0 && start > 0) pos = start;      // the web view did not skip: go to the range ourselves
            skipped = true;
            if (in == null || inPos != pos) { if (in != null) try { in.close(); } catch (Exception e) {} in = open(ctx, doc, pos); inPos = pos; }
        }
        @Override public int available() { return (int) Math.min(Integer.MAX_VALUE, Math.max(0, size - pos)); }
        @Override public long skip(long n) { if (n <= 0) return 0; long k = Math.min(n, Math.max(0, size - pos)); pos += k; skipped = true; return k; }
        @Override public int read() throws IOException { byte[] b = new byte[1]; int n = read(b, 0, 1); return n <= 0 ? -1 : b[0] & 0xff; }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (len == 0) return 0;
            ensure();
            if (pos > end) return -1;
            int n = in.read(b, off, (int) Math.min(len, end - pos + 1));
            if (n > 0) { pos += n; inPos = pos; }
            return n;
        }
        @Override public void close() throws IOException { if (in != null) in.close(); }
    }

    /** reads at most n bytes, and closes the file when done */
    private static class Bounded extends FilterInputStream {
        private long left;
        private final ParcelFileDescriptor pfd;
        Bounded(InputStream in, long n, ParcelFileDescriptor pfd) { super(in); left = n; this.pfd = pfd; }
        @Override public int read() throws IOException { if (left <= 0) return -1; int b = super.read(); if (b >= 0) left--; return b; }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
        @Override public int available() throws IOException { return (int) Math.min(Integer.MAX_VALUE, left); }
        @Override public void close() throws IOException { try { super.close(); } finally { if (pfd != null) try { pfd.close(); } catch (Exception e) {} } }
    }
}
