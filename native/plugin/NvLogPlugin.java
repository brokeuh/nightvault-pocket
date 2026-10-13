package be.brokeuh.nightvault;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;

/** Debug mode: the app's own Android messages (logcat of this app only), added to the debug log on request. */
@CapacitorPlugin(name = "NvLog")
public class NvLogPlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        int n = call.getInt("lines", 400);
        new Thread(() -> {
            StringBuilder sb = new StringBuilder();
            try {
                Process p = Runtime.getRuntime().exec(new String[]{"logcat", "-d", "-v", "time", "-t", String.valueOf(n), "--pid=" + android.os.Process.myPid()});
                try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                    String l; while ((l = r.readLine()) != null) sb.append(l).append('\n');
                }
            } catch (Exception e) { sb.append("logcat failed: ").append(e); }
            JSObject o = new JSObject();
            o.put("text", sb.toString());
            call.resolve(o);
        }).start();
    }
}
