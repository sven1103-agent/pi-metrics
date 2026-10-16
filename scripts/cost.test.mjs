/**
 * Cost rendering, on the HUD and in the report.
 *
 * `cost` was declared, defaulted and documented for the whole life of the project — but the
 * extension only ever rendered it in `/metrics report` and on the persisted card. The README
 * advertised it as a headline HUD metric ("decode throughput and cost — for one call, and for
 * the session"), so the setting looked wired up while the running HUD showed nothing. A
 * setting that is documented and never displayed is worse than one that does not exist: the
 * user goes looking for the bug in their config.
 *
 * These assertions pin the behaviour that closes that gap:
 *
 *   1. a finished call's cost appears on the HUD's first row,
 *   2. the session total appears in the header and is the sum of the calls,
 *   3. `cost: false` removes both, and
 *   4. a provider that reports nothing shows no `$0.0000`, because that reads as a
 *      measurement rather than as absent data.
 *
 * The total is deliberately a running accumulator, not a sum over `state.calls`: that array
 * is capped at `history` for the HIST timeline, so a session total derived from it would
 * silently start shrinking. Case 5 is that regression.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { theme, plain } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { interopDefault: true });
const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;

/** Boot a fresh instance (all state lives in the factory closure). */
async function boot(metricsSettings = {}) {
  const handlers = new Map();
  let command;
  let captured;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, def) => {
      if (name === "metrics") command = def.handler;
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
    ui: { notify: () => {}, setStatus: () => {}, setWidget: (_k, f) => { captured = f; } },
  };
  await factory(pi);
  await handlers.get("session_start")({}, ctx);
  if (command) await command("on", ctx);

  const fire = (name, event) => handlers.get(name)(event, ctx);

  /** Stream one assistant turn of `outputTokens` over a nominal duration. */
  async function stream(outputTokens, { costTotal, durationMs = 1_000, chars = 40 } = {}) {
    const message = {
      role: "assistant",
      provider: "test",
      model: "test-model",
      api: "openai-completions",
      timestamp: Date.now(),
      durationMs,
      stopReason: "stop",
      content: [],
      usage:
        costTotal === undefined
          ? undefined
          : {
              input: 10,
              output: outputTokens,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 10 + outputTokens,
              cost: { input: costTotal, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
            },
    };
    await fire("before_provider_request", {});
    await fire("after_provider_response", {});
    await fire("message_start", { message });
    for (let i = 0; i < 4; i++) {
      await fire("message_update", {
        message,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(Math.ceil(chars / 4)), partial: message },
      });
    }
    await fire("message_end", { message });
  }

  const hud = () => captured({ requestRender: () => {} }, theme).render(120).map(plain);
  return { hud, stream, run: (args) => command(args, ctx) };
}

const totalOf = (lines) => {
  const m = /total \$([\d.]+)/.exec(lines[0]);
  return m ? Number(m[1]) : undefined;
};

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/* ------------------------------------ 1 + 2. per-call cost and the session total ---- */

{
  const h = await boot({ cost: true });
  await h.stream(50, { costTotal: 0.003 });
  const lines = h.hud();
  check(/\$0\.003/.test(lines[1] ?? ""), `row 1 should show the call's $0.003, got: ${JSON.stringify(lines[1])}`);
  check(totalOf(lines) === 0.003, `header should total $0.003 after one call, got ${totalOf(lines)}`);

  await h.stream(50, { costTotal: 0.004 });
  const after = h.hud();
  check(totalOf(after) === 0.007, `header should accumulate to $0.007, got ${totalOf(after)}`);

  // The chart is drawn from state.calls, so the header total and the call count must agree.
  check(/\b2 calls\b/.test(after[0]), `header should report 2 calls, got ${JSON.stringify(after[0])}`);
  console.log(`1. per-call cost and session total: row1 $0.004, header total $${totalOf(after)}`);
}

/* ------------------------------------------------------ 3. cost:false hides both ---- */

{
  const h = await boot({ cost: false });
  await h.stream(50, { costTotal: 0.003 });
  const lines = h.hud();
  check(!/\$/.test(lines.join("\n")), `cost:false must hide every amount, got:\n${lines.join("\n")}`);
  console.log("2. cost:false removes the row-1 amount and the header total");
}

/* ------------------------------------------- 4. no cost reported, no $0.0000 placeholder ---- */

{
  const h = await boot({ cost: true });
  await h.stream(50); // no usage, so no cost at all
  const lines = h.hud();
  check(!/total \$/.test(lines[0]), `a session with no reported cost must not print a total, got ${JSON.stringify(lines[0])}`);
  check(!/\$0\.0000/.test(lines.join("\n")), `absent cost must not render as $0.0000:\n${lines.join("\n")}`);

  // A provider that reports a real zero (a local model) behaves the same: hidden, not $0.
  await h.stream(50, { costTotal: 0 });
  const zero = h.hud();
  check(!/\$/.test(zero.join("\n")), `a zero reported cost must stay hidden, got:\n${zero.join("\n")}`);
  console.log("3. absent or zero cost is omitted rather than shown as $0.0000");
}

/* --------------------------- 5. the total is not derived from the capped call list ---- */

{
  // `history` caps state.calls. If the session total were computed by summing that array, it
  // would stop growing (or shrink) once the cap is hit — which is exactly the kind of silent
  // undercount that makes a cost figure untrustworthy. The call count in the header has the
  // same trap: pairing a capped count with an uncapped total reads as "2 calls · total $0.010".
  const h = await boot({ cost: true, history: 2 });
  for (let i = 0; i < 5; i++) await h.stream(10, { costTotal: 0.002 });
  const lines = h.hud();
  check(totalOf(lines) === 0.01, `total must reflect all 5 calls ($0.010) even when history=2, got ${totalOf(lines)}`);
  check(/\b5 calls\b/.test(lines[0]), `the header count must not be capped by history=2, got ${JSON.stringify(lines[0])}`);
  // The STATS row sits one line above the total, so a capped count there would contradict both
  // the header and the money beside it.
  const stats = lines.find((line) => /^\s*STATS/.test(line));
  check(/\b5 calls\b/.test(stats ?? ""), `the STATS count must match the header, got ${JSON.stringify(stats)}`);
  console.log(`4. spend and both call counts survive the history cap: $${totalOf(lines)} over 5 calls with history=2`);
}

/* ------------------------------------------------------------- 6. reset clears it ---- */

{
  const h = await boot({ cost: true });
  await h.stream(10, { costTotal: 0.005 });
  check(totalOf(h.hud()) === 0.005, "precondition: total is $0.005 before reset");
  await h.run("reset");
  const lines = h.hud();
  check(totalOf(lines) === undefined, `reset must clear the session spend, got ${totalOf(lines)}`);
  check(!/\$/.test(lines.join("\n")), `reset must clear the row-1 amount too:\n${lines.join("\n")}`);
  console.log("5. /metrics reset clears the session spend");
}

assert.equal(failures.length, 0, `\n${failures.join("\n")}\n`);
console.log("\nall cost-rendering assertions passed");
