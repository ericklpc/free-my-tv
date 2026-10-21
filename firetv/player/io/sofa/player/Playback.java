package io.sofa.player;

import android.app.Activity;
import android.app.Application;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Display;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The native player under the page: Media3 on a SurfaceView behind the WebView, which turns transparent while a
 * video plays, so the page keeps drawing the controls, the menus and the subtitles. The page drives it through
 * window.Player and hears back through Native.player(event):
 *  - ready, firstFrame (the real TTFF), buffering, stall (6 s without progress), error, ended;
 *  - tracks (audio and embedded subtitles), cues (the subtitle text to draw), warm (a link resolved ahead of time).
 * Audio the stick can't decode (DTS, TrueHD) goes through the ffmpeg renderer, to PCM, which is what the TV takes.
 * Only in ./firetv/build.sh --proto; HomeActivity attaches it when the class is there.
 */
public final class Playback implements Player.Listener {
    private static final String TAG = "SofaPlayer";
    private static final long STALL_MS = 6000, START_MS = 25000;

    private final Activity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, String> warmed = new HashMap<String, String>();
    private final Map<String, Long> warmedAt = new HashMap<String, Long>();
    private SurfaceView surface;
    private ExoPlayer player;
    private long openedAt, bufferingSince;
    private boolean rendered, matchRate;
    private String preloaded;   // the stream prepared paused on the title's page, so OK only has to press play
    private int modeBefore = -1;
    private Tracks tracks = Tracks.EMPTY;

