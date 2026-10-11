package be.brokeuh.nightvault;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;

/** The floating capture button. Tap it: it hides itself, saves the screen as a picture and shows the count. ✕: done, back to Nightvault. */
public class NvCaptureService extends Service {
    static volatile boolean running = false;
    private MediaProjection proj;
    private VirtualDisplay vd;
    private ImageReader reader;
    private int w, h, dpi;
    private WindowManager wm;
    private LinearLayout bubble;
    private TextView shot;
    private WindowManager.LayoutParams lp;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean want = false;
    private volatile long hiddenAt = 0;
    private int count = 0;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || proj != null) return START_NOT_STICKY;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("capture", "Screen capture", NotificationManager.IMPORTANCE_LOW));
        Notification n = (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "capture") : new Notification.Builder(this))
                .setContentTitle("Nightvault is capturing").setContentText("Tap the floating button for every page of your collection")
                .setSmallIcon(android.R.drawable.ic_menu_camera).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(7, n);
        try {
            MediaProjectionManager m = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            proj = m.getMediaProjection(intent.getIntExtra("code", 0), intent.getParcelableExtra("data"));
            proj.registerCallback(new MediaProjection.Callback() { @Override public void onStop() { ui.post(() -> stopSelf()); } }, ui);
            measure();
            reader = newReader();
            vd = proj.createVirtualDisplay("nightvault", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, ui);
            count = countFiles();
            showBubble();
            running = true;
        } catch (Exception e) {
            Toast.makeText(this, "Screen capture could not start: " + e.getMessage(), Toast.LENGTH_LONG).show();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private int countFiles() { File[] l = NvCapturePlugin.dir(this).listFiles((d, nm) -> nm.endsWith(".jpg")); return l == null ? 0 : l.length; }

    private void measure() {
        DisplayMetrics dm = new DisplayMetrics();
        ((WindowManager) getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
        w = dm.widthPixels; h = dm.heightPixels; dpi = dm.densityDpi;
    }

    private ImageReader newReader() {
        ImageReader r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        r.setOnImageAvailableListener(rd -> {
            Image img = null;
            try { img = rd.acquireLatestImage(); } catch (Exception e) { return; }
            if (img == null) return;
            if (!want || System.currentTimeMillis() - hiddenAt < 160) { img.close(); return; }
            want = false;
            save(img);
        }, ui);
        return r;
    }

    private void save(Image img) {
        try {
            Image.Plane p = img.getPlanes()[0];
            ByteBuffer buf = p.getBuffer();
            int ps = p.getPixelStride(), rs = p.getRowStride(), iw = img.getWidth(), ih = img.getHeight();
            Bitmap b = Bitmap.createBitmap(rs / ps, ih, Bitmap.Config.ARGB_8888);
            b.copyPixelsFromBuffer(buf);
            img.close();
            Bitmap c = Bitmap.createBitmap(b, 0, 0, iw, ih);
            File f = new File(NvCapturePlugin.dir(this), "cap_" + System.currentTimeMillis() + ".jpg");
            try (FileOutputStream o = new FileOutputStream(f)) { c.compress(Bitmap.CompressFormat.JPEG, 90, o); }
            b.recycle(); if (c != b) c.recycle();
            count++;
        } catch (Exception e) {
            try { img.close(); } catch (Exception ignored) {}
            Toast.makeText(this, "Capture failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
        bubble.setVisibility(View.VISIBLE);
        shot.setText("📷 " + count);
    }

    private void capture() {
        int ow = w, oh = h;
        measure();
        if (w != ow || h != oh) {                     // the screen turned (Hearthstone plays sideways): same display, new size
            ImageReader old = reader;
            reader = newReader();
            vd.resize(w, h, dpi);
            vd.setSurface(reader.getSurface());
            old.close();
        }
        bubble.setVisibility(View.INVISIBLE);
        hiddenAt = System.currentTimeMillis();
        want = true;
        ui.postDelayed(() -> { if (want) { want = false; bubble.setVisibility(View.VISIBLE); Toast.makeText(this, "Nothing captured - try again", Toast.LENGTH_SHORT).show(); } }, 2500);
    }

    private TextView pill(String t, int color) {
        TextView v = new TextView(this);
        v.setText(t); v.setTextColor(Color.WHITE); v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16); v.setGravity(Gravity.CENTER);
        int pd = dp(12); v.setPadding(pd, dp(8), pd, dp(8));
        GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(dp(22)); g.setStroke(dp(2), 0x66FFFFFF);
        v.setBackground(g);
        return v;
    }
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void showBubble() {
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.HORIZONTAL);
        shot = pill("📷 " + count, 0xEE2E9E78);
        TextView done = pill("✕", 0xEE30343C);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, -2); sp.setMargins(0, 0, dp(6), 0);
        bubble.addView(shot, sp); bubble.addView(done);
        lp = new WindowManager.LayoutParams(-2, -2, Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START; lp.x = dp(8); lp.y = dp(80);
        shot.setOnTouchListener(new View.OnTouchListener() {            // drag it anywhere; a tap captures
            float sx, sy; int ox, oy; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN: sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; moved = false; return true;
                    case MotionEvent.ACTION_MOVE:
                        if (Math.abs(e.getRawX() - sx) + Math.abs(e.getRawY() - sy) > dp(8)) moved = true;
                        if (moved) { lp.x = ox + (int) (e.getRawX() - sx); lp.y = oy + (int) (e.getRawY() - sy); wm.updateViewLayout(bubble, lp); }
                        return true;
                    case MotionEvent.ACTION_UP: if (!moved) capture(); return true;
                }
                return false;
            }
        });
        done.setOnClickListener(v -> {
            Intent a = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (a != null) { a.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT); a.putExtra("captured", true); startActivity(a); }
            stopSelf();
        });
        wm.addView(bubble, lp);
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (bubble != null) wm.removeView(bubble); } catch (Exception ignored) {}
        try { if (vd != null) vd.release(); } catch (Exception ignored) {}
        try { if (reader != null) reader.close(); } catch (Exception ignored) {}
        try { if (proj != null) proj.stop(); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
