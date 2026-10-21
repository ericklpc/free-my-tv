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

Debugging the page: `chrome://inspect` on the computer, with the Fire TV connected over adb.

## Making the Fire TV faster

`debloat.sh` turns off Amazon's ads, telemetry and the Amazon apps Sofá doesn't use, so there's more memory and CPU
for Sofá and the player. It never touches Amazon's home, Settings, the Appstore, Prime Video, the keyboard, WebView,
Sofá, the player or apps that saved a Wi-Fi network, and it logs every change so `--restore` undoes it all.

    ./firetv/debloat.sh <IP>                    # what it would do; changes nothing
    ./firetv/debloat.sh <IP> --apply            # tiers 1 (ads, telemetry) and 2 (unused Amazon apps)
    ./firetv/debloat.sh <IP> --apply 3          # also Alexa, home recommendations and system updates
    ./firetv/debloat.sh <IP> --animations 0.5   # faster animations (1 = stock)
    ./firetv/debloat.sh <IP> --restore          # undo everything

Then restart the TV. On the TV itself, also turn off Settings → Preferences → Featured Content → video and audio
autoplay (Amazon's home stops playing trailers behind Sofá), and in Preferences → Privacy, the usage data and
interest-based ads. A factory reset or a big Fire OS update can bring the apps back; run it again.
