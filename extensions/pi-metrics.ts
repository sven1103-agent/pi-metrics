/**
 * pi-metrics — live LLM latency metrics for Pi.
 *
 * Shows, for every provider call, the figures that matter when tuning models,
 * prompts or a local inference server:
 *
 *   TTFT   time to first token   — request start → first streamed content delta.
 *                                  `/metrics report` additionally splits it into
 *                                  `conn` (request → response headers) and
 *                                  `prefill` (headers → first token) when the
 *                                  provider emits response headers; the column
 *                                  shows `–` when it does not.
 *   ITL    inter-token latency   — mean gap between consecutive streamed deltas.
 *                                  This is stream *smoothness*, not throughput:
 *                                  some providers batch several tokens per delta.
 *   TTOUT  time to output end    — wall time of the whole response (E2E).
 *   tok/s  decode throughput     — output tokens / TTOUT.
 *   usage  in/out/cache tokens, reasoning tokens and cost, from the provider.
 *
 * Rendering — a labelled panel above the editor by default. The top rule is the HUD's
 * outer edge (and names the model); the editor's own border closes it at the bottom,
 * so the block reads as one framed band instead of running into the transcript:
 *
 *   ─ pi-metrics · demo-model ─────────────────────────────────────────────────── 5 calls ─
 *   ○ waiting  ● writing  ‖ paused  ✔ done  [░░░░░░░░░░░░]  61.5 tok/s  (usage)  80 tok
 *   TPS         ▇▄▃▃▃▃▂▂▂▂▂▂▂▄▄▂  · avg    26 tok/s · p95    62 tok/s  20s  ·  max 100 auto
 *   STATS  split 25/75 conn/prefill  med first 400ms  med ITL 22ms  p95 ITL 74ms  5 calls
 *   HIST TTFT ▆▃▅█▁                  400ms  │  ITL ▁▂▆█▁                  22ms  (5 calls)
 *
 * The layout never changes: row 1 always shows every state with the active one
 * highlighted, so there is nothing to re-read mid-response.
 *   ○ waiting   no token yet (connection + prompt reading, one wait)
 *   ● writing   tokens are flowing
 *   ‖ paused    a token is overdue (`waiting Xs` appears at the end)
 *   ✔ done      the call finished; the values freeze
 *
 * The pressure bar is throughput against the TPS scale (full at the `good` baseline).
 * Colour has four bands, keyed to `tpsFast` (100), `tpsGood` (30) and
 * `tpsBad` (15): green at/above `tpsGood` (a brighter green at `tpsFast`), amber
 * between `tpsGood` and `tpsBad`, and red below `tpsBad`. The bar empties once
 * writing stops. Those thresholds are deliberately *not* printed: they are configuration,
 * not measurement, and the colour already encodes them. `fast` is the exception, because
 * it also floors the auto axis maximum, so the title keeps it to explain `max … auto`.
 *
 * Row 1 ends its metrics with where they came from: `(usage)` when the provider reported
 * `usage.output`, in which case the call is finished and its throughput buckets were
 * rescaled to that exact count; `(est)` while the figure is still derived from streamed
 * characters. Estimates are marked in amber because a number you cannot trust should look
 * different from one you can — and the tag replaced a `~` prefix that was both too quiet
 * to notice and applied inconsistently (a finished call with no usage printed no `~` at
 * all, despite being an estimate).
 *
 * Row 3 shows SESSION medians — `med first` and `med ITL` — plus p95 ITL and the call
 * count; the full breakdown of a single call is in `/metrics report`.
 * Median rather than mean because latency has a long right tail (cold connections,
 * provider queueing): the mean is dragged by single outliers, and the HIST row and the
 * severity colouring already key off the median.
 *
 * The TPS row is what the provider is actually delivering: one column per completed
 * writing second, height = tokens generated in that second (≈ tok/s). It is a SESSION
 * timeline — a new response keeps appending to it instead of resetting it, so you can
 * compare writing actions. Empty columns are seconds with no tokens. The left of the
 * title line is measurement (mean and p95 throughput); the right is the chart's own axes —
 * how many seconds of history are plotted, then the tok/s ceiling, with `auto` when that
 * ceiling is derived from the session rather than fixed. Throughput stays a mean
 * deliberately: a stalled second is delivered throughput, not noise, and a median would
 * flatter it.
 *
 * Token counts are the provider's own (`usage.output`) whenever it reports them, and the
 * live figure during streaming is an estimate from streamed characters. Once a call ends
 * the real count replaces the estimate in the TPS history too, so a finished call's
 * throughput is exact rather than approximately right. When a provider reports nothing,
 * the divisor is calibrated from the session's own completed calls: measured over 39k
 * real calls the true characters-per-token ranges from ~3.0 to ~3.8 by provider, so a
 * fixed 4 is wrong by ~19% typically and ~49% at p90. The HUD marks which of the two any
 * given figure is; see the `(usage)` / `(est)` note above.
 *
 * While a call streams, the widget repaints on a timer so a stalled second shows up as
 * it happens, and the completed second is the one plotted (the in-progress second is
 * excluded, so the newest column does not flicker).
 *
 * Commands
 *   /metrics                       toggle the HUD on/off
 *   /metrics on | off              explicit toggle
 *   /metrics report                append a table of the recent calls to the transcript
 *   /metrics reset                 forget the calls recorded in this session
 *   /metrics placement above|below
 *   /metrics style compact|normal
 *   /metrics graph braille|block
 *   /metrics color calm|vivid|mono
 *
 * The display commands change the running HUD immediately and hold until Pi exits, and
 * each one prints the settings.json line that makes it permanent. They cannot write the
 * file themselves: Pi's extension API has no settings-write call, and reaching for the
 * path directly would race Pi's own settings manager and could drop unrelated keys.
 *
 * Settings (`~/.pi/agent/settings.json`, key `pi-metrics`, all optional):
 *   {
 *     "pi-metrics": {
 *       "enabled": true,
 *       "placement": "aboveEditor",   // or "belowEditor"
 *       "history": 120,               // calls kept for the HIST timeline
 *       "persist": false,             // append a one-line card per call to the transcript
 *       "timeline": true,
 *       "liveTimeline": true,
 *       "cost": true,
 *       "style": "normal",             // "compact" | "normal"
 *       "graphStyle": "braille",       // "braille" | "block"
 *       "colorMode": "calm",           // "calm" | "vivid" | "mono"
 *       "tpsWindow": 120,             // seconds of history in the TPS chart
 *       "tpsMax": "auto",            // "auto" (session p98, floor `tpsFast`) or a fixed tok/s
 *       "tpsGood": 30,               // at/above this = good (green)
 *       "tpsBad": 15,                // below this = bad (red); 15-30 is the amber band
 *       "tpsFast": 100,              // at/above this = fast (excellent)
 *       "charsPerToken": "auto"       // "auto" (calibrate from this session) or a fixed divisor
 *     }
 *   }
 *
 * The `rateWindow`/`rateMax`/`rateGood`/`rateBad`/`rateFast` spellings from before 0.1.0
 * are still read as aliases and never written back.
 *
 * Every setting is validated, and a bad value is reported rather than ignored. That
 * matters because Pi accepts only the exact string "belowEditor" and silently falls back
 * to above-the-editor for anything else, so `"placement": "below"` used to leave the HUD
 * stubbornly in place with no indication why. Both spellings are now accepted, and a value
 * that is wrong in some other way produces a warning instead of quiet degradation.
 */

import { appendFileSync } from "node:fs";

import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { EntryRenderOptions, ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, colorToOkhsl, mixColors, okhslColor, truncateToWidth, visibleWidth, type Color, type TUI } from "@earendil-works/pi-tui";

/** Set `PI_METRICS_TRACE=/path` to log ticker/render activity for debugging. */
const TRACE_FILE = process.env.PI_METRICS_TRACE;
function trace(message: string): void {
  if (!TRACE_FILE) return;
  try {
    appendFileSync(TRACE_FILE, `${Date.now()} ${message}\n`);
  } catch {
    // tracing is best-effort
  }
}

const CUSTOM_TYPE = "pi-metrics";
const WIDGET_KEY = "pi-metrics";
const STATUS_KEY = "pi-metrics";

/* ------------------------------------------------------------------ settings */

interface MetricsSettings {
  enabled?: boolean;
  placement?: "aboveEditor" | "belowEditor";
  history?: number;
  persist?: boolean;
  timeline?: boolean;
  liveTimeline?: boolean;
  cost?: boolean;
  /** Layout: "compact" (four lines) or "normal" (btop-like multi-row graphs). */
  style?: "compact" | "normal";
  /** Graph glyphs in the normal style: "braille" (dotted, 2×4 per cell) or "block". */
  graphStyle?: "braille" | "block";
  /** Colour intensity: "calm" (quiet when healthy), "vivid", or "mono". */
  colorMode?: "calm" | "vivid" | "mono";
  /** Seconds of history shown by the TPS chart. */
  tpsWindow?: number;
  /**
   * Top of the TPS graph and pressure-bar fill, in tok/s, or "auto" to derive it from
   * the session's own p98 (never below `tpsFast`, so a slow provider is not zoomed in).
   */
  tpsMax?: number | "auto";
  /** "Good" threshold: at or above this TPS is green, below it ramps through amber. */
  tpsGood?: number;
  /** "Bad" threshold: below this TPS is red; `tpsBad`..`tpsGood` is the amber band. */
  tpsBad?: number;
  /** "Fast" threshold: at or above this TPS reads as excellent. */
  tpsFast?: number;
  /**
   * Fallback divisor for estimating tokens from streamed characters when the provider
   * reports no usage. Measured across 39k real calls, characters-per-token ranges from
   * ~3.0 (DeepSeek) to ~3.8 (Kimi), so no constant is correct for every provider —
   * hence "auto", which calibrates from this session's own completed calls.
   */
  charsPerToken?: number | "auto";
}

type ResolvedSettings = Required<MetricsSettings>;

const DEFAULTS: ResolvedSettings = {
  enabled: true,
  placement: "aboveEditor",
  history: 120,
  persist: false,
  timeline: true,
  liveTimeline: true,
  cost: true,
  style: "normal",
  graphStyle: "braille",
  colorMode: "calm",
  tpsWindow: 120,
  tpsMax: "auto",
  tpsGood: 30,
  tpsBad: 15,
  tpsFast: 100,
  charsPerToken: "auto",
};

/**
 * Pre-0.1.0 spellings. Renamed to `tps*` because TPS is the term the ecosystem uses
 * (`pi-tps`, `pi-token-speed`, ...) and `RATE` was neither that nor self-consistent —
 * the rest of the HUD already said tok/s. Accepted read-only so an existing config
 * keeps working; never written back.
 */
