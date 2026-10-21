#!/usr/bin/env bash
# Turns off Amazon's ads, telemetry and unused apps on a Fire TV (Fire OS 6/7), so Sofá and the player have more
# memory and CPU. Every change is written to a log next to this script, and --restore brings it all back.
#
#   ./firetv/debloat.sh <IP>                     what it would do (changes nothing)
#   ./firetv/debloat.sh <IP> --apply [1|2|3]     turn off tiers up to N (default 2), then trim caches
#   ./firetv/debloat.sh <IP> --animations 0.5    animation speed (1 = stock, 0.5 = twice as fast, 0 = off)
#   ./firetv/debloat.sh <IP> --restore           undo everything in the log
#
# Tier 1: ads, telemetry, demos, tutorials. Nothing you see changes.
# Tier 2: Amazon apps Sofá doesn't use (Photos, Music, Kindle, Kids, Freevee, games, smart home).
# Tier 3: costs something: Alexa (the voice button stops), Amazon's home recommendations, system updates.
#
# Never touched: Amazon's home (Fire OS 6 can't swap it), Settings, the Appstore (licenses for Netflix, Max,
# Globoplay), Prime Video, the keyboard, WebView, Sofá, the player, and any app that saved a Wi-Fi network
# (Android would delete its networks). Bash 3.2, so it runs on a stock Mac.
set -euo pipefail
cd "$(dirname "$0")"

TIER1="
com.amazon.dp.logger                    # telemetry
com.amazon.device.crashmanager          # crash reports to Amazon
com.amazon.wirelessmetrics.service      # Wi-Fi metrics
com.amazon.device.telemetry.emitter     # telemetry
com.amazon.perfcollection               # performance reports
com.amazon.hybridadidservice            # ad id and ad targeting
com.amazon.tv.acr                       # reads what's on screen for viewing stats
com.amazon.kso                          # special offers (ads)
com.amazon.kso.blackbird                # special offers (ads)
com.amazon.sneakpeek                    # ad previews on the home screen
com.amazon.tv.democontent.provider      # store demo content
com.amazon.storm.lightning.tutorial     # tutorial
com.amazon.shoptv.client                # shopping
com.amazon.spiderpork                   # scans sideloaded apps and can block them
"
TIER2="
com.amazon.bueller.photos               # Amazon Photos
com.amazon.bueller.music                # Amazon Music
com.amazon.ods.kindleconnect            # Kindle
com.amazon.tahoe                        # Amazon Kids
com.amazon.imdb.tv.android.app          # Freevee
com.amazon.minitv.android.app           # miniTV
com.amazon.gamehub                      # games hub
com.amazon.ags.app                      # GameCircle
com.amazon.smarthomemapviewapp          # smart home
com.amazon.tv.matter                    # smart home (Matter)
com.amazon.audiohome                    # Alexa audio groups
"
TIER3="
com.amazon.tv.alexanotifications        # Alexa notifications
com.amazon.vizzini                      # Alexa (the remote's voice button stops)
com.amazon.media.recommendations        # recommendations on Amazon's home
com.amazon.tv.forcedotaupdater.v2       # forced updates
com.amazon.device.software.ota          # system updates (keeps the debloat, but no more security fixes)
"
# A safety net in case a list above is edited carelessly
PROTECTED='^(io\.sofa\..*|com\.amazon\.tv\.launcher|com\.amazon\.tv\.settings.*|com\.amazon\.venezia|com\.amazon\.firebat|com\.amazon\.avod.*|com\.amazon\.amazonvideo\..*|com\.amazon\.tv\.ime.*|com\.amazon\.tv\.oobe|com\.amazon\.webview.*|com\.android\..*|android|com\.amazon\.tcomm|com\.amazon\.device\.messaging|com\.amazon\.client\.metrics.*|com\.amazon\.wifilocker|com\.amazon\.tv\.parentalcontrols)$'

IP="${1:-}"; shift || true
[ -n "$IP" ] || { sed -n '5,9p' "$0" | sed 's/^# *//'; exit 1; }
MODE="${1:-dry}"; ARG="${2:-}"
DEV="$IP"; case "$DEV" in *:*) ;; *) DEV="$DEV:5555" ;; esac
LOG="debloat-$(echo "$IP" | tr ':.' '__').log"

adb connect "$DEV" >/dev/null
tv() { adb -s "$DEV" shell "$@" 2>&1 | tr -d '\r' || true; }
[ "$(tv echo ok)" = ok ] || { echo "No adb on $DEV. Accept the prompt on the TV and try again."; exit 1; }
echo "$(tv getprop ro.product.model) · Fire OS $(tv getprop ro.build.version.name | sed 's/.*Fire OS //') · Android $(tv getprop ro.build.version.release)"

