package be.brokeuh.nightvault;

import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Nightvault Cinema: play on the TV (DLNA / UPnP, an open standard in Samsung, LG, Sony, Philips … TVs). This is NOT screen casting:
 * the phone only tells the TV which address to play, the TV fetches the video itself (from the PC, or from this phone) in full quality.
 *   discover({timeout})          – the TVs on this Wi-Fi that can play videos (SSDP M-SEARCH for MediaRenderer): [{location, server, usn}]
 *   get({url})                   – a plain http GET (the TV's description), {status, text}
 *   soap({url, service, action, body}) – one UPnP command (SetAVTransportURI, Play, Pause, Seek, GetPositionInfo …), {status, text}
 *   ip()                         – this phone's address on the Wi-Fi
 *   share({uri | text, name, mime, cap}) – serve a file from a phone folder (content:// uri) or a text (a subtitle) to the TV:
 *                                  {url} = http://<phone>:8767/m/<token>/<name>, with byte ranges and the DLNA headers
 *                                  (cap = a subtitle address for Samsung's CaptionInfo.sec header)
 *   unshare({token})             – stop serving one (or everything without a token)
 */
@CapacitorPlugin(name = "NvTv")
public class NvTvPlugin extends Plugin {
    private static final String TAG = "NvTv";
    private static final int PORT = 8767;
    private static final String DLNA = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

    private static class Item { Uri uri; byte[] text; String name; String mime; String cap; }
    private final Map<String, Item> shared = new ConcurrentHashMap<>();
    private ServerSocket server = null;
    private int port = 0;

    @PluginMethod
    public void discover(PluginCall call) {
        final int timeout = call.getInt("timeout", 3000);
        new Thread(() -> {
            WifiManager.MulticastLock lock = null;
            DatagramSocket s = null;
            try {
                WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { lock = wm.createMulticastLock("nvtv"); lock.setReferenceCounted(false); lock.acquire(); }
                s = new DatagramSocket(null);
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(0));
                s.setSoTimeout(400);
                InetAddress group = InetAddress.getByName("239.255.255.250");
                String[] targets = {"urn:schemas-upnp-org:device:MediaRenderer:1", "urn:schemas-upnp-org:service:AVTransport:1"};
                Map<String, JSObject> found = new LinkedHashMap<>();
                long end = System.currentTimeMillis() + timeout, nextSend = 0;
                int sent = 0;
                byte[] buf = new byte[4096];
                while (System.currentTimeMillis() < end) {
                    if (sent < 3 && System.currentTimeMillis() >= nextSend) {
                        for (String st : targets) {
                            String msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\nUSER-AGENT: Android UPnP/1.1 Nightvault/1\r\n\r\n";
                            byte[] b = msg.getBytes(StandardCharsets.US_ASCII);
                            s.send(new DatagramPacket(b, b.length, group, 1900));
                        }
                        sent++;
                        nextSend = System.currentTimeMillis() + 700;
                    }
                    try {
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        s.receive(p);
                        String txt = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                        String loc = header(txt, "LOCATION");
                        if (loc == null || found.containsKey(loc)) continue;
                        JSObject o = new JSObject();
                        o.put("location", loc);
                        o.put("server", nz(header(txt, "SERVER")));
                        o.put("usn", nz(header(txt, "USN")));
                        o.put("st", nz(header(txt, "ST")));
                        found.put(loc, o);
                    } catch (SocketTimeoutException e) { /* keep listening until the time is up */ }
                }
                JSArray arr = new JSArray();
                for (JSObject o : found.values()) arr.put(o);
                JSObject r = new JSObject();
                r.put("tvs", arr);
                call.resolve(r);
            } catch (Exception e) {
                Log.w(TAG, "discover failed", e);
                call.reject("Could not look for TVs: " + e.getMessage());
            } finally {
                if (s != null) s.close();
                if (lock != null) try { lock.release(); } catch (Exception e) { /* already released */ }
            }
        }).start();
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static String header(String txt, String name) {
        for (String line : txt.split("\r?\n")) {
            int i = line.indexOf(':');
            if (i > 0 && line.substring(0, i).trim().equalsIgnoreCase(name)) return line.substring(i + 1).trim();
        }
        return null;
    }

    @PluginMethod
    public void get(PluginCall call) {
        final String url = call.getString("url", "");
        final int timeout = call.getInt("timeout", 5000);
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(timeout); c.setReadTimeout(timeout);
                int code = c.getResponseCode();
                JSObject o = new JSObject();
                o.put("status", code);
                o.put("text", readAll(code >= 400 ? c.getErrorStream() : c.getInputStream()));
                call.resolve(o);
            } catch (Exception e) {
                call.reject("The TV did not answer: " + e.getMessage());
            } finally { if (c != null) c.disconnect(); }
        }).start();
    }

    @PluginMethod
    public void soap(PluginCall call) {
        final String url = call.getString("url", ""), service = call.getString("service", ""), action = call.getString("action", ""), body = call.getString("body", "");
        final int timeout = call.getInt("timeout", 8000);
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                String env = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
                        + "<u:" + action + " xmlns:u=\"" + service + "\">" + body + "</u:" + action + "></s:Body></s:Envelope>";
                byte[] out = env.getBytes(StandardCharsets.UTF_8);
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(timeout); c.setReadTimeout(timeout);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
                c.setRequestProperty("SOAPACTION", "\"" + service + "#" + action + "\"");
                c.setFixedLengthStreamingMode(out.length);
                try (OutputStream o = c.getOutputStream()) { o.write(out); }
                int code = c.getResponseCode();
                JSObject o = new JSObject();
                o.put("status", code);
                o.put("text", readAll(code >= 400 ? c.getErrorStream() : c.getInputStream()));
                call.resolve(o);
            } catch (Exception e) {
                call.reject("The TV did not answer: " + e.getMessage());
            } finally { if (c != null) c.disconnect(); }
        }).start();
    }

    @PluginMethod
    public void ip(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ip", wifiIp());
        call.resolve(o);
    }

    private static String wifiIp() {
        String best = "";
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    String n = ni.getName().toLowerCase();
                    if (n.startsWith("wlan") || n.startsWith("eth")) return a.getHostAddress();
                    if (best.isEmpty()) best = a.getHostAddress();
                }
            }
        } catch (Exception e) { /* no network */ }
        return best;
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            startServer();
            Item it = new Item();
            String uri = call.getString("uri", null), text = call.getString("text", null);
            if (uri != null && !uri.isEmpty()) it.uri = Uri.parse(uri);
            else if (text != null) it.text = text.getBytes(StandardCharsets.UTF_8);
            else { call.reject("Nothing to share"); return; }
            it.name = call.getString("name", "video");
            it.mime = call.getString("mime", "video/mp4");
            it.cap = call.getString("cap", null);
            String token = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
            shared.put(token, it);
            JSObject o = new JSObject();
            o.put("token", token);
            o.put("url", "http://" + wifiIp() + ":" + port + "/m/" + token + "/" + Uri.encode(it.name));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("Could not share the file with the TV: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unshare(PluginCall call) {
        String t = call.getString("token", null);
        if (t == null) shared.clear(); else shared.remove(t);
        call.resolve();
    }

    private synchronized void startServer() throws IOException {
        if (server != null && !server.isClosed()) return;
        ServerSocket ss;
        try { ss = new ServerSocket(PORT); } catch (IOException e) { ss = new ServerSocket(0); }
        server = ss;
        port = ss.getLocalPort();
        final ServerSocket srv = ss;
        Thread t = new Thread(() -> {
            while (!srv.isClosed()) {
                try {
                    final Socket sock = srv.accept();
                    new Thread(() -> answer(sock)).start();
                } catch (IOException e) { if (srv.isClosed()) break; }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    /** one request from the TV: GET or HEAD /m/<token>/<name>, with a byte range */
    private void answer(Socket sock) {
        try (Socket s = sock) {
            s.setSoTimeout(30000);
            InputStream in = s.getInputStream();
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.ISO_8859_1));
            String first = r.readLine();
            if (first == null) return;
            String[] req = first.split(" ");
            String range = null, line;
            while ((line = r.readLine()) != null && !line.isEmpty()) {
                int i = line.indexOf(':');
                if (i > 0 && line.substring(0, i).trim().equalsIgnoreCase("Range")) range = line.substring(i + 1).trim();
            }
            OutputStream out = s.getOutputStream();
            String path = req.length > 1 ? req[1] : "";
            String[] p = path.split("/");
            Item it = p.length > 2 && "m".equals(p[1]) ? shared.get(p[2]) : null;
            if (it == null) { write(out, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return; }
            boolean head = "HEAD".equalsIgnoreCase(req[0]);
            long size = it.text != null ? it.text.length : sizeOf(it.uri);
            long start = 0, end = size - 1;
            boolean partial = false;
            if (range != null && range.startsWith("bytes=") && size > 0) {
                String[] a = range.substring(6).split(",")[0].trim().split("-", -1);
                if (a[0].isEmpty()) start = Math.max(0, size - Long.parseLong(a[1]));
                else { start = Long.parseLong(a[0]); if (a.length > 1 && !a[1].isEmpty()) end = Math.min(Long.parseLong(a[1]), size - 1); }
                partial = true;
                if (start >= size) { write(out, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return; }
            }
            StringBuilder h = new StringBuilder();
            h.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            h.append("Content-Type: ").append(it.mime).append("\r\n");
            h.append("Accept-Ranges: bytes\r\n");
            if (size >= 0) h.append("Content-Length: ").append(end - start + 1).append("\r\n");
            if (partial) h.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(size).append("\r\n");
            h.append("contentFeatures.dlna.org: ").append(DLNA).append("\r\n");
            h.append("transferMode.dlna.org: Streaming\r\n");
            if (it.cap != null && !it.cap.isEmpty()) h.append("CaptionInfo.sec: ").append(it.cap).append("\r\n");
            h.append("Server: Android UPnP/1.0 Nightvault/1\r\nConnection: close\r\n\r\n");
            write(out, h.toString());
            if (head) return;
            if (it.text != null) { out.write(it.text, (int) start, (int) (end - start + 1)); out.flush(); return; }
            try (ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(it.uri, "r")) {
                if (pfd == null) return;
                try (FileInputStream fin = new FileInputStream(pfd.getFileDescriptor())) {
                    FileChannel ch = fin.getChannel();
                    try { ch.position(start); } catch (Exception e) { long left = start; while (left > 0) { long k = fin.skip(left); if (k <= 0) break; left -= k; } }
                    byte[] b = new byte[262144];
                    long left = size < 0 ? Long.MAX_VALUE : end - start + 1;
                    int n;
                    while (left > 0 && (n = fin.read(b, 0, (int) Math.min(b.length, left))) > 0) { out.write(b, 0, n); left -= n; }
                    out.flush();
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "TV request ended: " + e.getMessage());
        }
    }

    private long sizeOf(Uri u) {
        ContentResolver cr = getContext().getContentResolver();
        try (AssetFileDescriptor a = cr.openAssetFileDescriptor(u, "r")) {
            if (a != null && a.getLength() >= 0) return a.getLength();
        } catch (Exception e) { /* ask the folder instead */ }
        try (Cursor c = cr.query(u, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception e) { /* unknown */ }
        return -1;
    }

    private static void write(OutputStream o, String s) throws IOException { o.write(s.getBytes(StandardCharsets.ISO_8859_1)); o.flush(); }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        in.close();
        return o.toString("UTF-8");
    }

    @Override
    protected void handleOnDestroy() {
        try { if (server != null) server.close(); } catch (IOException e) { /* closing */ }
        shared.clear();
    }
}
