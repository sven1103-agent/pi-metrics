#!/usr/bin/env bash
#
# Regenerate the README animations from scripts/demo.mjs.
#
# The committed animations are build output, not source. This script is what produces them,
# so a change to the HUD can be reflected in the docs without guessing at the original
# settings. Both the intermediate .cast and the intermediate .gif are removed; only the
# .webp is committed.
#
# Requires: asciinema, agg (https://github.com/asciinema/agg), gif2webp (libwebp)
#
#   ./scripts/record-demo.sh
#
# Output is animated WebP, not GIF. agg can only write GIF, so each recording is rendered to
# a temporary GIF and then converted with `gif2webp` in its **default lossless** mode. That
# is not a compromise: terminal frames are flat, few-colour images, so lossless WebP comes
# out ~35% smaller than the GIF (535K -> 348K across both animations) *and* decodes to
# byte-identical pixels. Verified frame-by-frame: 128/128 frames match on both, with the same
# 798x341 canvas and the same total duration. Do not reach for `-q`: lossy here is larger
# than lossless and would only add artefacts. Keep the GIFs out of the repository and out of
# `files`; the README references the .webp directly.
#
set -euo pipefail

cd "$(dirname "$0")/.."

for tool in asciinema agg gif2webp node; do
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
  webp="docs/assets/hud-$mode.webp"
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

  # Default (lossless) gif2webp: no -q, no -lossy, no -min_size. -m 6 is the slowest and
  # smallest search; this runs twice a release, so the CPU is free.
  gif2webp -m 6 -mt "$gif" -o "$webp" >/dev/null

  rm -f "$cast" "$gif"
  echo "  wrote $webp ($(du -h "$webp" | cut -f1))"
done

echo "done."
