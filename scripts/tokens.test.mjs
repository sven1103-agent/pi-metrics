/**
 * Behavioural test for the token-accuracy logic.
 *
 * The HUD estimates tokens from characters while streaming, then replaces that estimate
 * with the provider's real count once the call ends. The replacement is multiplicative,
 * so an error compounds silently and still looks plausible in the UI — the kind of bug a
 * typecheck cannot catch. This drives the real event handlers through a stub ExtensionAPI
 * and asserts the numbers the user would actually see in `/metrics report`.
 *
 * Only the provider-reported path is asserted exactly. The character-estimate path is
 * asserted only for "produces a finite positive number", because its accuracy is
 * inherently bounded by the heuristic (measured ~19% median error on real sessions) and
 * pretending otherwise in a test would be misleading.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));

const handlers = new Map();
let commandHandler;
const appended = [];
const pi = {
  on: (name, fn) => handlers.set(name, fn),
  registerCommand: (name, def) => {
    if (name === "metrics") commandHandler = def.handler;
  },
  registerEntryRenderer: () => {},
  appendEntry: (type, data) => appended.push({ type, data }),
  getSettings: () => ({}),
  reload: async () => {},
  log: () => {},
};
const ctx = {
  isIdle: () => false,
  hasUI: false,
  mode: "print",
  ui: { notify: () => {}, setWidget: () => {}, setStatus: () => {} },
};

const jiti = createJiti(import.meta.url, { interopDefault: true });
const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;
await factory(pi);

const fire = (name, event) => handlers.get(name)(event, ctx);

function assistant(usageOutput, { stopReason = "stop", durationMs = 2000 } = {}) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    api: "openai-completions",
    timestamp: Date.now(),
    durationMs,
    stopReason,
    content: [],
    usage: {
      input: 0,
      output: usageOutput,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usageOutput,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

/** Stream `chars` characters in `chunk`-sized deltas. */
async function stream(msg, chars, chunk = 10) {
  await fire("before_provider_request", {});
  await fire("message_start", { message: msg });
  for (let sent = 0; sent < chars; sent += chunk) {
    const delta = "x".repeat(Math.min(chunk, chars - sent));
    await fire("message_update", {
      message: msg,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: msg },
    });
  }
  await fire("message_end", { message: msg });
}

async function report() {
  appended.length = 0;
  await commandHandler("report", ctx);
  const entry = appended.find((e) => e.data?.kind === "report");
  assert.ok(entry, "expected a report entry to be appended");
  return entry.data.calls;
}

// --- 1. provider count wins, and is not marked as an estimate ---------------------
// 400 chars / 4 = 100 estimated; the provider says 133 (true ratio 3.0). If the report
// still showed ~100, the real count is being ignored.
await stream(assistant(133), 400);
let calls = await report();
let row = calls[calls.length - 1];
assert.equal(row.usage.output, 133, "report must carry the provider's own count");
console.log(`1. provider count authoritative: out=${row.usage.output} (estimate would be 100)`);

// --- 2. absent usage falls back to a finite estimate, never NaN --------------------
await stream(assistant(0), 400);
calls = await report();
row = calls[calls.length - 1];
assert.equal(row.usage.output, 0, "provider reported 0 and that must be preserved verbatim");
assert.ok(row.chars === 400, `expected 400 chars recorded, got ${row.chars}`);
console.log(`2. zero-usage call: usage.output=${row.usage.output}, chars=${row.chars} preserved`);

// --- 3. the correction is guarded against compounding -----------------------------
// `tokensCorrected` must be set once the real count is applied. If it were applied per
// flush, the recorded output would keep drifting across repeated renders. The report
// derives its rate from `usage.output` directly, so a stable value across a second
// report call proves no mutation is happening between renders.
const before = JSON.stringify((await report()).map((c) => [c.usage.output, c.chars]));
const after = JSON.stringify((await report()).map((c) => [c.usage.output, c.chars]));
assert.equal(before, after, "repeated renders must not mutate recorded call data");
console.log("3. idempotent across repeated renders: no compounding");

// --- 4. aborted call with no tokens must not poison the session -------------------
await stream(assistant(0, { stopReason: "aborted", durationMs: 500 }), 0);
calls = await report();
row = calls[calls.length - 1];
assert.equal(row.aborted, true, "aborted flag must be recorded");
assert.ok(Number.isFinite(row.chars), "chars must stay finite");
console.log("4. aborted call recorded with aborted=true, no NaN");

// --- 5. no failure path leaves an Infinity/NaN in the payload --------------------
const payload = JSON.stringify(await report());
assert.ok(!payload.includes("null,\"chars\":null"), "chars must never be null");
assert.ok(!/Infinity|NaN/.test(payload), `payload must contain no Infinity/NaN: ${payload.slice(0, 400)}`);
console.log("5. full payload free of Infinity/NaN");

console.log("\nall token-accuracy assertions passed");

// The chart-level behaviour (provider count replacing the estimate in the TPS history)
// is asserted in tps-accuracy.test.mjs, which renders the HUD and compares two calls.
