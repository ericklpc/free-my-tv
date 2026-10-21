package io.sofa.firetv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.IBinder;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.widget.FrameLayout;
import android.widget.ImageView;

/**
 * Fire OS doesn't let another app be the home screen, and Fire OS 6 won't run accessibility services from apps
 * installed outside its store. So this looks at which app came to the front (usage access, given once over adb; see
 * README) a few times a second: when it's Amazon's home, it opens Sofá over it. Back on Sofá's first screen still
 * reaches Amazon's home on purpose (HomeActivity.leave), and stays there until you open something else.
 * Android holds an app opened right after Home for about 5 s; a cover (draw over other apps, also given over adb) hides
 * Amazon's home meanwhile. Without that permission Amazon's home just shows until Sofá comes up.
 */
public class HomeWatcher extends Service {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final long EVERY = 350, GUARD = 6000, COVER_MAX = 9000;

    /** Set when you leave Sofá for Amazon's home on purpose; cleared when another app comes up. */
    static volatile boolean stayOnAmazon;

    private final Handler handler = new Handler();
    private UsageStatsManager usage;
    private long checked, opened;
    private String lastFront;
    private View cover;

    private static HomeWatcher running;

    /** Sofá is on screen: the cover can go. */
    static void arrived() {
        final HomeWatcher w = running;
        if (w != null) w.handler.post(new Runnable() { @Override public void run() { w.uncover(); } });
    }

    static void start(Context c) {
        Intent i = new Intent(c, HomeWatcher.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    @Override public void onCreate() {
        super.onCreate();
        running = this;
        usage = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        checked = System.currentTimeMillis();
        lastFront = latestFront(checked - 24 * 3600 * 1000L, checked);
        registerReceiver(wake, new IntentFilter(Intent.ACTION_SCREEN_ON));
        handler.post(tick);
    }

    /**
     * Turning the TV on wakes the stick where it was, usually Amazon's home, without anything new coming to the
     * front: so on waking, Sofá opens if that's where it is (even if you had left Sofá with Back before).
     */
    private final BroadcastReceiver wake = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            stayOnAmazon = false;
            handler.postDelayed(new Runnable() { @Override public void run() {
                long now = System.currentTimeMillis();
                String front = latestFront(now - 24 * 3600 * 1000L, now);
                if (front != null) lastFront = front;
                Log.i("HomeWatcher", "screen on, front " + lastFront);
                if (AMAZON_HOME.equals(lastFront)) open(now);
            } }, 1500);
        }
    };

    /** The last app that came to the front between from and to, or null. */
    private String latestFront(long from, long to) {
        String front = null;
        try {
            UsageEvents events = usage.queryEvents(from, to);
            UsageEvents.Event e = new UsageEvents.Event();
            while (events.getNextEvent(e)) {
                if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) front = e.getPackageName();
            }
        } catch (Exception ignored) {}
        return front;
    }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel("home", "Botão Home", NotificationManager.IMPORTANCE_MIN));
            startForeground(1, new Notification.Builder(this, "home").setSmallIcon(R.drawable.icon).build());
        }
        return START_STICKY;
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            check();
            handler.postDelayed(this, EVERY);
        }
    };

    private void check() {
        long now = System.currentTimeMillis();
        String front = null;
        try {
            // Events can be written a moment after they happen: look back a few seconds and take what's newer than
            // the last one seen. Without usage access this comes back empty, and nothing happens.
            UsageEvents events = usage.queryEvents(now - 10000, now + 1000);
            UsageEvents.Event e = new UsageEvents.Event();
            while (events.getNextEvent(e)) {
                if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND && e.getTimeStamp() > checked) {
                    front = e.getPackageName();
                    checked = e.getTimeStamp();
                }
            }
        } catch (Exception ignored) {}
        if (front == null) return;
        lastFront = front;
        Log.i("HomeWatcher", front + (stayOnAmazon ? " (stay)" : "") + (now - opened < GUARD ? " (guard)" : ""));
        if (front.equals(getPackageName())) {
            opened = 0;   // Sofá is up: the next Home counts, however soon it comes (the page lifts the cover)
            return;
        }
        if (!AMAZON_HOME.equals(front)) {
            stayOnAmazon = false;
            return;
        }
        if (stayOnAmazon || now - opened < GUARD) return;
        open(now);
    }

    private void open(long now) {
        opened = now;
        cover();
        startActivity(new Intent(this, HomeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    /** Black, with Sofá's icon breathing in the middle, over everything until Sofá shows up. */
    @SuppressWarnings("deprecation")
    private void cover() {
        if (cover != null) return;
        FrameLayout v = new FrameLayout(this);
        v.setBackgroundColor(Color.BLACK);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.icon);
        int size = (int) (96 * getResources().getDisplayMetrics().density);
        v.addView(icon, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        AlphaAnimation breathe = new AlphaAnimation(0.35f, 1f);
        breathe.setDuration(900);
        breathe.setRepeatMode(Animation.REVERSE);
        breathe.setRepeatCount(Animation.INFINITE);
        icon.startAnimation(breathe);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                PixelFormat.OPAQUE);
        try {
            ((WindowManager) getSystemService(WINDOW_SERVICE)).addView(v, lp);
            cover = v;
            handler.postDelayed(uncoverLate, COVER_MAX);
        } catch (Exception noPermission) {}
    }

    private final Runnable uncoverLate = new Runnable() { @Override public void run() { uncover(); } };

    private void uncover() {
        handler.removeCallbacks(uncoverLate);
        final View v = cover;
        if (v == null) return;
        cover = null;
        v.animate().alpha(0f).setStartDelay(100).setDuration(300).withEndAction(new Runnable() {
            @Override public void run() {
                try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(v); } catch (Exception ignored) {}
            }
        });
    }

    @Override public void onDestroy() {
        if (running == this) running = null;
        try { unregisterReceiver(wake); } catch (Exception ignored) {}
        uncover();
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** Back on after the TV restarts. */
    public static class Boot extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent i) { start(c); }
    }
}
