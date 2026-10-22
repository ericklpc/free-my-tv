#!/bin/bash
# Monday and Thursday runs on Erick's Mac (launchd, see sofa.curation.plist): this week's picks, the Trakt list, a new Sofá Player
# with them, installed on the Fire TV only when nothing is playing there. Logs to ~/Library/Logs/sofa-curation.log.
set -uo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
TV="${SOFA_TV:-192.168.15.22:5555}"
LETTERBOXD="${SOFA_LETTERBOXD:-$HOME/sofa-tv/survey/letterboxd}"

echo "== $(date) =="
python3 client/curation/curate.py --letterboxd "$LETTERBOXD" || { echo "curation failed"; exit 1; }
(cd firetv && ./build.sh --proto) || { echo "build failed"; exit 1; }

adb connect "$TV" >/dev/null 2>&1
if ! adb -s "$TV" get-state >/dev/null 2>&1; then echo "TV not reachable: the new picks wait for next time"; exit 0; fi
# Never in the middle of a film: playing means a media session in state 3.
if adb -s "$TV" shell dumpsys media_session 2>/dev/null | grep -q "state=PlaybackState {state=3"; then
  echo "something is playing on the TV: not installing"; exit 0
fi
adb -s "$TV" install -r firetv/Sofa-Player.apk && echo "installed"
