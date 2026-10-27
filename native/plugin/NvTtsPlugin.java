package be.brokeuh.nightvault;

import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Read aloud (Audiobooks: EPUBs from Bookcase). Turns a piece of text into a WAV file with one of the phone's text-to-speech
 * engines (Google's, or a natural-voice engine the owner installed, e.g. a Kokoro / sherpa-onnx engine app), so the normal
 * audiobook player can play it. The page asks for the next pieces ahead of time; old files are cleaned up automatically.
 * The file is played through NvFiles' /_nvfile_/ address (it accepts file:// addresses too).
 */
@CapacitorPlugin(name = "NvTts")
public class NvTtsPlugin extends Plugin {
    private TextToSpeech tts;
    private String ttsEngine = null;          // the engine the current TextToSpeech was made for ("" = the phone's default)
    private boolean ready = false;
    private final List<Runnable> waiting = new ArrayList<>();
    private final List<PluginCall> waitingFail = new ArrayList<>();
    private final Map<String, PluginCall> jobs = new HashMap<>();
    private final Map<String, File> jobFiles = new HashMap<>();

    private File dir() { File d = new File(getContext().getCacheDir(), "tts"); d.mkdirs(); return d; }

    /** make sure a TextToSpeech for this engine is ready, then run 'then' (or reject 'call') */
    private synchronized void ensure(String engine, PluginCall call, Runnable then) {
        String e = engine == null ? "" : engine;
        if (tts != null && e.equals(ttsEngine)) {
            if (ready) { then.run(); return; }
            waiting.add(then); waitingFail.add(call); return;
        }
        if (tts != null) { try { tts.shutdown(); } catch (Exception x) {} }
        ready = false; ttsEngine = e; waiting.clear(); waitingFail.clear();
        waiting.add(then); waitingFail.add(call);
        TextToSpeech.OnInitListener init = status -> {
            List<Runnable> go; List<PluginCall> fail;
            synchronized (NvTtsPlugin.this) { go = new ArrayList<>(waiting); fail = new ArrayList<>(waitingFail); waiting.clear(); waitingFail.clear(); ready = status == TextToSpeech.SUCCESS; }
            if (status != TextToSpeech.SUCCESS) { for (PluginCall c : fail) if (c != null) c.reject("The voice engine could not start (" + status + ")", "engine"); return; }
            tts.setOnUtteranceProgressListener(listener);
            for (Runnable r : go) r.run();
        };
        tts = e.isEmpty() ? new TextToSpeech(getContext(), init) : new TextToSpeech(getContext(), init, e);
    }

    private final UtteranceProgressListener listener = new UtteranceProgressListener() {
        @Override public void onStart(String id) {}
        @Override public void onDone(String id) {
            PluginCall c; File f;
            synchronized (NvTtsPlugin.this) { c = jobs.remove(id); f = jobFiles.remove(id); }
            if (c == null) return;
            if (f == null || !f.exists() || f.length() < 100) { c.reject("The voice engine made no sound for this piece", "empty"); return; }
            JSObject o = new JSObject();
            o.put("uri", Uri.fromFile(f).toString());
            o.put("size", f.length());
            c.resolve(o);
        }
        @Override public void onError(String id) { onError(id, -1); }
        @Override public void onError(String id, int code) {
            PluginCall c; synchronized (NvTtsPlugin.this) { c = jobs.remove(id); jobFiles.remove(id); }
            if (c != null) c.reject("The voice engine failed (" + code + ")", "synth");
        }
    };

    /** the text-to-speech engines on this phone: [{name, label}], and which one is the phone's default */
    @PluginMethod
    public void engines(PluginCall call) {
        ensure(call.getString("engine", ""), call, () -> {
            JSArray a = new JSArray();
            for (TextToSpeech.EngineInfo e : tts.getEngines()) { JSObject o = new JSObject(); o.put("name", e.name); o.put("label", e.label); a.put(o); }
            JSObject r = new JSObject();
            r.put("engines", a);
            r.put("default", tts.getDefaultEngine());
            call.resolve(r);
        });
    }

    /** the voices of an engine: [{name, lang, quality, latency, network, installed}] */
    @PluginMethod
    public void voices(PluginCall call) {
        ensure(call.getString("engine", ""), call, () -> {
            JSArray a = new JSArray();
            try {
                for (Voice v : tts.getVoices()) {
                    JSObject o = new JSObject();
                    o.put("name", v.getName());
                    o.put("lang", v.getLocale() == null ? "" : v.getLocale().toLanguageTag());
                    o.put("quality", v.getQuality());
                    o.put("latency", v.getLatency());
                    o.put("network", v.isNetworkConnectionRequired());
                    o.put("installed", v.getFeatures() == null || !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
                    a.put(o);
                }
            } catch (Exception e) { Log.w("NvTts", "voices", e); }
            JSObject r = new JSObject();
            r.put("voices", a);
            try { Voice d = tts.getDefaultVoice(); r.put("default", d == null ? "" : d.getName()); } catch (Exception e) { r.put("default", ""); }
            call.resolve(r);
        });
    }

    /** turn text into a WAV file: {text, engine?, voice?, lang?, id?} → {uri, size}.  engine "@nv" = Nightvault's own voices (voice "<pack>#<speaker>") */
    @PluginMethod
    public void synth(PluginCall call) {
        String text = call.getString("text", "");
        if (text.trim().isEmpty()) { call.reject("No text", "empty"); return; }
        if (NV.equals(call.getString("engine", ""))) { nvSynth(call, text); return; }
        ensure(call.getString("engine", ""), call, () -> {
            try {
                String vn = call.getString("voice", ""), lang = call.getString("lang", "");
                Voice pick = null;
                if (!vn.isEmpty()) for (Voice v : tts.getVoices()) if (v.getName().equals(vn)) { pick = v; break; }
                if (pick != null) tts.setVoice(pick);
                else if (!lang.isEmpty()) tts.setLanguage(Locale.forLanguageTag(lang));
                int max = TextToSpeech.getMaxSpeechInputLength();
                String t = text.length() > max ? text.substring(0, max) : text;
                String id = UUID.randomUUID().toString();
                String name = call.getString("id", id).replaceAll("[^A-Za-z0-9_.-]", "_");
                File f = new File(dir(), name + ".wav");
                tidy();
                synchronized (this) { jobs.put(id, call); jobFiles.put(id, f); }
                int r = tts.synthesizeToFile(t, new Bundle(), f, id);
                if (r != TextToSpeech.SUCCESS) { synchronized (this) { jobs.remove(id); jobFiles.remove(id); } call.reject("The voice engine refused this piece", "synth"); }
            } catch (Exception e) { call.reject("Read aloud failed: " + e.getMessage(), "synth"); }
        });
    }

    /** keep only the newest pieces (the page keeps at most 8 of them in use) */
    private void tidy() {
        File[] l = dir().listFiles((d, n) -> n.endsWith(".wav"));
        if (l == null || l.length <= 14) return;
        Arrays.sort(l, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = 14; i < l.length; i++) l[i].delete();
    }

    /* ---------- Nightvault's own natural voices: sherpa-onnx (Kokoro for English, Piper for Dutch), packs downloaded once ---------- */
    static final String NV = "@nv";
    private final ExecutorService work = Executors.newSingleThreadExecutor();     // one voice at a time, in order
    private OfflineTts nvTts; private String nvId = null;
    private File voicesDir() { File d = new File(getContext().getFilesDir(), "voices"); d.mkdirs(); return d; }
    private static String readAll(File f) throws Exception { try (InputStream in = new FileInputStream(f)) { java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); return o.toString("UTF-8"); } }

    private synchronized OfflineTts nvLoad(String id) throws Exception {
        if (nvTts != null && id.equals(nvId)) return nvTts;
        if (nvTts != null) { try { nvTts.release(); } catch (Throwable t) {} nvTts = null; nvId = null; }
        File d = new File(voicesDir(), id), cf = new File(d, "nv.json");
        if (!cf.exists()) throw new Exception("This voice is not downloaded yet");
        JSONObject c = new JSONObject(readAll(cf));
        String kind = c.optString("kind", "vits");
        OfflineTtsModelConfig mc = new OfflineTtsModelConfig();
        if ("kokoro".equals(kind)) {
            OfflineTtsKokoroModelConfig k = new OfflineTtsKokoroModelConfig();
            k.setModel(new File(d, c.getString("model")).getAbsolutePath());
            k.setVoices(new File(d, c.optString("voices", "voices.bin")).getAbsolutePath());
            k.setTokens(new File(d, c.optString("tokens", "tokens.txt")).getAbsolutePath());
            k.setDataDir(new File(d, c.optString("dataDir", "espeak-ng-data")).getAbsolutePath());
            mc.setKokoro(k);
        } else {
            OfflineTtsVitsModelConfig v = new OfflineTtsVitsModelConfig();
            v.setModel(new File(d, c.getString("model")).getAbsolutePath());
            v.setTokens(new File(d, c.optString("tokens", "tokens.txt")).getAbsolutePath());
            v.setDataDir(new File(d, c.optString("dataDir", "espeak-ng-data")).getAbsolutePath());
            mc.setVits(v);
        }
        mc.setNumThreads(Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 2)));
        mc.setProvider("cpu");
        OfflineTtsConfig cfg = new OfflineTtsConfig();
        cfg.setModel(mc);
        long t0 = System.currentTimeMillis();
        nvTts = new OfflineTts((android.content.res.AssetManager) null, cfg);
        nvId = id;
        Log.d("NvTts", "voice " + id + " loaded in " + (System.currentTimeMillis() - t0) + " ms, " + nvTts.numSpeakers() + " speakers");
        return nvTts;
    }

    private void nvSynth(PluginCall call, String text) {
        work.execute(() -> {
            try {
                String v = call.getString("voice", ""); int h = v.indexOf('#');
                String id = h >= 0 ? v.substring(0, h) : v; int sid = 0;
                try { sid = h >= 0 ? Integer.parseInt(v.substring(h + 1)) : 0; } catch (Exception e) { sid = 0; }
                if (id.isEmpty()) throw new Exception("Pick a voice first");
                OfflineTts t = nvLoad(id);
                long t0 = System.currentTimeMillis();
                GeneratedAudio a = t.generate(text, sid, 1.0f);
                String name = call.getString("id", UUID.randomUUID().toString()).replaceAll("[^A-Za-z0-9_.-]", "_");
                File f = new File(dir(), name + ".wav");
                tidy();
                if (!a.save(f.getAbsolutePath()) || !f.exists()) throw new Exception("Could not save the sound");
                float secs = a.getSamples().length / (float) a.getSampleRate();
                Log.d("NvTts", "made " + secs + " s of speech in " + (System.currentTimeMillis() - t0) + " ms");
                JSObject o = new JSObject();
                o.put("uri", Uri.fromFile(f).toString());
                o.put("size", f.length());
                o.put("secs", secs);
                o.put("ms", System.currentTimeMillis() - t0);
                call.resolve(o);
            } catch (Throwable e) { Log.w("NvTts", "built-in voice", e); call.reject("The voice failed: " + e.getMessage(), "nv"); }
        });
    }

    /** the voice packs on this phone: [{id, kind, size}] */
    @PluginMethod
    public void installed(PluginCall call) {
        JSArray a = new JSArray();
        File[] l = voicesDir().listFiles();
        if (l != null) for (File d : l) {
            File cf = new File(d, "nv.json"); if (!d.isDirectory() || !cf.exists()) continue;
            try { JSONObject c = new JSONObject(readAll(cf)); JSObject o = new JSObject(); o.put("id", d.getName()); o.put("kind", c.optString("kind")); o.put("lang", c.optString("lang")); o.put("size", size(d)); a.put(o); } catch (Exception e) {}
        }
        JSObject r = new JSObject(); r.put("voices", a); call.resolve(r);
    }
    private static long size(File f) { if (f.isFile()) return f.length(); long n = 0; File[] l = f.listFiles(); if (l != null) for (File x : l) n += size(x); return n; }
    private static void wipe(File f) { File[] l = f.listFiles(); if (l != null) for (File x : l) wipe(x); f.delete(); }

    /** download a voice pack once: {id, url, cfg:{kind, model, voices, tokens, dataDir, lang}}; events "voiceProgress" {id, done, total, step} */
    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id", "").replaceAll("[^A-Za-z0-9_.-]", "_"), url = call.getString("url", "");
        JSObject cfg = call.getObject("cfg", new JSObject());
        if (id.isEmpty() || !url.startsWith("https://")) { call.reject("No voice to download"); return; }
        new Thread(() -> {
            File zip = new File(voicesDir(), id + ".zip.part"), tmp = new File(voicesDir(), id + ".tmp"), dst = new File(voicesDir(), id);
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true); c.setConnectTimeout(20000); c.setReadTimeout(60000);
                int code = c.getResponseCode();
                for (int i = 0; i < 5 && (code == 301 || code == 302 || code == 303 || code == 307 || code == 308); i++) {
                    String loc = c.getHeaderField("Location"); c.disconnect(); c = (HttpURLConnection) new URL(new URL(url), loc).openConnection(); c.setConnectTimeout(20000); c.setReadTimeout(60000); code = c.getResponseCode();
                }
                if (code != 200) throw new Exception("the download answered " + code);
                long total = c.getContentLengthLong(), done = 0, lastSent = 0;
                try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream out = new FileOutputStream(zip)) {
                    byte[] b = new byte[65536]; int n;
                    while ((n = in.read(b)) > 0) { out.write(b, 0, n); done += n;
                        if (done - lastSent > 1_000_000) { lastSent = done; JSObject p = new JSObject(); p.put("id", id); p.put("done", done); p.put("total", total); p.put("step", "download"); notifyListeners("voiceProgress", p); } }
                }
                JSObject p = new JSObject(); p.put("id", id); p.put("step", "unpack"); p.put("done", done); p.put("total", total); notifyListeners("voiceProgress", p);
                wipe(tmp); tmp.mkdirs();
                String root = tmp.getCanonicalPath() + File.separator;
                try (ZipInputStream zin = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
                    ZipEntry e; byte[] b = new byte[65536];
                    while ((e = zin.getNextEntry()) != null) {
                        File f = new File(tmp, e.getName()); if (!f.getCanonicalPath().startsWith(root)) continue;   // stay inside the folder
                        if (e.isDirectory()) { f.mkdirs(); continue; }
                        f.getParentFile().mkdirs();
                        try (OutputStream out = new FileOutputStream(f)) { int n; while ((n = zin.read(b)) > 0) out.write(b, 0, n); }
                    }
                }
                try (OutputStream o = new FileOutputStream(new File(tmp, "nv.json"))) { o.write(cfg.toString().getBytes(StandardCharsets.UTF_8)); }
                synchronized (this) { if (id.equals(nvId) && nvTts != null) { try { nvTts.release(); } catch (Throwable t) {} nvTts = null; nvId = null; } }
                wipe(dst); if (!tmp.renameTo(dst)) throw new Exception("could not put the voice in place");
                zip.delete();
                JSObject r = new JSObject(); r.put("id", id); r.put("size", size(dst)); call.resolve(r);
            } catch (Throwable e) { Log.w("NvTts", "download " + id, e); zip.delete(); wipe(tmp); call.reject("The voice could not be downloaded: " + e.getMessage(), "download"); }
        }).start();
    }

    @PluginMethod
    public void removeVoice(PluginCall call) {
        String id = call.getString("id", "").replaceAll("[^A-Za-z0-9_.-]", "_");
        synchronized (this) { if (id.equals(nvId) && nvTts != null) { try { nvTts.release(); } catch (Throwable t) {} nvTts = null; nvId = null; } }
        if (!id.isEmpty()) wipe(new File(voicesDir(), id));
        call.resolve();
    }

    /** the phone's own settings screen for text-to-speech (to install or pick voices) */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            android.content.Intent i = new android.content.Intent("com.android.settings.TTS_SETTINGS");
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("Could not open the settings: " + e.getMessage()); }
    }

    @Override
    protected void handleOnDestroy() { if (tts != null) try { tts.shutdown(); } catch (Exception e) {} }
}