    public static void attach(Activity activity, WebView web) {
        final Playback p = new Playback(activity, web);
        web.addJavascriptInterface(p.new Bridge(), "Player");
        activity.getApplication().registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPaused(Activity a) { if (a == p.activity && p.player != null) p.player.pause(); }
            @Override public void onActivityDestroyed(Activity a) { if (a == p.activity) p.release(); }
            @Override public void onActivityCreated(Activity a, Bundle b) {}
            @Override public void onActivityStarted(Activity a) {}
            @Override public void onActivityResumed(Activity a) {}
            @Override public void onActivityStopped(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
        });
    }

    private Playback(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        main.post(watch);
    }

    // MARK: - Opening and closing

    private void open(JSONObject o, boolean play) {
        String url = o.optString("url");
        long start = Math.max(0, o.optLong("startMs"));
        if (play && url.equals(preloaded) && player != null && player.getPlaybackState() != Player.STATE_IDLE) {
            preloaded = null;
            openedAt = SystemClock.elapsedRealtime();
            show();
            if (Math.abs(player.getCurrentPosition() - start) > 3000) player.seekTo(start);
            player.setPlayWhenReady(true);
            onTracksChanged(player.getCurrentTracks());   // the page ignored them while it was on the title's page
            if (rendered) { rendered = false; onRenderedFirstFrame(); }   // decoded behind the page already: on screen right away
            Log.i(TAG, "open: preloaded, state " + player.getPlaybackState());
            return;
        }
        preloaded = play ? null : url;
        matchRate = o.optBoolean("matchRate");
        String direct = warmed.get(url);
        Long at = warmedAt.get(url);
        if (direct != null && at != null && SystemClock.elapsedRealtime() - at < 10 * 60000) url = direct;
        // A new player for every stream: reusing one makes Media3 flush the audio decoder, and the stick's Dolby
        // decoder fails the flush (MediaCodec 0x80001001), over and over.
        if (player != null) { player.release(); player = null; }
        create();
        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
        JSONArray subs = o.optJSONArray("subtitles");
        if (subs != null) {
            List<MediaItem.SubtitleConfiguration> list = new ArrayList<MediaItem.SubtitleConfiguration>();
            for (int i = 0; i < subs.length(); i++) {
                JSONObject s = subs.optJSONObject(i);
                if (s == null) continue;
                list.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.optString("url")))
                        .setMimeType(subtitleMime(s.optString("url"), s.optString("format")))
                        .setLanguage(s.optString("lang", null)).setLabel(s.optString("label", null))
                        .setId("ext" + i).build());
            }
            item.setSubtitleConfigurations(list);
        }
        openedAt = SystemClock.elapsedRealtime();
        bufferingSince = 0;
        rendered = false;
        // The surface stays behind the black page while preloading, so the first frame is decoded before OK.
        surface.setVisibility(android.view.View.VISIBLE);
        if (play) show();
        player.setMediaItem(item.build(), start);
        player.setPlayWhenReady(play);
        player.prepare();
        Log.i(TAG, play ? "open" : "preload");
    }

    private void show() {
        web.setBackgroundColor(Color.TRANSPARENT);
        surface.setVisibility(android.view.View.VISIBLE);
    }

    private void create() {
        // Fast start over a debrid link: play after 1 s buffered, keep up to 50 s.
        DefaultLoadControl load = new DefaultLoadControl.Builder().setBufferDurationsMs(15000, 50000, 1000, 2000).build();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory().setUserAgent("SofaPlayer/1.0")
                .setAllowCrossProtocolRedirects(true).setConnectTimeoutMs(8000).setReadTimeoutMs(8000);
        // ON: the stick's own decoders first, ffmpeg only for what it lacks (DTS, TrueHD).
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(activity)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON).setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(activity, renderers).setLoadControl(load)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(activity).setDataSourceFactory(http)).build();
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setPreferredTextLanguages("pt-BR", "pt", "por", "en").setMaxVideoSize(3840, 2160).build());
        player.addListener(this);
        if (surface == null) {
            surface = new SurfaceView(activity);
            ViewGroup parent = (ViewGroup) web.getParent();
            parent.addView(surface, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        player.setVideoSurfaceView(surface);
    }

    private void stop() {
        preloaded = null;
        if (player != null) { player.release(); player = null; }
        if (surface != null) surface.setVisibility(android.view.View.GONE);
        web.setBackgroundColor(Color.BLACK);
        restoreMode();
    }

    private void release() {
        main.removeCallbacks(watch);
        if (player != null) { player.release(); player = null; }
        restoreMode();
    }

    private static String subtitleMime(String url, String format) {
        String u = (format != null && format.length() > 0 ? "." + format : url).toLowerCase();
        if (u.contains(".vtt")) return MimeTypes.TEXT_VTT;
        if (u.contains(".ass") || u.contains(".ssa")) return MimeTypes.TEXT_SSA;
        return MimeTypes.APPLICATION_SUBRIP;
    }

    // MARK: - Resolving a link before OK: follows the redirects (the debrid makes the file link on the first hit)
    // and keeps the final address for 10 minutes.

    private void warm(final String url) {
        new Thread(new Runnable() {
            @Override public void run() {
                long t0 = SystemClock.elapsedRealtime();
                String at = url;
                boolean ok = false;
                try {
                    for (int i = 0; i < 6; i++) {
                        HttpURLConnection c = (HttpURLConnection) new URL(at).openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(8000);
                        c.setReadTimeout(8000);
                        c.setRequestProperty("Range", "bytes=0-1");
                        c.setRequestProperty("User-Agent", "SofaPlayer/1.0");
                        int code = c.getResponseCode();
                        String next = c.getHeaderField("Location");
                        c.disconnect();
                        if (code >= 300 && code < 400 && next != null) { at = new URL(new URL(at), next).toString(); continue; }
                        ok = code >= 200 && code < 300;
                        break;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "warm: " + e);
                }
                final long ms = SystemClock.elapsedRealtime() - t0;
                final String direct = at;
                final boolean good = ok;
                main.post(new Runnable() {
                    @Override public void run() {
                        if (good) { warmed.put(url, direct); warmedAt.put(url, SystemClock.elapsedRealtime()); }
                        emit(event("warm").put2("url", url).put2("ms", ms).put2("ok", good));
                    }
                });
            }
        }).start();
    }

    // MARK: - Events to the page

    private final Runnable watch = new Runnable() {
        @Override public void run() {
            // A stall: buffering for 6 s after playback started. The page moves to the next stream.
            long t = SystemClock.elapsedRealtime();
            if (player != null && bufferingSince > 0 && t - bufferingSince > STALL_MS) {
                bufferingSince = 0;
                emit(event("stall").put2("pos", player.getCurrentPosition()));
            }
            // Never got to the first frame: the link is dead or far too slow.
            if (player != null && preloaded == null && !rendered && openedAt > 0 && t - openedAt > START_MS) {
                openedAt = 0;
                emit(event("stall").put2("pos", player.getCurrentPosition()));
            }
            main.postDelayed(this, 500);
        }
    };

    @Override public void onPlaybackStateChanged(int state) {
        if (state == Player.STATE_BUFFERING) {
            if (bufferingSince == 0 && rendered && player.getPlayWhenReady()) bufferingSince = SystemClock.elapsedRealtime();
            emit(event("buffering"));
        } else {
            bufferingSince = 0;
            if (state == Player.STATE_READY) emit(event("ready").put2("dur", player.getDuration()));
            if (state == Player.STATE_ENDED) emit(event("ended"));
        }
    }

    @Override public void onRenderedFirstFrame() {
        if (rendered && preloaded == null) return;   // a seek renders a "first frame" too: only the start counts
        rendered = true;
        if (preloaded != null) return;
        long ms = SystemClock.elapsedRealtime() - openedAt;
        Log.i(TAG, "first frame " + ms + " ms after open");
        emit(event("firstFrame").put2("ms", ms));
    }

    @Override public void onPlayerError(PlaybackException e) {
        Log.w(TAG, "error " + e.getErrorCodeName(), e);
        emit(event("error").put2("code", e.getErrorCodeName()).put2("message", String.valueOf(e.getMessage())));
    }

    @Override public void onCues(CueGroup cues) {
        StringBuilder text = new StringBuilder();
        for (Cue c : cues.cues) if (c.text != null) { if (text.length() > 0) text.append('\n'); text.append(c.text); }
        emit(event("cues").put2("text", text.toString()));
    }

    @Override public void onTracksChanged(Tracks t) {
        tracks = t;
        J audio = new J(), text = new J();
        for (int g = 0; g < t.getGroups().size(); g++) {
            Tracks.Group group = t.getGroups().get(g);
            for (int i = 0; i < group.length; i++) {
                Format f = group.getTrackFormat(i);
                J one = new J().put2("group", g).put2("index", i).put2("lang", f.language).put2("label", f.label)
                        .put2("mime", f.sampleMimeType).put2("channels", f.channelCount).put2("selected", group.isTrackSelected(i))
                        .put2("supported", group.isTrackSupported(i)).put2("id", f.id)
                        .put2("forced", (f.selectionFlags & C.SELECTION_FLAG_FORCED) != 0);
                if (group.getType() == C.TRACK_TYPE_AUDIO) audio.add(one);
                else if (group.getType() == C.TRACK_TYPE_TEXT) text.add(one);
                else if (group.getType() == C.TRACK_TYPE_VIDEO && group.isTrackSelected(i) && preloaded == null && matchRate) matchRefreshRate(f.frameRate);
            }
        }
        emit(event("tracks").put2("audio", audio.array).put2("text", text.array));
    }

    private J event(String type) { return new J().put2("type", type); }

    private void emit(final J o) {
        final String js = "window.Native && Native.player(" + o.toString() + ")";
        main.post(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
    }

    // MARK: - The TV's refresh rate to the film's (24p on a 60 Hz screen judders), and back when the video stops

    private void matchRefreshRate(float fps) {
        if (fps <= 0 || Build.VERSION.SDK_INT < 23) return;
        Display d = activity.getWindowManager().getDefaultDisplay();
        Display.Mode now = d.getMode(), best = null;
        for (Display.Mode m : d.getSupportedModes()) {
            if (m.getPhysicalWidth() != now.getPhysicalWidth() || m.getPhysicalHeight() != now.getPhysicalHeight()) continue;
            float r = m.getRefreshRate(), k = Math.round(r / fps);
            if (k < 1 || Math.abs(r - k * fps) > 0.05f) continue;
            if (best == null || r < best.getRefreshRate()) best = m;
        }
        if (best == null || best.getModeId() == now.getModeId()) return;
        if (modeBefore < 0) modeBefore = now.getModeId();
        WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
        lp.preferredDisplayModeId = best.getModeId();
        activity.getWindow().setAttributes(lp);
    }

    private void restoreMode() {
        if (modeBefore < 0 || Build.VERSION.SDK_INT < 23) return;
        WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
        lp.preferredDisplayModeId = 0;   // the system's choice again
        activity.getWindow().setAttributes(lp);
        modeBefore = -1;
    }

    // MARK: - What the page calls (on a WebView thread: everything goes to the main thread)

    final class Bridge {
        @JavascriptInterface public void open(final String json) {
            main.post(new Runnable() { @Override public void run() {
                try { Playback.this.open(new JSONObject(json), true); } catch (Exception e) { emit(event("error").put2("code", "BAD_REQUEST").put2("message", e.toString())); }
            } });
        }
        /** Like open, paused and out of sight: the title's page gets the stream ready before OK. */
        @JavascriptInterface public void preload(final String json) {
            main.post(new Runnable() { @Override public void run() {
                try { Playback.this.open(new JSONObject(json), false); } catch (Exception e) { Log.w(TAG, "preload", e); }
            } });
        }
        @JavascriptInterface public void warm(String url) { Playback.this.warm(url); }
        @JavascriptInterface public void play() { run(new Runnable() { @Override public void run() { player.play(); } }); }
        @JavascriptInterface public void pause() { run(new Runnable() { @Override public void run() { player.pause(); } }); }
        @JavascriptInterface public void seekTo(final long ms) { run(new Runnable() { @Override public void run() { player.seekTo(ms); } }); }
        @JavascriptInterface public void stop() { main.post(new Runnable() { @Override public void run() { Playback.this.stop(); } }); }

        /** An audio or subtitle track from the tracks event; group -1 turns subtitles off. */
        @JavascriptInterface public void select(final int type, final int group, final int index) {
            run(new Runnable() { @Override public void run() {
                int t = type == 1 ? C.TRACK_TYPE_AUDIO : C.TRACK_TYPE_TEXT;
                if (group < 0) {
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(t, true).build());
                    return;
                }
                Tracks.Group g = tracks.getGroups().get(group);
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(t, false)
                        .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), index)).build());
            } });
        }

        /** {pos, dur, buffered, playing}: the page asks four times a second while the controls show. */
        @JavascriptInterface public String state() {
            final J o = new J();
            final Object lock = new Object();
            final boolean[] done = {false};
            main.post(new Runnable() { @Override public void run() {
                if (player != null) o.put2("pos", player.getCurrentPosition()).put2("dur", player.getDuration())
                        .put2("buffered", player.getBufferedPosition()).put2("playing", player.isPlaying());
                synchronized (lock) { done[0] = true; lock.notify(); }
            } });
            synchronized (lock) { if (!done[0]) try { lock.wait(300); } catch (InterruptedException e) { /* answer with what there is */ } }
            return o.toString();
        }

        private void run(final Runnable r) {
            main.post(new Runnable() { @Override public void run() { if (player != null) r.run(); } });
        }
    }

    /** A JSONObject whose put doesn't throw, to build events in one line. */
    static final class J extends JSONObject {
        final JSONArray array = new JSONArray();
        J put2(String k, Object v) { try { put(k, v == null ? JSONObject.NULL : v); } catch (Exception e) { /* only NaN, never sent */ } return this; }
        J put2(String k, long v) { try { put(k, v); } catch (Exception e) { /* never */ } return this; }
        J put2(String k, boolean v) { try { put(k, v); } catch (Exception e) { /* never */ } return this; }
        void add(J o) { array.put(o); }
    }
}
