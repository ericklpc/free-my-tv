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

Fire OS doesn't let you pick another home screen. For now Sofá opens like an app. Debugging the page:
`chrome://inspect` on the computer, with the Fire TV connected over adb.
