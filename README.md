# pi-metrics

[![CI](https://github.com/sven1103-agent/pi-metrics/actions/workflows/ci.yml/badge.svg)](https://github.com/sven1103-agent/pi-metrics/actions/workflows/ci.yml)
[![Pi compatibility](https://github.com/sven1103-agent/pi-metrics/actions/workflows/pi-compat.yml/badge.svg)](https://github.com/sven1103-agent/pi-metrics/actions/workflows/pi-compat.yml)

Live LLM latency HUD for the [Pi](https://pi.dev) coding agent: time to first token,
inter-token latency, decode throughput and cost — for one call, and for the session.

```
─ pi-metrics · deepseek-v3.1 ───────────────────────────── 3 calls ─
○ waiting  ● writing  ‖ paused  ✔ done  [█████░░░░░░░]  38 tok/s  255 tok
TPS 30s  ▃▄▄▁▁█▄▄▆▅  · avg   34 tok/s · p95   46 tok/s
STATS  split 76/24 conn/prefill  med first 371ms  med ITL 28ms  p95 ITL 45ms  3 calls
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
    "tpsWindow": 120,
    "tpsMax": "auto",
    "tpsGood": 30,
    "tpsBad": 15,
    "tpsFast": 100,
    "charsPerToken": "auto",
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
`braille` or `block`. `colorMode` is `calm`, `vivid` or `mono`. `tpsMax` is a fixed
tok/s ceiling or `auto` (session p98, never below `tpsFast`). `charsPerToken` is `auto`
(calibrate from this session) or a fixed characters-per-token divisor. `persist` appends
a one-line card per call to the transcript.

The pre-0.1.0 names `rateWindow` / `rateMax` / `rateGood` / `rateBad` / `rateFast` are
still read as aliases, so an existing config keeps working. When both a legacy and a new
key are set, the new key wins.

## What it measures

- **TTFT** — request → first streamed token, reported as a session median. `/metrics report`
  additionally splits it into `conn` (request → response headers) and `prefill`
  (headers → first token) when the provider emits response headers; the live HUD shows the
  pair as a percentage split, and the report shows `–` when the provider does not expose
  the boundary. `conn` folds in any server-side queueing, so the split compares calls to
  the *same* provider rather than across providers.
- **ITL** — mean gap between streamed deltas, reported as a session median and p95.
  This is stream *smoothness*, not throughput: some providers batch several tokens
  into one delta.
- **tok/s** — decode throughput. The figure shown is the provider's own token count
  (`usage.output`) whenever it reports one, and an estimate from streamed characters while
  the call is still running — estimated values carry a `~` prefix. When a call finishes,
  the real count replaces the estimate in the TPS history too, so a completed call's
  throughput is exact rather than approximately right.
- **TPS** — a session timeline of tokens generated per second, one column per completed
  second. It is session-scoped and never resets per call, so separate writing actions stay
  comparable. Its summary is a **mean** and p95, deliberately: a stalled second is
  delivered throughput, not noise, and a median would flatter it. Latency figures use the
  median for the opposite reason — latency has a long right tail.
- **usage** — input/output/cache and reasoning tokens plus cost, as reported by the
  provider.

### About the character estimate

When a provider reports no token usage, tokens are estimated from streamed characters
divided by `charsPerToken`. There is no universally correct divisor: measured across
39,000 real calls with provider-reported counts as ground truth, characters-per-token
ranges from about 3.0 (DeepSeek) to 3.8 (Kimi), so a fixed 4 is off by ~19% typically
and ~49% at p90. The default is therefore `auto`, which calibrates from the session's own
completed calls. Set a number instead if you want reproducibility.

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
