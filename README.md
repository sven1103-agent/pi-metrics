# pi-metrics

[![CI](https://github.com/sven1103-agent/pi-metrics/actions/workflows/ci.yml/badge.svg)](https://github.com/sven1103-agent/pi-metrics/actions/workflows/ci.yml)
[![Pi compatibility](https://github.com/sven1103-agent/pi-metrics/actions/workflows/pi-compat.yml/badge.svg)](https://github.com/sven1103-agent/pi-metrics/actions/workflows/pi-compat.yml)

Live LLM latency HUD for the [Pi](https://pi.dev) coding agent: time to first token,
inter-token latency, decode throughput and cost — for one call, and for the session.

```
─ pi-metrics · deepseek-v3.1 ───────────────────────────── 3 calls ─
○ waiting  ● writing  ‖ paused  ✔ done  [█████░░░░░░░]  38.0 tok/s  (usage)  255 tok
TPS  ▃▄▄▁▁█▄▄▆▅  · avg   34 tok/s · p95   46 tok/s       65s  ·  max 100 auto
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
| `/metrics style compact` · `normal` | four lines, or multi-row graphs |
| `/metrics graph braille` · `block` | graph glyphs |
| `/metrics color calm` · `vivid` · `mono` | colour intensity |

Display commands take effect immediately and last until Pi exits. Each one prints the
`settings.json` line that makes the change permanent — the extension cannot write that file
itself, because Pi's extension API exposes no settings-write call, and editing the file
underneath Pi's settings manager risks dropping unrelated keys.

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
`braille` or `block`. `colorMode` is `calm`, `vivid` or `mono`. `tpsMax` is a fixed tok/s
ceiling or `auto` (session p98, never below `tpsFast`). `charsPerToken` is `auto`
(calibrate from this session) or a fixed characters-per-token divisor. `persist` appends a
one-line card per call to the transcript. `cost` controls the cost column in `/metrics
report` and on the persisted card.

`placement` accepts `aboveEditor` / `belowEditor` and, because a natural guess is otherwise
silently ignored, also `above` / `below`. A value that is unusable in any other way is
reported at startup as a warning *and* replaced by the default, so a typo cannot degrade
the HUD quietly.

The pre-0.1.0 names `rateWindow` / `rateMax` / `rateGood` / `rateBad` / `rateFast` are
still read as aliases, so an existing config keeps working. When both a legacy and a new
key are set, the new key wins.

`tpsGood` and `tpsBad` colour the HUD but are deliberately not printed: they are
configuration, not measurement, and printing them invited reading them as results.
`tpsFast` is printed because it also floors the automatic chart ceiling.

## What it measures

- **TTFT** — request → first streamed token, as a session median. `/metrics report` splits
  it further into `conn` (request → response headers) and `prefill` (headers → first
  token) when the provider exposes the boundary; the live HUD shows the pair as a
  percentage, and the report shows `–` otherwise. `conn` folds in server-side queueing, so
  the split compares calls to the *same* provider rather than across providers.
- **ITL** — gap between streamed deltas, as a session median and p95. This is stream
  *smoothness*, not throughput: some providers batch several tokens into one delta.
- **tok/s** — decode throughput, tagged with its source: `(usage)` when the provider
  reported `usage.output`, or `(est)` in amber while the figure still comes from streamed
  characters. A `(usage)` call is finished and its TPS buckets were rescaled to the
  provider's exact count. Estimates are never shown as if they were measured.
- **TPS** — a session timeline of tokens per second, one column per completed second,
  never reset per call so separate writing actions stay comparable. The title's left side
  is measurement (mean and p95); its right side is the chart's own axes — the recording
  window in seconds, then the tok/s ceiling, marked `auto` when derived from the session.
- **usage** — input/output/cache and reasoning tokens plus cost, as reported.

Latency uses the **median**, throughput the **mean**, and the difference is deliberate.
Latency has a long right tail (cold connections, provider queueing) where single outliers
drag a mean away from the typical call. Throughput has no such noise: a stalled second is
delivered throughput, and a median would flatter it.

### About the character estimate

When a provider reports no usage, tokens are estimated from streamed characters divided by
`charsPerToken`. Measured across 39,000 real calls against provider-reported counts, the
true characters-per-token ranges from ~3.0 (DeepSeek) to ~3.8 (Kimi), so a fixed 4 is off
by ~19% typically and ~49% at p90. The default `auto` calibrates from the session's own
completed calls; set a number for reproducibility.

## Supported Pi versions

Each version is its own CI job, so the Checks tab names the exact release that broke:

| Pi | Typechecks clean | Loads |
|---|---|---|
| 1.3.0 · 1.2.0 · 1.1.0 | ✅ gating | ✅ gating |
| 1.0.4 · 1.0.0 · 0.99.2 | ⚠️ errors reported, not asserted | ✅ gating |
| < 0.85.1 | ❌ | ❌ does not load |

Below 1.1.0 the published typings are incomplete: the extension loads, but does not
typecheck. That lane asserts the load gate and only *reports* the error count as evidence
for the floor — it never requires errors to be present, so an upstream backport lowers the
floor without breaking the build. The `@earendil-works/pi-ai` peer floor matches at
`>=1.1.0`; the other two stay at `*` as Pi requires.

**Interactive rendering is verified manually.** The widget is TUI-only, so a headless run
cannot exercise it. Do not read these badges as covering what the HUD looks like.

## What it does not do

- It does not send anything anywhere. **No network calls, no telemetry, no credential
  access.** See [SECURITY.md](SECURITY.md).
- It does not measure prompt tokens per second; it measures decode throughput.
- It does not persist history across sessions unless `persist` is enabled.

## Maintained by

[Sven Fillinger](https://github.com/sven1103), Research Software Engineer, University
of Tübingen, through my agent alias [@sven1103-agent](https://github.com/sven1103-agent)
— the account that authors the commits here. Same person; the alias exists so the
automation is labelled as automation.

## License

MIT
