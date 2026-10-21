package io.sofa.firetv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The home screen: web/ (the same one Samsung and LG run) in a full-screen WebView. The page asks the TV through
 * window.AndroidTV (see web/tv.js): the installed apps with their banners, opening one (or a Stremio link in it),
 * the TV's settings. The remote's arrows and OK reach the page as keys; Back goes to the page's own Back.
 */
public class HomeActivity extends Activity {
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Log.i("Sofa", "[start] created");
        WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect from the computer, over adb
        web = new WebView(this);
        // See-through until the page has drawn itself, so the splash (the theme's background) shows meanwhile; then
        // opaque, which is cheaper to draw (Bridge.shown).
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // the page's settings and caches (localStorage)
        s.setAllowFileAccess(true);
        // The page lives in the APK (file://) and asks Stremio, Cinemeta, metahub and TMDB over https.
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // The page is a 1920 × 1080 stage (<meta name="viewport" content="width=1920">). Fire TV runs at 2x density:
        // without these the WebView shows only the top-left quarter of it.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        web.setWebChromeClient(new WebChromeClient() {
            // The page's console.log, in adb logcat (tag Sofa).
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("Sofa", m.message());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidTV");
        setContentView(web);
        IntentFilter changes = new IntentFilter();
        changes.addAction(Intent.ACTION_PACKAGE_ADDED);
        changes.addAction(Intent.ACTION_PACKAGE_REMOVED);
        changes.addAction(Intent.ACTION_PACKAGE_CHANGED);
        changes.addAction(Intent.ACTION_PACKAGE_REPLACED);
        changes.addDataScheme("package");
        registerReceiver(appsChanged, changes);
        appsCache = read(appsFile());
        if (appsCache != null) rebuildApps();   // without one, the page's first apps() builds it
        web.loadUrl("file:///android_asset/web/index.html");
        web.requestFocus();
        HomeWatcher.start(this);
    }

    /** The TV's apps with their banners, as the page wants them. Slow (it draws every banner): off the UI thread. */
    private String buildApps() {
        PackageManager pm = getPackageManager();
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<String>();
        seen.add(getPackageName());
        for (String category : new String[] {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            List<ResolveInfo> list = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(category), 0);
            for (ResolveInfo r : list) {
                ActivityInfo a = r.activityInfo;
                if (a == null || !seen.add(a.packageName)) continue;
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", a.packageName);
                    o.put("title", String.valueOf(r.loadLabel(pm)));
                    Drawable art = a.loadBanner(pm);
                    if (art == null) art = a.applicationInfo.loadBanner(pm);
                    Bitmap banner = art != null ? draw(art, 640, 360) : null;
                    o.put("color", banner != null ? edgeColor(banner) : "");
                    o.put("banner", banner != null);
                    o.put("icon", banner != null ? png(banner) : "");   // png() recycles it
                    out.put(o);
                } catch (Exception ignored) {}
            }
        }
        return out.toString();
    }

    private File appsFile() { return new File(getCacheDir(), "apps.json"); }

    private void saveApps(String json) {
        try {
            FileOutputStream f = new FileOutputStream(appsFile());
            f.write(json.getBytes("UTF-8"));
            f.close();
        } catch (Exception ignored) {}
    }

    private static String read(File file) {
        try {
            byte[] bytes = new byte[(int) file.length()];
            FileInputStream f = new FileInputStream(file);
            int n = 0;
            while (n < bytes.length) { int r = f.read(bytes, n, bytes.length - n); if (r < 0) break; n += r; }
            f.close();
            return n == bytes.length && n > 0 ? new String(bytes, "UTF-8") : null;
        } catch (Exception e) {
            return null;
        }
    }

    private volatile boolean rebuilding;

    /** Builds the list again in the background; if it changed, keeps it and tells the page. */
    private void rebuildApps() {
        if (rebuilding) return;
        rebuilding = true;
        new Thread(new Runnable() { @Override public void run() {
            try {
                String fresh = buildApps();
                if (!fresh.equals(appsCache)) {
                    appsCache = fresh;
                    saveApps(fresh);
                    js("window.FreeMyTV && FreeMyTV.appsUpdated && FreeMyTV.appsUpdated()");
                }
            } finally {
                rebuilding = false;
            }
        } }, "apps").start();
    }

    private boolean started;

    /** The apps list as last built; kept on disk too, so a cold start shows the shelf at once. */
    private volatile String appsCache;

    private final BroadcastReceiver appsChanged = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { rebuildApps(); }
    };

    @Override protected void onResume() {
        super.onResume();
        Log.i("HomeWatcher", "Sofá resumed");
        web.onResume();
        // Back from Stremio or another app: to the shelf, with fresh lists (what you just watched moves up).
        if (started) js("window.FreeMyTV && FreeMyTV.reopened && FreeMyTV.reopened()");
        started = true;
        // Once what that leaves on the page is really on screen (first title, not the one from before), the loading
        // cover goes. The page also says so itself (Bridge.shown); whichever comes first.
        if (Build.VERSION.SDK_INT >= 23) web.post(new Runnable() { @Override public void run() {
            web.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override public void onComplete(long id) { HomeWatcher.arrived("drawn"); }
            });
        } });
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    /** Sofá Player (the same activity, built as io.sofa.player): a sofa:// link while it's already open. */
    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (!"io.sofa.firetv".equals(getPackageName()) && i.getDataString() != null) {
            js("window.Sofa && Sofa.deepLink && Sofa.deepLink(" + JSONObject.quote(i.getDataString()) + ")");
        }
    }

    @Override protected void onDestroy() {
        try { unregisterReceiver(appsChanged); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) js("window.FreeMyTV && FreeMyTV.back()");
            return true;
        }
        // The Fire remote's OK is DPAD_CENTER: the page listens for Enter.
        if (e.getKeyCode() == KeyEvent.KEYCODE_DPAD_CENTER) {
            return web.dispatchKeyEvent(new KeyEvent(e.getDownTime(), e.getEventTime(), e.getAction(), KeyEvent.KEYCODE_ENTER,
                    e.getRepeatCount(), e.getMetaState()));
        }
        return super.dispatchKeyEvent(e);
    }

    private void js(final String code) {
        web.post(new Runnable() { @Override public void run() { web.evaluateJavascript(code, null); } });
    }

    /** What web/tv.js calls. Runs on a WebView thread: anything touching the UI goes through runOnUiThread. */
    final class Bridge {
        /** The apps list: from the cache at once (rebuilt in the background); built here only the very first time. */
        @JavascriptInterface public String apps() {
            String cached = appsCache;
            if (cached != null) return cached;
            String fresh = buildApps();
            saveApps(fresh);
            return appsCache = fresh;
        }

        /** Opens an app; with a link (stremio:///detail/...), straight to it inside that app. */
        @JavascriptInterface public boolean launch(String pkg, String uri) {
            Intent intent = null;
            if (uri != null && uri.length() > 0) {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(pkg);
                if (getPackageManager().resolveActivity(intent, 0) == null) intent = null;
            }
            if (intent == null) intent = getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
            if (intent == null) intent = getPackageManager().getLaunchIntentForPackage(pkg);
            if (intent == null) return false;
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(intent);
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }

        /** The page has drawn itself (web/home.js, after opening or coming back): the loading cover can go. */
        @JavascriptInterface public void shown() {
            runOnUiThread(new Runnable() { @Override public void run() { web.setBackgroundColor(Color.BLACK); } });
            HomeWatcher.arrived("page");
        }

        /** Back on the first screen: to whatever was before (Fire OS's own home, which HomeWatcher then leaves alone). */
        @JavascriptInterface public void leave() {
            HomeWatcher.stayOnAmazon = true;
            runOnUiThread(new Runnable() { @Override public void run() { moveTaskToBack(true); } });
        }

        @JavascriptInterface public boolean settings() {
            try {
                startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }
    }

    /** The color around a banner's edges (the average of its border), as #RRGGBB; black when it's see-through. */
    private static String edgeColor(Bitmap b) {
        long r = 0, g = 0, bl = 0, n = 0;
        int w = b.getWidth(), h = b.getHeight();
        for (int i = 0; i < w; i += 4) {
            for (int y : new int[] {1, h - 2}) {
                int p = b.getPixel(i, Math.max(0, y));
                if (Color.alpha(p) < 200) continue;
                r += Color.red(p); g += Color.green(p); bl += Color.blue(p); n++;
            }
        }
        for (int i = 0; i < h; i += 4) {
            for (int x : new int[] {1, w - 2}) {
                int p = b.getPixel(Math.max(0, x), i);
                if (Color.alpha(p) < 200) continue;
                r += Color.red(p); g += Color.green(p); bl += Color.blue(p); n++;
            }
        }
        if (n == 0) return "#000000";
        return String.format("#%02X%02X%02X", r / n, g / n, bl / n);
    }

    /** A banner, at its own proportions and at most w × h. */
    private static Bitmap draw(Drawable d, int w, int h) {
        int iw = d.getIntrinsicWidth(), ih = d.getIntrinsicHeight();
        if (iw > 0 && ih > 0) {
            float scale = Math.min(1f, Math.min((float) w / iw, (float) h / ih));
            w = Math.max(1, Math.round(iw * scale));
            h = Math.max(1, Math.round(ih * scale));
        }
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, w, h);
        d.draw(new Canvas(b));
        return b;
    }

    /** A picture as a data: URL the page can show. */
    private static String png(Bitmap b) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        b.recycle();
        return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }
}
