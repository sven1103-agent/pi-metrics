/**
 * The command surface and settings validation.
 *
 * Two classes of bug are covered here, both of which shipped and were reported by a user:
 *
 *   1. Settings that Pi accepted but the extension ignored. `placement: "below"` is the
 *      example: Pi compares against the exact string `"belowEditor"` and silently treats
 *      anything else as above-the-editor, so the HUD "did nothing" with no explanation.
 *   2. Advertised commands that did not exist. `/metrics style`, `/metrics graph` and
 *      `/metrics color` were accepted settings but had no command, so the only way to change
 *      them was to edit settings.json and restart.
 *
 * The third case is a regression guard: an unrecognised subcommand used to fall through to
 * the toggle, so a typo silently switched the HUD off.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { theme, plain } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { interopDefault: true });
const factory = (await jiti.import(resolve(here, "../extensions/pi-metrics.ts"))).default;

/** Boot a fresh instance (state lives in the factory closure) and record what it does. */
async function boot(metricsSettings = {}) {
  const handlers = new Map();
  const widgets = [];
  const notes = [];
  const appended = [];
  let command;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, def) => {
      if (name === "metrics") command = def.handler;
    },
    registerEntryRenderer: () => {},
    appendEntry: (type, data) => appended.push({ type, data }),
    getSettings: () => ({ "pi-metrics": metricsSettings }),
    reload: async () => {},
    log: () => {},
  };
  const ctx = {
    isIdle: () => false,
    hasUI: true,
    mode: "tui",
    ui: {
      notify: (message, level) => notes.push({ message, level }),
      setStatus: () => {},
      setWidget: (_key, content, options) => widgets.push({ defined: content !== undefined, placement: options?.placement }),
    },
  };
  await factory(pi);
  await handlers.get("session_start")({}, ctx);
  return {
    widgets,
    notes,
    appended,
    run: async (...args) => {
      widgets.length = 0;
      notes.length = 0;
      await command(args.join(" "), ctx);
      return { placement: widgets.at(-1)?.placement, note: notes.at(-1)?.message ?? "", level: notes.at(-1)?.level, clears: widgets.length };
    },
    startupNotes: notes.slice(),
    getCompletions: (prefix) => command, // handler only; completions tested via registerCommand below
  };
}

// --- 1. placement spellings ---------------------------------------------------------
// The bug report was "placement does not do anything". Pi only honours the exact string
// "belowEditor"; every other spelling silently means "above".
const spellings = [
  ["belowEditor", "belowEditor"],
  ["below", "belowEditor"],
  ["BELOW", "belowEditor"],
  ["above", "aboveEditor"],
  ["aboveEditor", "aboveEditor"],
];
for (const [input, expected] of spellings) {
  const { widgets, notes } = await boot({ placement: input });
  assert.equal(widgets.at(-1)?.placement, expected, `placement ${JSON.stringify(input)} should resolve to ${expected}`);
  assert.equal(notes.length, 0, `placement ${JSON.stringify(input)} is valid and must not warn`);
}
console.log(`1. placement spellings accepted: ${spellings.map(([i]) => i).join(", ")}`);

// --- 2. an unusable value warns AND falls back --------------------------------------
// Warning alone is not enough: the bad value would still reach Pi, which would quietly
// interpret it as above-the-editor, i.e. exactly the silent behaviour being fixed.
for (const bad of ["sideways", 42, "beneath"]) {
  const { widgets, notes } = await boot({ placement: bad });
  assert.equal(widgets.at(-1)?.placement, "aboveEditor", `invalid placement ${JSON.stringify(bad)} must fall back to the default`);
  assert.ok(notes.some((n) => n.level === "warning" && /placement/.test(n.message)), `invalid placement ${JSON.stringify(bad)} must warn`);
  assert.ok(notes.every((n) => !/undefined|NaN/.test(n.message)), "warnings must not print undefined");
}
console.log("2. invalid placement warns and falls back to the default");

// --- 3. the other enum settings are validated the same way --------------------------
const badEnums = [
  ["style", "fancy", "normal"],
  ["graphStyle", "sparkles", "braille"],
  ["colorMode", "rainbow", "calm"],
];
for (const [key, bad, fallback] of badEnums) {
  const { notes } = await boot({ [key]: bad });
  assert.ok(
    notes.some((n) => n.level === "warning" && n.message.includes(key)),
    `${key}=${JSON.stringify(bad)} must warn; got ${JSON.stringify(notes)}`,
  );
  const good = await boot({ [key]: fallback });
  assert.equal(good.notes.length, 0, `${key}=${JSON.stringify(fallback)} is valid and must not warn`);
}
console.log("3. style / graphStyle / colorMode validated with the same rule");

