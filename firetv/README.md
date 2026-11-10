# Sofá on Fire TV

The same home screen as Samsung and LG (`web/`), inside a small Android app: a full-screen WebView plus a bridge
(`window.AndroidTV`) that lists the installed apps with their banners, opens them, and opens Stremio straight on a
title (`stremio:///detail/...`).

## Build and install

1. Tools: JDK 17+, Python 3, Android SDK command-line tools (`build-tools;34.0.0`, `platforms;android-34`), adb.
   On a Mac: `brew install --cask temurin android-commandlinetools android-platform-tools`, then
   `sdkmanager "build-tools;34.0.0" "platforms;android-34"`.
2. Settings in `../config.properties` (the same file as the rest of the project). They go into the APK.
3. `./firetv/build.sh` → `firetv/Sofa-FireTV.apk`. Keep `firetv/sofa.keystore`.
4. On the Fire TV: Settings → My Fire TV → Developer options → ADB debugging on. Then
   `adb connect <IP>:5555` (accept the prompt on the TV) and `adb install -r firetv/Sofa-FireTV.apk`.

## The Home button

Fire OS doesn't let you pick another home screen, and Fire OS 6 won't run accessibility services from apps installed
outside its store (so Projectivy's and Home on Fire's Home override don't work there either). Sofá works around it with
`HomeWatcher`: a few times a second it checks which app came to the front, and when it's Amazon's home, it opens Sofá
over it (Amazon's home shows for a moment first). Back on Sofá's first screen still takes you to Amazon's home on
purpose (it stays there until you open another app).

It needs usage access, which only adb can give, once:

    adb shell appops set io.sofa.firetv GET_USAGE_STATS allow

Android holds an app opened right after Home for about 5 s. To cover Amazon's home meanwhile (a black screen with
Sofá's icon), let Sofá draw over other apps:

    adb shell appops set io.sofa.firetv SYSTEM_ALERT_WINDOW allow

Then open Sofá once (it also starts by itself when the TV restarts). To undo either: the same line with `ignore`.

## The screensaver

Sofá keeps the screen on while it's in front (`FLAG_KEEP_SCREEN_ON`), so Fire OS's own screensaver never covers it.
Instead, after five idle minutes the page shows its own screensaver: a slow slideshow of what you're watching and your
lists (their art), then the picks, with a clock over them. Any key wakes it. After a long idle (~45 min) Sofá stops
holding the screen on, so Fire OS can sleep the panel; a press wakes the TV and Sofá comes back.

Fire OS's screensaver is now hidden behind Sofá, so turning it off is optional. To turn it off anyway:
Settings → Display & Sounds → Screen Saver → Start Time → **Never** (no adb needed).

Debugging the page: `chrome://inspect` on the computer, with the Fire TV connected over adb.
