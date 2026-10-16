/**
 * The colour ramp has to stay *monotone in hue*.
 *
 * Colour is the HUD's second read on value, so its order must match the value's order or the
 * chart argues with itself. This has now been wrong twice:
 *
 *   1. The anchors were mixed toward `dim` in Oklch, which pushed `success` past green into
 *      cyan and pulled `warning` back to greener-than-success, so the ramp crossed hues in the
 *      wrong order and the "warning" band read healthier than the "good" one.
 *   2. `latencySeverity` clamped to [0, 1], so *every* latency at or below the session median
 *      was exactly severity 0. The cool half of the ramp was unreachable: the histogram charts
 *      could never show a hue gradient at all, and adding a cool `fast` anchor changed nothing
 *      about them. Only the TPS chart, whose scale does reach -1, was affected.
 *
 * These assertions drive the real report renderer, read the colour off the TTFT cells, and
 * check that hue falls as TTFT rises — and that the run spans enough of the ramp to actually
 * be a gradient rather than one flat colour.
 *
 * A virtual clock is needed because TTFT is measured with `performance.now()`, and real elapsed
 * time inside a test is both tiny and jittery, so it cannot produce a controlled spread.
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

/** TTFT ends up exactly `prefill + 1` ms, so the ratios to the median are known up front. */
const PREFILLS = [20, 60, 120, 200, 300, 500, 900];

