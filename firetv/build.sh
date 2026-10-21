#!/usr/bin/env bash
# Builds Sofa-FireTV.apk: web/ (the same home screen as Samsung and LG) inside a WebView, for Fire TV and other
# Android TVs. No Gradle, like ../build.sh: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# Needs a JDK (17+), Python 3 and the Android SDK command-line tools (build-tools 34+, platform android-34).
# Settings come from ../config.properties (city, language, stremio_auth_key, tmdb_key): they go inside the APK,
# so keep the APK to yourself.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ]; then
  for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" /opt/homebrew/share/android-commandlinetools \
           /usr/local/share/android-commandlinetools /usr/lib/android-sdk; do
    if [ -d "$d/build-tools" ]; then SDK="$d"; break; fi
  done
fi
[ -n "$SDK" ] && [ -d "$SDK/build-tools" ] || { echo "Android SDK not found. Install it and set ANDROID_HOME (see README)."; exit 1; }
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
AJ="$(ls -d "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1 || true)"
[ -f "${AJ:-}" ] || { echo "Android platform not found. Run: sdkmanager \"platforms;android-34\""; exit 1; }
JAVAC="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
KEYTOOL="${JAVA_HOME:+$JAVA_HOME/bin/}keytool"

rm -rf out && mkdir -p out/assets out/classes out/gen
# The web app's files, with the settings, as the APK's assets/web/.
python3 -c "
import sys; sys.path.insert(0, '../tools'); import webapp
webapp.preview(webapp.files(webapp.config_from_args(sys.argv[1:]), 'firetv/build.sh'), 'out/assets/web')
" "$@"

"$BT/aapt2" compile --dir res -o out/res.zip
"$BT/aapt2" link -o out/base.apk -I "$AJ" --manifest AndroidManifest.xml --java out/gen out/res.zip \
  --min-sdk-version 22 --target-sdk-version 28 -A out/assets -0 ttf
"$JAVAC" -nowarn -Xlint:-options -source 8 -target 8 -classpath "$AJ" -encoding UTF-8 -d out/classes \
  $(find src out/gen -name '*.java')
"$BT/d8" --release --min-api 22 --lib "$AJ" --output out $(find out/classes -name '*.class')
(cd out && zip -qj base.apk classes.dex)
"$BT/zipalign" -f -p 4 out/base.apk out/aligned.apk

# Your own signing key, created once (updates need the same one: keep sofa.keystore).
if [ ! -f sofa.keystore ]; then
  "$KEYTOOL" -genkeypair -keystore sofa.keystore -alias sofa -keyalg RSA -keysize 2048 -validity 20000 \
    -storepass sofa-tv -keypass sofa-tv -dname "CN=Sofa" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks sofa.keystore --ks-pass pass:sofa-tv --key-pass pass:sofa-tv --out Sofa-FireTV.apk out/aligned.apk
echo "Built firetv/Sofa-FireTV.apk ($(du -h Sofa-FireTV.apk | cut -f1)). Install: adb connect <IP>:5555 && adb install -r firetv/Sofa-FireTV.apk"
