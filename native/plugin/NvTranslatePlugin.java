package be.brokeuh.nightvault;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.TranslateRemoteModel;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;

import java.util.HashMap;
import java.util.Map;

/**
 * Google's on-device translator (ML Kit) for Bookcase (translate the bubbles of a comic).
 *   languages()                       -> {languages:[tag,...]}
 *   status({lang})                    -> {downloaded:bool}           (is the model of that language on the phone)
 *   download({lang, wifi})            -> {ok:true}                    (about 30 MB, once; needs internet)
 *   remove({lang})                    -> {ok:true}
 *   translate({from, to, texts:[..]}) -> {texts:[..]}                 (one after the other, same order; works offline once downloaded)
 */
@CapacitorPlugin(name = "NvTranslate")
public class NvTranslatePlugin extends Plugin {
    private final Map<String, Translator> translators = new HashMap<>();

    private static String code(String tag) {
        if (tag == null) return null;
        return TranslateLanguage.fromLanguageTag(tag);
    }

    @PluginMethod
    public void languages(PluginCall call) {
        JSArray a = new JSArray();
        for (String l : TranslateLanguage.getAllLanguages()) a.put(l);
        JSObject r = new JSObject();
        r.put("languages", a);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        String lang = code(call.getString("lang"));
        if (lang == null) { call.reject("Language not supported"); return; }
        RemoteModelManager.getInstance().isModelDownloaded(new TranslateRemoteModel.Builder(lang).build())
            .addOnSuccessListener(ok -> { JSObject r = new JSObject(); r.put("downloaded", ok); call.resolve(r); })
            .addOnFailureListener(e -> call.reject("Could not check: " + e.getMessage()));
    }

    @PluginMethod
    public void download(PluginCall call) {
        String lang = code(call.getString("lang"));
        if (lang == null) { call.reject("Language not supported"); return; }
        DownloadConditions.Builder c = new DownloadConditions.Builder();
        if (Boolean.TRUE.equals(call.getBoolean("wifi", false))) c.requireWifi();
        RemoteModelManager.getInstance().download(new TranslateRemoteModel.Builder(lang).build(), c.build())
            .addOnSuccessListener(v -> { JSObject r = new JSObject(); r.put("ok", true); call.resolve(r); })
            .addOnFailureListener(e -> call.reject("Download failed: " + e.getMessage()));
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String lang = code(call.getString("lang"));
        if (lang == null) { call.reject("Language not supported"); return; }
        RemoteModelManager.getInstance().deleteDownloadedModel(new TranslateRemoteModel.Builder(lang).build())
            .addOnSuccessListener(v -> { translators.clear(); JSObject r = new JSObject(); r.put("ok", true); call.resolve(r); })
            .addOnFailureListener(e -> call.reject("Could not remove: " + e.getMessage()));
    }

    @PluginMethod
    public void translate(PluginCall call) {
        final String from = code(call.getString("from", "en")), to = code(call.getString("to"));
        JSArray in = call.getArray("texts");
        if (from == null || to == null) { call.reject("Language not supported"); return; }
        if (in == null) { call.reject("No text"); return; }
        final String[] texts = new String[in.length()];
        try { for (int i = 0; i < texts.length; i++) texts[i] = in.getString(i); }
        catch (Exception e) { call.reject("Bad text list"); return; }
        final String key = from + ">" + to;
        Translator t = translators.get(key);
        if (t == null) {
            t = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build());
            translators.put(key, t);
        }
        final Translator tr = t;
        // the models must already be on the phone; never start a download by surprise (the app asks first)
        final RemoteModelManager mm = RemoteModelManager.getInstance();
        mm.isModelDownloaded(new TranslateRemoteModel.Builder(from).build()).addOnSuccessListener(okFrom ->
            mm.isModelDownloaded(new TranslateRemoteModel.Builder(to).build()).addOnSuccessListener(okTo -> {
                if (!okFrom || !okTo) { call.reject("The language is not on this phone yet"); return; }
                step(tr, texts, new String[texts.length], 0, call);
            }).addOnFailureListener(e -> call.reject("Could not check: " + e.getMessage())))
            .addOnFailureListener(e -> call.reject("Could not check: " + e.getMessage()));
    }

    private void step(Translator tr, String[] src, String[] out, int i, PluginCall call) {
        if (i >= src.length) {
            JSArray a = new JSArray();
            for (String s : out) a.put(s);
            JSObject r = new JSObject();
            r.put("texts", a);
            call.resolve(r);
            return;
        }
        if (src[i] == null || src[i].trim().isEmpty()) { out[i] = ""; step(tr, src, out, i + 1, call); return; }
        tr.translate(src[i])
            .addOnSuccessListener(s -> { out[i] = s; step(tr, src, out, i + 1, call); })
            .addOnFailureListener(e -> call.reject("Translate: " + e.getMessage()));
    }
}
