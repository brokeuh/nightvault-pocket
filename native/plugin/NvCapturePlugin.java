package be.brokeuh.nightvault;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.util.Arrays;

/**
 * Screen capture (alpha): a floating button over other apps (Hearthstone) that saves what is on screen into the app's
 * cache, so Nightvault Pocket can read the cards on it afterwards. Android asks permission for every capture session.
 */
@CapacitorPlugin(name = "NvCapture")
public class NvCapturePlugin extends Plugin {

    static File dir(Context c) { File d = new File(c.getCacheDir(), "captures"); d.mkdirs(); return d; }

    private File[] files() {
        File[] l = dir(getContext()).listFiles((d, n) -> n.endsWith(".jpg"));
        if (l == null) l = new File[0];
        Arrays.sort(l, (a, b) -> a.getName().compareTo(b.getName()));
        return l;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.reject("Screen capture needs Android 8 or newer", "old"); return; }
        if (!Settings.canDrawOverlays(getContext())) {
            Intent s = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("Allow Nightvault Pocket to display over other apps, then tap Capture again", "overlay");
            return;
        }
        MediaProjectionManager m = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, m.createScreenCaptureIntent(), "granted");
    }

    @ActivityCallback
    private void granted(PluginCall call, ActivityResult r) {
        if (call == null) return;
        if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null) { call.reject("Screen capture was not allowed", "denied"); return; }
        Intent svc = new Intent(getContext(), NvCaptureService.class);
        svc.putExtra("code", r.getResultCode());
        svc.putExtra("data", r.getData());
        ContextCompat.startForegroundService(getContext(), svc);
        String pkg = call.getString("open");                      // open the game right away (when it is installed)
        boolean opened = false;
        if (pkg != null) {
            Intent g = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (g != null) { g.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(g); opened = true; }
        }
        JSObject o = new JSObject();
        o.put("opened", opened);
        call.resolve(o);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), NvCaptureService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        o.put("running", NvCaptureService.running);
        o.put("count", files().length);
        call.resolve(o);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray a = new JSArray();
        for (File f : files()) a.put(f.getName());
        JSObject o = new JSObject();
        o.put("files", a);
        call.resolve(o);
    }

    @PluginMethod
    public void get(PluginCall call) {
        String n = call.getString("name", "");
        File f = new File(dir(getContext()), n);
        if (n.contains("/") || !f.exists()) { call.reject("No such capture"); return; }
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, k;
            while (off < b.length && (k = in.read(b, off, b.length - off)) > 0) off += k;
            JSObject o = new JSObject();
            o.put("data", "data:image/jpeg;base64," + Base64.encodeToString(b, Base64.NO_WRAP));
            call.resolve(o);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        for (File f : files()) f.delete();
        call.resolve();
    }
}