const LEGACY_SETTING_ALIASES: Record<string, keyof MetricsSettings> = {
  rateWindow: "tpsWindow",
  rateMax: "tpsMax",
  rateGood: "tpsGood",
  rateBad: "tpsBad",
  rateFast: "tpsFast",
};

/**
 * Accepted spellings for `placement`. Pi itself compares against the exact string
 * `"belowEditor"` and treats everything else as above-the-editor, so a natural
 * `"placement": "below"` is ignored with no error — which reads as "the setting does
 * nothing". Both spellings are translated here, matching what the command documents.
 */
const PLACEMENT_SPELLINGS: Record<string, "aboveEditor" | "belowEditor"> = {
  aboveeditor: "aboveEditor",
  above: "aboveEditor",
  beloweditor: "belowEditor",
  below: "belowEditor",
};

const STYLE_VALUES = ["compact", "normal"] as const;
const GRAPH_VALUES = ["braille", "block"] as const;
const COLOR_VALUES = ["calm", "vivid", "mono"] as const;

function normalizePlacement(value: unknown): "aboveEditor" | "belowEditor" | undefined {
  return typeof value === "string" ? PLACEMENT_SPELLINGS[value.toLowerCase()] : undefined;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

interface ReadSettingsResult {
  settings: ResolvedSettings;
  /** Human-readable complaints about values that were present but unusable. */
  problems: string[];
}

function readSettings(pi: ExtensionAPI): ReadSettingsResult {
  let raw: unknown;
  try {
    raw = (pi.getSettings() as unknown as Record<string, unknown>)["pi-metrics"];
  } catch {
    raw = undefined;
  }
  const merged = { ...DEFAULTS };
  const problems: string[] = [];
  if (raw && typeof raw === "object") {
    const source = raw as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;
      (merged as Record<string, unknown>)[key] = value;
    }
    // A legacy key only applies when its replacement is absent, so a config that sets
    // both keeps the new name.
    for (const [legacy, current] of Object.entries(LEGACY_SETTING_ALIASES)) {
      if (source[legacy] === undefined || source[current] !== undefined) continue;
      (merged as Record<string, unknown>)[current] = source[legacy];
    }

    // Reject unusable values loudly. Quietly substituting the default is what made the
    // placement bug invisible: the HUD stayed put and nothing said why.
    const invalid = (key: keyof MetricsSettings, allowed: string, fallback: unknown): void => {
      problems.push(
        `pi-metrics: "${key}" must be ${allowed} — ignoring ${JSON.stringify((merged as Record<string, unknown>)[key])}`,
      );
      // Reset to the default as well as warning: leaving the bad value in place would let it
      // reach Pi, which silently interprets anything unrecognised as its own default.
      (merged as Record<string, unknown>)[key] = fallback;
    };

    const placement = normalizePlacement(merged.placement);
    if (placement === undefined) invalid("placement", '"aboveEditor" or "belowEditor"', DEFAULTS.placement);
    else merged.placement = placement;

    const style = normalizeEnum(merged.style, STYLE_VALUES);
    if (style === undefined) invalid("style", `one of ${STYLE_VALUES.join(", ")}`, DEFAULTS.style);
    else merged.style = style;

    const graphStyle = normalizeEnum(merged.graphStyle, GRAPH_VALUES);
    if (graphStyle === undefined) invalid("graphStyle", `one of ${GRAPH_VALUES.join(", ")}`, DEFAULTS.graphStyle);
    else merged.graphStyle = graphStyle;

    const colorMode = normalizeEnum(merged.colorMode, COLOR_VALUES);
    if (colorMode === undefined) invalid("colorMode", `one of ${COLOR_VALUES.join(", ")}`, DEFAULTS.colorMode);
    else merged.colorMode = colorMode;
  }
  return { settings: merged, problems };
}

/* --------------------------------------------------------------------- state */

type TokenKind = "thinking" | "text" | "tool";

interface CallStats {
  id: number;
  turnIndex: number;
  provider: string;
  model: string;
  /** Wall-clock request start (assistant message timestamp). */
  requestWall: number;
  /** Monotonic `performance.now()` when the request left Pi (`before_provider_request`). */
  armPerf?: number;
  /** Monotonic time when response headers arrived (`after_provider_response`). */
  headersPerf?: number;
  /** Monotonic time and wall clock when the response stream started (`message_start`). */
  streamPerf?: number;
  streamWall?: number;
  firstTokenPerf?: number;
  firstTokenKind?: TokenKind;
  firstTextPerf?: number;
  lastTokenPerf?: number;
  /** Gap (ms) between consecutive deltas; `gapKinds[i]` is the kind that ended gap i. */
  gaps: number[];
  gapKinds: TokenKind[];
  /** Characters produced in each whole second since the first token. */
  rateBuckets: number[];
  /** How many of those seconds are already copied into the session history. */
  flushedSeconds: number;
  /**
   * Characters-per-token divisor actually used for this call's buckets. Captured at
   * flush time so a later calibration does not reinterpret bucket units, and so the
   * retroactive correction (see `correctCallTokens`) divides by the same number the
   * buckets were built with.
   */
  bucketDivisor: number;
  /**
   * Set once `usage.output` has been applied to the flushed buckets. Guarantees the
   * correction is applied at most once — it is multiplicative, so re-running it on a
   * finished call would compound and corrupt the chart.
   */
  tokensCorrected: boolean;
  chunks: number;
  chars: number;
  usage?: Usage;
  durationMs?: number;
  endedAt?: number;
  aborted: boolean;
  error?: string;
  live: boolean;
}

interface HudState {
  /** Oldest first, capped at `settings.history`. */
  calls: CallStats[];
  current?: CallStats;
  settings: ResolvedSettings;
  visible: boolean;
  nextId: number;
  turnIndex: number;
  /** Monotonic time of the last untracked provider request (see before_provider_request). */
  pendingArmPerf?: number;
  /** Monotonic time of the last untracked provider response headers. */
  pendingHeadersPerf?: number;
  /** Session-wide per-second token counts, across every call; never reset per call. */
  rateHistory: number[];
  /**
   * Session-local calibration: characters observed and the provider-reported tokens they
   * produced. Used to derive `charsPerToken` for calls that report no usage, which is
   * strictly better than a fixed constant — measured over 39k real calls, a fixed 4
   * carries ~19% median error because the true ratio varies by provider and model.
   */
  calibrationChars: number;
  calibrationTokens: number;
}

interface SerializedCall {
  id: number;
  turnIndex: number;
  provider: string;
  model: string;
  requestWall: number;
  armPerf?: number;
  streamPerf?: number;
  streamWall?: number;
  firstTokenPerf?: number;
  firstTokenKind?: TokenKind;
  firstTextPerf?: number;
  lastTokenPerf?: number;
  gaps: number[];
  gapKinds: TokenKind[];
  rateBuckets: number[];
  flushedSeconds: number;
  bucketDivisor: number;
  chunks: number;
  chars: number;
  usage?: Usage;
  durationMs?: number;
  endedAt?: number;
  aborted: boolean;
  error?: string;
}

type MetricsEntryData = { kind: "call"; call: SerializedCall } | { kind: "report"; calls: SerializedCall[]; generatedAt: number };

