#!/bin/bash
# The curation's run on your Mac (launchd, see sofa.curation.plist). launchd calls this every hour and when you log in;
# the script itself decides what is due, so a Mac that was asleep or off on the day catches up the moment it's back:
#
#   1. Monday and Thursday from 8:00: this run's picks and the Trakt list (once per day of run; a run that fails is
#      tried again the next hour).
#   2. Publishes picks.json where every TV looks for it (SOFA_PUBLISH, a branch served by GitHub Pages; picks_url in
#      config.properties is its address): the Fire TV, the Samsung and a TV in another house get the new picks without
#      a new install.
#   3. Installs a Sofá Player with the new picks inside on the Fire TV, only when it's reachable and nothing is
#      playing; until then it stays pending and is tried again every hour.
#
#   weekly.sh          what is due
#   weekly.sh --now    a new run now, whatever the day
#   weekly.sh --status what was done and what is pending (changes nothing)
#
# Logs to ~/Library/Logs/sofa-curation.log.
set -uo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
TV="${SOFA_TV:?set SOFA_TV to your Fire TV, e.g. 192.168.1.20:5555}"
LETTERBOXD="${SOFA_LETTERBOXD:?set SOFA_LETTERBOXD to your Letterboxd export folder}"
PUBLISH="${SOFA_PUBLISH:-}"                     # the branch GitHub Pages serves, e.g. yt-pages; empty = don't publish
OUT=client/curation/out
mkdir -p "$OUT"

# The day of run this moment belongs to: the last Monday or Thursday whose 8:00 has passed.
slot="$(python3 -c "
import datetime
t = datetime.datetime.now()
for back in range(8):
    d = (t - datetime.timedelta(days=back)).replace(hour=8, minute=0, second=0, microsecond=0)
    if d.weekday() in (0, 3) and d <= t:
        print(d.date().isoformat()); break
")"
week() { python3 -c "import json,sys; print(json.load(open('$OUT/picks.json')).get('week',''))" 2>/dev/null; }
stamp() { cat "$OUT/$1" 2>/dev/null || true; }

if [ "${1:-}" = "--status" ]; then
  echo "day of run: $slot · last run: $(stamp last-run) · picks: $(week) · published: $(stamp published) · on the Fire TV: $(stamp installed-firetv)"
  exit 0
fi

# One at a time: an hourly call must not start over a run still going (a lock older than 3 hours is a dead one).
LOCK="$OUT/.running"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# 1. The run.
if [ "${1:-}" = "--now" ] || [ "$(stamp last-run)" != "$slot" ]; then
  echo "== $(date) · run of $slot =="
  if python3 client/curation/curate.py --letterboxd "$LETTERBOXD"; then
    echo "$slot" > "$OUT/last-run"
  else
    echo "curation failed: trying again in an hour"; exit 1
  fi
fi
WEEK="$(week)"
[ -n "$WEEK" ] || exit 0

# 2. Where the TVs look.
if [ -n "$PUBLISH" ] && [ "$(stamp published)" != "$WEEK" ]; then
  PAGES="$OUT/pages"
  if [ ! -d "$PAGES" ]; then git fetch -q origin "$PUBLISH" && git worktree add -q --detach "$PAGES" "origin/$PUBLISH"; fi
  if (cd "$PAGES" && git fetch -q origin "$PUBLISH" && git checkout -q --detach "origin/$PUBLISH") \
     && cp "$OUT/picks.json" "$PAGES/picks.json" \
     && (cd "$PAGES" && git add picks.json && { git diff --cached --quiet || git -c user.name="Sofá" -c user.email="sofa@localhost" commit -q -m "Curadoria de $WEEK"; } \
         && git push -q origin "HEAD:$PUBLISH"); then
    echo "$WEEK" > "$OUT/published"; echo "published the picks of $WEEK"
  else
    echo "publishing failed: trying again in an hour"
  fi
fi

# 3. The Fire TV: the same picks inside the app, for the days without network.
if [ "$(stamp installed-firetv)" != "$WEEK" ]; then
  adb connect "$TV" >/dev/null 2>&1
  if ! adb -s "$TV" get-state >/dev/null 2>&1; then echo "$(date '+%d/%m %H:%M') Fire TV not reachable: the install waits"; exit 0; fi
  # Never in the middle of a film: playing means a media session in state 3.
  if adb -s "$TV" shell dumpsys media_session 2>/dev/null | grep -q "state=PlaybackState {state=3"; then
    echo "$(date '+%d/%m %H:%M') something is playing on the Fire TV: the install waits"; exit 0
  fi
  (cd firetv && ./build.sh --proto) || { echo "build failed"; exit 1; }
  if adb -s "$TV" shell dumpsys media_session 2>/dev/null | grep -q "state=PlaybackState {state=3"; then
    echo "something started playing during the build: the install waits"; exit 0
  fi
  adb -s "$TV" install -r firetv/Sofa-Player.apk && echo "$WEEK" > "$OUT/installed-firetv" && echo "installed the picks of $WEEK on the Fire TV"
fi
