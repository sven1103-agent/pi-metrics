/**
 * Layout regressions in the chart title.
 *
 * The title is the one line where two independent strings are joined and then hard-truncated
 * by the widget, so it is the easiest place for a change to produce a run-on. A real bug
 * shipped during development: at ~66 columns the axis text `120s · max 500 auto` was
 * appended straight after the stats, rendering as
 *
 *   TPS tok/s · fast 100 · avg 60 · p95 300 120s · max 500 a…
 *
 * i.e. the window looked like another statistic, and the axis was itself cut. These
 * assertions pin the fix: the axis (window + ceiling) must always be present and whole,
 * and the stats are what give way.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { theme, plain } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const jiti = createJiti(import.meta.url, { interopDefault: true });
const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;

async function renderAt(width) {
  const handlers = new Map();
  let captured;
  let command;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, def) => {
      if (name === "metrics") command = def.handler;
    },
    registerEntryRenderer: () => {},
    appendEntry: () => {},
    getSettings: () => ({ "pi-metrics": { style: "normal", tpsWindow: 120 } }),
    reload: async () => {},
    log: () => {},
  };
  const ctx = {
    isIdle: () => false,
    hasUI: true,
    mode: "tui",
    ui: { notify: () => {}, setStatus: () => {}, setWidget: (_k, f) => { captured = f; } },
  };
  await factory(pi);
  const fire = (name, event) => handlers.get(name)(event, ctx);
  const message = {
    role: "assistant",
    provider: "test",
    model: "test-model",
    api: "openai-completions",
    timestamp: Date.now(),
    durationMs: 5_000,
    stopReason: "stop",
    content: [],
    usage: { input: 0, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 300, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  await fire("session_start", {});
  await command("on", ctx);
  await fire("before_provider_request", {});
  await fire("after_provider_response", {});
  await fire("message_start", { message });
  for (let i = 0; i < 60; i++) {
    await fire("message_update", { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(10), partial: message } });
  }
  await fire("message_end", { message });
  await command("on", ctx);
  return captured({ requestRender: () => {} }, theme).render(width).map(plain);
}

const realWidths = [120, 100, 80, 66, 54, 46];
const failures = [];

for (const width of realWidths) {
  const lines = await renderAt(width);
  const title = lines.find((line) => /TPS/.test(line) && /tok\/s/.test(line));
  if (!title) {
    failures.push(`${width}: no TPS title line found`);
    continue;
  }
  // The axis is the contract: the window in seconds and the ceiling must both be there.
  if (!/\d+s\s+·\s+max\s+\d+/.test(title)) failures.push(`${width}: axis missing or split: ${JSON.stringify(title.trim())}`);
  // And nothing may exceed the terminal, or Pi would re-wrap and break the frame.
  if (title.length > width) failures.push(`${width}: title overflows to ${title.length} cols: ${JSON.stringify(title.trim())}`);
  // The run-on signature: a truncated axis, i.e. `max` followed by an ellipsis.
  if (/max\s+\d+\s*a?…/.test(title)) failures.push(`${width}: axis was truncated: ${JSON.stringify(title.trim())}`);
}

assert.equal(failures.length, 0, `\n${failures.join("\n")}`);

/* ------------------------------------------------ the ceiling on an outlier ---- */

/**
 * The automatic ceiling must not chase a single outlier second.
 *
 * p98 is not a robust statistic at the sample counts this chart has — `percentile` takes the
 * nearest index, so p98 of ten seconds *is* the tenth — and one burst moved the ceiling and
 * rescaled every other bar with it. p95 does not fix that either: it is still the maximum until
 * about a dozen samples, and still returns an outlier when there are three in thirty seconds.
 * The assertion is that *growing the outlier does not move the axis at all*, which p98 and p95
 * both fail and p90 passes. A measured 9x150-plus-one-900 session went from a flat line along the
 * bottom (ceiling 1500) to a readable chart (200).
 *
 * Rate R for one second is `R` four-character deltas 1000/R ms apart, so each per-second bucket
 * is exactly R and the second is exactly 1000 ms long.
 */
async function axisForOutlier(burst) {
  const rates = [150, 150, 150, 150, 150, 150, 150, 150, 150, burst];
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
      registerCommand: () => {}, registerEntryRenderer: () => {}, appendEntry: () => {},
      getSettings: () => ({ "pi-metrics": { style: "normal", graphStyle: "braille", tpsWindow: 10 } }),
      reload: async () => {}, log: () => {},
    };
    const ctx = {
      isIdle: () => false, hasUI: true, mode: "tui",
      ui: { notify: () => {}, setStatus: () => {}, setWidget: (_k, c) => { captured = c; } },
    };
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
    for (const rate of rates) {
      const itl = 1_000 / rate;
      for (let k = 0; k < rate; k++) {
        fire("message_update", { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "xxxx", partial: message } });
        t += itl;
      }
    }
    t += 20;
    message.usage = { input: 10, output: rates.reduce((a, b) => a + b, 0), cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    message.durationMs = 10_000;
    fire("message_end", { message });
    t += 200;
    captured({ requestRender: () => {} }, theme).render(100); // flush the per-second history
    const lines = captured({ requestRender: () => {} }, theme).render(100).map(plain);
    return /max (\d+) auto/.exec(lines.find((line) => /TPS/.test(line) && /tok\/s/.test(line)))?.[1];
  } finally {
    performance.now = realNow;
    Date.now = realDate;
  }
}

const typicalBurst = await axisForOutlier(900);
const hugeBurst = await axisForOutlier(9000);
if (typicalBurst === undefined || hugeBurst === undefined) {
  failures.push(`could not read the automatic ceiling (${typicalBurst} / ${hugeBurst})`);
} else if (typicalBurst !== hugeBurst) {
  failures.push(
    `the automatic ceiling chases the outlier: a 900 tok/s burst gives max ${typicalBurst} but a ` +
      `9000 tok/s burst gives max ${hugeBurst}, so one second rescales every other bar`,
  );
}
assert.equal(failures.length, 0, `\n${failures.join("\n")}`);

for (const width of realWidths) {
  const title = (await renderAt(width)).find((line) => /TPS/.test(line) && /tok\/s/.test(line));
  console.log(`${String(width).padStart(3)}: ${title.trim()}`);
}
console.log("\nall HUD layout assertions passed");