/* ------------------------------------------------------------- small helpers */

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function fmtMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return "–";
  if (ms < 0) return "0ms";
  if (ms < 1) return "<1ms";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function fmtTokens(tokens: number | undefined): string {
  if (tokens === undefined || !Number.isFinite(tokens)) return "–";
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 100_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${Math.round(tokens / 1_000)}k`;
}

function fmtCost(cost: number | undefined, enabled: boolean): string | undefined {
  if (!enabled || cost === undefined || !Number.isFinite(cost) || cost <= 0) return undefined;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function percentile(values: number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | undefined {
  return percentile(values, 0.5);
}

function maxOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return max;
}

function padEnd(text: string, width: number): string {
  const visible = visibleWidth(text);
  return visible >= width ? text : text + " ".repeat(width - visible);
}

function shortModel(model: string): string {
  const tail = model.split("/").pop() ?? model;
  return tail.length > 24 ? `${tail.slice(0, 23)}…` : tail;
}

/**
 * Colour a latency value against the session median: at/below the median is green, 2x is
 * amber and 3x or worse is red. Provider-independent — it never needs a per-model scale.
 */
function latencySeverity(value: number, medianValue: number | undefined): number {
  if (medianValue === undefined || !(medianValue > 0)) return 0;
  return clamp01((value / medianValue - 1) / 2); // 1x median = 0, 3x = 1
}

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Throughput colour, defined by four *hue-stable* anchors so that severity reads as
 * red -> amber -> green in one direction:
 *
 *   fast (-1)      good (0)      ok (+0.5)     bad (+1)
 *   success full   success muted warning       error full
 *
 * Saturation is the only variable inside a hue, so no interpolation can rotate the
 * colour. Earlier this mixed every anchor toward `dim` in Oklch, which sent `success`
 * (hue 148) past green into cyan and `warning` (hue 40) to 117 — i.e. the warning band
 * rendered *greener* than the healthy one and the ramp crossed hues in the wrong order.
 */
type ColorMode = "calm" | "vivid" | "mono";

/**
 * Re-tint a theme colour by scaling its saturation, keeping hue and lightness.
 * Preserving hue is what keeps the ramp monotone; preserving lightness keeps the HUD at
 * the same brightness as the surrounding chrome instead of glowing.
 */
function tint(color: Color, satScale: number): Color {
  const { h, s, l } = colorToOkhsl(color);
  return okhslColor(h, clamp01(s * satScale), l);
}

/** Four hue-stable anchors; `severityColor` interpolates strictly *within* each pair. */
interface Ramp {
  fast: Color;
  good: Color;
  ok: Color;
  bad: Color;
}

/** Vivid ramp anchors, hand-picked (excellent -> good -> mid -> bad). */
const VIVID_FAST = { hue: 150, sat: 0.85, light: 0.62 };
const VIVID_GOOD = { hue: 145, sat: 0.62, light: 0.64 };
const VIVID_OK = { hue: 85, sat: 0.95, light: 0.68 };
const VIVID_BAD = { hue: 25, sat: 0.95, light: 0.6 };

function rampFor(theme: Theme, mode: ColorMode): Ramp {
  if (mode === "mono") {
    // Severity reads as dim -> bright, with no hue at all.
    return {
      fast: mixColors(theme.colors.dim, theme.colors.text, 1),
      good: mixColors(theme.colors.dim, theme.colors.text, 0.55),
      ok: mixColors(theme.colors.dim, theme.colors.text, 0.85),
      bad: mixColors(theme.colors.dim, theme.colors.error, 0.25),
    };
  }
  if (mode === "vivid") {
    return {
      fast: okhslColor(VIVID_FAST.hue, VIVID_FAST.sat, VIVID_FAST.light),
      good: okhslColor(VIVID_GOOD.hue, VIVID_GOOD.sat, VIVID_GOOD.light),
      ok: okhslColor(VIVID_OK.hue, VIVID_OK.sat, VIVID_OK.light),
      bad: okhslColor(VIVID_BAD.hue, VIVID_BAD.sat, VIVID_BAD.light),
    };
  }
  // calm: the theme's own semantics, desaturated but never hue-shifted.
  return {
    fast: tint(theme.colors.success, 1.0),
    good: tint(theme.colors.success, 0.55),
    ok: tint(theme.colors.warning, 0.7),
    bad: tint(theme.colors.error, 1.0),
  };
}

/**
 * One palette for everything, keyed by *severity*: -1 = very healthy, +1 = bad.
 * Colour is reserved for deviations, so a session where everything is fine stays quiet.
 */
function severityColor(severity: number, theme: Theme, mode: ColorMode): Color {
  const t = Math.max(-1, Math.min(1, severity));
  const ramp = rampFor(theme, mode);
  if (t <= 0) return mixColors(ramp.good, ramp.fast, -t); // 0 good … -1 fast
  if (t <= 0.5) return mixColors(ramp.good, ramp.ok, t * 2); // 0 good … 0.5 ok
  return mixColors(ramp.ok, ramp.bad, (t - 0.5) * 2); // 0.5 ok … 1 bad
}

/**
 * Severity of a throughput value, in four bands:
 *
 *   rate >= fast          -> -1           (excellent)
 *   good <= rate < fast   -> 0 … -1       (healthy; greener as it approaches fast)
 *   bad  <= rate < good   -> 0 … +0.5     (amber band; the "slower than baseline" zone)
 *   rate <  bad           -> +0.75 … +1   (clearly bad)
 *
 * The old mapping was a single `1 - rate/good` below the good baseline, which put a rate
 * of half the baseline at severity 0.5 — visually "half good" rather than "halfway to
 * bad" — and gave the caller no way to say where "bad" actually starts.
 */
function rateSeverity(rate: number | undefined, good: number, bad: number, fast: number): number {
  if (rate === undefined) return 0;
  const goodAt = Math.max(1, good);
  const fastAt = Math.max(goodAt + 1, fast);
  const badAt = Math.max(1, Math.min(bad, goodAt));
  if (rate >= fastAt) return -1;
  if (rate >= goodAt) return -(rate - goodAt) / (fastAt - goodAt);
  if (rate >= badAt) return (0.5 * (goodAt - rate)) / Math.max(1e-9, goodAt - badAt);
  return 0.75 + 0.25 * Math.min(1, (badAt - rate) / Math.max(1, badAt));
}

/**
 * Round a value up to a "nice" axis maximum: 1 / 1.5 / 2 / 3 / 5 / 7.5 × 10^n.
 * Plain powers of ten would waste most of the chart (a 400 tok/s provider would get a
 * 1000 ceiling and sit at 40% height).
 */
function niceCeil(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, value))));
  for (const multiple of [1, 1.5, 2, 3, 5, 7.5, 10]) {
    if (value <= multiple * magnitude) return multiple * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Top of the RATE graph, in tok/s.
 *
 * A fixed ceiling is the wrong shape for a HUD that has to serve both a local 8 tok/s
 * llama.cpp and a 400 tok/s API: too high and the fast provider is a solid slab, too low
 * and a slow one looks pegged. So "auto" tracks the session's own p98.
 *
 * The `tpsFast` floor is what keeps that honest: without it a slow session would get
 * `max ≈ 30` and a mediocre provider would fill the chart. With it, `tpsGood` can never
 * sit higher than 30% of the height, so "below the good line" always reads as low.
 */
function resolveRateMax(history: number[], setting: number | "auto", tpsFast: number): { max: number; auto: boolean } {
  const floor = Math.max(1, tpsFast);
  // A non-positive number is a typo, not a request for a 1 tok/s axis; treat it as auto.
  if (setting !== "auto" && Number.isFinite(setting) && setting > 0) return { max: setting, auto: false };
  const p98 = percentile(history, 0.98);
  if (p98 === undefined || !(p98 > 0)) return { max: niceCeil(floor), auto: true };
  return { max: Math.max(niceCeil(p98 * 1.15), niceCeil(floor)), auto: true };
}

/**
 * Characters-per-token, used ONLY while a call is still streaming or when the provider
 * never reports usage. Measured across 39k real calls with provider-reported output
 * tokens as ground truth, the true ratio is not a constant:
 *
 *   median 3.27, p10 2.04, p90 4.22   (so a fixed 4 carries ~19% median error)
 *   litellm 3.04 · openrouter 3.44 · opencode-go 3.70 · opencode 3.79
 *   DeepSeek-V4-Flash 2.96 · kimi-k2.6 3.84
 *
 * So the default is `auto`: calibrate from this session's own completed calls, which
 * measurably reduces the error and adapts per provider. A fixed number is accepted for
 * anyone who wants reproducibility.
 */
function resolveCharsPerToken(state: HudState, setting: number | "auto"): number {
  if (setting !== "auto" && Number.isFinite(setting) && setting > 0) return setting;
  if (state.calibrationTokens >= 64 && state.calibrationChars > 0) {
    const ratio = state.calibrationChars / state.calibrationTokens;
    // Clamp to the observed plausible band so one odd call cannot distort the HUD.
    if (Number.isFinite(ratio) && ratio >= 1.5 && ratio <= 6) return ratio;
  }
  return 4;
}

/**
 * Provider-reported output tokens, or undefined when the provider gave us none. Only a
 * positive finite number counts: several providers send 0 while streaming.
 */
function reportedOutputTokens(call: CallStats): number | undefined {
  const output = call.usage?.output;
  return typeof output === "number" && Number.isFinite(output) && output > 0 ? output : undefined;
}

/**
 * Fold a finished call into the session calibration. Called once per call, after the
 * provider has reported its real token count.
 */
function calibrate(state: HudState, call: CallStats): void {
  const real = reportedOutputTokens(call);
  if (real === undefined || call.chars <= 0) return;
  state.calibrationChars += call.chars;
  state.calibrationTokens += real;
}

/**
 * Retroactively make a finished call's throughput exact.
 *
 * The buckets are built from characters while the stream is flowing, because that is all
 * that exists mid-flight. Once `usage.output` arrives it is authoritative, so rescale the
 * already-flushed per-second samples by `real / estimated`. The call total then equals the
 * provider's count exactly rather than being off by the character heuristic's error; only
 * the *within-call* distribution keeps estimation error, which is unavoidable and much
 * smaller than getting the total wrong.
 *
 * Buckets are divided by the divisor captured when they were written, so a mid-session
 * recalibration cannot reinterpret their units.
 */
function correctCallTokens(state: HudState, call: CallStats): void {
  const real = reportedOutputTokens(call);
  if (real === undefined || call.chars <= 0 || call.tokensCorrected) return;
  const estimated = call.chars / call.bucketDivisor;
  if (!(estimated > 0)) return;
  const factor = real / estimated;
  if (!Number.isFinite(factor) || factor <= 0) return;
  call.tokensCorrected = true;

  // Only the seconds this call contributed, which are the last `flushedSeconds` entries
  // pushed for it — unless the session cap has already evicted some, hence the clamp.
  const count = Math.min(call.flushedSeconds, state.rateHistory.length);
  const from = state.rateHistory.length - count;
  for (let index = from; index < state.rateHistory.length; index++) {
    state.rateHistory[index] *= factor;
  }
}

/**
 * Session throughput history: one entry per completed writing second, across every call
 * in the session. It is never reset when a new response starts, so the TPS chart keeps
 * continuing instead of jumping back to empty.
 */
function flushRateHistory(state: HudState, call: CallStats, d: Derived): void {
  if (call.firstTokenPerf === undefined) return;
  const elapsedMs = Math.max(0, (d.ttoutMs ?? 0) - (d.ttftMs ?? 0));
  // While live, only wholly finished seconds are recorded; once the call is over the
  // final partial second is recorded too so no produced tokens are lost.
  const completed = Math.floor(elapsedMs / 1_000) + (call.live ? 0 : 1);
  // Capture the divisor once per call: later buckets of the same call must use the same
  // unit, and the retroactive correction divides by exactly this number.
  if (call.bucketDivisor <= 0) call.bucketDivisor = resolveCharsPerToken(state, state.settings.charsPerToken);
  for (let second = call.flushedSeconds; second < completed; second++) {
    state.rateHistory.push((call.rateBuckets[second] ?? 0) / call.bucketDivisor);
  }
  call.flushedSeconds = Math.max(call.flushedSeconds, completed);
  // A finished call knows its real token count, so replace the estimate for good.
  if (!call.live) correctCallTokens(state, call);
  const cap = 4_000;
  if (state.rateHistory.length > cap) state.rateHistory.splice(0, state.rateHistory.length - cap);
}

/** Last `columns` session seconds, oldest left, blank where the session has no data yet. */
function buildSessionRateTrace(state: HudState, columns: number, windowSeconds: number): { values: (number | null)[]; perColumnSeconds: number } {
  const history = state.rateHistory;
  const total = history.length;
  if (columns <= 0) return { values: [], perColumnSeconds: 1 };

  // The window always spans the full chart width: each column is `windowSeconds / columns`
  // seconds of real time. That way 120s of history fills the whole graph, and a shorter
  // session fills the right-hand fraction of it (never just half a character per second).
  const perColumnSeconds = windowSeconds / columns;
  const values: (number | null)[] = [];
  for (let column = 0; column < columns; column++) {
    const from = total - windowSeconds + column * perColumnSeconds;
    const to = from + perColumnSeconds;
    let sum = 0;
    let count = 0;
    for (let index = Math.max(0, Math.floor(from)); index < Math.min(total, Math.ceil(to)); index++) {
      sum += history[index];
      count += 1;
    }
    values.push(count > 0 ? sum / count : null);
  }
  return { values, perColumnSeconds };
}

/** Block chart on a linear scale; taller = faster, colour = healthy (green) → slow (red). */
function sparklineRate(values: (number | null)[], scale: readonly [number, number], good: number, bad: number, fast: number, theme: Theme, mode: ColorMode): string {
  const span = Math.max(1, scale[1] - scale[0]);
  return values
    .map((value) => {
      if (value === null) return " ";
      const t = clamp01((value - scale[0]) / span);
      const glyph = BLOCKS[Math.min(BLOCKS.length - 1, Math.max(0, Math.round(t * (BLOCKS.length - 1))))];
      return theme.style(glyph, { fg: severityColor(rateSeverity(value, good, bad, fast), theme, mode) });
    })
    .join("");
}


/**
 * One block per value: height relative to the shown window, colour from `colorOf`.
 * `kinds` optionally dims reasoning deltas.
 */
function sparkline(values: number[], width: number, colorOf: (value: number) => Color, theme: Theme, kinds?: TokenKind[]): string {
  const shown = values.slice(-width);
  if (shown.length === 0) return "";
  const kindShown = kinds ? kinds.slice(-width) : undefined;
  const min = Math.min(...shown);
  const max = Math.max(...shown);
  const range = max - min;
  return shown
    .map((value, index) => {
      const rank = range > 0 ? (value - min) / range : 0.5;
      const glyph = BLOCKS[Math.min(BLOCKS.length - 1, Math.max(0, Math.round(rank * (BLOCKS.length - 1))))];
      return theme.style(glyph, { fg: colorOf(value), dim: kindShown?.[index] === "thinking" });
    })
    .join("");
}

/** Right-pad a sparkline so a short history starts at the left edge and grows right. */
function sparklineFixed(values: number[], width: number, colorOf: (value: number) => Color, theme: Theme, kinds?: TokenKind[]): string {
  const body = sparkline(values, width, colorOf, theme, kinds);
  const bodyWidth = visibleWidth(body);
  return bodyWidth > 0 ? body + " ".repeat(Math.max(0, width - bodyWidth)) : " ".repeat(width);
}

interface FittedSeries {
  values: number[];
  kinds?: TokenKind[];
  /** How many original samples each block covers (1 = raw). */
  perBucket: number;
  total: number;
}

/**
 * Downsample a series to at most `width` blocks by averaging buckets, so the whole
 * span stays visible instead of letting the oldest samples scroll out of view as a
 * response (or a session) grows.
 */
function fitSeries(values: number[], width: number, kinds?: TokenKind[]): FittedSeries {
  const total = values.length;
  if (width <= 0 || total === 0) return { values: [], kinds: undefined, perBucket: 1, total };
  if (total <= width) return { values, kinds: kinds ? kinds.slice(-total) : undefined, perBucket: 1, total };

  const perBucket = Math.ceil(total / width);
  const outValues: number[] = [];
  const outKinds: TokenKind[] = [];
  for (let start = 0; start < total; start += perBucket) {
    const end = Math.min(total, start + perBucket);
    let sum = 0;
    let worstKind: TokenKind | undefined;
    let worst = -Infinity;
    for (let index = start; index < end; index++) {
      sum += values[index];
      if (values[index] > worst) {
        worst = values[index];
        worstKind = kinds?.[index];
      }
    }
    outValues.push(sum / (end - start));
    if (kinds) outKinds.push(worstKind ?? "text");
  }
  return { values: outValues, kinds: kinds ? outKinds : undefined, perBucket, total };
}

/* ---------------------------------------------------------------- derived info */

interface Derived {
  requestStartPerf?: number;
  connectMs?: number;
  prefillMs?: number;
  /** True when `prefillMs` is headers→first token, false when it is streamStart→first token. */
  prefillIncludesConnect: boolean;
  ttftMs?: number;
  ttftTextMs?: number;
  ttoutMs?: number;
  itlMeanMs?: number;
  itlP95Ms?: number;
  decodeMs?: number;
  tokensPerSecond?: number;
  outputTokens?: number;
  /** Character-based token estimate; present when `outputTokens` is not. */
  estimatedOutput?: number;
  estimatedTokens: boolean;
}

function derive(call: CallStats, now: number): Derived {
  const requestStartPerf =
    call.armPerf ??
    (call.streamPerf !== undefined && call.streamWall !== undefined ? call.streamPerf + (call.requestWall - call.streamWall) : undefined);

  const headersPerf = call.headersPerf;
  const streamAnchor = headersPerf ?? call.streamPerf;
  const connectMs = headersPerf !== undefined && requestStartPerf !== undefined ? headersPerf - requestStartPerf : undefined;
  const prefillMs = call.firstTokenPerf !== undefined && streamAnchor !== undefined ? call.firstTokenPerf - streamAnchor : undefined;
  // `prefillMs` covers headers→first token when headers arrived, but silently becomes
  // streamStart→first token when they did not. An elapsed time is always `!== undefined`,
  // so that fallback is indistinguishable by value alone — flag it so the two are never
  // mislabelled, which matters now that the split is on the live HUD.
  const prefillIncludesConnect = headersPerf !== undefined;
  const ttftMs = call.firstTokenPerf !== undefined && requestStartPerf !== undefined ? call.firstTokenPerf - requestStartPerf : undefined;
  const ttftTextMs = call.firstTextPerf !== undefined && requestStartPerf !== undefined ? call.firstTextPerf - requestStartPerf : undefined;

  const ttoutMs = call.durationMs ?? (requestStartPerf !== undefined ? now - requestStartPerf : undefined);
  const itlMeanMs = mean(call.gaps);
  const itlP95Ms = percentile(call.gaps, 0.95);

  const outputTokens = reportedOutputTokens(call);
  const estimatedTokens = outputTokens === undefined;
  // Fall back to the calibrated character estimate, never to `chunks`: the number of
  // streamed deltas is a batching artifact (some providers pack many tokens per delta),
  // so using it as a token count produced a number that disagreed with the TPS chart.
  const divisor = call.bucketDivisor > 0 ? call.bucketDivisor : 4;
  const estimatedOutput = call.chars > 0 ? call.chars / divisor : undefined;
  const tokens = outputTokens ?? estimatedOutput;
  const decodeMs = ttftMs !== undefined && ttoutMs !== undefined ? Math.max(1, ttoutMs - ttftMs) : undefined;
  const tokensPerSecond = decodeMs !== undefined && tokens !== undefined && tokens > 1 ? tokens / (decodeMs / 1_000) : undefined;

  return { requestStartPerf, connectMs, prefillMs, prefillIncludesConnect, ttftMs, ttftTextMs, ttoutMs, itlMeanMs, itlP95Ms, decodeMs, tokensPerSecond, outputTokens, estimatedOutput, estimatedTokens };
}

/* -------------------------------------------------------------------- widget */

class MetricsWidget {
  constructor(
    private readonly theme: Theme,
    private readonly state: HudState,
  ) {}

  render(width: number): string[] {
    // Match the transcript gutter so the HUD reads as part of the output column
    // instead of being flush against the terminal edge.
    const gutter = width > 8 ? 1 : 0;
    const innerWidth = Math.max(1, width - gutter);
    const lines = renderHud(this.state, innerWidth, this.theme).map((line) => truncateToWidth(line, innerWidth, "…"));
    const pad = " ".repeat(gutter);
    const out = lines.map((line) => pad + line);
    const plain = out.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    trace(`render |${plain[0] ?? ""}|${plain[1] ?? ""}`);
    return out;
  }

  invalidate(): void {
    // Stateless render; the extension refreshes with tui.requestRender().
  }
}

type HealthToken = "success" | "warning" | "error" | "muted" | "text" | "accent" | "thinkingText";

type LiveState = "waiting" | "writing" | "paused" | "done";

/** The fixed state strip: every state is always shown, the active one highlighted. */
function stateStrip(active: LiveState, theme: Theme, mode: ColorMode): string {
  const label = (state: LiveState) => {
    const glyph = state === "waiting" ? "○" : state === "writing" ? "●" : state === "paused" ? "‖" : "✔";
    const text = `${glyph} ${state}`;
    if (state !== active) return dim(theme, text);
    // Only "paused" and errors are allowed to be loud; healthy states stay muted.
    if (state === "writing") return theme.style(text, { fg: severityColor(0, theme, mode) });
    if (state === "paused") return theme.fg("error", text);
    return theme.fg("muted", text);
  };
  return (["waiting", "writing", "paused", "done"] as LiveState[]).map(label).join(dim(theme, "  "));
}

/** Fixed-width gauge: filled = rate / max; colour by severity (quiet when fast). */
function pressureBar(rate: number | undefined, cells: number, good: number, bad: number, fast: number, theme: Theme, mode: ColorMode): string {
  // A gauge for "are we at the good baseline?": full once the good threshold is reached.
  const fill = rate !== undefined ? clamp01(rate / Math.max(1, good)) : 0;
  const filled = Math.max(0, Math.min(cells, Math.round(fill * cells)));
  return `${dim(theme, "[")}${theme.style("█".repeat(filled), { fg: severityColor(rateSeverity(rate, good, bad, fast), theme, mode) })}${dim(theme, "░".repeat(cells - filled))}${dim(theme, "]")}`;
}

/**
 * Row 1 is deliberately stable: the same elements are always present and only the
 * highlighted state moves, so the user never has to re-read a changing layout.
 *
 *   ○ waiting  ● writing  ‖ paused  ✔ done   [██████████░░]  38.0 tok/s  (est)  275 tok
 *
 * The pressure bar is a gauge for the "good baseline": it fills toward `tpsGood`
 * (30 tok/s) and is green once there, brighter green at/above `tpsFast` (100 tok/s),
 * amber between `tpsBad` (15) and `tpsGood`, and red below `tpsBad`.
 *
 * The trailing `(usage)` / `(est)` tag names where the numbers came from — see the
 * module docblock. It sits directly after the rate because that is the figure the tag
 * qualifies, and because a narrow terminal truncates the end of the row.
 */
function renderStateRow(call: CallStats, state: HudState, d: Derived, now: number, theme: Theme): string {
  const recent = call.gaps.length >= 4 ? median(call.gaps.slice(-20)) : undefined;
  const cadence = median(
    state.calls
      .slice(-30)
      .map((entry) => mean(entry.gaps))
      .filter((value): value is number => value !== undefined),
  ) ?? recent;
  const sinceToken = call.lastTokenPerf !== undefined && call.chunks > 0 ? now - call.lastTokenPerf : undefined;
  const stalled = call.live && sinceToken !== undefined && sinceToken > Math.max(800, (cadence ?? 100) * 3);

  const active: LiveState = !call.live ? "done" : call.firstTokenPerf === undefined ? "waiting" : stalled ? "paused" : "writing";

  // Average decode rate over real elapsed time (robust against bursty providers).
  // Below a quarter second the decode window is too short to be meaningful.
  const decodeSeconds = d.decodeMs !== undefined ? d.decodeMs / 1_000 : undefined;
  const measurable = decodeSeconds !== undefined && decodeSeconds >= 0.25;
  const divisor = call.bucketDivisor > 0 ? call.bucketDivisor : resolveCharsPerToken(state, state.settings.charsPerToken);
  const liveRate = measurable ? call.chars / divisor / decodeSeconds : undefined;
  // Once finished, prefer the provider's own number — the same figure the report and the
  // corrected TPS chart use, so the three can no longer disagree.
  const rate = measurable ? (call.live ? liveRate : d.tokensPerSecond ?? liveRate) : undefined;
  const reported = reportedOutputTokens(call);
  const tokens = reported ?? (call.chars > 0 ? Math.round(call.chars / divisor) : undefined);
  // Where the number came from. While a call streams there is no provider count yet, so the
  // figure is derived from characters; a finished call that reported `usage.output` has the
  // provider's own count and its buckets were rescaled to match. This replaced a `~` prefix
  // that was too subtle to read and was applied inconsistently — a finished call with no
  // usage showed no `~` at all, so an estimate looked authoritative.
  const fromProvider = !call.live && reported !== undefined;

  const segments: string[] = [stateStrip(active, theme, state.settings.colorMode)];
  // Pressure is a live signal: it falls back to empty once writing stops.
  const mode = state.settings.colorMode;
  const { tpsGood, tpsBad, tpsFast } = state.settings;
  segments.push(pressureBar(call.live ? rate : undefined, 12, tpsGood, tpsBad, tpsFast, theme, mode));
  segments.push(rate !== undefined ? theme.style(`${rate >= 100 ? rate.toFixed(0) : rate.toFixed(1)} tok/s`, { fg: severityColor(rateSeverity(rate, tpsGood, tpsBad, tpsFast), theme, mode) }) : dim(theme, call.live ? "… tok/s" : "– tok/s"));
  if (rate !== undefined || tokens !== undefined) segments.push(fromProvider ? dim(theme, "(usage)") : theme.fg("warning", "(est)"));
  if (tokens !== undefined) segments.push(theme.fg("muted", `${fmtTokens(tokens)} tok`));
  if (stalled && sinceToken !== undefined) segments.push(theme.fg("error", `waiting ${fmtMs(sinceToken)}`));

  return segments.join(dim(theme, "  "));
}

/**
 * The observed numbers, reduced to the essentials. Running averages while writing,
 * frozen once the call finishes.
 */
/**
 * Session latency averages across every call so far (the streaming one included). The
 * rate average/p95 lives next to the RATE chart and is computed from per-second samples,
 * so the rate is deliberately NOT repeated here (two different figures called "avg rate"
 * was confusing).
 */
/**
 * Session latency figures across every call so far (the streaming one included).
 *
 * Median, not mean: latency has a long right tail (cold connections, provider
 * queueing), so the mean is dragged by single outliers while the median describes the
 * typical call. The HIST row and the severity colouring already key off the median, so
 * using the mean here showed two different central tendencies for the same calls at the
 * same time.
 *
 * The TPS average/p95 lives next to the TPS chart and is computed from per-second
 * samples, so throughput is deliberately NOT repeated here (two different figures called
 * "avg rate" was confusing). Throughput stays a mean there on purpose: a slow second is
 * delivered throughput, not noise, and the median would flatter it.
 */
function renderStatsRow(state: HudState, theme: Theme): string {
  const now = performance.now();
  const calls = state.current ? [...state.calls, state.current] : state.calls;

  const derived = calls.map((call) => derive(call, now));
  const pick = (values: (number | undefined)[]) => values.filter((value): value is number => value !== undefined);
  const ttfts = pick(derived.map((d) => d.ttftMs));
  const itls = pick(derived.map((d) => d.itlMeanMs));
  const conns = pick(derived.map((d) => d.connectMs));
  const prefills = pick(derived.map((d) => (d.prefillIncludesConnect ? d.prefillMs : undefined)));

  const segments: string[] = [dim(theme, "STATS")];

  const connMedian = percentile(conns, 0.5);
  const prefillMedian = percentile(prefills, 0.5);
  if (prefills.length > 0 && connMedian !== undefined && prefillMedian !== undefined && connMedian + prefillMedian > 0) {
    // Shares of TTFT, so the pair reads without needing a baseline: 86% conn is
    // connection-bound, 86% prefill is server-bound.
    const share = Math.round((connMedian / (connMedian + prefillMedian)) * 100);
    segments.push(theme.fg("text", `split ${share}/${100 - share} conn/prefill`));
  }
  segments.push(theme.fg("text", `med first ${fmtMs(percentile(ttfts, 0.5))}`));
  segments.push(theme.fg("text", `med ITL ${fmtMs(percentile(itls, 0.5))}`));
  segments.push(theme.fg("text", `p95 ITL ${fmtMs(percentile(itls, 0.95))}`));
  segments.push(theme.fg("text", `${calls.length} call${calls.length === 1 ? "" : "s"}`));
  const error = calls.find((call) => call.error);
  if (error) segments.push(theme.fg("error", error.aborted ? "aborted" : "error"));
  return segments.join(dim(theme, "  "));
}

function dim(theme: Theme, text: string): string {
  return theme.fg("dim", text);
}

/** Braille dot bits: [left column, right column], sub-rows bottom -> top. */
const BRAILLE_DOTS = [
  [0x40, 0x04, 0x02, 0x01],
  [0x80, 0x20, 0x10, 0x08],
];

/** Dim dotted line across a braille cell at each sub-row (bottom -> top). */
const BRAILLE_LINE = [0xc0, 0x24, 0x12, 0x09];

/** Right-align a value list into exactly `slots` positions (null = no data). */
function toSlots(values: number[], slots: number, align: "left" | "right" = "right"): (number | null)[] {
  const out: (number | null)[] = new Array(slots).fill(null);
  const count = Math.min(values.length, slots);
  const from = values.length - count;
  const base = align === "left" ? 0 : slots - count;
  for (let i = 0; i < count; i++) out[base + i] = values[from + i];
  return out;
}

/**
 * Braille area chart: each character cell is a 2x4 dot matrix, so one text row carries
 * four levels of height and the bars read as stacked dots. Two samples share a cell,
 * giving 2x the horizontal resolution of the block chart for the same width.
 */
function renderBrailleChart(
  values: (number | null)[],
  columns: number,
  height: number,
  max: number,
  colorOf: (value: number) => Color,
  theme: Theme,
  align: "left" | "right" = "right",
  thresholds: number[] = [],
): string[] {
  const safeMax = Math.max(1, max);
  const slots = columns * 2;
  const shown = values.slice(-slots);
  const offset = align === "left" ? 0 : Math.max(0, slots - shown.length);
  const rows: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    let line = "";
    for (let column = 0; column < columns; column++) {
      let bits = 0;
      let hasBar = false;
      let worst: number | undefined;
      for (let half = 0; half < 2; half++) {
        const index = column * 2 + half - offset;
        if (index < 0 || index >= shown.length) continue;
        const value = shown[index];
        if (value === null) continue;
        if (worst === undefined || value > worst) worst = value;
        const filled = clamp01(value / safeMax) * height * 4; // sub-rows from the bottom
        for (let sub = 0; sub < 4; sub++) {
          if (filled > row * 4 + sub) {
            bits |= BRAILLE_DOTS[half][sub];
            hasBar = true;
          }
        }
      }
      // Reference lines are drawn only where no bar covers them.
      let onLine = false;
      if (!hasBar) {
        for (const threshold of thresholds) {
          const sub = (threshold / safeMax) * height * 4;
          if (sub >= row * 4 && sub < row * 4 + 4) {
            bits |= BRAILLE_LINE[Math.floor(sub - row * 4)];
            onLine = true;
          }
        }
      }
      if (bits === 0) line += row === 0 ? dim(theme, "⠂") : " ";
      else if (hasBar) line += theme.style(String.fromCharCode(0x2800 + bits), { fg: colorOf(worst ?? 0) });
      else line += theme.style(String.fromCharCode(0x2800 + bits), { fg: theme.colors.dim, dim: onLine });
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Multi-row area chart (btop-style): one column per sample, grown from the bottom over
 * `height` rows with eighth-block resolution at the top edge of each bar.
 */
function renderAreaChart(
  values: (number | null)[],
  width: number,
  height: number,
  max: number,
  colorOf: (value: number) => Color,
  theme: Theme,
  thresholds: number[] = [],
): string[] {
  const safeMax = Math.max(1, max);
  const shown = values.slice(-width);
  const pad = Math.max(0, width - shown.length);
  const rows: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    let line = " ".repeat(pad);
    for (const value of shown) {
      if (value === null) {
        line += row === 0 ? dim(theme, "·") : " ";
        continue;
      }
      const total = clamp01(value / safeMax) * height;
      if (total >= row + 1) line += theme.style("█", { fg: colorOf(value) });
      else if (total > row) {
        const index = Math.max(0, Math.min(BLOCKS.length - 1, Math.round((total - row) * 8) - 1));
        line += theme.style(BLOCKS[index], { fg: colorOf(value) });
      } else line += row === 0 ? dim(theme, "·") : " ";
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Outer top rule: closes the HUD off from the transcript above and labels it.
 * Uses the editor's border colour so the rule and the editor frame read as the two
 * edges of one HUD band; the internal dividers stay `dim`.
 *
 *   ─ pi-metrics · deepseek-v3.1 ─────────────────── 3 calls ─
 */
function renderHeader(state: HudState, width: number, theme: Theme): string {
  const call = state.current ?? state.calls[state.calls.length - 1];
  const count = state.calls.length + (state.current ? 1 : 0);
  const left = `─ pi-metrics${call ? ` · ${shortModel(call.model)}` : ""} `;
  const right = ` ${count} call${count === 1 ? "" : "s"} ─`;
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const text = truncateToWidth(left + "─".repeat(gap) + right, width, "…");
  return theme.fg("borderMuted", text);
}

/**
 * Title line: labels on the left, the chart's axis text right-aligned.
 *
 * The axis must survive a narrow terminal. Truncation happens at the end of the line, so a
 * naive left-then-gap layout turns `p95 300` + `120s · max 500 auto` into the run-on
 * `p95 300 120s · max 500 a…`, where the axis reads as more stats and is itself cut. So if
 * the two do not both fit, the *labels* shrink and the axis stays whole.
 */
function chartTitle(labels: string, axis: string, width: number, theme: Theme): string {
  const axisText = dim(theme, axis);
  const minGap = 2;
  const room = width - visibleWidth(axis) - minGap;
  if (room < 1) {
    // Not even the axis fits: show as much of it as possible rather than a broken mix.
    return truncateToWidth(axisText, Math.max(1, width), "…");
  }
  // Only warn when a figure the user might act on was actually dropped.
  const labelsText = visibleWidth(labels) <= room ? dim(theme, labels) : theme.fg("warning", truncateToWidth(labels, room, "…"));
  const gap = Math.max(minGap, width - visibleWidth(labelsText) - visibleWidth(axisText));
  return labelsText + " ".repeat(gap) + axisText;
}

/**
 * The tall layout: the same state row, then a multi-row RATE graph and two multi-row
 * session graphs (TTFT and ITL) side by side, then the session averages.
 */
function renderNormalHud(state: HudState, call: CallStats, d: Derived, now: number, width: number, theme: Theme): string[] {
  const settings = state.settings;
  const mode = settings.colorMode;
  const lines: string[] = [renderStateRow(call, state, d, now, theme), ""];

  /* RATE graph */
  flushRateHistory(state, call, d);
  const windowSeconds = Math.max(10, Math.round(settings.tpsWindow));
  const rateWidth = Math.max(20, width - 1);
  const { max: tpsMax, auto: tpsMaxAuto } = resolveRateMax(state.rateHistory, settings.tpsMax, settings.tpsFast);
  const rateColumns = settings.graphStyle === "braille" ? rateWidth * 2 : rateWidth;
  const rateTrace = buildSessionRateTrace(state, rateColumns, windowSeconds);
  const averageRate = mean(state.rateHistory);
  const p95Rate = percentile(state.rateHistory, 0.95);
  // Left is measurement, right is the chart's own axes. The `good`/`bad` thresholds used to
  // be printed here; they are configuration rather than measurement, and the colour already
  // encodes them, so they are gone. `fast` stays because it is not merely a colour bound: it
  // is the floor the auto maximum can never go below, so without it `max … auto` would have
  // no visible explanation.
  const rateLabels = [
    "TPS tok/s",
    `fast ${settings.tpsFast}`,
    averageRate !== undefined ? `avg ${Math.round(averageRate)}` : undefined,
    p95Rate !== undefined ? `p95 ${Math.round(p95Rate)}` : undefined,
    rateTrace.perColumnSeconds > 1.05 ? `${rateTrace.perColumnSeconds.toFixed(1)}s/col` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("  ·  ");
  const rateAxis = `${windowSeconds}s  ·  max ${tpsMax}${tpsMaxAuto ? " auto" : ""}`;
  lines.push(chartTitle(rateLabels, rateAxis, rateWidth, theme));  const rateColorOf = (value: number) => severityColor(rateSeverity(value, settings.tpsGood, settings.tpsBad, settings.tpsFast), theme, mode);
  const rateLines = [settings.tpsBad, settings.tpsGood, settings.tpsFast].filter((value) => value < tpsMax);
  const rateRows = settings.graphStyle === "braille"
    ? renderBrailleChart(rateTrace.values, rateWidth, 5, tpsMax, rateColorOf, theme, "right", rateLines)
    : renderAreaChart(rateTrace.values, rateWidth, 5, tpsMax, rateColorOf, theme, rateLines);
  for (const row of rateRows) lines.push(row);

  lines.push(dim(theme, "─".repeat(Math.max(1, width))));

  /* HIST graphs */
  const all = state.current ? [...state.calls, state.current] : state.calls;
  const history = all.slice(-settings.history).map((entry) => derive(entry, now));
  const ttfts = history.map((entry) => entry.ttftMs).filter((value): value is number => value !== undefined);
  const itls = history.map((entry) => entry.itlMeanMs).filter((value): value is number => value !== undefined);
  const medianTtft = percentile(ttfts, 0.5);
  const medianItl = percentile(itls, 0.5);
  const ttftMax = Math.max(1, maxOf(ttfts) ?? 1);
  const itlMax = Math.max(1, maxOf(itls) ?? 1);

  const leftWidth = Math.max(12, Math.floor((width - 3) / 2));
  const rightWidth = Math.max(12, width - 3 - leftWidth);
  const ttftColorOf = (value: number) => severityColor(latencySeverity(value, medianTtft), theme, mode);
  const itlColorOf = (value: number) => severityColor(latencySeverity(value, medianItl), theme, mode);
  const leftLines = medianTtft !== undefined ? [medianTtft] : [];
  const rightLines = medianItl !== undefined ? [medianItl] : [];
  const left = settings.graphStyle === "braille"
    ? renderBrailleChart(toSlots(ttfts, leftWidth * 2, "left"), leftWidth, 4, ttftMax, ttftColorOf, theme, "left", leftLines)
    : renderAreaChart(toSlots(ttfts, leftWidth * 2, "left"), leftWidth, 4, ttftMax, ttftColorOf, theme, leftLines);
  const right = settings.graphStyle === "braille"
    ? renderBrailleChart(toSlots(itls, rightWidth * 2, "left"), rightWidth, 4, itlMax, itlColorOf, theme, "left", rightLines)
    : renderAreaChart(toSlots(itls, rightWidth * 2, "left"), rightWidth, 4, itlMax, itlColorOf, theme, rightLines);

  const histTitle = (label: string, median: number | undefined, max: number, columnWidth: number) =>
    truncateToWidth(dim(theme, `${label}  med ${fmtMs(median)}  max ${fmtMs(max)}`), columnWidth, "…", true);
  lines.push(`${histTitle("TTFT ms", medianTtft, ttftMax, leftWidth)}${dim(theme, " │ ")}${histTitle("ITL ms", medianItl, itlMax, rightWidth)}`);
  for (let row = 0; row < 4; row++) lines.push(`${left[row]}${dim(theme, " │ ")}${right[row]}`);

  lines.push(dim(theme, "─".repeat(Math.max(1, width))));
  lines.push(renderStatsRow(state, theme));
  return lines;
}

function renderHud(state: HudState, width: number, theme: Theme): string[] {
  const { settings } = state;
  const call = state.current ?? state.calls[state.calls.length - 1];
  const now = performance.now();
  // The header is always present: it is the HUD's top edge, so it must not depend
  // on whether a call has happened yet.
  const lines: string[] = [renderHeader(state, width, theme)];

  if (!call) {
    lines.push(`${theme.fg("accent", "LLM")} ${dim(theme, "waiting for the first response …")}`);
    return lines;
  }

  const d = derive(call, now);
  const live = call.live;

  if (settings.style === "normal") return [renderHeader(state, width, theme), ...renderNormalHud(state, call, d, now, width, theme)];

  /* line 1 — stable state row (same elements live and done) --------------- */

  lines.push(renderStateRow(call, state, d, now, theme));

  /* line 2 — rolling throughput of the current provider -------------------- */

  if (settings.timeline && settings.liveTimeline) {
    // Record any newly finished seconds before drawing the session timeline.
    flushRateHistory(state, call, d);

    const windowSeconds = Math.max(10, Math.round(settings.tpsWindow));
    const labelText = "TPS";
    const padded = (value: string) => value.padStart(6);
    const averageRate = mean(state.rateHistory);
    const p95Rate = percentile(state.rateHistory, 0.95);
    const { max: tpsMax, auto: tpsMaxAuto } = resolveRateMax(state.rateHistory, settings.tpsMax, settings.tpsFast);
    // The recording window and the ceiling are attributes of the chart, not of the data, so
    // they sit together at the right instead of reading as a prefix to the graph.
    const axisText = `${windowSeconds}s  ·  max ${tpsMax}${tpsMaxAuto ? " auto" : ""}`;

    // Two passes: size the chart from the stats text, then account for a compression note.
    const statsFor = (perColumn: number) => {
      const stats: string[] = [];
      if (averageRate !== undefined && width >= 84) stats.push(`avg${padded(Math.round(averageRate).toString())} tok/s`);
      if (p95Rate !== undefined && width >= 80) stats.push(`p95${padded(Math.round(p95Rate).toString())} tok/s`);
      if (perColumn > 1.05) stats.push(`${perColumn.toFixed(1)}s/col`);
      return `· ${stats.join(" · ")}`;
    };

    // Reserve the axis text before the stats: truncation eats the end of the line, so the
    // chart's scale must be accounted for first or a narrow terminal would cut it off.
    const fixed = visibleWidth(labelText) + 1 + visibleWidth(axisText) + 2;
    let graphWidth = Math.max(12, width - fixed - visibleWidth(statsFor(1)) - 2);
    let trace = buildSessionRateTrace(state, graphWidth, windowSeconds);
    if (trace.perColumnSeconds > 1.05) {
      graphWidth = Math.max(12, width - fixed - visibleWidth(statsFor(trace.perColumnSeconds)) - 2);
      trace = buildSessionRateTrace(state, graphWidth, windowSeconds);
    }

    const statsText = statsFor(trace.perColumnSeconds);
    const statsRoom = Math.max(0, width - fixed - graphWidth - 2);
    const statsLine = statsRoom > 0 ? truncateToWidth(statsText, statsRoom, "…") : "";

    const bars = sparklineRate(trace.values, [0, tpsMax], settings.tpsGood, settings.tpsBad, settings.tpsFast, theme, settings.colorMode);
    lines.push(`${dim(theme, labelText)} ${bars}${statsLine ? `  ${dim(theme, statsLine)}` : ""}  ${dim(theme, axisText)}`);
  }

  /* line 3 — session averages --------------------------------------------- */

  lines.push(renderStatsRow(state, theme));

  /* line 4 — history timelines -------------------------------------------- */

  if (settings.timeline && (state.calls.length > 0 || state.current)) {
    // Include the streaming call so HIST and STATS agree on the call count.
    const all = state.current ? [...state.calls, state.current] : state.calls;
    const history = all.slice(-settings.history);
    const derived = history.map((entry) => derive(entry, now));
    const ttfts = derived.map((entry) => entry.ttftMs).filter((value): value is number => value !== undefined);
    const itls = derived.map((entry) => entry.itlMeanMs).filter((value): value is number => value !== undefined);

    // Fit first, then shrink the timelines if the ×N compression label needs room.
    const suffix = ` (${history.length} call${history.length === 1 ? "" : "s"})`;
    let perSeries = Math.max(6, Math.min(72, Math.floor((width - 42) / 2)));
    let ttftSeries = fitSeries(ttfts, perSeries);
    let itlSeries = fitSeries(itls, perSeries);
    const compressed = Math.max(ttftSeries.perBucket, itlSeries.perBucket);
    if (compressed > 1) {
      perSeries = Math.max(6, perSeries - 2);
      ttftSeries = fitSeries(ttfts, perSeries);
      itlSeries = fitSeries(itls, perSeries);
    }
    const histLabel = compressed > 1 ? `HIST×${compressed}` : "HIST";

    const medianTtft = percentile(ttfts, 0.5);
    const mode = settings.colorMode;
    const medianItl = percentile(itls, 0.5);
    const ttftSpark = ttftSeries.values.length > 0 ? sparklineFixed(ttftSeries.values, perSeries, (value) => severityColor(latencySeverity(value, medianTtft), theme, mode), theme) : "";
    const itlSpark = itlSeries.values.length > 0 ? sparklineFixed(itlSeries.values, perSeries, (value) => severityColor(latencySeverity(value, medianItl), theme, mode), theme) : "";

    const row = [
      dim(theme, histLabel.padEnd(4)),
      dim(theme, "TTFT"),
      ttftSpark,
      theme.fg("muted", fmtMs(medianTtft)),
      dim(theme, " │ "),
      dim(theme, "ITL"),
      itlSpark,
      theme.fg("muted", fmtMs(medianItl)),
      dim(theme, suffix),
    ].join(" ");
    lines.push(row);
  }

  return lines;
}

/* -------------------------------------------------------------------- report */

interface ReportRow {
  time: string;
  turn: string;
  model: string;
  ttft: string;
  conn: string;
  itl: string;
  tps: string;
  ttout: string;
  out: string;
  cost: string;
  status: string;
  ttftMs?: number;
  itlMs?: number;
  medianTtft?: number;
}

function buildReportRows(calls: CallStats[], includeCost: boolean): ReportRow[] {
  const now = performance.now();
  const medianTtft = percentile(
    calls.map((call) => derive(call, now).ttftMs).filter((value): value is number => value !== undefined),
    0.5,
  );
  return calls.map((call) => {
    const d = derive(call, now);
    return {
      time: new Date(call.requestWall).toLocaleTimeString([], { hour12: false }),
      turn: `t${call.turnIndex}`,
      model: shortModel(call.model),
      ttft: fmtMs(d.ttftMs),
      conn: d.connectMs !== undefined && d.prefillMs !== undefined ? `${fmtMs(d.connectMs)}/${fmtMs(d.prefillMs)}` : "–",
      itl: fmtMs(d.itlMeanMs),
      tps: d.tokensPerSecond !== undefined ? d.tokensPerSecond.toFixed(1) : "–",
      ttout: fmtMs(d.ttoutMs),
      // Same estimate the HUD and the TPS chart use (characters / divisor). It must NOT
      // fall back to `call.chunks`: the number of streamed deltas is a batching artifact,
      // so some providers would report a wildly different figure here than in the chart.
      out: d.estimatedTokens ? `~${fmtTokens(d.estimatedOutput)}` : fmtTokens(d.outputTokens),
      cost: includeCost ? fmtCost(call.usage?.cost?.total, true) ?? "–" : "–",
      status: call.error ? (call.aborted ? "abort" : "error") : "ok",
      ttftMs: d.ttftMs,
      itlMs: d.itlMeanMs,
      medianTtft,
    };
  });
}

function renderReport(rows: ReportRow[], settings: ResolvedSettings, theme: Theme): string[] {
  const medianRowItl = percentile(rows.map((row) => row.itlMs).filter((value): value is number => value !== undefined), 0.5);
  // Drop the cost column entirely when the setting is off, rather than printing a column
  // of dashes: the setting is advertised as "show cost", and a blank column is not that.
  const showCost = settings.cost;
  const headers = ["time", "turn", "model", "TTFT", "conn/pre", "ITL", "tok/s", "TTOUT", "out", ...(showCost ? ["cost"] : []), ""];
  const keys: (keyof ReportRow)[] = ["time", "turn", "model", "ttft", "conn", "itl", "tps", "ttout", "out", ...(showCost ? (["cost"] as const) : []), "status"];
  const widths = headers.map((header, index) => Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(String(row[keys[index]])))));

  const lines: string[] = [];
  lines.push("LLM call metrics");
  lines.push(headers.map((header, index) => theme.fg("dim", padEnd(header, widths[index]))).join("  "));
  for (const row of rows) {
    const cells = keys.map((key, index) => {
      const value = String(row[key]);
      const text = padEnd(value, widths[index]);
      const mode = settings.colorMode;
      if (key === "ttft" && row.ttftMs !== undefined) return theme.style(text, { fg: severityColor(latencySeverity(row.ttftMs, row.medianTtft), theme, mode) });
      if (key === "itl" && row.itlMs !== undefined) return theme.style(text, { fg: severityColor(latencySeverity(row.itlMs, medianRowItl), theme, mode) });
      if (key === "status") return theme.fg(row.status === "ok" ? "success" : "error", text);
      if (key === "model") return theme.fg("accent", text);
      return theme.fg("text", text);
    });
    lines.push(cells.join("  "));
  }
  return lines;
}

function summarizeCall(call: CallStats, settings: ResolvedSettings, theme: Theme, medianTtft?: number, medianItl?: number): string {
  const d = derive(call, performance.now());
  const parts = [
    `${theme.fg("accent", "metrics")} ${theme.fg("muted", shortModel(call.model))}`,
    theme.style(`TTFT ${fmtMs(d.ttftMs)}`, { fg: severityColor(latencySeverity(d.ttftMs ?? 0, medianTtft), theme, settings.colorMode) }),
    theme.style(`ITL ${fmtMs(d.itlMeanMs)}`, { fg: severityColor(latencySeverity(d.itlMeanMs ?? 0, medianItl), theme, settings.colorMode) }),
    theme.fg("text", `TTOUT ${fmtMs(d.ttoutMs)}`),
    theme.fg("muted", `out ${fmtTokens(d.estimatedTokens ? d.estimatedOutput : d.outputTokens)}`),
  ];
  const cost = settings.cost ? fmtCost(call.usage?.cost?.total, true) : undefined;
  if (cost) parts.push(theme.fg("muted", cost));
  if (call.error) parts.push(theme.fg("error", call.aborted ? "aborted" : "error"));
  return parts.join(dim(theme, "  "));
}

function serialize(call: CallStats): SerializedCall {
  const { live, ...rest } = call;
  void live;
  return rest;
}

/* ----------------------------------------------------------------- extension */

export default function piMetrics(pi: ExtensionAPI): void {
  let state: HudState = {
    calls: [],
    settings: { ...DEFAULTS },
    visible: DEFAULTS.enabled,
    nextId: 1,
    turnIndex: 0,
    rateHistory: [],
    calibrationChars: 0,
    calibrationTokens: 0,
  };

  let tui: TUI | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let renderScheduled = false;
  let liveTicker: ReturnType<typeof setInterval> | undefined;
  let lastCtx: ExtensionContext | undefined;

  /* --------------------------------------------------------------- helpers */

  /**
   * Repaint on a timer while a call is streaming, so the RATE chart keeps up with
   * wall-clock time and a stall shows as an empty column without waiting for a token.
   */
  function syncTicker(): void {
    const shouldRun = state.visible && state.current?.live === true;
    if (!shouldRun) {
      if (liveTicker) {
        clearInterval(liveTicker);
        liveTicker = undefined;
      }
      return;
    }
    if (liveTicker) return;
    const period = 250;
    liveTicker = setInterval(() => {
      trace(`tick live=${state.current?.live === true}`);
      if (state.visible && state.current?.live) tui?.requestRender();
      else syncTicker();
    }, period);
    // Never hold the process open just to repaint.  
    liveTicker.unref?.();
  }

  function refresh(immediate = false): void {
    if (!tui) return;
    if (immediate) {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = undefined;
      renderScheduled = false;
      tui.requestRender();
      return;
    }
    if (renderScheduled) return;
    renderScheduled = true;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      renderScheduled = false;
      tui?.requestRender();
    }, 90);
  }

  function attachWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const factory = (instance: TUI, theme: Theme) => {
      tui = instance;
      return new MetricsWidget(theme, state);
    };
    ctx.ui.setWidget(WIDGET_KEY, state.visible ? factory : undefined, { placement: state.settings.placement });
  }

  function detachWidget(ctx: ExtensionContext | undefined): void {
    tui = undefined;
    if (!ctx?.hasUI || ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  function updateStatus(ctx: ExtensionContext | undefined): void {
    if (!ctx?.hasUI) return;
    if (state.visible) {
      // The widget already shows everything; keep the footer clean.
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const call = state.current ?? state.calls[state.calls.length - 1];
    if (!call) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const d = derive(call, performance.now());
    const bits = [`TTFT ${fmtMs(d.ttftMs)}`, `ITL ${fmtMs(d.itlMeanMs)}`, `TTOUT ${fmtMs(d.ttoutMs)}`];
    ctx.ui.setStatus(STATUS_KEY, `⚡ ${bits.join(" · ")}`);
  }

  function touch(ctx: ExtensionContext | undefined, immediate = false): void {
    if (ctx) lastCtx = ctx;
    const active = ctx ?? lastCtx;
    // The widget factory only runs on the first render; make sure we get a TUI handle early.
    if (state.visible && !tui && active?.hasUI && active.mode === "tui") attachWidget(active);
    syncTicker();
    updateStatus(active);
    refresh(immediate);
  }

  function currentCallIs(message: AssistantMessage): boolean {
    const current = state.current;
    if (!current) return false;
    return current.requestWall === message.timestamp && current.model === message.model;
  }

  function keyOf(message: AssistantMessage): { requestWall: number; provider: string; model: string } {
    return { requestWall: message.timestamp, provider: message.provider, model: message.model };
  }

  /* --------------------------------------------------------- event handling */

  pi.on("session_start", (_event, ctx) => {
    const { settings, problems } = readSettings(pi);
    state.settings = settings;
    state.visible = settings.enabled;
    state.current = undefined;
    state.rateHistory = [];
    // Surface unusable config instead of silently substituting the default. Pi validates
    // `settings.json` but not an extension's own nested keys, so this is the only place a
    // typo inside `pi-metrics` can be reported.
    for (const problem of problems) {
      ctx.ui.notify(problem, "warning");
    }

    // Rebuild history from persisted cards so a resumed session keeps its timeline.
    if (state.settings.persist) {
      const restored: CallStats[] = [];
      try {
        for (const entry of ctx.sessionManager.getBranch()) {
          if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
          const data = entry.data as MetricsEntryData | undefined;
          if (data?.kind === "call")
            restored.push({
              ...data.call,
              flushedSeconds: data.call.flushedSeconds ?? 0,
              // Written by a version that used a fixed 4, so label its buckets correctly.
              bucketDivisor: data.call.bucketDivisor ?? 4,
              // A restored call's seconds were never replayed into rateHistory, so its
              // buckets must not be corrected again.
              tokensCorrected: true,
              live: false,
            });
        }
      } catch {
        // Older session files or unexpected shapes: start with an empty timeline.
      }
      state.calls = restored.slice(-state.settings.history);
      state.nextId = (state.calls[state.calls.length - 1]?.id ?? 0) + 1;
    } else {
      state.calls = [];
    }

    lastCtx = ctx;
    attachWidget(ctx);
    touch(ctx, true);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (renderTimer) clearTimeout(renderTimer);
    if (liveTicker) clearInterval(liveTicker);
    liveTicker = undefined;
    renderTimer = undefined;
    renderScheduled = false;
    detachWidget(ctx);
  });

  pi.on("turn_start", (event) => {
    state.turnIndex = event.turnIndex;
  });

  // Fires just before the payload leaves Pi: the most accurate request start we get.
  pi.on("before_provider_request", (_event, ctx) => {
    if (ctx.isIdle()) return; // background calls (cache warming, titles) are not turn requests
    state.pendingHeadersPerf = undefined;
    if (state.current && state.current.live) {
      // A repeated request while the response has not started is a provider retry:
      // re-anchor the request start. Once deltas flow, leave the timing alone.
      if (state.current.chunks === 0) state.current.armPerf = performance.now();
      return;
    }
    state.pendingArmPerf = performance.now();
  });

  pi.on("after_provider_response", (_event, ctx) => {
    if (ctx.isIdle()) return;
    state.pendingHeadersPerf = performance.now();
    if (state.current?.live) state.current.headersPerf = state.pendingHeadersPerf;
  });

  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = event.message as AssistantMessage;
    const now = performance.now();
    state.current = {
      id: state.nextId++,
      turnIndex: state.turnIndex,
      provider: message.provider,
      model: message.model,
      requestWall: message.timestamp,
      armPerf: state.pendingArmPerf,
      headersPerf: state.pendingHeadersPerf,
      streamPerf: now,
      streamWall: Date.now(),
      gaps: [],
      gapKinds: [],
      rateBuckets: [],
      flushedSeconds: 0,
      bucketDivisor: resolveCharsPerToken(state, state.settings.charsPerToken),
      tokensCorrected: false,
      chunks: 0,
      chars: 0,
      aborted: false,
      live: true,
    };
    state.pendingArmPerf = undefined;
    state.pendingHeadersPerf = undefined;
    touch(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = event.message as AssistantMessage;
    const current = state.current;
    if (!current) return;
    if (!currentCallIs(message)) return; // a stream we are not tracking

    const assistantEvent = event.assistantMessageEvent;
    let kind: TokenKind;
    let delta: string;
    switch (assistantEvent.type) {
      case "thinking_delta":
        kind = "thinking";
        delta = assistantEvent.delta;
        break;
      case "text_delta":
        kind = "text";
        delta = assistantEvent.delta;
        break;
      case "toolcall_delta":
        kind = "tool";
        delta = assistantEvent.delta;
        break;
      default:
        return;
    }

    const now = performance.now();

    if (current.firstTokenPerf === undefined) {
      current.firstTokenPerf = now;
      current.firstTokenKind = kind;
    }
    if (kind === "text" && current.firstTextPerf === undefined) current.firstTextPerf = now;

    if (current.lastTokenPerf !== undefined) {
      current.gaps.push(now - current.lastTokenPerf);
      current.gapKinds.push(kind);
    }
    current.lastTokenPerf = now;
    current.chunks += 1;
    current.chars += delta.length;

    // Bucket characters by whole seconds since the first token for the RATE chart.
    if (current.firstTokenPerf !== undefined) {
      const second = Math.floor((now - current.firstTokenPerf) / 1_000);
      while (current.rateBuckets.length <= second) current.rateBuckets.push(0);
      current.rateBuckets[second] += delta.length;
    }

    touch(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = event.message as AssistantMessage;
    let call = state.current;
    if (!call || !currentCallIs(message)) {
      // A response we never saw start (e.g. replayed from the session branch):
      // record it with whatever the message carries.
      call = {
        id: state.nextId++,
        turnIndex: state.turnIndex,
        provider: message.provider,
        model: message.model,
        requestWall: message.timestamp,
        gaps: [],
        gapKinds: [],
        rateBuckets: [],
        flushedSeconds: 0,
        bucketDivisor: 0,
        tokensCorrected: false,
        chunks: 0,
        chars: 0,
        aborted: false,
        live: true,
      };
    }

    call.usage = message.usage;
    call.durationMs = message.durationMs;
    call.endedAt = Date.now();
    call.aborted = message.stopReason === "aborted";
    call.error = message.stopReason === "error" ? message.errorMessage ?? "provider error" : undefined;
    call.live = false;
    state.current = undefined;
    // The provider's own token count is authoritative: fold it into the session
    // calibration so later calls estimate better.
    calibrate(state, call);
    // NOTE: the TPS buckets are corrected inside flushRateHistory, not here. Ordering
    // matters: a finished call still has a final partial second that is only pushed on
    // the next flush, so correcting now would rescale the whole seconds and then let
    // that last bucket through uncorrected — leaving the call total inexact. The flush
    // path pushes every remaining bucket first and corrects once afterwards.

    if (call.firstTokenPerf === undefined && call.durationMs === undefined) {
      // Nothing useful to show (e.g. an immediately failed request).
    }

    state.calls.push(call);
    if (state.calls.length > state.settings.history) state.calls = state.calls.slice(-state.settings.history);

    if (state.visible && ctx.hasUI && ctx.mode === "tui" && !tui) attachWidget(ctx);
    touch(ctx, true);

    if (state.settings.persist) {
      try {
        pi.appendEntry(CUSTOM_TYPE, { kind: "call", call: serialize(call) } satisfies MetricsEntryData);
      } catch {
        // Persisting is best-effort; never break a turn over a metrics card.
      }
    }
  });

  /* ---------------------------------------------------------------- command */

  pi.registerCommand("metrics", {
    description: "Show, toggle or reset the LLM latency HUD",
    getArgumentCompletions: (prefix) => {
      const candidates = [
        "on",
        "off",
        "report",
        "reset",
        "placement above",
        "placement below",
        "style compact",
        "style normal",
        "graph braille",
        "graph block",
        "color calm",
        "color vivid",
        "color mono",
      ];
      const matches = candidates.filter((candidate) => candidate.startsWith(prefix));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const [command, argument] = args.trim().split(/\s+/, 2);
      // A display change applies now and is reported with the settings.json line that makes
      // it permanent. Persisting would need a settings write, which Pi's extension API does
      // not offer; writing the file directly would race Pi's settings manager and could drop
      // unrelated keys.
      const applied = (summary: string, settingsKey: string, value: string): void => {
        attachWidget(ctx);
        touch(ctx, true);
        ctx.ui.notify(`${summary} — persist with "pi-metrics": { "${settingsKey}": "${value}" }`, "info");
      };
      const choose = <T extends string>(allowed: readonly T[], value: string | undefined): T | undefined => {
        if (value === undefined) return undefined;
        return allowed.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
      };

      switch (command) {
        case "on":
        case "off": {
          state.visible = command === "on";
          attachWidget(ctx);
          touch(ctx, true);
          ctx.ui.notify(`metrics HUD ${state.visible ? "enabled" : "disabled"}`, "info");
          return;
        }
        case "placement": {
          const placement = normalizePlacement(argument);
          if (placement === undefined) {
            ctx.ui.notify("/metrics placement above|below", "warning");
            return;
          }
          state.settings.placement = placement;
          applied(`metrics HUD placed ${placement}`, "placement", placement);
          return;
        }
        case "style": {
          const style = choose(STYLE_VALUES, argument);
          if (style === undefined) {
            ctx.ui.notify("/metrics style compact|normal", "warning");
            return;
          }
          state.settings.style = style;
          applied(`metrics style ${style}`, "style", style);
          return;
        }
        case "graph":
        case "graphStyle": {
          const graphStyle = choose(GRAPH_VALUES, argument);
          if (graphStyle === undefined) {
            ctx.ui.notify("/metrics graph braille|block", "warning");
            return;
          }
          state.settings.graphStyle = graphStyle;
          applied(`metrics graph ${graphStyle}`, "graphStyle", graphStyle);
          return;
        }
        case "color":
        case "colorMode": {
          const colorMode = choose(COLOR_VALUES, argument);
          if (colorMode === undefined) {
            ctx.ui.notify("/metrics color calm|vivid|mono", "warning");
            return;
          }
          state.settings.colorMode = colorMode;
          applied(`metrics color ${colorMode}`, "colorMode", colorMode);
          return;
        }
        case "reset": {
          state.calls = [];
          state.current = undefined;
          state.nextId = 1;
          state.rateHistory = [];
          touch(ctx, true);
          ctx.ui.notify("metrics history cleared", "info");
          return;
        }
        case "report": {
          const calls = state.calls.length > 0 ? state.calls : [];
          if (calls.length === 0) {
            ctx.ui.notify("no LLM calls recorded yet", "warning");
            return;
          }
          pi.appendEntry(CUSTOM_TYPE, { kind: "report", calls: calls.map(serialize), generatedAt: Date.now() } satisfies MetricsEntryData);
          return;
        }
        case "":
        case undefined: {
          state.visible = !state.visible;
          attachWidget(ctx);
          touch(ctx, true);
          ctx.ui.notify(`metrics HUD ${state.visible ? "enabled" : "disabled"}`, "info");
          return;
        }
        default: {
          // An unrecognised subcommand used to fall through to the toggle, so a typo like
          // `/metrics styel compact` silently switched the HUD off. Say so instead.
          ctx.ui.notify(`unknown option "${command}" — try on, off, report, reset, placement, style, graph or color`, "warning");
          return;
        }
      }
    },
  });

  /* -------------------------------------------------------- entry rendering */

  pi.registerEntryRenderer<MetricsEntryData>(CUSTOM_TYPE, (entry, _options: EntryRenderOptions, theme) => {
    const data = entry.data;
    if (!data) return undefined;
    if (data.kind === "call") {
      const call = { ...data.call, live: false } as CallStats;
      const now = performance.now();
      const ttfts = state.calls
        .map((entry) => derive(entry, now).ttftMs)
        .filter((value): value is number => value !== undefined);
      const itls = state.calls
        .map((entry) => derive(entry, now).itlMeanMs)
        .filter((value): value is number => value !== undefined);
      return new Text(summarizeCall(call, state.settings, theme, percentile(ttfts, 0.5), percentile(itls, 0.5)), 1, 0);
    }
    const calls = data.calls.map((call) => ({ ...call, live: false } as CallStats));
    const rows = buildReportRows(calls, state.settings.cost);
    return new Text(renderReport(rows, state.settings, theme).join("\n"), 1, 0);
  });
}
