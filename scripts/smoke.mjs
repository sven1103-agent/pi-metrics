/**
 * Factory-level smoke test for the pi-metrics extension.
 *
 * Loads the extension through jiti with a stub ExtensionAPI and asserts that it
 * registers exactly the surface it is supposed to: the `metrics` command, the
 * `pi-metrics` entry renderer, and its eight event handlers. This catches refactor
 * breakage that a typecheck cannot, without needing Pi, credentials or a network.
 *
 * It does NOT verify rendering, because the widget is TUI-only and the entry
 * renderer needs a live session.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "../extensions/pi-metrics.ts");

const EXPECTED_EVENTS = [
  "session_start",
  "session_shutdown",
  "turn_start",
  "before_provider_request",
  "after_provider_response",
  "message_start",
  "message_update",
  "message_end",
];

const problems = [];

const events = [];
const commands = [];
const entryRenderers = [];

const pi = {
  on: (name) => events.push(name),
  registerCommand: (name) => commands.push(name),
  registerEntryRenderer: (name) => entryRenderers.push(name),
  registerTool: (name) => problems.push(`unexpected tool registration: ${name}`),
  registerProvider: (name) => problems.push(`unexpected provider registration: ${name}`),
  appendEntry: () => {},
  getSettings: () => ({}),
  getContext: () => undefined,
  reload: async () => {},
  log: () => {},
};

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti.import(extensionPath);
const factory = mod.default ?? mod;

if (typeof factory !== "function") {
  problems.push(`extension does not export a default factory (got ${typeof factory})`);
} else {
  await factory(pi);
}

const check = (label, actual, expected) => {
  const a = [...actual].sort().join(",");
  const e = [...expected].sort().join(",");
  if (a !== e) problems.push(`${label}: expected [${e}], got [${a}]`);
};

check("events", events, EXPECTED_EVENTS);
check("commands", commands, ["metrics"]);
check("entry renderers", entryRenderers, ["pi-metrics"]);

if (problems.length > 0) {
  console.error("smoke FAILED");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`smoke OK — ${commands.length} command, ${entryRenderers.length} renderer, ${events.length} events`);
for (const name of events) console.log(`  event: ${name}`);
