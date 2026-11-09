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

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.HashSet;
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
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult r) {
        if (call == null) return;
        if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null || r.getData().getData() == null) { call.reject("No folder picked", "cancel"); return; }
        Uri tree = r.getData().getData();
        try {
            // read + write, so "Save to phone" (NvPc.saveToFolder) and "Remove the phone copy" keep working after a restart
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            try { getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (Exception e2) { /* some file apps give no lasting permission: it then works until the app restarts */ }
        }
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
                listStop = false; listFolders = 0; listAudio = 0; lastNote = 0; listDepth = Math.max(0, Math.min(8, call.getInt("depth", 8)));
                walk(getContext().getContentResolver(), tree, DocumentsContract.getTreeDocumentId(tree), nameOf(tree), out, 0);
                note(out, "", true);
                JSObject o = new JSObject();
                o.put("files", out);
                o.put("stopped", listStop);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("Nightvault may no longer read this folder - pick it again", "permission");
            } catch (IllegalStateException e) {
                call.reject(e.getMessage(), "unreachable");
            } catch (Exception e) {
                call.reject("Could not read the folder: " + e.getMessage());
            }
        }).start();
    }

    /* progress while listing a big folder (an SD card can take minutes): event "listProgress" about twice a second */
    private volatile boolean listStop = false;
    private int listDepth = 8;   // list({depth:0}) = only the files right in the folder (the backups folder)
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

    /** the entries of ONE folder (no walking down): listDir({tree, sub:"mtg/neo - Kamigawa"}) -> {found, entries:[{name, dir, uri, size}]} - used to find saved card pictures */
    @PluginMethod
    public void listDir(PluginCall call) {
        String t = call.getString("tree"), sub = call.getString("sub", "");
        if (t == null) { call.reject("No folder"); return; }
        new Thread(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                Uri tree = Uri.parse(t);
                String docId = DocumentsContract.getTreeDocumentId(tree);
                boolean found = true;
                for (String seg : sub.split("/")) {
                    if (seg.isEmpty()) continue;
                    String next = null;
                    try (Cursor q = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId),
                            new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                        if (q != null) while (q.moveToNext()) if (seg.equals(q.getString(1)) && DocumentsContract.Document.MIME_TYPE_DIR.equals(q.getString(2))) { next = q.getString(0); break; }
                    }
                    if (next == null) { found = false; break; }
                    docId = next;
                }
                JSArray out = new JSArray();
                if (found) try (Cursor c = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId),
                        new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
                    while (c != null && c.moveToNext()) {
                        String name = c.getString(1);
                        if (name == null || name.startsWith(".")) continue;
                        JSObject f = new JSObject();
                        f.put("name", name);
                        f.put("dir", DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)));
                        f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)).toString());
                        f.put("size", c.isNull(3) ? 0 : c.getLong(3));
                        out.put(f);
                    }
                }
                JSObject o = new JSObject();
                o.put("found", found);
                o.put("entries", out);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("Nightvault may no longer read this folder - pick it again", "permission");
            } catch (Exception e) {
                call.reject("Could not read the folder: " + e.getMessage());
            }
        }).start();
    }

    /** keeps the screen on while true (used while adding a big music folder, so the phone does not go to sleep and stop it) */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(() -> {
            if (on) a.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    /** stops a running list() - it then answers with stopped: true */
    @PluginMethod
    public void stopList(PluginCall call) { listStop = true; call.resolve(); }

    private void walk(ContentResolver cr, Uri tree, String docId, String path, JSArray out, int depth) {
        if (listStop || depth > listDepth || out.length() > 20000) return;
        listFolders++; note(out, path, false);
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try (Cursor c = cr.query(kids, cols, null, null, null)) {
            // the folder itself gives no answer (SD card out or not ready yet, folder gone): say so instead of "no files",
            // otherwise an app looking for changes thinks everything was deleted and drops its whole list (Music, 21 Oct)
            if (c == null) { if (depth == 0) throw new IllegalStateException("The folder can't be reached right now - is the SD card in the phone?"); return; }
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

    /** writes one file right in a picked folder (replaces a file with the same name): {tree, name, data (base64), mime} → {uri}.
        Used for the automatic backups (hub/nvbackup.js) - a file in a folder the owner picked survives even removing the app. */
    @PluginMethod
    public void write(PluginCall call) {
        String t = call.getString("tree", ""), name = call.getString("name", ""), data = call.getString("data", ""), mime = call.getString("mime", "application/octet-stream");
        if (t.isEmpty() || name.isEmpty() || name.contains("/")) { call.reject("No folder or name"); return; }
        new Thread(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                Uri tree = Uri.parse(t);
                String root = DocumentsContract.getTreeDocumentId(tree), have = null;
                try (Cursor q = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, root),
                        new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                    if (q == null) throw new IllegalStateException("The folder can't be reached right now - is the SD card in the phone?");
                    while (q.moveToNext()) if (name.equals(q.getString(1))) { have = q.getString(0); break; }
                }
                Uri f = have != null ? DocumentsContract.buildDocumentUriUsingTree(tree, have)
                        : DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, root), mime, name);
                if (f == null) throw new IOException("the folder did not make the file");
                try (OutputStream o = cr.openOutputStream(f, "wt")) {
                    if (o == null) throw new IOException("the file can't be written");
                    o.write(Base64.decode(data, Base64.DEFAULT));
                }
                JSObject r = new JSObject();
                r.put("uri", f.toString());
                r.put("name", name);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject("Nightvault may not write in this folder - pick it again", "permission");
            } catch (IllegalStateException e) {
                call.reject(e.getMessage(), "unreachable");
            } catch (Exception e) { call.reject("Could not save the file: " + e.getMessage()); }
        }).start();
    }

    /** deletes one file in a picked folder (Cinema: "Remove the phone copy" of a video saved from the PC) */
    @PluginMethod
    public void remove(PluginCall call) {
        String u = call.getString("uri", "");
        new Thread(() -> {
            try {
                boolean ok = DocumentsContract.deleteDocument(getContext().getContentResolver(), Uri.parse(u));
                JSObject o = new JSObject();
                o.put("removed", ok);
                call.resolve(o);
            } catch (Exception e) { call.reject("Could not remove the file: " + e.getMessage()); }
        }).start();
    }

    /* ---------- card pictures (Nightvault > Card pictures, hub/nvcards.js) ----------
       download({tree, items:[{dir:"mtg/neo - Kamigawa", name:"12_Card.jpg", url}], pauseMs}) saves each address straight into
       sub-folders of the picked folder (made when missing), SKIPS a file that is already there (so a stopped download continues where
       it was), waits pauseMs between pictures, and answers {got, skipped, missed, bytes, stopped, refused}. Event "dlProgress" about
       twice a second. A picture is read completely first and only then written, so a failed one never leaves half a file. */
    private volatile boolean dlStop = false;

    @PluginMethod
    public void stopDownload(PluginCall call) { dlStop = true; call.resolve(); }

    @PluginMethod
    public void download(PluginCall call) {
        final String t = call.getString("tree", "");
        final JSArray items = call.getArray("items");
        final int pause = Math.max(0, Math.min(5000, call.getInt("pauseMs", 250)));
        final int webpQ = Math.max(40, Math.min(100, call.getInt("webpQ", 90)));
        if (t.isEmpty() || items == null) { call.reject("No folder or list"); return; }
        dlStop = false;
        new Thread(() -> {
            int got = 0, skipped = 0, missed = 0, misses = 0;
            long bytes = 0, lastNote = 0;
            boolean refused = false;
            String at = "";
            try {
                ContentResolver cr = getContext().getContentResolver();
                Uri tree = Uri.parse(t);
                HashMap<String, String> dirIds = new HashMap<>();
                HashMap<String, HashSet<String>> have = new HashMap<>();
                dirIds.put("", DocumentsContract.getTreeDocumentId(tree));
                final int total = items.length();
                for (int i = 0; i < total; i++) {
                    if (dlStop) break;
                    org.json.JSONObject it = items.getJSONObject(i);
                    String dir = it.optString("dir", ""), name = it.optString("name", ""), url = it.optString("url", "");
                    if (name.isEmpty() || name.contains("/") || url.isEmpty()) { missed++; continue; }
                    at = dir + "/" + name;
                    String dirId = ensureDir(cr, tree, dirIds, dir);
                    HashSet<String> names = have.get(dir);
                    if (names == null) { names = namesIn(cr, tree, dirId); have.put(dir, names); }
                    if (names.contains(name)) { skipped++; }
                    else {
                        byte[] data = null;
                        try { data = httpGet(url); } catch (IOException e) { Log.w("NvFiles", "download " + url + ": " + e); }
                        if (data == null || data.length == 0) {
                            missed++; misses++;
                            if (misses >= 25) { refused = true; break; }      // the picture site keeps refusing: stop, continue later
                        } else {
                            misses = 0;
                            if (name.endsWith(".webp") && !isWebp(data)) {      // the picture came as JPG/PNG: save it as WebP (smaller)
                                byte[] w = toWebp(data, webpQ);
                                if (w == null) { missed++; continue; }
                                data = w;
                            }
                            Uri f = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, dirId), mimeOf(name), name);
                            if (f == null) throw new IOException("the folder did not make the file");
                            try (OutputStream o = cr.openOutputStream(f, "wt")) {
                                if (o == null) throw new IOException("the file can't be written");
                                o.write(data);
                            } catch (IOException e) {
                                try { DocumentsContract.deleteDocument(cr, f); } catch (Exception x) {}
                                throw e;
                            }
                            names.add(name); got++; bytes += data.length;
                            if (pause > 0) try { Thread.sleep(pause); } catch (InterruptedException e) { dlStop = true; }
                        }
                    }
                    long now = System.currentTimeMillis();
                    if (now - lastNote > 450) {
                        lastNote = now;
                        JSObject e = new JSObject();
                        e.put("done", i + 1); e.put("total", total); e.put("got", got); e.put("skipped", skipped); e.put("missed", missed); e.put("bytes", bytes); e.put("at", at);
                        notifyListeners("dlProgress", e);
                    }
                }
                JSObject r = new JSObject();
                r.put("got", got); r.put("skipped", skipped); r.put("missed", missed); r.put("bytes", bytes); r.put("stopped", dlStop); r.put("refused", refused);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject("Nightvault may not write in this folder - pick it again", "permission");
            } catch (IllegalStateException e) {
                call.reject(e.getMessage(), "unreachable");
            } catch (Exception e) {
                call.reject("Could not save the pictures: " + e.getMessage());
            }
        }).start();
    }

    private static boolean isWebp(byte[] d) {
        return d.length > 12 && d[0] == 'R' && d[1] == 'I' && d[2] == 'F' && d[3] == 'F' && d[8] == 'W' && d[9] == 'E' && d[10] == 'B' && d[11] == 'P';
    }

    @SuppressWarnings("deprecation")
    private static byte[] toWebp(byte[] d, int q) {
        try {
            android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeByteArray(d, 0, d.length);
            if (bm == null) return null;
            ByteArrayOutputStream o = new ByteArrayOutputStream(Math.max(4096, d.length / 3));
            android.graphics.Bitmap.CompressFormat fmt = android.os.Build.VERSION.SDK_INT >= 30 ? android.graphics.Bitmap.CompressFormat.WEBP_LOSSY : android.graphics.Bitmap.CompressFormat.WEBP;
            boolean ok = bm.compress(fmt, q, o);
            bm.recycle();
            return ok ? o.toByteArray() : null;
        } catch (Throwable t) { Log.w("NvFiles", "webp: " + t); return null; }
    }

    private static String ensureDir(ContentResolver cr, Uri tree, HashMap<String, String> ids, String path) throws IOException {
        String known = ids.get(path);
        if (known != null) return known;
        int k = path.lastIndexOf('/');
        String parent = ensureDir(cr, tree, ids, k < 0 ? "" : path.substring(0, k)), leaf = k < 0 ? path : path.substring(k + 1), found = null;
        try (Cursor q = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent),
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (q == null) throw new IllegalStateException("The folder can't be reached right now - is the SD card in the phone?");
            while (q.moveToNext()) if (leaf.equals(q.getString(1)) && DocumentsContract.Document.MIME_TYPE_DIR.equals(q.getString(2))) { found = q.getString(0); break; }
        }
        if (found == null) {
            Uri d = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, parent), DocumentsContract.Document.MIME_TYPE_DIR, leaf);
            if (d == null) throw new IOException("the folder did not make the folder " + leaf);
            found = DocumentsContract.getDocumentId(d);
        }
        ids.put(path, found);
        return found;
    }

    private static HashSet<String> namesIn(ContentResolver cr, Uri tree, String dirId) {
        HashSet<String> out = new HashSet<>();
        try (Cursor q = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId), new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (q == null) throw new IllegalStateException("The folder can't be reached right now - is the SD card in the phone?");
            while (q.moveToNext()) out.add(q.getString(0));
        }
        return out;
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".avif")) return "image/avif";
        if (n.endsWith(".gif")) return "image/gif";
        return "image/jpeg";
    }

    /** one picture as bytes; null = the site says no (403/404) or kept failing. Waits and tries again on 429/503/network errors (like the PC downloaders). */
    private byte[] httpGet(String url) throws IOException {
        IOException last = null;
        long wait = 5000;
        for (int attempt = 0; attempt < 4 && !dlStop; attempt++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(20000); c.setReadTimeout(60000); c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "Nightvault (personal card collection app)");
                c.setRequestProperty("Accept", "image/*,*/*;q=0.8");
                int rc = c.getResponseCode();
                if (rc == 200) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream(1 << 17);
                    try (InputStream in = c.getInputStream()) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > 30 * 1024 * 1024) throw new IOException("picture too big"); }
                    }
                    return bo.toByteArray();
                }
                if (rc == 403 || rc == 404 || rc == 410) return null;
                String ra = c.getHeaderField("Retry-After");
                if ((rc == 429 || rc == 503) && ra != null && ra.matches("\\d{1,3}")) wait = Math.max(wait, Long.parseLong(ra) * 1000);
                last = new IOException("HTTP " + rc);
            } catch (IOException e) { last = e; }
            finally { if (c != null) c.disconnect(); }
            if (attempt < 3) {
                for (long w = 0; w < wait && !dlStop; w += 250) try { Thread.sleep(250); } catch (InterruptedException e) { dlStop = true; }
                wait *= 3;
            }
        }
        if (last != null && !dlStop) throw last;
        return null;
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
        MIME.put("mkv", "video/x-matroska"); MIME.put("m4v", "video/mp4"); MIME.put("mov", "video/mp4"); MIME.put("avi", "video/x-msvideo");
        MIME.put("ts", "video/mp2t"); MIME.put("3gp", "video/3gpp"); MIME.put("srt", "text/plain"); MIME.put("vtt", "text/vtt"); MIME.put("ass", "text/plain");
        MIME.put("pdf", "application/pdf"); MIME.put("epub", "application/epub+zip"); MIME.put("cbz", "application/zip");
    }


    /* ---------- a folder of web files (an offline copy of a web app the owner put on the phone himself), served as https://cardmaker.nightvault.local/<path>
       - its own origin, so the pages cannot read Nightvault's data. Nothing of it is shipped with Nightvault. ---------- */
    static final String SITE_HOST = "cardmaker.nightvault.local";
    static volatile String siteTree = null;
    private static final HashMap<String, String[]> siteIds = new HashMap<>();   // path -> {document id, "d" folder | "f" file}
    private static final Map<String, String> SITE_MIME = new HashMap<>();
    static {
        SITE_MIME.put("html", "text/html"); SITE_MIME.put("htm", "text/html"); SITE_MIME.put("js", "application/javascript"); SITE_MIME.put("mjs", "application/javascript");
        SITE_MIME.put("css", "text/css"); SITE_MIME.put("json", "application/json"); SITE_MIME.put("svg", "image/svg+xml"); SITE_MIME.put("gif", "image/gif");
        SITE_MIME.put("ico", "image/x-icon"); SITE_MIME.put("woff", "font/woff"); SITE_MIME.put("woff2", "font/woff2"); SITE_MIME.put("ttf", "font/ttf"); SITE_MIME.put("otf", "font/otf");
        SITE_MIME.put("txt", "text/plain"); SITE_MIME.put("xml", "application/xml"); SITE_MIME.put("map", "application/json"); SITE_MIME.put("wasm", "application/wasm");
        SITE_MIME.put("webmanifest", "application/manifest+json"); SITE_MIME.put("md", "text/plain");
    }
    /** what the web app's pages get added: downloads (blob / data links) are handed to the parent page instead of being lost */
    private static final String SITE_HOOK =
        "<script>(function(){if(window.__nvcm)return;window.__nvcm=1;"
        + "function h(a){var name=a.getAttribute('download')||'file';fetch(a.href).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();"
        + "f.onloadend=function(){parent.postMessage({nvcm:'save',name:name,type:b.type||'application/octet-stream',b64:String(f.result).split(',')[1]||''},'*')};f.readAsDataURL(b)})}"
        + "var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download')&&this.href){h(this);return}oc.call(this)};"
        + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;if(!a||!a.href)return;e.preventDefault();e.stopPropagation();h(a)},true);"
        + "})();</script>";

    private static String[] siteFind(ContentResolver cr, Uri tree, String path) {
        synchronized (siteIds) {
            String[] known = siteIds.get(path);
            if (known != null) return known;
            String docId = DocumentsContract.getTreeDocumentId(tree), kind = "d", cur = "";
            for (String seg : path.split("/")) {
                if (seg.isEmpty()) continue;
                cur = cur + "/" + seg;
                String[] k = siteIds.get(cur);
                if (k == null) {
                    String id = null, mime = null;
                    try (Cursor q = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId),
                            new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                        if (q != null) while (q.moveToNext()) if (seg.equals(q.getString(1))) { id = q.getString(0); mime = q.getString(2); break; }
                    }
                    if (id == null) return null;
                    k = new String[]{id, DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) ? "d" : "f"};
                    siteIds.put(cur, k);
                }
                docId = k[0]; kind = k[1];
            }
            String[] r = new String[]{docId, kind};
            siteIds.put(path, r);
            return r;
        }
    }

    @PluginMethod
    public void siteOpen(PluginCall call) {
        String t = call.getString("tree");
        if (t == null) { call.reject("No folder"); return; }
        new Thread(() -> {
            try {
                Uri tree = Uri.parse(t);
                synchronized (siteIds) { siteIds.clear(); }
                siteTree = t;
                String[] idx = siteFind(getContext().getContentResolver(), tree, "index.html");
                JSObject o = new JSObject();
                o.put("hasIndex", idx != null && "f".equals(idx[1]));
                o.put("host", SITE_HOST);
                call.resolve(o);
            } catch (SecurityException e) {
                call.reject("Nightvault may no longer read this folder - pick it again", "permission");
            } catch (Exception e) {
                call.reject("Could not read the folder: " + e.getMessage());
            }
        }).start();
    }

    static WebResourceResponse serveSite(Context ctx, Uri url) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-cache");
        try {
            String t = siteTree;
            if (t == null) throw new IOException("no folder chosen");
            String path = Uri.decode(url.getEncodedPath() == null ? "" : url.getEncodedPath());
            while (path.startsWith("/")) path = path.substring(1);
            if (path.contains("..")) throw new IOException("bad path");
            if (path.isEmpty() || path.endsWith("/")) path = path + "index.html";
            ContentResolver cr = ctx.getContentResolver();
            Uri tree = Uri.parse(t);
            String[] f = siteFind(cr, tree, path);
            if (f != null && "d".equals(f[1])) { path = path + "/index.html"; f = siteFind(cr, tree, path); }
            if (f == null || !"f".equals(f[1])) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new java.io.ByteArrayInputStream("not found".getBytes()));
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, f[0]);
            String ext = path.contains(".") ? path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
            String mime = SITE_MIME.containsKey(ext) ? SITE_MIME.get(ext) : MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            boolean text = mime.startsWith("text/") || mime.equals("application/javascript") || mime.equals("application/json") || mime.equals("image/svg+xml");
            if (mime.equals("text/html")) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                try (InputStream in = open(ctx, doc, 0)) { byte[] buf = new byte[16384]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); }
                String html = bo.toString("UTF-8");
                int at = html.toLowerCase(Locale.ROOT).indexOf("<head");
                if (at >= 0) { int close = html.indexOf('>', at); html = html.substring(0, close + 1) + SITE_HOOK + html.substring(close + 1); }
                else html = SITE_HOOK + html;
                return new WebResourceResponse(mime, "utf-8", 200, "OK", h, new java.io.ByteArrayInputStream(html.getBytes("UTF-8")));
            }
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", h, open(ctx, doc, 0));
        } catch (SecurityException e) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", h, new java.io.ByteArrayInputStream("no permission".getBytes()));
        } catch (Exception e) {
            Log.w("NvFiles", "site serve failed for " + url, e);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new java.io.ByteArrayInputStream(("not found: " + e.getMessage()).getBytes()));
        }
    }

    static WebResourceResponse serve(Context ctx, WebResourceRequest req) {
        Uri url = req.getUrl();
        if (SITE_HOST.equals(url.getHost())) return serveSite(ctx, url);
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
