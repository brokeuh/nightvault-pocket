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
                walk(getContext().getContentResolver(), tree, DocumentsContract.getTreeDocumentId(tree), nameOf(tree), out, 0);
                JSObject o = new JSObject();
                o.put("files", out);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("Nightvault may no longer read this folder - pick it again", "permission");
            } catch (Exception e) {
                call.reject("Could not read the folder: " + e.getMessage());
            }
        }).start();
    }

    private void walk(ContentResolver cr, Uri tree, String docId, String path, JSArray out, int depth) {
        if (depth > 8 || out.length() > 20000) return;
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try (Cursor c = cr.query(kids, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
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
            ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(doc, "r");
            if (pfd == null) throw new IOException("cannot open");
            long size = pfd.getStatSize();
            long start = 0, end = size - 1;
            String range = null;
            for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            boolean partial = range != null && range.startsWith("bytes=") && size > 0;
            if (partial) {
                String[] p = range.substring(6).split(",")[0].trim().split("-", -1);
                if (p[0].isEmpty()) { long n = Long.parseLong(p[1]); start = Math.max(0, size - n); }
                else { start = Long.parseLong(p[0]); if (p.length > 1 && !p[1].isEmpty()) end = Math.min(Long.parseLong(p[1]), size - 1); }
                if (start >= size) {
                    pfd.close();
                    h.put("Content-Range", "bytes */" + size);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new java.io.ByteArrayInputStream(new byte[0]));
                }
            }
            FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
            if (start > 0) fis.getChannel().position(start);
            long len = Math.max(0, end - start + 1);
            h.put("Content-Length", String.valueOf(len));
            if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            InputStream body = new Bounded(fis, len, pfd);
            return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
        } catch (SecurityException e) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", h, new java.io.ByteArrayInputStream("no permission".getBytes()));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new java.io.ByteArrayInputStream(("not found: " + e.getMessage()).getBytes()));
        }
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
        @Override public void close() throws IOException { try { super.close(); } finally { try { pfd.close(); } catch (Exception e) {} } }
    }
}
