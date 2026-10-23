/**
 * The TPS headline is window-scoped; the chart's ceiling is not.
 *
 * The title's `avg` and `p95` used to be computed over the whole session while the bars
 * beside them were drawn from the last `tpsWindow` seconds. The two got further apart as a
 * session grew: a session mean absorbs a live degradation (an hour of history barely moves
 * for a bad minute), and a session p95 stays pinned by one old burst forever, so neither
 * could answer "how is it going right now?" — which is the one question a live HUD exists
 * to answer. They are now computed over the window the chart is actually drawing.
 *
 * The ceiling deliberately stays session-wide. A windowed ceiling would rescale every bar
 * each time history rolls out of the window, which is exactly the axis instability the p90
 * work removed (`scripts/hud-layout.test.mjs` pins that separately).
 *
 * The check is differential: the same session is rendered with a window that excludes an
 * early fast burst, and with a window that includes everything. The measurement must move
 * with the window; the ceiling must not move at all. A single run could not tell a windowed
 * statistic from a session one without hard-coding the expected arithmetic.
 *
 * Rate R for one second is `R` four-character deltas 1000/R ms apart, so each per-second
 * bucket is exactly R and the second is exactly 1000 ms long. `usage.output` reports the
 * true total, so the character estimate is corrected to the same figure and the buckets are
 * exact — the test measures the windowing, not the estimate.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { theme, plain } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Eight seconds of a fast provider, then twenty of a slow one. The slow phase is longer
 * than `tpsWindow`'s 10-second floor on purpose, so a "tail" window can be drawn without
 * the clamp pulling fast seconds back in.
 */
const RATES = [...Array(8).fill(200), ...Array(20).fill(25)];

/** Render the HUD over a virtual clock with one `tpsWindow` setting, return its TPS line. */
async function tpsLineForWindow(tpsWindow) {
  let t = 1_000_000;
  const realNow = performance.now;
  const realDate = Date.now;
  performance.now = () => t;
  Date.now = () => 1_700_000_000_000 + (t - 1_000_000);
  try {
    const handlers = new Map();
    let captured;
    const pi = {
      on: (n, f) => handlers.set(n, f),
      registerCommand: () => {},
      registerEntryRenderer: () => {},
      appendEntry: () => {},
      getSettings: () => ({ "pi-metrics": { style: "normal", graphStyle: "braille", tpsWindow } }),
      reload: async () => {},
      log: () => {},
    };
    const ctx = {
      isIdle: () => false,
      hasUI: true,
      mode: "tui",
      ui: { notify: () => {}, setStatus: () => {}, setWidget: (_k, c) => { captured = c; } },
    };
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;
    await factory(pi);
    const fire = (n, e) => handlers.get(n)(e, ctx);
    await fire("session_start", {});

    const message = {
      role: "assistant", provider: "test", model: "test-model", api: "openai-completions",
      timestamp: Date.now(), content: [], stopReason: "stop",
    };
    t += 90; fire("before_provider_request", {});
    t += 1; fire("after_provider_response", {});
    fire("message_start", { message });
    t += 300;
    for (const rate of RATES) {
      const itl = 1_000 / rate;
      for (let k = 0; k < rate; k++) {
        fire("message_update", { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "xxxx", partial: message } });
        t += itl;
      }
    }
    t += 20;
    message.usage = {
      input: 10,
      output: RATES.reduce((a, b) => a + b, 0),
      cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    message.durationMs = 28_000;
    fire("message_end", { message });
    t += 200;
    captured({ requestRender: () => {} }, theme).render(100); // flush the per-second history
    const lines = captured({ requestRender: () => {} }, theme).render(100).map(plain);
    return lines.find((line) => /TPS.*tok\/s/.test(line)) ?? "";
  } finally {
    performance.now = realNow;
    Date.now = realDate;
  }
}

const numberFor = (line, label) => {
  const m = line.match(new RegExp(`${label}\\s+(\\d+)`));
  return m ? Number(m[1]) : undefined;
};

// 1000s comfortably covers the whole 28s session; 10s is the floor and here covers only
// the slow tail, because the slow phase is 20s long.
const full = await tpsLineForWindow(1000);
const tail = await tpsLineForWindow(10);

const failures = [];
const check = (value, what) => {
  if (value === undefined) failures.push(`could not read ${what} from the TPS line`);
  return value;
};

console.log(`full window: ${full.trim()}`);
console.log(`tail window: ${tail.trim()}`);

const fullAvg = check(numberFor(full, "avg"), "avg (full window)");
const tailAvg = check(numberFor(tail, "avg"), "avg (tail window)");
const fullP95 = check(numberFor(full, "p95"), "p95 (full window)");
const tailP95 = check(numberFor(tail, "p95"), "p95 (tail window)");
const fullMax = check(/max (\d+)/.exec(full)?.[1] === undefined ? undefined : Number(/max (\d+)/.exec(full)[1]), "max (full window)");
const tailMax = check(/max (\d+)/.exec(tail)?.[1] === undefined ? undefined : Number(/max (\d+)/.exec(tail)[1]), "max (tail window)");

assert.equal(failures.length, 0, `\n${failures.join("\n")}`);

// The measurement must follow the window. The session is 200 tok/s for its first eight
// seconds and 25 for its remaining twenty, so a ten-second window over the slow tail has to
// be well below the full-session figure — that is the whole point of the change.
if (!(tailAvg < fullAvg)) {
  failures.push(`avg did not narrow to the window: tail window ${tailAvg} is not below full ${fullAvg}`);
}
if (!(tailP95 < fullP95)) {
  failures.push(`p95 did not narrow to the window: tail window ${tailP95} is not below full ${fullP95}`);
}
// And it must be near the slow tail's own rate rather than merely lower.
if (tailAvg < 20 || tailAvg > 30) {
  failures.push(`avg over the slow tail should be near 25 tok/s, got ${tailAvg}`);
}
if (tailP95 > 30) {
  failures.push(`p95 over the slow tail should be near 25 tok/s, got ${tailP95}`);
}
// The ceiling is a scale, not a headline, and must not move with the window.
if (tailMax !== fullMax) {
  failures.push(`the auto ceiling moved with the window: ${fullMax} full vs ${tailMax} tail — the axis must stay session-scoped`);
}

assert.equal(failures.length, 0, `\n${failures.join("\n")}`);

console.log(`\navg: full ${fullAvg} -> tail ${tailAvg} (windowed)`);
console.log(`p95: full ${fullP95} -> tail ${tailP95} (windowed)`);
console.log(`max: full ${fullMax} -> tail ${tailMax} (session-scoped, unchanged)`);
console.log("all TPS window assertions passed");
