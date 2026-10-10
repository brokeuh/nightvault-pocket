package be.brokeuh.nightvault;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updates of the Android app without the browser: the new APK is downloaded into the app's own cache (no copies pile up
 * in Downloads), the Android installer opens, and the file is deleted again the next time the app starts.
 */
@CapacitorPlugin(name = "NvUpdate")
public class NvUpdatePlugin extends Plugin {

    private File dir() { return new File(getContext().getCacheDir(), "updates"); }

    @Override
    public void load() {                                   // the update is installed (or given up): remove the downloaded file
        File[] old = dir().listFiles();
        if (old != null) for (File f : old) f.delete();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("No address"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("Allow Nightvault Pocket to install apps, then tap Download again", "permission");
            return;
        }
        new Thread(() -> {
            try {
                File d = dir();
                d.mkdirs();
                File[] old = d.listFiles();
                if (old != null) for (File f : old) f.delete();
                File apk = new File(d, "nightvault-pocket.apk");
                HttpURLConnection c = null;
                String u = url;
                for (int i = 0; i < 6; i++) {                  // follow GitHub's redirects to the file
                    c = (HttpURLConnection) new URL(u).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(60000);
                    c.setRequestProperty("User-Agent", "NightvaultPocket");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) { u = new URL(new URL(u), c.getHeaderField("Location")).toString(); c.disconnect(); continue; }
                    if (code != 200) throw new Exception("download answered " + code);
                    break;
                }
                long total = c.getContentLength(), got = 0, last = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        if (total > 0 && got - last > total / 50) {
                            last = got;
                            JSObject p = new JSObject();
                            p.put("done", got); p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                if (total > 0 && got != total) throw new Exception("the download stopped halfway (" + got + " of " + total + " bytes)");
                JSObject r = new JSObject();
                r.put("bytes", got);
                try {
                    installSession(apk);                       // the whole file goes to Android first, then it asks you to confirm
                    r.put("way", "session");
                } catch (Exception e) {
                    Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                    r.put("way", "viewer");
                    r.put("sessionError", String.valueOf(e.getMessage()));
                }
                call.resolve(r);
            } catch (Exception e) {
                call.reject("The update could not be downloaded: " + e.getMessage());
            }
        }).start();
    }

    private static final String ACTION = "be.brokeuh.nightvault.INSTALL_STATUS";
    private BroadcastReceiver receiver;

    /** Android's own installer API: the APK is copied into an install session by this app, so nothing is read from the app's files later. */
    private void installSession(File apk) throws Exception {
        Context ctx = getContext();
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        int id = pi.createSession(params);
        PackageInstaller.Session session = pi.openSession(id);
        try (OutputStream out = session.openWrite("nightvault-pocket", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            session.fsync(out);
        }
        if (receiver == null) {
            receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent intent) {
                    int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                        if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); c.startActivity(confirm); }
                        return;
                    }
                    JSObject r = new JSObject();
                    r.put("status", status);
                    r.put("message", String.valueOf(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)));
                    notifyListeners("installResult", r);
                }
            };
            IntentFilter f = new IntentFilter(ACTION);
            if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED);
            else ctx.registerReceiver(receiver, f);
        }
        Intent cb = new Intent(ACTION).setPackage(ctx.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pend = PendingIntent.getBroadcast(ctx, id, cb, flags);
        session.commit(pend.getIntentSender());
        session.close();
    }
}
