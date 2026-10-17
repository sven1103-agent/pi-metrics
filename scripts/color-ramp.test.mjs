/**
 * The colour ramp: order, reach, scale-invariance, and the direction of the bar fill.
 *
 * Colour is the HUD's second read on value, so its order must match the value's order and its
 * scale must not depend on things that move on their own. Four separate things have been wrong
 * here, all of them shipped at some point:
 *
 *   1. Anchors were mixed toward `dim` in Oklch, which pushed `success` past green into cyan and
 *      pulled `warning` back to greener-than-success — the ramp crossed hues.
 *   2. `latencySeverity` clamped to `[0, 1]`, so every latency at or below the session median was
 *      exactly severity 0. The cool half of the ramp was unreachable.
 *   3. The chart fill was keyed to the *row* (`max * (row + 0.5) / height`), which silently made
 *      the colour a function of the axis maximum — and the axis moves on its own, so rescaling
 *      shifted every bar's colour. A slow provider with the `tpsFast` axis floor had every bar
 *      crushed into the bottom row in one colour.
 *   4. Throughput severity used absolute tok/s thresholds, so the same palette meant "all bad"
 *      on a local model and "all excellent" on a hosted one.
 *
 * These assertions drive the real report renderer and the real widget. A virtual clock is needed
 * because TTFT is measured with `performance.now()`, which a test cannot otherwise control.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { colorToOkhsl, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { interopDefault: true });
const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;

/**
 * TTFT ends up exactly `prefill + 1` ms (one virtual millisecond passes between the request
 * leaving and the response headers arriving). Choosing the prefill backwards from the TTFT we
 * want makes a scaled run *exactly* proportional, so the scale-invariance check can be tight:
 * with `prefill = target * factor - 1` the TTFT is exactly `target * factor`. Kept under 1000 ms
 * so `fmtMs` does not switch to seconds and change the cell text this matches on.
 */
const TTFT_BASE = [11, 21, 41, 81, 121, 181, 241];
/** Index of the median: `81 ms` is the fourth of the seven. */
const MEDIAN_AT = 3;

/** Install a virtual clock for the duration of `body`, then restore the real one. */
async function withVirtualClock(body) {
  let t = 1_000_000;
  const realNow = performance.now;
  const realDate = Date.now;
  performance.now = () => t;
  Date.now = () => 1_700_000_000_000 + (t - 1_000_000);
  try {
    return await body({ now: () => t, advance: (ms) => (t += ms) });
  } finally {
    performance.now = realNow;
    Date.now = realDate;
  }
}

/* --------------------------------------------------------------- the report ---- */

/**
 * The report colours each row's TTFT cell, which is the cleanest read on severity: one value,
 * one colour, in a known order.
 */
