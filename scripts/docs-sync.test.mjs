/**
 * Keeps the documentation's HUD examples honest.
 *
 * Two places quote a frame of the HUD as text: the README, and the header docblock of
 * `extensions/pi-metrics.ts`. Both were once hand-typed, and both drifted — the source
 * example showed a header of `3 calls` beside a `HIST … (12 calls)` suffix, which cannot
 * happen, because HIST is a slice of the same call set the header counts.
 *
 * This asserts both quotes are exactly what the demo produces now. When it fails,
 * regenerate rather than hand-edit:
 *
 *   node scripts/demo.mjs braille --markdown      # for README.md
 *   DEMO_WIDTH=88 node scripts/demo.mjs compact --source-frame   # for the docblock
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const run = (args, env = {}) =>
  execFileSync(process.execPath, [resolve(here, "demo.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trimEnd();

/** Report the first differing line, which is far more useful than a whole-file diff. */
function reportDrift(where, actual, expected, hint) {
  const a = actual.split("\n");
  const b = expected.split("\n");
  const i = a.findIndex((line, n) => line !== b[n]);
  const index = i === -1 ? Math.min(a.length, b.length) : i;
  console.error(`${where} has drifted from the demo.\n`);
  console.error(`  ${where} line ${index + 1}:`);
  console.error(`    ${JSON.stringify(a[index] ?? "<missing>")}`);
  console.error(`  demo.mjs produces:`);
  console.error(`    ${JSON.stringify(b[index] ?? "<missing>")}`);
  console.error(`\nRegenerate with:  ${hint}\n`);
}

/* ---------------------------------------------------------------- README ---- */

// `--markdown` emits its own ``` fence so it can be pasted straight into a document; the
// README stores the same content inside its own fence. Compare the inner text of both.
const stripFence = (text) => text.replace(/^```\n/, "").replace(/\n?```\s*$/, "");
const readmeGenerated = stripFence(run(["braille", "--markdown"]));

const readme = readFileSync(resolve(root, "README.md"), "utf8");
const anchor = readme.indexOf("<summary>A static frame, as text</summary>");
assert.ok(anchor >= 0, "README.md must contain a static frame excerpt");

const open = readme.indexOf("```", anchor);
assert.ok(open >= 0, "the excerpt must be a fenced code block");
const close = readme.indexOf("```", open + 3);
assert.ok(close > open, "the excerpt's code fence must be closed");
const readmeEmbedded = readme.slice(open + 3, close).replace(/^\n/, "").trimEnd();

if (readmeEmbedded !== readmeGenerated) {
  reportDrift("README's HUD excerpt", readmeEmbedded, readmeGenerated, "node scripts/demo.mjs braille --markdown");
}
assert.equal(readmeEmbedded, readmeGenerated, "README HUD excerpt must match scripts/demo.mjs output");

/* --------------------------------------------------------- source docblock ---- */

const sourceGenerated = run(["compact", "--source-frame"], { DEMO_WIDTH: "88" });
const source = readFileSync(resolve(root, "extensions/pi-metrics.ts"), "utf8");
const sourceLines = source.split("\n");

// The example is the contiguous run of ` *  `-prefixed lines that contains the HUD header.
const isExample = (line) => /^ \* {2}/.test(line);
const headerAt = sourceLines.findIndex((line) => isExample(line) && line.includes("─ pi-metrics · "));
assert.ok(headerAt >= 0, "the source docblock must quote a HUD frame");

let first = headerAt;
while (first > 0 && isExample(sourceLines[first - 1]) && sourceLines[first - 1].trimStart() !== "*") first--;
let last = headerAt;
while (last + 1 < sourceLines.length && isExample(sourceLines[last + 1]) && sourceLines[last + 1].trimStart() !== "*") last++;
const sourceEmbedded = sourceLines.slice(first, last + 1).join("\n").trimEnd();

if (sourceEmbedded !== sourceGenerated) {
  reportDrift(
    "The source docblock's HUD example",
    sourceEmbedded,
    sourceGenerated,
    "DEMO_WIDTH=88 node scripts/demo.mjs compact --source-frame",
  );
}
assert.equal(
  sourceEmbedded,
  sourceGenerated,
  "the source docblock's HUD example must match scripts/demo.mjs output",
);

console.log(`README HUD excerpt matches the demo (${readmeGenerated.split("\n").length} lines)`);
console.log(`source HUD example matches the demo (${sourceGenerated.split("\n").length} lines)`);
