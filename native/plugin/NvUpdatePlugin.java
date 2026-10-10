package be.brokeuh.nightvault;

import android.content.Intent;
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
import java.io.FileOutputStream;
import java.io.InputStream;
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
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                JSObject r = new JSObject();
                r.put("bytes", got);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("The update could not be downloaded: " + e.getMessage());
            }
        }).start();
    }
}
