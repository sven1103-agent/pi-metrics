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
for (const width of realWidths) {
  const title = (await renderAt(width)).find((line) => /TPS/.test(line) && /tok\/s/.test(line));
  console.log(`${String(width).padStart(3)}: ${title.trim()}`);
}
console.log("\nall HUD layout assertions passed");
