#!/usr/bin/env bash
#
# Regenerate the README animations from scripts/demo.mjs.
#
# The committed GIFs are build output, not source. This script is what produces them, so a
# change to the HUD can be reflected in the docs without guessing at the original settings.
#
# Requires: asciinema, agg (https://github.com/asciinema/agg)
#
#   ./scripts/record-demo.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

for tool in asciinema agg node; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

mkdir -p docs/assets
COLS=100
ROWS=20

# The animation plays at real time: demo.mjs steps 100ms of virtual time every 100ms of wall
# clock, so what you see is the cadence a user actually gets in Pi. Do NOT reintroduce a
# second speed factor here. A previous revision combined DEMO_FRAME_MS=25 (4x) with
# `agg --speed 1.5` (1.5x) for a compounded ~6x, which drew each TPS column in ~25ms and made
# the chart read as a blinking panel rather than an instrument.
for mode in braille block; do
  cast="docs/assets/hud-$mode.cast"
  gif="docs/assets/hud-$mode.gif"
  echo "recording $mode …"
  asciinema rec \
    --output-format asciicast-v2 \
    --cols "$COLS" --rows "$ROWS" \
    --command "node scripts/demo.mjs $mode" \
    "$cast" --overwrite >/dev/null
  # No --speed: the elapsed time in the cast is already the real time. --idle-time-limit only
  # trims the dead air between calls, which carries no information.
  # --last-frame-duration is 0 because the demo already ends with its own HOLD_MS pause on the
  # finished HUD; setting both stacks two holds and stretches the loop past the timeline the
  # chart is actually showing.
  agg --cols "$COLS" --rows "$ROWS" \
    --font-size 13 --line-height 1.25 \
    --idle-time-limit 1 --last-frame-duration 0 \
    --theme asciinema \
    "$cast" "$gif" >/dev/null
  rm -f "$cast"
  echo "  wrote $gif ($(du -h "$gif" | cut -f1))"
done

echo "done."
