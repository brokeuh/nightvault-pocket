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

import java.io.File;
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

    /** turn text into a WAV file: {text, engine?, voice?, lang?, id?} → {uri, size} */
    @PluginMethod
    public void synth(PluginCall call) {
        String text = call.getString("text", "");
        if (text.trim().isEmpty()) { call.reject("No text", "empty"); return; }
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
