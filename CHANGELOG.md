# Changelog

Notable changes per release. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-16

First public release.

- Live HUD above or below the editor: per-call state, decode throughput, token count.
- Session TPS timeline — tokens per second, one column per completed second, never
  reset per call, so separate writing actions stay comparable.
- Session STATS — median first-token time, median inter-token latency and p95 ITL.
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
- The chart title protects the axis under truncation: on a narrow terminal the stats give
  way, not the scale.

[0.1.0]: https://github.com/sven1103-agent/pi-metrics/releases/tag/v0.1.0
