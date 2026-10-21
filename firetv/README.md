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

Fire OS doesn't let you pick another home screen. Sofá works around it with `HomeService`, an accessibility service
that only sees which app comes to the front: when Amazon's home shows up, it opens Sofá over it. Back on Sofá's first
screen still takes you to Amazon's home on purpose (it stays there until you open another app).

Turn it on once, from the computer (it adds Sofá to the services already on, and keeps them):

    cur=$(adb shell settings get secure enabled_accessibility_services | tr -d '\r')
    svc=io.sofa.firetv/io.sofa.firetv.HomeService
    case "$cur" in null|"") new=$svc ;; *"$svc"*) new=$cur ;; *) new="$cur:$svc" ;; esac
    adb shell settings put secure enabled_accessibility_services "$new"
    adb shell settings put secure accessibility_enabled 1

To undo, put back the old value (or `adb shell settings delete secure enabled_accessibility_services` if it was
`null`). Fire OS may switch the service off after an update; run the lines again.

Debugging the page: `chrome://inspect` on the computer, with the Fire TV connected over adb.
