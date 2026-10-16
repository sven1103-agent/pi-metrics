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

# DEMO_FRAME_MS controls how fast the animation runs in real time. The demo itself is driven
# by a virtual clock (see demo.mjs), so this only affects wall-clock length, never the
# rendered numbers.
for mode in braille block; do
  cast="docs/assets/hud-$mode.cast"
  gif="docs/assets/hud-$mode.gif"
  echo "recording $mode …"
  DEMO_FRAME_MS=25 asciinema rec \
    --output-format asciicast-v2 \
    --cols "$COLS" --rows "$ROWS" \
    --command "node scripts/demo.mjs $mode" \
    "$cast" --overwrite >/dev/null
  # --idle-time-limit compresses the gaps between calls; --speed trims the total runtime.
  agg --cols "$COLS" --rows "$ROWS" \
    --font-size 13 --line-height 1.25 \
    --speed 1.5 --idle-time-limit 0.5 --last-frame-duration 2.5 \
    --theme asciinema \
    "$cast" "$gif" >/dev/null
  rm -f "$cast"
  echo "  wrote $gif ($(du -h "$gif" | cut -f1))"
done

echo "done."
