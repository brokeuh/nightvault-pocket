package be.brokeuh.nightvault;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Media controls for Nightvault Audio (Audiobooks, later Music). The sound itself plays in the web page (an audio element);
 * this plugin shows the media notification / lock-screen controls and runs a foreground service while a book plays, so Android
 * keeps the app alive with the screen off. Buttons on the notification, headphones and Bluetooth come back to the page as
 * "action" events (play, pause, back, forward, prev, next, seek).
 */
@CapacitorPlugin(name = "NvMedia")
public class NvMediaPlugin extends Plugin {
    static volatile NvMediaPlugin inst;
    private boolean askedNotif = false;

    @Override public void load() { inst = this; }

    static void send(String action, long pos) {
        NvMediaPlugin p = inst;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        if (pos >= 0) o.put("pos", pos);
        p.notifyListeners("action", o, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !askedNotif && getActivity() != null
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askedNotif = true;
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4711);
        }
        NvMediaService.Info i = new NvMediaService.Info();
        i.title = call.getString("title", "");
        i.artist = call.getString("artist", "");
        i.album = call.getString("album", "");
        i.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        i.position = call.getLong("position", 0L);
        i.duration = call.getLong("duration", 0L);
        Double sp = call.getDouble("speed", 1.0);
        i.speed = sp == null ? 1f : sp.floatValue();
        String art = call.getString("art");                       // only sent when the book changes; "" = no picture
        if (art != null) {
            File f = new File(getContext().getCacheDir(), "media_art.jpg");
            try {
                if (art.isEmpty()) { f.delete(); i.artPath = ""; }
                else {
                    int c = art.indexOf(',');
                    byte[] b = Base64.decode(c >= 0 ? art.substring(c + 1) : art, Base64.DEFAULT);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(b); }
                    i.artPath = f.getAbsolutePath();
                }
            } catch (Exception e) { i.artPath = ""; }
        }
        NvMediaService s = NvMediaService.inst;
        if (s != null) {
            s.apply(i);
        } else if (i.playing) {                                    // start the service only when playing starts (the app is in front then)
            NvMediaService.pending = i;
            try {
                ContextCompat.startForegroundService(getContext(), new Intent(getContext(), NvMediaService.class));
            } catch (Exception e) { call.reject("Media controls could not start: " + e.getMessage()); return; }
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        NvMediaService s = NvMediaService.inst;
        if (s != null) s.stopNow();
        call.resolve();
    }
}
