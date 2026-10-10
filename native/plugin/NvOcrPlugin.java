package be.brokeuh.nightvault;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.lang.reflect.Method;

/**
 * Google's on-device text reader (ML Kit) for Nightvault Pocket.
 * recognize({image: "data:image/jpeg;base64,..."}) answers in the same shape the web text reader (Tesseract.js) uses,
 * so the scanner code works with either: {text, confidence, blocks:[{paragraphs:[{lines:[{text, confidence, box, words:[{text, confidence}]}]}]}]}
 */
@CapacitorPlugin(name = "NvOcr")
public class NvOcrPlugin extends Plugin {
    private TextRecognizer recognizer;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("engine", "Google ML Kit text recognition");
        call.resolve(r);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String img = call.getString("image");
        if (img == null || img.isEmpty()) { call.reject("No picture"); return; }
        int comma = img.indexOf(',');
        if (comma >= 0) img = img.substring(comma + 1);
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(img, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) { call.reject("Picture could not be read: " + e.getMessage()); return; }
        if (bmp == null) { call.reject("Picture could not be read"); return; }
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        final long t0 = System.currentTimeMillis();
        recognizer.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(text -> {
                JSObject out = new JSObject();
                JSArray blocks = new JSArray();
                double sum = 0; int n = 0;
                for (Text.TextBlock b : text.getTextBlocks()) {
                    JSArray lines = new JSArray();
                    for (Text.Line l : b.getLines()) {
                        JSArray words = new JSArray();
                        double ls = 0; int ln = 0;
                        for (Text.Element el : l.getElements()) {
                            double c = conf(el);
                            JSObject w = new JSObject();
                            w.put("text", el.getText());
                            w.put("confidence", c);
                            words.put(w);
                            ls += c; ln++;
                        }
                        double lc = ln > 0 ? ls / ln : conf(l);
                        JSObject lo = new JSObject();
                        lo.put("text", l.getText());
                        lo.put("confidence", lc);
                        lo.put("words", words);
                        Rect r = l.getBoundingBox();
                        if (r != null) {
                            JSObject box = new JSObject();
                            box.put("x0", r.left); box.put("y0", r.top); box.put("x1", r.right); box.put("y1", r.bottom);
                            lo.put("box", box);
                        }
                        lines.put(lo);
                        sum += lc; n++;
                    }
                    JSObject para = new JSObject();
                    para.put("lines", lines);
                    JSArray paras = new JSArray();
                    paras.put(para);
                    JSObject bo = new JSObject();
                    bo.put("paragraphs", paras);
                    blocks.put(bo);
                }
                out.put("text", text.getText());
                out.put("confidence", n > 0 ? sum / n : 0);
                out.put("blocks", blocks);
                out.put("width", bmp.getWidth());
                out.put("height", bmp.getHeight());
                out.put("ms", System.currentTimeMillis() - t0);
                call.resolve(out);
            })
            .addOnFailureListener(e -> call.reject("Text reader: " + e.getMessage()));
    }

    /** ML Kit gives a confidence (0-1) on newer versions; older ones have none - then the text counts as sure. */
    private static double conf(Object o) {
        try {
            Method m = o.getClass().getMethod("getConfidence");
            Object v = m.invoke(o);
            if (v instanceof Float) return Math.round(((Float) v) * 1000) / 10.0;
        } catch (Exception ignored) { }
        return 90.0;
    }
}
