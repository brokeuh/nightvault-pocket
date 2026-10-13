package be.brokeuh.nightvault;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/** The media notification and lock-screen controls of Nightvault Audio. While a book plays it is a foreground service. */
public class NvMediaService extends Service {
    static volatile NvMediaService inst;
    static volatile Info pending;

    static class Info {
        String title = "", artist = "", album = "", artPath = null;
        boolean playing;
        long position, duration;
        float speed = 1f;
    }

    private static final String CH = "playback";
    private static final int ID = 8;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private Info cur = new Info();
    private Bitmap art;
    private boolean foreground = false, noisyOn = false;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {      // headphones pulled out: pause
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) NvMediaPlugin.send("pause", -1);
        }
    };

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CH, "Now playing", NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        session = new MediaSession(this, "Nightvault");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { NvMediaPlugin.send("play", -1); }
            @Override public void onPause() { NvMediaPlugin.send("pause", -1); }
            @Override public void onStop() { NvMediaPlugin.send("pause", -1); }
            @Override public void onSkipToNext() { NvMediaPlugin.send("next", -1); }
            @Override public void onSkipToPrevious() { NvMediaPlugin.send("prev", -1); }
            @Override public void onFastForward() { NvMediaPlugin.send("forward", -1); }
            @Override public void onRewind() { NvMediaPlugin.send("back", -1); }
            @Override public void onSeekTo(long pos) { NvMediaPlugin.send("seek", pos); }
            @Override public void onCustomAction(String a, android.os.Bundle extras) { NvMediaPlugin.send(a, -1); }
        });
        session.setActive(true);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) session.setSessionActivity(PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (a != null && !a.equals("start")) {
            if (a.equals("dismiss")) { NvMediaPlugin.send("pause", -1); stopNow(); }
            else NvMediaPlugin.send(a, -1);                        // play / pause / back / forward from the notification buttons
            return START_NOT_STICKY;
        }
        Info p = pending; pending = null;
        if (p != null) apply(p);
        else if (!foreground) goForeground(build());               // must be called quickly after startForegroundService
        return START_NOT_STICKY;
    }

    /** New state from the page (title, playing, position, speed, picture). */
    void apply(Info i) {
        ui.post(() -> {
            boolean newArt = i.artPath != null;
            if (i.artPath == null) i.artPath = cur.artPath;
            cur = i;
            if (newArt) {
                art = null;
                if (i.artPath != null && !i.artPath.isEmpty()) try { art = BitmapFactory.decodeFile(i.artPath); } catch (Exception e) { art = null; }
            }
            MediaMetadata.Builder m = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, i.title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, i.artist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, i.album)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, i.duration);
            if (art != null) m.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
            session.setMetadata(m.build());
            long acts = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO
                    | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
            session.setPlaybackState(new PlaybackState.Builder().setActions(acts)
                    .addCustomAction(new PlaybackState.CustomAction.Builder("back", "Back", android.R.drawable.ic_media_rew).build())
                    .addCustomAction(new PlaybackState.CustomAction.Builder("forward", "Forward", android.R.drawable.ic_media_ff).build())
                    .setState(i.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, i.position, i.playing ? i.speed : 0f)
                    .build());
            Notification n = build();
            if (i.playing) {
                goForeground(n);
                if (!noisyOn) {
                    IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                    if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, f, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(noisy, f);
                    noisyOn = true;
                }
            } else {
                if (foreground) {                                  // paused: the notification stays but can be swiped away
                    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH); else stopForeground(false);
                    foreground = false;
                }
                ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ID, n);
            }
        });
    }

    private void goForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(ID, n);
            foreground = true;
        } catch (Exception e) {                                    // Android may refuse when the app is in the background
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ID, n);
        }
    }

    private PendingIntent act(String a, int code) {
        Intent i = new Intent(this, NvMediaService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @SuppressWarnings("deprecation")
    private Notification build() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(cur.title.isEmpty() ? "Nightvault" : cur.title)
                .setContentText(cur.album.equals(cur.title) ? cur.artist : cur.album)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setShowWhen(false)
                .setOngoing(cur.playing)
                .setDeleteIntent(act("dismiss", 20))
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_rew, "Back", act("back", 21)).build())
                .addAction(cur.playing
                        ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", act("pause", 22)).build()
                        : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Play", act("play", 23)).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_ff, "Forward", act("forward", 24)).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (art != null) b.setLargeIcon(art);
        if (session.getController() != null && session.getController().getSessionActivity() != null) b.setContentIntent(session.getController().getSessionActivity());
        return b.build();
    }

    void stopNow() {
        ui.post(() -> {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
            foreground = false;
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(ID);
            stopSelf();
        });
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) { stopNow(); }   // the app was swiped away: the page (and the sound) is gone too

    @Override
    public void onDestroy() {
        if (noisyOn) try { unregisterReceiver(noisy); } catch (Exception e) {}
        noisyOn = false;
        if (session != null) { session.setActive(false); session.release(); }
        inst = null;
        super.onDestroy();
    }
}
