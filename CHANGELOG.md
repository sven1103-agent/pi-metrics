# Changelog

Notable changes per release. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-16

First public release.

- Live HUD above or below the editor: per-call state, decode throughput, token count.
- Session RATE timeline — tokens per second, one column per completed second, never
  reset per call, so separate writing actions stay comparable.
- Session STATS — mean first-token time, mean inter-token latency and p95 ITL.
- HIST timelines for TTFT and ITL with median and max.
- `/metrics` command to toggle, reset, move the panel, or print a per-call report
  table with TTFT, `conn`/`prefill`, ITL, tok/s, TTOUT, tokens and cost.
- Settings for layout, graph glyphs, colour intensity, rate thresholds and persistence.

[0.1.0]: https://github.com/sven1103-agent/pi-metrics/releases/tag/v0.1.0
