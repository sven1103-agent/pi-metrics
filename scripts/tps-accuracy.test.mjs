/**
 * Differential test: proves the TPS chart uses the provider's real token count rather
 * than the character estimate.
 *
 * Two identical calls are streamed — same characters, same duration — differing only in
 * whether the provider reports usage. If the correction is applied, the call that reports
 * usage must show strictly higher throughput, by exactly the ratio real/estimated.
 * Comparing two renders is the strongest available check because the chart's buckets live
 * in a closure and cannot be read directly.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));

import { theme, plain } from "./theme.mjs";

/** Fresh extension instance per scenario, since all state lives in the factory closure. */
async function boot() {
  const handlers = new Map();
  let commandHandler;
  let captured;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, def) => {
      if (name === "metrics") commandHandler = def.handler;
    },
    registerEntryRenderer: () => {},
    appendEntry: () => {},
    getSettings: () => ({}),
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
  return { handlers, ctx, getCommand: () => commandHandler, getCaptured: () => captured };
}

function assistant(usageOutput, durationMs = 4000) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    api: "openai-completions",
    timestamp: Date.now(),
    durationMs,
    stopReason: "stop",
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

const CHARS = 800;
const DURATION = 4000;

/** Stream CHARS characters, then render and return the plain-text HUD lines. */
async function scenario(usageOutput) {
  const { handlers, ctx, getCommand, getCaptured } = await boot();
  const fire = (n, e) => handlers.get(n)(e, ctx);
  await fire("session_start", {});
  await getCommand()("on", ctx);

  const msg = assistant(usageOutput, DURATION);
  await fire("before_provider_request", {});
  await fire("message_start", { message: msg });
  for (let sent = 0; sent < CHARS; sent += 10) {
    await fire("message_update", {
      message: msg,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(10), partial: msg },
    });
  }
  await fire("message_end", { message: msg });
  await getCommand()("on", ctx);

  const factory = getCaptured();
  assert.ok(factory, "widget factory must be captured in tui mode");
  const widget = factory({ requestRender: () => {} }, theme);
  return widget.render(100).map(plain);
}

const grab = (lines, pattern) => {
  for (const line of lines) {
    const m = line.match(pattern);
    if (m) return Number(m[1]);
  }
  return undefined;
};

const withUsage = await scenario(400); // real 400 for 800 chars
const withoutUsage = await scenario(0); // no usage → estimate (800/4 = 200)

// The token count is the "<n> tok" that is not "<n> tok/s".
const realTok = grab(withUsage, /(\d+) tok(?!\/s)/);
const estTok = grab(withoutUsage, /(\d+) tok(?!\/s)/);
const realTps = grab(withUsage, /(\d+(?:\.\d+)?) tok\/s/);
const estTps = grab(withoutUsage, /(\d+(?:\.\d+)?) tok\/s/);

console.log(`with usage   : ${realTok} tok, ${realTps} tok/s`);
console.log(`without usage: ${estTok} tok, ${estTps} tok/s`);

assert.equal(realTok, 400, "the recorded token count must be the provider's own");
assert.ok(realTok > estTok, `corrected count (${realTok}) must exceed the estimate (${estTok})`);
assert.ok(realTps > estTps, `corrected rate (${realTps}) must exceed the estimate (${estTps})`);

// The provider's rate must be self-consistent with its token count and the duration.
const expected = 400 / (DURATION / 1000);
assert.ok(
  Math.abs(realTps - expected) / expected < 0.02,
  `provider rate should be ~${expected.toFixed(1)} tok/s, got ${realTps}`,
);

console.log(`\nratio real/estimate = ${(realTok / estTok).toFixed(2)} (expected ~2.00 for divisor 4)`);

// --- provenance tag ---------------------------------------------------------------
// The HUD must say which of the two figures it is showing. This is the difference the
// module docblock promises, and it is the only way a user can tell a provider-reported
// number from a character estimate — without it an estimate reads as authoritative.
const tagOf = (lines) => {
  const line = lines.find((l) => /tok\/s/.test(l)) ?? "";
  const m = line.match(/\((usage|est)\)/);
  return m?.[1];
};
assert.equal(tagOf(withUsage), "usage", `a provider-reported call must be tagged (usage): ${withUsage[1]?.trim()}`);
assert.equal(tagOf(withoutUsage), "est", `a call with no usage must be tagged (est): ${withoutUsage[1]?.trim()}`);
console.log("provenance tag: (usage) when reported, (est) when estimated");

console.log("all TPS-accuracy assertions passed");
