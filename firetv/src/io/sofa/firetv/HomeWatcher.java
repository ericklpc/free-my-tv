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
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.util.Log;

/**
 * Fire OS doesn't let another app be the home screen, and Fire OS 6 won't run accessibility services from apps
 * installed outside its store. So this looks at which app came to the front (usage access, given once over adb; see
 * README) a few times a second: when it's Amazon's home, it opens Sofá over it. Back on Sofá's first screen still
 * reaches Amazon's home on purpose (HomeActivity.leave), and stays there until you open something else.
 */
public class HomeWatcher extends Service {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final long EVERY = 350, GUARD = 6000;

    /** Set when you leave Sofá for Amazon's home on purpose; cleared when another app comes up. */
    static volatile boolean stayOnAmazon;

    private final Handler handler = new Handler();
    private UsageStatsManager usage;
    private long checked, opened;

    static void start(Context c) {
        Intent i = new Intent(c, HomeWatcher.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    @Override public void onCreate() {
        super.onCreate();
        usage = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        checked = System.currentTimeMillis();
        handler.post(tick);
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
        Log.i("HomeWatcher", front + (stayOnAmazon ? " (stay)" : "") + (now - opened < GUARD ? " (guard)" : ""));
        if (front.equals(getPackageName())) {
            opened = 0;   // Sofá is up: the next Home counts, however soon it comes
            return;
        }
        if (!AMAZON_HOME.equals(front)) {
            stayOnAmazon = false;
            return;
        }
        if (stayOnAmazon || now - opened < GUARD) return;
        opened = now;
        startActivity(new Intent(this, HomeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** Back on after the TV restarts. */
    public static class Boot extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent i) { start(c); }
    }
}