// --- 4. every advertised display command exists and applies -------------------------
const commands = [
  ["placement below", "belowEditor", "placement"],
  ["placement above", "aboveEditor", "placement"],
  ["style compact", undefined, "style"],
  ["style normal", undefined, "style"],
  ["graph block", undefined, "graphStyle"],
  ["graph braille", undefined, "graphStyle"],
  ["color vivid", undefined, "colorMode"],
  ["color mono", undefined, "colorMode"],
];
for (const [cmd, expectedPlacement, settingsKey] of commands) {
  const harness = await boot();
  const result = await harness.run(cmd);
  assert.equal(result.level, "info", `/${"metrics "}${cmd} must succeed: got ${JSON.stringify(result.note)}`);
  // The change must be applied, not merely acknowledged.
  assert.ok(result.clears >= 1, `/${"metrics "}${cmd} must re-attach the widget so the change is visible`);
  if (expectedPlacement) assert.equal(result.placement, expectedPlacement, `/${"metrics "}${cmd} must move the widget`);
  // And the user must be told how to make it permanent, since the extension cannot write
  // settings.json itself (Pi exposes no settings-write API).
  assert.ok(result.note.includes(settingsKey), `/${"metrics "}${cmd} must name the settings key to persist, got: ${result.note}`);
  assert.ok(result.note.includes("pi-metrics"), `/${"metrics "}${cmd} must show the settings block, got: ${result.note}`);
}
console.log(`4. all ${commands.length} display commands apply and explain persistence`);

// --- 5. a typo must not silently toggle the HUD off ---------------------------------
// This was a real bug: `default:` fell through to the toggle, so `/metrics styel compact`
// turned the HUD off and reported "metrics HUD disabled" — which reads as success.
for (const typo of ["styel compact", "colour vivid", "placement sideways", "style nonsense"]) {
  const harness = await boot();
  const result = await harness.run(typo);
  assert.equal(result.level, "warning", `/${"metrics "}${typo} must warn, got level=${result.level}`);
  assert.equal(result.clears, 0, `/${"metrics "}${typo} must not touch the widget (it used to toggle visibility off)`);
  assert.ok(!/enabled|disabled/.test(result.note), `/${"metrics "}${typo} must not report a toggle: ${result.note}`);
}
console.log("5. unrecognised subcommands warn instead of toggling the HUD");

// --- 6. bare /metrics and on|off still work -----------------------------------------
for (const [cmd, expectLevel] of [["", "info"], ["on", "info"], ["off", "info"]]) {
  const harness = await boot();
  const result = await harness.run(cmd);
  assert.equal(result.level, "info", `/${"metrics "}${cmd} must still work`);
  assert.ok(/enabled|disabled/.test(result.note), `/${"metrics "}${cmd} should report the toggle state`);
}
console.log("6. bare /metrics, on and off unchanged");

// --- 7. the report honours the cost setting -----------------------------------------
// `cost: false` used to still print the cost column: the setting was declared and
// documented but read by nothing, so the column was hardcoded on.
async function reportText(costSetting) {
  const handlers = new Map();
  const appended = [];
  const renderers = new Map();
  let command;
  const pi = {
    on: (n, f) => handlers.set(n, f),
    registerCommand: (n, d) => {
      if (n === "metrics") command = d.handler;
    },
    registerEntryRenderer: (type, fn) => renderers.set(type, fn),
    appendEntry: (type, data) => appended.push({ type, data }),
    getSettings: () => ({ "pi-metrics": { cost: costSetting } }),
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

  const message = {
    role: "assistant",
    provider: "test",
    model: "test-model",
    api: "openai-completions",
    timestamp: Date.now(),
    durationMs: 2_000,
    stopReason: "stop",
    content: [],
    usage: {
      input: 10,
      output: 40,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 50,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
  };
  await handlers.get("before_provider_request")({}, ctx);
  await handlers.get("message_start")({ message }, ctx);
  for (let i = 0; i < 20; i++) {
    await handlers.get("message_update")(
      { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x".repeat(10), partial: message } },
      ctx,
    );
  }
  await handlers.get("message_end")({ message }, ctx);
  await command("report", ctx);

  const entry = appended.find((e) => e.data?.kind === "report");
  assert.ok(entry, "expected a report entry");
  assert.ok(entry.data.session, "the report entry must carry the session rate summary");
  const renderer = renderers.get("pi-metrics");
  assert.ok(renderer, "expected an entry renderer");
  const component = renderer({ data: entry.data }, {}, theme);
  return component.render(200).map(plain).join("\n");
}

const costOn = await reportText(true);
const costOff = await reportText(false);
assert.ok(/cost/.test(costOn), `cost: true must show the cost column:\n${costOn}`);
assert.ok(/\$0\.003/.test(costOn), `cost: true must show the amount:\n${costOn}`);
assert.ok(!/cost/.test(costOff), `cost: false must drop the column entirely, not blank it:\n${costOff}`);
console.log("7. cost:true shows the column and amount, cost:false drops the column");

// --- 8. the report carries the complete session rate estimate ----------------------
// The HUD's `avg`/`p95` are window-scoped (see scripts/tps-window.test.mjs), so the report
// is where the whole-session figure has to live, or windowing the HUD would lose it. Both
// scopes are printed, and the report entry stores the numbers rather than recomputing them,
// so a resumed session renders what it actually measured.
assert.ok(/TPS\s+session avg \d+ tok\/s/.test(costOn), `the report must print the session average:\n${costOn}`);
assert.ok(/p95 \d+/.test(costOn), `the report must print the session p95:\n${costOn}`);
assert.ok(/window avg \d+/.test(costOn), `the report must also print the window figures:\n${costOn}`);
assert.ok(/\d+s recorded/.test(costOn), `the report must say how many seconds it covers:\n${costOn}`);
console.log("8. report prints session and window TPS summary");

console.log("\nall command-surface assertions passed");
