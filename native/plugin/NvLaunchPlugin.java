package be.brokeuh.nightvault;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Nightvault Games: start an emulator app on this phone with one of the owner's own game backups (a file in a folder he picked, NvFiles).
 * Ways to start (the page picks one per system tile, Games ⚙ → How to play):
 *   chooser     – Android asks which app should open the file ("Open with…") – works with any emulator that opens files
 *   view        – open the file in one app (ACTION_VIEW to that package)
 *   extra       – start an app's screen with the file in a named extra (as a content:// address, or as a real path when path=true)
 *   extraArray  – the same, as a list with one file (Dolphin "AutoStartFiles")
 *   retroarch   – RetroArch with a core: ROM (real path), LIBRETRO (the core), CONFIGFILE …  (RetroArch needs "All files access" for the path)
 * Every way hands the app read permission for that one file.
 */
@CapacitorPlugin(name = "NvLaunch")
public class NvLaunchPlugin extends Plugin {

    /** which of these apps are installed: {installed:[package names]} */
    @PluginMethod
    public void installed(PluginCall call) {
        JSArray out = new JSArray();
        try {
            JSONArray in = call.getArray("pkgs", new JSArray());
            PackageManager pm = getContext().getPackageManager();
            for (int i = 0; i < in.length(); i++) {
                String p = in.optString(i);
                if (has(pm, p)) out.put(p);
            }
        } catch (Exception e) { Log.w("NvLaunch", "installed", e); }
        JSObject o = new JSObject();
        o.put("installed", out);
        call.resolve(o);
    }

    /** the real place of a file in a phone folder (/storage/emulated/0/… or /storage/XXXX-XXXX/…), for apps that want a path */
    @PluginMethod
    public void pathOf(PluginCall call) {
        JSObject o = new JSObject();
        o.put("path", realPath(Uri.parse(call.getString("uri", ""))));
        call.resolve(o);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        String mode = call.getString("mode", "chooser"), cls = call.getString("cls", ""), key = call.getString("key", ""),
               core = call.getString("core", ""), mime = call.getString("mime", "application/octet-stream"), title = call.getString("title", "Play with…");
        boolean usePath = Boolean.TRUE.equals(call.getBoolean("path", false));
        Uri uri = Uri.parse(call.getString("uri", ""));
        String pkg = null;
        try {
            JSONArray ps = call.getArray("pkgs", new JSArray());
            for (int i = 0; i < ps.length() && pkg == null; i++) if (has(pm, ps.optString(i))) pkg = ps.optString(i);
        } catch (Exception e) { /* none */ }
        if (!"chooser".equals(mode) && pkg == null) { call.reject("That emulator app is not installed on this phone", "missing"); return; }
        try {
            Intent it;
            String path = realPath(uri);
            switch (mode) {
                case "view":
                    it = new Intent(Intent.ACTION_VIEW);
                    it.setDataAndType(uri, mime);
                    if (cls.isEmpty()) it.setPackage(pkg); else it.setComponent(new ComponentName(pkg, cls));
                    break;
                case "extra":
                case "extraArray":
                    it = new Intent(Intent.ACTION_VIEW);
                    if (cls.isEmpty()) it.setPackage(pkg); else it.setComponent(new ComponentName(pkg, cls));
                    String v = usePath && path != null ? path : uri.toString();
                    if ("extraArray".equals(mode)) it.putExtra(key, new String[]{v}); else it.putExtra(key, v);
                    break;
                case "retroarch": {
                    if (path == null) { call.reject("RetroArch needs a file on the phone's own storage or SD card"); return; }
                    ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                    String ext = Environment.getExternalStorageDirectory().getAbsolutePath();
                    it = new Intent();
                    it.setComponent(new ComponentName(pkg, cls.isEmpty() ? "com.retroarch.browser.retroactivity.RetroActivityFuture" : cls));
                    it.putExtra("ROM", path);
                    it.putExtra("LIBRETRO", ai.dataDir + "/cores/" + core + "_libretro_android.so");
                    it.putExtra("CONFIGFILE", ext + "/Android/data/" + pkg + "/files/retroarch.cfg");
                    it.putExtra("IME", Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD));
                    it.putExtra("DATADIR", ai.dataDir);
                    it.putExtra("APK", ai.sourceDir);
                    it.putExtra("SDCARD", ext);
                    it.putExtra("EXTERNAL", ext + "/Android/data/" + pkg + "/files");
                    it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    break;
                }
                default: {
                    Intent v2 = new Intent(Intent.ACTION_VIEW);
                    v2.setDataAndType(uri, mime);
                    v2.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    v2.setClipData(ClipData.newRawUri("game", uri));
                    it = Intent.createChooser(v2, title);
                }
            }
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (!"chooser".equals(mode)) it.setClipData(ClipData.newRawUri("game", uri));
            if (pkg != null) try { ctx.grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception e) { /* the clip data grant is enough */ }
            getActivity().startActivity(it);
            JSObject o = new JSObject();
            o.put("pkg", pkg == null ? "" : pkg);
            o.put("path", path == null ? "" : path);
            call.resolve(o);
        } catch (ActivityNotFoundException e) {
            call.reject("The emulator app could not open this game (" + e.getMessage() + "). Try “Let Android ask” in How to play.", "nostart");
        } catch (Exception e) {
            Log.w("NvLaunch", "launch failed", e);
            call.reject("Could not start: " + e.getMessage(), "error");
        }
    }

    private static boolean has(PackageManager pm, String p) {
        if (p == null || p.isEmpty()) return false;
        try { pm.getPackageInfo(p, 0); return true; } catch (Exception e) { return false; }
    }

    /** content://…externalstorage.documents/tree/primary%3ARoms/document/primary%3ARoms%2Fsnes%2Fx.sfc → /storage/emulated/0/Roms/snes/x.sfc */
    static String realPath(Uri u) {
        try {
            if ("file".equals(u.getScheme())) return u.getPath();
            String id = DocumentsContract.getDocumentId(u);
            if (id.startsWith("raw:")) return id.substring(4);
            int c = id.indexOf(':');
            if (c < 0) return null;
            String vol = id.substring(0, c), rest = id.substring(c + 1);
            if (!"com.android.externalstorage.documents".equals(u.getAuthority())) return null;
            String base = "primary".equalsIgnoreCase(vol) ? Environment.getExternalStorageDirectory().getAbsolutePath() : "/storage/" + vol;
            return base + "/" + rest;
        } catch (Exception e) { return null; }
    }
}
