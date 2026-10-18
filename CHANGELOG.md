# Changelog

Notable changes per release. This project follows [Semantic Versioning](https://semver.org/).

**`0.y.z` is initial development.** By SemVer, anything may change at any time in a major-zero
release — behaviour, settings keys, the rendered layout, and the extension's exported surface —
including in a patch. No version below `1.0.0` is a compatibility promise. `1.0.0` is the first
release that will define a stable API, and it is the target being built towards.

## 0.1.1 — unreleased

Not yet tagged: the date and the release link are added at that point.

Documentation and packaging fixes. The extension's behaviour, settings keys and rendered
layout are unchanged from 0.1.0, so this is a drop-in replacement.

- **The README animations are now actually published.** `files` whitelisted `README.md` but
  not the two images it references, so they were absent from the tarball and every relative
  image URL resolved to a 404. GitHub renders them from the repository, which hid the
  problem: only the *published* consumers were broken, and the Pi gallery is one of them,
  because it resolves relative README paths against the tarball
  (`cdn.jsdelivr.net/npm/@sven1103-agent/pi-metrics@0.1.0/docs/assets/...`). `files` now
  includes `docs/assets/*.webp`. `scripts/pack-assets.test.mjs` asserts that every relative
  image in the README is present in `npm pack` output, so the two cannot drift again.
- **The animations are animated WebP, not GIF.** Same 798x341 canvas, same 128 frames, same
  duration, byte-identical pixels — and 535 KB of GIF became 348 KB, a 35% reduction on every
  clone and every npm fetch of the README. `gif2webp` in its default lossless mode is both
  smaller *and* exact here, because terminal frames are flat, few-colour images; lossy `-q`
  actually came out larger. `scripts/record-demo.sh` now renders via agg to a temporary GIF
  and converts, deleting both intermediates so only the `.webp` is committed.
- `package.json` declares an explicit `pi` manifest, naming the extension entry point and a
  gallery preview image, instead of relying on `extensions/` directory discovery. This is not
  cosmetics: Pi treats a present-but-extensionless `pi` object as authoritative and skips
  directory discovery, so a manifest added later for preview fields alone would have silently
  disabled the extension. Verified against the real binary — `pi` with `image` and no
  `extensions` loads nothing, while an explicit `extensions` entry loads as before.

## 0.1.0 — unreleased

Not yet tagged: the date and the release link are added at that point.

First public **development** release, not the stable one — see the note above.

- Live HUD above or below the editor: per-call state, decode throughput, token count.
- Session TPS timeline — tokens per second, one column per completed second, never
  reset per call, so separate writing actions stay comparable.
- Session STATS — median first-token time, its `conn`/`prefill` split, median
  inter-token latency and p95 ITL.
- HIST timelines for TTFT and ITL with median and max.
- `/metrics` command to toggle, reset, move the panel, or print a per-call report
  table with TTFT, `conn`/`prefill`, ITL, tok/s, TTOUT, tokens and cost.
- Settings for layout, graph glyphs, colour intensity, TPS thresholds and persistence.

The pre-release draft kept a few things it was better off without, so 0.1.0 is not a
rename of them:

- Throughput is the provider's own count when it reports one, and a character estimate
  otherwise — tagged `(usage)` or `(est)` on the HUD so the two are never confused. This
  replaced a `chars / 4` heuristic that was wrong by ~19% at the median and ~49% at p90
  against 39,000 real calls.
- `RATE` became `TPS`, and the `rate*` settings keys became `tps*`. The `rate*` names are
  still read as aliases.
- `tpsFast` is the only threshold printed. `tpsGood` / `tpsBad` are configuration, not
  measurement, and printing them invited reading them as results; they now draw the chart's
  reference lines. The recording window and the chart ceiling sit together on the right.
- Colour is one cool-to-hot hue ramp, not four bands, and it is **relative rather than
  absolute**. Severity is now the ratio to the session's own typical value for throughput as
  well as latency, so an 8 tok/s local model and a 200 tok/s hosted one centre on the same
  green; absolute tok/s thresholds pinned the first at "bad" and the second at "fast" forever.
  `tpsGood` is the cold-start stand-in until the session has a few seconds of history, and
  `tpsGood` / `tpsBad` / `tpsFast` are now what they look like on the chart: target lines.
  The `fast` anchor sits at teal (195°) instead of green, so the healthy half is a hue sweep
  rather than a single green with only saturation varying. Anchors stay monotone
  (~195° → ~150° → ~100° → ~45°) and are mixed in Oklch, not RGB, so the midtones stay
  saturated instead of passing through grey. Green-to-red read as harsh, so the yellow half of
  the warm range now gets 70% of it and only the far end reaches red: `vivid` uses hand-picked
  anchors, `calm` blends the theme's own red toward its warning, `mono` still has no hue.
- The chart fill is a *vertical* gradient keyed to the **bar**, not to the axis: a bar's top
  edge carries the colour of its own value and the fill fades toward the axis baseline below.
  The previous version coloured each row from `max * (row + 0.5) / height`, which quietly made
  the colour a function of the axis maximum — and that maximum moves on its own (auto ceiling,
  running max, floored at `tpsFast`), so a slow provider had every bar crushed into the bottom
  row in one colour and any rescale shifted the whole gradient. The honest cost: only the top
  edge is a measurement, the cells below are a gradient. A braille cell carries one colour
  across four sub-rows, so the fade steps once per text row. The one-row sparklines in the
  persisted card keep the per-sample colour, the only thing a single row can show.
- The automatic TPS ceiling is derived from the session **p90** with headroom, instead of p98.
  At the sample counts this chart has p98 *is* the maximum — `percentile` takes the nearest
  index, so p98 of ten seconds is the tenth — so one outlier second moved the ceiling and
  rescaled every other bar with it: a measured 9-seconds-at-150-plus-one-at-900 session got a
  1500 ceiling and rendered as a flat line along the bottom. p95 does not fix that either; it is
  still the maximum until about a dozen samples, and returns an outlier for three in thirty. p90
  survives both, and a bimodal (half cached) session as well. The median was tried and rejected
  for a different reason: it sits *on* a mode and jumps between them, so a small shift in the mix
  swung its doubled value from 200 to 750. Deliberate trade: a genuine peak exceeds the ceiling
  and renders at full height. `scripts/hud-layout.test.mjs` asserts that growing the outlier does
  not move the axis at all — which p98 and p95 fail and p90 passes.
- `graphStyle: "block"` actually draws its TTFT and ITL histograms. Both were handed the
  braille slot count (two samples per cell) while the block renderer only ever reads the last
  `width` slots — the padding half — so the two charts rendered empty, and the README's own
  block-mode animation showed a blank histogram. The slot count now follows the renderer.
- The latency ramp is symmetric in the ratio to the median, so the cool end is reachable at
  all. `latencySeverity` clamped to `[0, 1]`, which made *every* latency at or below the
  session median the same green: 3× the median was red, but a tenth of it was no cooler than
  the median, and the new `fast` anchor changed nothing for the histogram charts. It is now
  `-1` at a third of the median and `+1` at 3×, saturating at the same multiplicative distance
  in both directions, and throughput uses the same scale with the sign flipped.
  `scripts/color-ramp.test.mjs` pins the order, the reach, the scale-invariance and the
  gradient fill.
- The chart title protects the axis under truncation: on a narrow terminal the stats give
  way, not the scale.
- `placement` works as documented. Pi compares the value against `belowEditor` exactly and
  silently treats anything else as "above", so the `below` spelling this extension's own
  usage line printed moved nothing and said nothing. Both spellings are now accepted, and an
  unusable value is reported at startup as a warning *and* replaced by the default.
- The STATS `conn`/`prefill` split is shown as two millisecond medians, not a percentage.
  `conn` (request → response headers) usually dwarfs `prefill` (headers → first token), so
  the share rounded to `100/0` in the common case and hid the magnitude that actually tells
  you whether the wait is worth chasing. The two are separate medians, not a decomposition:
  medians are not additive, so they need not sum to the `med first` printed beside them.
- `/metrics` gained `placement`, `style`, `graph`, `color` and `report` subcommands. They
  apply immediately and print the `settings.json` line that persists them; the extension
  does not write that file itself, because the extension API exposes no settings-write call
  and editing it underneath Pi's settings manager can drop unrelated keys. An unrecognised
  subcommand now warns instead of silently toggling the HUD.
- `cost` is honoured. It was declared, defaulted and documented, but read by nothing; it
  now gates the cost column in `/metrics report` and on the persisted card.
