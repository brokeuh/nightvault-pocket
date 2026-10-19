package be.brokeuh.nightvault;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Nightvault Boardgames: sends a logged play to BoardGameGeek, like BG Stats does.
 * BGG has no official "log a play" API: the website itself logs in at /login/api/v1 (user name + password, answered with
 * cookies) and saves plays with a JSON POST to /geekplay.php. This plugin does the same from Android (a web page can't:
 * BGG doesn't allow other sites to call it). The user name, password and cookies stay in this app's private storage only.
 * Methods: login({username, password}) · status() · logout() · logPlay({play}) → {playid}
 */
@CapacitorPlugin(name = "NvBgg")
public class NvBggPlugin extends Plugin {
    static final String BGG = "https://boardgamegeek.com";
    static final String UA = "Nightvault/0.1 (personal board game app)";

    SharedPreferences prefs() { return getContext().getSharedPreferences("nvbgg", Context.MODE_PRIVATE); }

    @PluginMethod
    public void status(PluginCall call) {
        SharedPreferences p = prefs();
        JSObject o = new JSObject();
        o.put("username", p.getString("user", ""));
        o.put("loggedIn", !p.getString("user", "").isEmpty() && !p.getString("pass", "").isEmpty());
        call.resolve(o);
    }

    @PluginMethod
    public void logout(PluginCall call) { prefs().edit().clear().apply(); call.resolve(); }

    @PluginMethod
    public void login(PluginCall call) {
        String user = call.getString("username", "").trim(), pass = call.getString("password", "");
        if (user.isEmpty() || pass.isEmpty()) { call.reject("Type your BGG user name and password", "input"); return; }
        new Thread(() -> {
            try {
                String cookies = doLogin(user, pass);
                prefs().edit().putString("user", user).putString("pass", pass).putString("cookies", cookies).apply();
                JSObject o = new JSObject(); o.put("username", user); o.put("loggedIn", true);
                call.resolve(o);
            } catch (BggError e) {
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                call.reject("Can't reach BoardGameGeek: " + e.getMessage(), "offline");
            }
        }).start();
    }

    /** play = {objectid, playdate 'YYYY-MM-DD', quantity, length, location, comments, players:[{name, username, score, win}]} */
    @PluginMethod
    public void logPlay(PluginCall call) {
        JSObject play = call.getObject("play");
        if (play == null) { call.reject("No play given", "input"); return; }
        new Thread(() -> {
            SharedPreferences p = prefs();
            String user = p.getString("user", ""), pass = p.getString("pass", "");
            if (user.isEmpty() || pass.isEmpty()) { call.reject("Log in to BoardGameGeek first (Boardgames → Settings)", "login"); return; }
            try {
                String body = body(play).toString();
                String cookies = p.getString("cookies", "");
                if (cookies.isEmpty()) { cookies = doLogin(user, pass); p.edit().putString("cookies", cookies).apply(); }
                Answer a = post(BGG + "/geekplay.php", body, cookies);
                if (needsLogin(a)) {                                      // the cookies ran out: log in again once
                    cookies = doLogin(user, pass); p.edit().putString("cookies", cookies).apply();
                    a = post(BGG + "/geekplay.php", body, cookies);
                }
                JSONObject j = null;
                try { j = new JSONObject(a.body); } catch (Exception ignore) {}
                if (a.code >= 400 || j == null || j.has("error") || !j.has("playid")) {
                    String why = j != null && j.has("error") ? j.optString("error") : "BGG answered " + a.code;
                    Log.w("NvBgg", "logPlay failed " + a.code + ": " + a.body.substring(0, Math.min(400, a.body.length())));
                    call.reject("BoardGameGeek did not save the play: " + why, needsLogin(a) ? "login" : "bgg");
                    return;
                }
                JSObject o = new JSObject();
                o.put("playid", j.optString("playid"));
                o.put("numplays", j.optInt("numplays", 0));
                call.resolve(o);
            } catch (BggError e) {
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                call.reject("Can't reach BoardGameGeek: " + e.getMessage(), "offline");
            }
        }).start();
    }

    /* ---------- BGG ---------- */
    static class BggError extends Exception { final String code; BggError(String m, String c) { super(m); code = c; } }
    static class Answer { int code; String body = ""; Map<String, List<String>> headers; }

    static boolean needsLogin(Answer a) {
        String b = a.body == null ? "" : a.body.toLowerCase();
        return a.code == 401 || a.code == 403 || b.contains("you must login") || b.contains("not logged in") || b.contains("login required");
    }

    static String doLogin(String user, String pass) throws Exception {
        JSONObject cred = new JSONObject(); cred.put("username", user); cred.put("password", pass);
        JSONObject j = new JSONObject(); j.put("credentials", cred);
        Answer a = post(BGG + "/login/api/v1", j.toString(), "");
        if (a.code == 401 || a.code == 400 || a.code == 403) throw new BggError("BGG did not accept that user name or password", "password");
        if (a.code >= 400) throw new BggError("BGG answered " + a.code + " while logging in", "bgg");
        Map<String, String> jar = new LinkedHashMap<>();
        if (a.headers != null) for (Map.Entry<String, List<String>> h : a.headers.entrySet()) {
            if (h.getKey() == null || !h.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String c : h.getValue()) {
                String first = c.split(";", 2)[0];
                int eq = first.indexOf('=');
                if (eq <= 0) continue;
                String name = first.substring(0, eq).trim(), value = first.substring(eq + 1).trim();
                if (value.isEmpty() || value.equalsIgnoreCase("deleted")) continue;
                jar.put(name, value);
            }
        }
        if (!jar.containsKey("bggpassword") && !jar.containsKey("SessionID")) throw new BggError("BGG did not log in (no session) - check the user name and password", "password");
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : jar.entrySet()) { if (sb.length() > 0) sb.append("; "); sb.append(e.getKey()).append('=').append(e.getValue()); }
        return sb.toString();
    }

    /** the JSON the BGG website itself sends when you save a play */
    static JSONObject body(JSObject play) throws Exception {
        String date = play.getString("playdate", "");
        int len = play.optInt("length", 0);
        JSONObject b = new JSONObject();
        b.put("playdate", date);
        b.put("date", date + "T05:00:00.000Z");
        b.put("comments", play.optString("comments", ""));
        b.put("length", len);
        b.put("hours", len / 60);
        b.put("minutes", len % 60);
        b.put("twitter", false);
        b.put("location", play.optString("location", ""));
        b.put("objectid", String.valueOf(play.opt("objectid")));
        b.put("objecttype", "thing");
        b.put("quantity", String.valueOf(Math.max(1, play.optInt("quantity", 1))));
        b.put("incomplete", false);
        b.put("nowinstats", false);
        b.put("action", "save");
        b.put("ajax", 1);
        JSONArray out = new JSONArray(), in = play.optJSONArray("players");
        if (in != null) for (int i = 0; i < in.length(); i++) {
            JSONObject x = in.optJSONObject(i);
            if (x == null) continue;
            JSONObject pl = new JSONObject();
            pl.put("name", x.optString("name", ""));
            pl.put("username", x.optString("username", ""));
            pl.put("userid", 0);
            pl.put("score", x.optString("score", ""));
            pl.put("win", x.optBoolean("win", false));
            pl.put("new", false);
            pl.put("startposition", "");
            pl.put("color", "");
            pl.put("rating", 0);
            pl.put("repeat", "true");
            pl.put("selected", false);
            out.put(pl);
        }
        b.put("players", out);
        return b;
    }

    static Answer post(String url, String json, String cookies) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(15000); c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json, text/plain, */*");
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Origin", BGG);
            c.setRequestProperty("Referer", BGG + "/");
            if (!cookies.isEmpty()) c.setRequestProperty("Cookie", cookies);
            byte[] data = json.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(data.length);
            try (OutputStream os = c.getOutputStream()) { os.write(data); }
            Answer a = new Answer();
            a.code = c.getResponseCode();
            a.headers = c.getHeaderFields();
            InputStream is = a.code >= 400 ? c.getErrorStream() : c.getInputStream();
            a.body = readAll(is);
            if (a.code >= 300 && a.code < 400) a.code = 401;             // sent to the login page
            return a;
        } finally { c.disconnect(); }
    }

    static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        is.close();
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }
}
