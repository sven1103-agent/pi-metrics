# pi-metrics

[![CI](https://github.com/sven1103-agent/pi-metrics/actions/workflows/ci.yml/badge.svg)](https://github.com/sven1103-agent/pi-metrics/actions/workflows/ci.yml)
[![Pi compatibility](https://github.com/sven1103-agent/pi-metrics/actions/workflows/pi-compat.yml/badge.svg)](https://github.com/sven1103-agent/pi-metrics/actions/workflows/pi-compat.yml)

Live LLM latency HUD for the [Pi](https://pi.dev) coding agent: time to first token,
inter-token latency, decode throughput and cost — for one call, and for the session.

```
─ pi-metrics · deepseek-v3.1 ───────────────────────────── 3 calls ─
○ waiting  ● writing  ‖ paused  ✔ done  [█████░░░░░░░]  ~38 tok/s  ~255 tok
RATE 30s  ▃▄▄▁▁█▄▄▆▅  · avg   34 tok/s · p95   46 tok/s
STATS  avg first 371ms  avg ITL 28ms  p95 ITL 45ms  3 calls
HIST TTFT ▁▂▃▅▇█▇▅▃▂ 1.8s  │  ITL ▂▃▅▇█▆▄ 41ms  (12 calls)
```

## Install

```bash
pi install npm:@sven1103/pi-metrics
```

Or pin a release from git:

```bash
pi install git:github.com/sven1103-agent/pi-metrics@v0.1.0
```

## Commands

| Command | Effect |
|---|---|
| `/metrics` | toggle the HUD |
| `/metrics on` · `/metrics off` | explicit toggle |
| `/metrics report` | append a table of recent calls to the transcript |
| `/metrics reset` | forget the calls recorded in this session |
| `/metrics placement above` · `below` | move the panel |

## Settings

All optional, under the `pi-metrics` key in `~/.pi/agent/settings.json`:

```json
{
  "pi-metrics": {
    "enabled": true,
    "placement": "aboveEditor",
    "style": "normal",
    "history": 120,
    "rateWindow": 120,
    "rateMax": "auto",
    "rateGood": 30,
    "rateBad": 15,
    "rateFast": 100,
    "graphStyle": "braille",
    "colorMode": "calm",
    "timeline": true,
    "liveTimeline": true,
    "cost": true,
    "persist": false
  }
}
```

`style` is `compact` (four lines) or `normal` (multi-row graphs). `graphStyle` is
`braille` or `block`. `colorMode` is `calm`, `vivid` or `mono`. `rateMax` is a fixed
tok/s ceiling or `auto` (session p98, never below `rateFast`). `persist` appends a
one-line card per call to the transcript.

## What it measures

- **TTFT** — request → first streamed token. `/metrics report` additionally splits it
  into `conn` (request → response headers) and `prefill` (headers → first token) when
  the provider emits response headers; the column shows `–` when it does not, and
  `conn` folds in any server-side queueing, so the split compares calls to the *same*
  provider rather than across providers.
- **ITL** — mean gap between streamed deltas, reported as a session mean and p95.
  This is stream *smoothness*, not throughput: some providers batch several tokens
  into one delta.
- **tok/s** — output tokens over decode time.
- **RATE** — a session timeline of tokens generated per second, one column per
  completed second. It is session-scoped and never resets per call, so separate
  writing actions stay comparable.
- **usage** — input/output/cache and reasoning tokens plus cost, as reported by the
  provider.

## Supported Pi versions

Two different floors, because they are genuinely different:

| | Range | Verified by |
|---|---|---|
| **Typechecks clean** | Pi **1.1.0 – 1.3.0** | `tsc --noEmit` per release |
| **Loads** | Pi **≥ 0.85.1** | real `pi` binary, headless |

Per-release status is checked in CI — each version is its own job, so the Checks tab
names the exact version that broke:

| Pi | Typecheck | Loads |
|---|---|---|
| 1.3.0 | ✅ gating | ✅ gating |
| 1.2.0 | ✅ gating | ✅ gating |
| 1.1.0 | ✅ gating | ✅ gating |
| 1.0.4, 1.0.0, 0.99.2 | ⚠️ errors reported, not asserted | ✅ gating |
| < 0.85.1 | ❌ | ❌ does not load |

Below Pi 1.1.0 the published typings are incomplete — the extension still loads, but it
does not typecheck. In that lane CI runs the load gate as a real check and only
*reports* the typecheck error count as evidence for the floor above; it never asserts
that errors must be present, so an upstream backport lowers the floor without breaking
the build.

The `@earendil-works/pi-ai` peerDependency floor is `>=1.1.0`, matching the typecheck
floor. The other two stay at `*` as Pi requires.

**Interactive rendering is verified manually.** The widget is TUI-only, so a headless
run cannot exercise it. Do not read these badges as covering what the HUD looks like.

## What it does not do

- It does not send anything anywhere. **No network calls, no telemetry, no credential
  access.** See [SECURITY.md](SECURITY.md).
- It does not measure prompt tokens per second; it measures decode throughput.
- It does not persist history across sessions unless `persist` is enabled.

## Maintained by

[Sven Fillinger](https://github.com/sven1103), Research Software Engineer, University
of Tübingen. The repository is operated through my agent alias
[@sven1103-agent](https://github.com/sven1103-agent) — the account that authors the
commits here. Same person; the alias exists so the automation is labelled as automation.

## License

MIT