list() {  # the packages of tiers 1..N, without comments
  local n="$1" all="$TIER1"
  [ "$n" -ge 2 ] && all="$all$TIER2"
  [ "$n" -ge 3 ] && all="$all$TIER3"
  echo "$all" | sed 's/#.*//' | tr -s ' \n' '\n' | grep -v '^$'
}

if [ "$MODE" = --restore ]; then
  [ -f "$LOG" ] || { echo "No $LOG: nothing to undo."; exit 0; }
  while read -r how pkg; do
    case "$how" in
      disabled) out="$(tv pm enable "$pkg")" ;;
      removed)  out="$(tv cmd package install-existing "$pkg")"
                echo "$out" | grep -qi 'installed' || out="$(tv pm install-existing "$pkg")" ;;
      animations) tv settings put global window_animation_scale "$pkg" >/dev/null
                  tv settings put global transition_animation_scale "$pkg" >/dev/null
                  tv settings put global animator_duration_scale "$pkg" >/dev/null; out="speed $pkg"; pkg=animations ;;
      *) continue ;;
    esac
    echo "  $pkg: $out"
  done < <(tail -r "$LOG" 2>/dev/null || tac "$LOG")
  mv "$LOG" "$LOG.restored-$(date +%Y%m%d-%H%M)"
  echo "Done. Restart the TV (Settings → My Fire TV → Restart)."
  exit 0
fi

if [ "$MODE" = --animations ]; then
  [ -n "$ARG" ] || { echo "Say the speed: 1, 0.5 or 0."; exit 1; }
  old="$(tv settings get global window_animation_scale)"; [ "$old" = null ] && old=1
  grep -q '^animations ' "$LOG" 2>/dev/null || echo "animations $old" >> "$LOG"
  for k in window_animation_scale transition_animation_scale animator_duration_scale; do
    tv settings put global "$k" "$ARG" >/dev/null
  done
  echo "Animations: $(tv settings get global window_animation_scale) (was $old)."
  exit 0
fi

TIER=3; [ "$MODE" = --apply ] && TIER="${ARG:-2}"
# Apps that saved a Wi-Fi network: turning them off makes Android delete those networks
WIFI="$(tv dumpsys wifi | grep -oE '(creatorName|cname)=[A-Za-z0-9._]+' | cut -d= -f2 | sort -u | tr '\n' ' ' || true)"
INSTALLED="$(tv pm list packages | sed 's/^package://')"
DISABLED="$(tv pm list packages -d | sed 's/^package://')"

[ "$MODE" = --apply ] && { tv pm list packages -s > "debloat-before-$(date +%Y%m%d-%H%M).txt"; }
n=0
for pkg in $(list "$TIER"); do
  tier=1; echo "$TIER2" | grep -qE "^$pkg " && tier=2; echo "$TIER3" | grep -qE "^$pkg " && tier=3
  if ! echo "$INSTALLED" | grep -qx "$pkg"; then continue; fi
  if echo "$pkg" | grep -qE "$PROTECTED"; then echo "  skip $pkg (protected)"; continue; fi
  case " $WIFI " in *" $pkg "*) echo "  skip $pkg (saved a Wi-Fi network)"; continue ;; esac
  if echo "$DISABLED" | grep -qx "$pkg"; then echo "  ok   $pkg (already off)"; continue; fi
  if [ "$MODE" != --apply ]; then echo "  would turn off [$tier] $pkg"; n=$((n+1)); continue; fi
  # disable-user keeps the app (Fire OS 6 refuses it for some); uninstall --user 0 keeps the APK in /system
  out="$(tv pm disable-user --user 0 "$pkg")"
  if echo "$out" | grep -q 'disabled-user'; then
    echo "disabled $pkg" >> "$LOG"; echo "  off  $pkg"
  else
    out="$(tv pm uninstall -k --user 0 "$pkg")"
    if [ "$out" = Success ]; then echo "removed $pkg" >> "$LOG"; echo "  off  $pkg (removed for this user)"
    else echo "  FAIL $pkg: $out"; fi
  fi
  n=$((n+1))
done

if [ "$MODE" = --apply ]; then
  tv pm trim-caches 999G >/dev/null
  echo "Done ($n). Log: firetv/$LOG. Restart the TV (Settings → My Fire TV → Restart)."
else
  echo "$n to turn off across tiers 1-3 (nothing changed). Wi-Fi owners: ${WIFI:-none}"
fi
