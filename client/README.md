# Sofá Player

Erick's own client for Stremio content, in the Apple TV app's language: the Sofá web UI (`web/`'s rules: ES5, no
CSS variables, only transform and opacity animate) on top of a native Media3 player on the Fire TV.

## What the TV can play (measured over adb, 2026-10-21)

Fire TV Stick 4K (2018, AFTMM, Fire OS 6.7.1.1 = Android 7.1, armv7) on a TV that takes 1080p at most, HDR10 only
(no Dolby Vision, no HLG) and stereo PCM only (no passthrough). The stick decodes HEVC, AVC and VP9 up to 4K60 in
hardware, has no AV1, and decodes AC3, E-AC3, AAC and Opus but not DTS or TrueHD. Wi-Fi on 2.4 GHz, 144 Mbps link.

So the ranking (`proto/ranking.js`) drops what isn't cached in TorBox, AV1, Dolby Vision without an HDR10 base layer
(profile 5) and anything over ~30 Mbps, and prefers 1080p, or 4K when the file is small, with DD/DD+/AAC audio and
Portuguese audio or subtitles. DTS and TrueHD still play (Media3's ffmpeg extension decodes them to PCM), ranked lower.

## The prototype (`proto/`)

Home, details page and player, navigable with a remote. The video is simulated (the title's backdrop and a timer);
the flow around it is the real one: pre-resolving the stream when a title keeps focus, the stream chosen for this TV,
automatic fallback when a stream breaks (Interstellar's first pick does, on purpose), one-button sources menu (Menu),
subtitles by priority with the release-matched one first, skip intro, next episode with the same `bingeGroup`, and
the measurements (clicks from Home to the first frame, TTFF, first choice kept) logged in the browser.
The picks' one-line reasons are placeholders until the curation runs on Erick's Letterboxd export.

- In a browser: `python3 client/proto/build.py --serve`, then http://127.0.0.1:8766. Keys: arrows, Enter (OK),
  Esc (Back), M (Menu), P (play/pause), F/R (±5 min).
- On the Fire TV: `./firetv/build.sh --proto` → `firetv/Sofa-Player.apk` ("Sofá Player", `io.sofa.player`, next to
  Sofá), then `adb install -r firetv/Sofa-Player.apk`. The remote's Menu (≡) opens the sources.

With `tmdb_key` in `config.properties`, the art comes from TMDB (backdrops, Portuguese title logos, episode stills).
