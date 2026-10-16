/**
 * Verifies the pre-0.1.0 `rate*` settings keys are still honoured.
 *
 * The keys were renamed to `tps*` (TPS is what the ecosystem calls this metric). A rename
 * that silently ignores an existing user's config would degrade their HUD with no warning,
 * so the alias path is asserted rather than assumed: the legacy key must take effect, and
 * the new key must win when both are present.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { theme, plain } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Render the HUD with a given pi-metrics settings object and return the plain lines. */
async function hudWith(metricsSettings) {
  const handlers = new Map();
  let captured;
  let commandHandler;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, def) => {
      if (name === "metrics") commandHandler = def.handler;
    },
    registerEntryRenderer: () => {},
    appendEntry: () => {},
    getSettings: () => ({ "pi-metrics": metricsSettings }),
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
      setWidget: (_k, factory) => {
        captured = factory;
      },
    },
  };
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;
  await factory(pi);

  // One call so the pressure bar and thresholds have data to render with.
  const msg = {
    role: "assistant",
    provider: "test",
    model: "test-model",
    api: "openai-completions",
    timestamp: Date.now(),
    durationMs: 2000,
    stopReason: "stop",
    content: [],
    usage: { input: 0, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const fire = (n, e) => handlers.get(n)(e, ctx);
  await fire("session_start", {});
  await commandHandler("on", ctx);
  await fire("before_provider_request", {});
  await fire("message_start", { message: msg });
  for (let i = 0; i < 30; i++) {
    await fire("message_update", { message: msg, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(10), partial: msg } });
  }
  await fire("message_end", { message: msg });
  await commandHandler("on", ctx);

  return captured({ requestRender: () => {} }, theme).render(100).map(plain);
}

const thresholdLine = (lines) => lines.find((l) => l.includes("good ") && l.includes("fast ")) ?? "";

// Legacy keys only.
const legacy = thresholdLine(await hudWith({ rateGood: 7, rateBad: 3, rateFast: 11 }));
assert.ok(/good 7\b/.test(legacy), `legacy rateGood ignored: ${legacy.trim()}`);
assert.ok(/bad 3\b/.test(legacy), `legacy rateBad ignored: ${legacy.trim()}`);
assert.ok(/fast 11\b/.test(legacy), `legacy rateFast ignored: ${legacy.trim()}`);
console.log("legacy rate* keys still applied:", legacy.trim().replace(/\s+/g, " "));

// New keys only.
const modern = thresholdLine(await hudWith({ tpsGood: 8, tpsBad: 4, tpsFast: 12 }));
assert.ok(/good 8\b/.test(modern), `tpsGood ignored: ${modern.trim()}`);
assert.ok(/fast 12\b/.test(modern), `tpsFast ignored: ${modern.trim()}`);
console.log("new tps* keys applied:      ", modern.trim().replace(/\s+/g, " "));

// Both present: the new key must win.
const both = thresholdLine(await hudWith({ rateGood: 7, tpsGood: 9 }));
assert.ok(/good 9\b/.test(both), `new key must win over the alias: ${both.trim()}`);
console.log("new key wins when both set: ", both.trim().replace(/\s+/g, " "));

console.log("\nall settings-alias assertions passed");
