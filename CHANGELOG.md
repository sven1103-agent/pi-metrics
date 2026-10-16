# Changelog

Notable changes per release. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-16

First public release.

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
- `tpsFast` is the only threshold printed. `tpsGood` / `tpsBad` colour the HUD but are
  configuration, not measurement, and printing them invited reading them as results.
  The recording window and the chart ceiling now sit together on the right of the title.
- Colour is one cool-to-hot hue ramp, not four bands. The `fast` anchor sits at teal (195°)
  instead of green, so the healthy half is a hue sweep rather than a single green with only
  saturation varying — a fast provider used to render as a flat green slab. Anchors stay
  monotone (~195° → ~150° → 85° → 25°) and are mixed in Oklch, not RGB, so the midtones stay
  saturated instead of passing through grey. `calm` keeps the theme's green/amber/red and
  hue-shifts only `fast`; `vivid` uses the full hand-picked set; `mono` still has no hue.
- The latency ramp is symmetric in the ratio to the median, so the cool end is reachable at
  all. `latencySeverity` clamped to `[0, 1]`, which made *every* latency at or below the
  session median the same green: 3× the median was red, but a tenth of it was no cooler than
  the median, and the new `fast` anchor changed nothing for the histogram charts. It is now
  `-1` at a third of the median and `+1` at 3×, saturating at the same multiplicative distance
  in both directions. `scripts/color-ramp.test.mjs` pins the order.
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

[0.1.0]: https://github.com/sven1103-agent/pi-metrics/releases/tag/v0.1.0