async function renderedReport(colorMode, factor = 1) {
  return withVirtualClock(async ({ now, advance }) => {
    const handlers = new Map();
    const appended = [];
    const renderers = new Map();
    let command;
    const pi = {
      on: (name, fn) => handlers.set(name, fn),
      registerCommand: (name, def) => {
        if (name === "metrics") command = def.handler;
      },
      registerEntryRenderer: (type, fn) => renderers.set(type, fn),
      appendEntry: (type, data) => appended.push({ type, data }),
      getSettings: () => ({ "pi-metrics": { style: "normal", colorMode } }),
      reload: async () => {},
      log: () => {},
    };
    const ctx = {
      isIdle: () => false,
      hasUI: false,
      mode: "print",
      ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
    };
    await factory(pi);
    await handlers.get("session_start")({}, ctx);

    for (const target of TTFT_BASE) {
      const prefill = target * factor - 1;
      const message = {
        role: "assistant", provider: "test", model: "test-model", api: "openai-completions",
        timestamp: now(), durationMs: prefill + 400, stopReason: "stop", content: [],
        usage: { input: 10, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      advance(5);
      await handlers.get("before_provider_request")({}, ctx);
      advance(1);
      await handlers.get("after_provider_response")({}, ctx);
      await handlers.get("message_start")({ message }, ctx);
      advance(prefill);
      await handlers.get("message_update")(
        { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(10), partial: message } },
        ctx,
      );
      advance(400);
      await handlers.get("message_end")({ message }, ctx);
      advance(100);
    }

    await command("report", ctx);
    const entry = appended.find((e) => e.data?.kind === "report");
    assert.ok(entry, "expected the report command to append an entry");
    const renderer = renderers.get("pi-metrics");
    assert.ok(renderer, "expected an entry renderer");
    return renderer({ data: entry.data }, {}, theme).render(220).map(String);
  });
}

/** Every `ESC[38;2;r;g;bm TEXT ESC[39m` run, as { text, hue }. */
function colourRuns(lines) {
  const out = [];
  const re = /\x1b\[38;2;(\d+);(\d+);(\d+)m([^\x1b]*)\x1b\[39m/g;
  for (const line of lines) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      out.push({ text: m[4].trim(), hue: colorToOkhsl(rgbColor(Number(m[1]), Number(m[2]), Number(m[3]))).h });
    }
  }
  return out;
}

const failures = [];
const expectedAt = (factor) => TTFT_BASE.map((t) => `${t * factor}ms`);

/** Hue of each TTFT cell, in ascending TTFT order. */
function ttftHues(runs, factor = 1) {
  const expected = expectedAt(factor);
  return expected.map((text) => {
    const run = runs.find((r) => r.text === text);
    assert.ok(run, `no coloured TTFT cell for ${text}; got ${JSON.stringify(runs.map((r) => r.text))}`);
    return run.hue;
  });
}

for (const colorMode of ["calm", "vivid"]) {
  const expected = expectedAt(1);
  const hues = ttftHues(colourRuns(await renderedReport(colorMode)));

  // Slower must never be cooler: severity rises with latency, and hue falls with severity.
  for (let i = 1; i < hues.length; i++) {
    if (hues[i] > hues[i - 1] + 1e-9) {
      failures.push(
        `${colorMode}: hue rose with latency — ${expected[i - 1]} is ${hues[i - 1].toFixed(0)}° ` +
          `but the slower ${expected[i]} is ${hues[i].toFixed(0)}°; the ramp crosses itself`,
      );
    }
  }

  const span = Math.max(...hues) - Math.min(...hues);
  if (span < 100) failures.push(`${colorMode}: the ramp spans only ${span.toFixed(0)}° — not a hue gradient`);

  // Ordering alone is not enough: a clamped below-median half keeps its order (all one colour).
  const medianAt = MEDIAN_AT;
  if (Math.max(...hues.slice(0, medianAt + 1)) - hues[medianAt] < 15) {
    failures.push(
      `${colorMode}: nothing below the median is cooler than it — the fastest call is ` +
        `${hues[0].toFixed(0)}° and the median call is ${hues[medianAt].toFixed(0)}°. The cool end is unreachable.`,
    );
  }

  // Relative, not absolute: quadrupling every latency must not change a single colour, because
  // severity is a *ratio* to the session's own median. With absolute thresholds it would.
  const scaled = ttftHues(colourRuns(await renderedReport(colorMode, 4)), 4);
  for (let i = 0; i < hues.length; i++) {
    if (Math.abs(hues[i] - scaled[i]) > 0.5) {      failures.push(
        `${colorMode}: colour is not relative — ${expected[i]} at scale 4 is ${scaled[i].toFixed(0)}° ` +
          `but was ${hues[i].toFixed(0)}°, so the ramp depends on absolute magnitude`,
      );
    }
  }
}

/* ----------------------------------------------------------------- the HUD ---- */

/** Per-character foreground hue of a rendered line; `null` where the cell is uncoloured. */
function cellHues(line) {
  const cells = [];
  const re = /\x1b\[([0-9;]*)m([^\x1b]*)/g;
  let match;
  let fg = null;
  while ((match = re.exec(line))) {
    const code = match[1];
    if (code.startsWith("38;2;")) {
      const [r, g, b] = code.split(";").slice(2).map(Number);
      const { h, s } = colorToOkhsl(rgbColor(r, g, b));
      fg = s >= 0.15 ? h : null;
    } else if (code === "39" || code === "0" || code === "2") fg = null;
    for (const _ of match[2]) cells.push(fg);
  }
  return cells;
}

/**
 * How far apart the hues are in the topmost occupied row and the bottom row of one column.
 * The fill is anchored on each bar, so a bar tall enough to span two rows is a gradient and the
 * two differ; a flat one-colour fill reads 0 here.
 */
function columnContrast(rows) {
  const bottom = rows[rows.length - 1];
  for (const top of rows.slice(0, -1)) {
    for (let i = 0; i < Math.min(top.length, bottom.length); i++) {
      if (top[i] !== null && bottom[i] !== null) return Math.abs(top[i] - bottom[i]);
    }
  }
  return undefined;
}

/** One chart's rows, keeping only the cells left of the `│` column divider. */
function leftOfDivider(rows, lines) {
  return rows.map((cells, i) => {
    const divider = lines[i].replace(/\x1b\[[0-9;]*m/g, "").indexOf("│");
    return divider > 0 ? cells.slice(0, divider) : cells;
  });
}

async function renderedHud(colorMode, graphStyle) {
  return withVirtualClock(async ({ now, advance }) => {
    const handlers = new Map();
    let widgetFactory;
    const pi = {
      on: (name, fn) => handlers.set(name, fn),
      registerCommand: () => {},
      registerEntryRenderer: () => {},
      appendEntry: () => {},
      getSettings: () => ({ "pi-metrics": { style: "normal", graphStyle, tpsWindow: 10, colorMode } }),
      reload: async () => {},
      log: () => {},
    };
    const ctx = {
      isIdle: () => false,
      hasUI: true,
      mode: "tui",
      ui: {
        notify: () => {},
        setStatus: () => {},
        setWidget: (_k, content) => {
          if (typeof content === "function") widgetFactory = content;
        },
      },
    };
    await factory(pi);
    await handlers.get("session_start")({}, ctx);

    // Throughput is ~1000/itl tok/s and TTFT is ~prefill, so both axes span their whole ramp.
    const calls = [
      [12, 20], [18, 40], [28, 120], [45, 200], [70, 320], [15, 500], [22, 800],
      [12, 30], [18, 60], [28, 150], [45, 240], [70, 400], [15, 600],
    ];
    for (const [itl, prefill] of calls) {
      const message = {
        role: "assistant", provider: "test", model: "test-model", api: "openai-completions",
        timestamp: now(), durationMs: prefill + 400, stopReason: "stop", content: [],
        usage: { input: 10, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      advance(90);
      await handlers.get("before_provider_request")({}, ctx);
      advance(1);
      await handlers.get("after_provider_response")({}, ctx);
      await handlers.get("message_start")({ message }, ctx);
      advance(prefill);
      for (let k = 0; k < 40; k++) {
        await handlers.get("message_update")(
          { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(4), partial: message } },
          ctx,
        );
        advance(itl);
      }
      advance(20);
      await handlers.get("message_end")({ message }, ctx);
      advance(100);
    }
    advance(400);
    assert.ok(widgetFactory, "the extension must register a widget");
    return widgetFactory({ requestRender: () => {} }, theme).render(100).map(String);
  });
}

for (const colorMode of ["calm", "vivid"]) {
  // Both renderers: the histogram is drawn by `renderBrailleChart` or `renderAreaChart`
  // depending on `graphStyle`, and each has its own fill call site.
  for (const graphStyle of ["braille", "block"]) {
    const lines = await renderedHud(colorMode, graphStyle);
    const text = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

    // A chart-rendering guard that landed with the colour work: the block renderer accepted
    // `thresholds` and never read them, so `graphStyle: "block"` drew no target lines at all.
    if (graphStyle === "block") {
      const tpsAt = text.findIndex((line) => /TPS tok\/s/.test(line));
      const tpsRows = text.slice(tpsAt + 1, tpsAt + 6);
      if (!tpsRows.some((row) => row.includes("─"))) {
        failures.push(`${colorMode}/block: the TPS chart draws no target lines, so renderAreaChart is ignoring \`thresholds\``);
      }
    }

    const histAt = text.findIndex((line) => /TTFT ms/.test(line));
    assert.ok(histAt >= 0, `the ${graphStyle} HUD must contain the TTFT/ITL charts`);
    const histRows = lines.slice(histAt + 1, histAt + 5);
    // Only the left (TTFT) chart: the two charts have different medians, so one row legitimately
    // holds two different hues.
    const contrast = columnContrast(leftOfDivider(histRows.map(cellHues), histRows));
    if (contrast === undefined || contrast < 30) {
      failures.push(
        `${colorMode}/${graphStyle}: the TTFT fill is not a gradient — the top and bottom of a column ` +
          `differ by ${contrast === undefined ? "no shared filled column" : `${contrast.toFixed(0)}°`}`,
      );
    }
  }
}

/* ------------------------------------------------------- relative, not absolute ---- */

/** Hue of the first styled run on a line whose text matches `pattern`. */
function runHue(line, pattern) {
  const re = /\x1b\[38;2;(\d+);(\d+);(\d+)m([^\x1b]*)\x1b\[39m/g;
  let m;
  while ((m = re.exec(line))) {
    if (pattern.test(m[4].trim())) return colorToOkhsl(rgbColor(Number(m[1]), Number(m[2]), Number(m[3]))).h;
  }
  return undefined;
}

/**
 * Renders row 1 with a call still streaming, after five finished calls at the same speed.
 * `itlMs` sets the speed (~1000/itl tok/s), so the live rate sits at the session's own median.
 *
 * The delta count is chosen to give every call the same ~16 s duration, so both the slow and the
 * fast variant produce the same *shape* of per-second buckets and the median is a fair baseline
 * in both. Calls are rendered as they finish, because the per-second history is only flushed by
 * a render — without that the session never accumulates a median and the cold-start fallback is
 * what gets measured.
 */
async function renderedLiveItl(colorMode, itlMs) {
  return withVirtualClock(async ({ now, advance }) => {
    const handlers = new Map();
    let widgetFactory;
    const pi = {
      on: (name, fn) => handlers.set(name, fn),
      registerCommand: () => {}, registerEntryRenderer: () => {}, appendEntry: () => {},
      getSettings: () => ({ "pi-metrics": { style: "normal", colorMode } }),
      reload: async () => {}, log: () => {},
    };
    const ctx = {
      isIdle: () => false, hasUI: true, mode: "tui",
      ui: {
        notify: () => {}, setStatus: () => {},
        setWidget: (_k, content) => { if (typeof content === "function") widgetFactory = content; },
      },
    };
    await factory(pi);
    await handlers.get("session_start")({}, ctx);
    const render = () => widgetFactory({ requestRender: () => {} }, theme).render(100);

    const DELTAS = Math.round(16_000 / itlMs);
    const start = async (live) => {
      const message = {
        role: "assistant", provider: "test", model: "test-model", api: "openai-completions",
        timestamp: now(), durationMs: live ? undefined : DELTAS * itlMs, stopReason: "stop", content: [],
        usage: live ? undefined : { input: 10, output: DELTAS, cacheRead: 0, cacheWrite: 0, totalTokens: DELTAS + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      advance(20);
      await handlers.get("before_provider_request")({}, ctx);
      advance(1);
      await handlers.get("after_provider_response")({}, ctx);
      await handlers.get("message_start")({ message }, ctx);
      advance(100);
      for (let k = 0; k < DELTAS; k++) {
        await handlers.get("message_update")(
          { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "xxxx", partial: message } },
          ctx,
        );
        advance(itlMs);
      }
      if (live) return;
      advance(20);
      await handlers.get("message_end")({ message }, ctx);
      advance(50);
      render(); // flushes this call's seconds into the session history
    };

    for (let i = 0; i < 5; i++) await start(false);
    await start(true);
    const lines = render().map(String);
    const row1 = lines.find((line) => /tok\/s/.test(line.replace(/\x1b\[[0-9;]*m/g, "")));
    const hue = row1 === undefined ? undefined : runHue(row1, /tok\/s$/);
    assert.ok(hue !== undefined, "row 1 must colour the live tok/s figure");
    return hue;
  });
}

for (const colorMode of ["calm", "vivid"]) {
  // ~12 tok/s and ~120 tok/s — a 10x difference in absolute speed, same shape, and the live
  // rate sits at each session's own median. Relative colouring must give the *same* colour;
  // absolute thresholds would put the slow one in the warm end and the fast one at the cool end,
  // which is the bug this pins. It also covers the cold start: five finished calls is past the
  // `MIN_RATE_SAMPLES` threshold, so the session median is what is being used.
  const slow = await renderedLiveItl(colorMode, 83);
  const fast = await renderedLiveItl(colorMode, 8.3);
  if (Math.abs(slow - fast) > 8) {
    failures.push(
      `${colorMode}: colour is not relative — the same relative speed renders ${slow.toFixed(0)}° at ` +
        `~12 tok/s but ${fast.toFixed(0)}° at ~120 tok/s, so the ramp is keyed to absolute magnitude`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("all colour-ramp assertions passed (order, reach, scale-invariance, gradient fill)");
