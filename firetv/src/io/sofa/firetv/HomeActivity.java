package io.sofa.firetv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
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
        WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect from the computer, over adb
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
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
        web.loadUrl("file:///android_asset/web/index.html");
        web.requestFocus();
        HomeWatcher.start(this);
    }

    private boolean started;

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
        // Back from Stremio or another app: to the shelf, with fresh lists (what you just watched moves up).
        if (started) js("window.FreeMyTV && FreeMyTV.reopened && FreeMyTV.reopened()");
        started = true;
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
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
        @JavascriptInterface public String apps() {
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
                        o.put("icon", art != null ? png(art, 320, 180) : "");
                        o.put("banner", art != null);
                        o.put("color", "");
                        out.put(o);
                    } catch (Exception ignored) {}
                }
            }
            return out.toString();
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
            HomeWatcher.arrived();
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

    /** A banner as a data: URL the page can show (Fire OS apps' banners are 320 × 180). */
    private static String png(Drawable d, int w, int h) {
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, w, h);
        d.draw(c);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        b.recycle();
        return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }
}