async function renderedReport(colorMode) {
  let t = 1_000_000;
  const realNow = performance.now;
  const realDate = Date.now;
  performance.now = () => t;
  Date.now = () => 1_700_000_000_000 + (t - 1_000_000);
  try {
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

    for (const prefill of PREFILLS) {
      const message = {
        role: "assistant",
        provider: "test",
        model: "test-model",
        api: "openai-completions",
        timestamp: Date.now(),
        durationMs: prefill + 400,
        stopReason: "stop",
        content: [],
        usage: { input: 10, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      t += 5;
      await handlers.get("before_provider_request")({}, ctx);
      t += 1;
      await handlers.get("after_provider_response")({}, ctx);
      await handlers.get("message_start")({ message }, ctx);
      t += prefill;
      await handlers.get("message_update")(
        { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(10), partial: message } },
        ctx,
      );
      t += 400;
      await handlers.get("message_end")({ message }, ctx);
      t += 100;
    }

    await command("report", ctx);
    const entry = appended.find((e) => e.data?.kind === "report");
    assert.ok(entry, "expected the report command to append an entry");
    const renderer = renderers.get("pi-metrics");
    assert.ok(renderer, "expected an entry renderer");
    return renderer({ data: entry.data }, {}, theme).render(220).map((line) => String(line));
  } finally {
    performance.now = realNow;
    Date.now = realDate;
  }
}

/** Every `ESC[38;2;r;g;bm TEXT ESC[39m` run, as { text, hue }. */
function colourRuns(lines) {
  const out = [];
  const re = /\x1b\[38;2;(\d+);(\d+);(\d+)m([^\x1b]*)\x1b\[39m/g;
  for (const line of lines) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) out.push({ text: m[4].trim(), hue: colorToOkhsl(rgbColor(Number(m[1]), Number(m[2]), Number(m[3]))).h });
  }
  return out;
}

const expected = PREFILLS.map((p) => `${p + 1}ms`);
const failures = [];

for (const colorMode of ["calm", "vivid"]) {
  const runs = colourRuns(await renderedReport(colorMode));
  const ttftHues = expected.map((text) => {
    const run = runs.find((r) => r.text === text);
    assert.ok(run, `${colorMode}: no coloured TTFT cell for ${text}; got ${JSON.stringify(runs.map((r) => r.text))}`);
    return run.hue;
  });

  // TTFT only ever increases across PREFILLS, so severity only increases, so hue must fall.
  for (let i = 1; i < ttftHues.length; i++) {
    if (ttftHues[i] > ttftHues[i - 1] + 1e-9) {
      failures.push(
        `${colorMode}: hue rose with latency: ${expected[i - 1]} is ${ttftHues[i - 1].toFixed(0)}° but the slower ` +
          `${expected[i]} is ${ttftHues[i].toFixed(0)}° — the ramp crosses itself`,
      );
    }
  }

  const span = Math.max(...ttftHues) - Math.min(...ttftHues);
  if (span < 100) {
    failures.push(
      `${colorMode}: the ramp spans only ${span.toFixed(0)}° of hue across ${expected[0]}..${expected.at(-1)} ` +
        `(${ttftHues.map((h) => h.toFixed(0)).join(",")}) — that is not a hue gradient`,
    );
  }
  if (Math.min(...ttftHues) > 60) {
    failures.push(`${colorMode}: the slowest call is still ${Math.min(...ttftHues).toFixed(0)}°, i.e. never reaches the warm end`);
  }

  // Ordering alone is not enough: a clamped below-median half keeps its order (they are all the
  // same colour). `200ms` is the median of PREFILLS, so the calls before it must be measurably
  // cooler than it. This is the assertion that fails when `latencySeverity` stops at 0.
  const medianAt = PREFILLS.indexOf(200);
  const coolest = Math.max(...ttftHues.slice(0, medianAt + 1));
  if (coolest - ttftHues[medianAt] < 15) {
    failures.push(
      `${colorMode}: nothing below the median is cooler than the median — the fastest call is ` +
        `${ttftHues[0].toFixed(0)}° and the median call (${expected[medianAt]}) is ${ttftHues[medianAt].toFixed(0)}°. ` +
        `The cool end of the ramp is unreachable for latency.`,
    );
  }
}

/**
 * Per-character foreground hue of a rendered line; `null` where the cell carries no colour.
 * Dim greys (baseline dots, reference lines) are dropped: they are not the ramp.
 */
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
 * The widest hue spread within any single chart row.
 *
 * This is the signature of *where* the gradient runs. The fill must be a function of the row
 * (the magnitude at that height), so every coloured cell in one row shares a hue and the spread
 * is 0. Colour taken from each sample's own value would instead vary across the row. The row
 * with the most cells is used because it discriminates best: a row holding only the two or three
 * tallest bars can look uniform under either scheme.
 */
function widestRowSpread(rows) {
  let widest;
  for (const cells of rows) {
    const hues = cells.filter((cell) => cell !== null);
    if (!widest || hues.length > widest.length) widest = hues;
  }
  if (!widest || widest.length < 2) return undefined;
  return Math.max(...widest) - Math.min(...widest);
}

/** One chart's rows, keeping only the cells left of the `│` column divider. */
function leftOfDivider(rows, lines) {
  return rows.map((cells, i) => {
    const divider = lines[i].replace(/\x1b\[[0-9;]*m/g, "").indexOf("│");
    return divider > 0 ? cells.slice(0, divider) : cells;
  });
}

async function renderedHud(colorMode, graphStyle) {
  let t = 1_000_000;
  const realNow = performance.now;
  const realDate = Date.now;
  performance.now = () => t;
  Date.now = () => 1_700_000_000_000 + (t - 1_000_000);
  try {
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
        timestamp: Date.now(), durationMs: prefill + 400, stopReason: "stop", content: [],
        usage: { input: 10, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      t += 90;
      await handlers.get("before_provider_request")({}, ctx);
      t += 1;
      await handlers.get("after_provider_response")({}, ctx);
      await handlers.get("message_start")({ message }, ctx);
      t += prefill;
      for (let k = 0; k < 40; k++) {
        await handlers.get("message_update")(
          { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(4), partial: message } },
          ctx,
        );
        t += itl;
      }
      t += 20;
      await handlers.get("message_end")({ message }, ctx);
      t += 100;
    }
    t += 400;
    assert.ok(widgetFactory, "the extension must register a widget");
    return widgetFactory({ requestRender: () => {} }, theme).render(100).map(String);
  } finally {
    performance.now = realNow;
    Date.now = realDate;
  }
}

for (const colorMode of ["calm", "vivid"]) {
  // Both renderers: the histogram is drawn by `renderBrailleChart` or `renderAreaChart`
  // depending on `graphStyle`, and each has its own colour call site.
  for (const graphStyle of ["braille", "block"]) {
    const lines = await renderedHud(colorMode, graphStyle);
    const text = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

    const histAt = text.findIndex((line) => /TTFT ms/.test(line));
    assert.ok(histAt >= 0, `the ${graphStyle} HUD must contain the TTFT/ITL charts`);
    const histRows = lines.slice(histAt + 1, histAt + 5);
    // Only the left (TTFT) chart: the two charts have different medians, so a genuine vertical
    // gradient gives them different hues in the same row.
    const histSpread = widestRowSpread(leftOfDivider(histRows.map(cellHues), histRows));
    if (histSpread === undefined || histSpread > 0.5) {
      failures.push(
        `${colorMode}/${graphStyle}: the TTFT fill is not a vertical gradient — the widest row ` +
          `spans ${histSpread === undefined ? "too few coloured cells to tell" : `${histSpread.toFixed(0)}° of hue`}, ` +
          `so colour is following the sample rather than the row`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("all colour-ramp assertions passed (hue falls monotonically with latency, in calm and vivid)");
