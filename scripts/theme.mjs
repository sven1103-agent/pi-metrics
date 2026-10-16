/**
 * Builds a real `Theme` for the test harnesses.
 *
 * The HUD mixes colours through okhsl, so a stub theme that returns plain strings makes
 * rendering throw — and a harness that cannot render cannot verify the chart. The token
 * list is read from the installed package because it is not a public export; if that ever
 * changes, the count assertion below fails loudly instead of silently under-populating.
 */
import { Theme } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../node_modules/@earendil-works/pi-coding-agent");
const source = readFileSync(resolve(packageRoot, "dist/modes/interactive/theme/theme-tokens.js"), "utf8");

const fg = {};
const bg = {};
for (const match of source.matchAll(/^\s{4}(\w+):\s*\{\s*\n?\s*slot:\s*"(foreground|background)"/gm)) {
  const [, token, slot] = match;
  (slot === "background" ? bg : fg)[token] = slot === "background" ? "#1a1b26" : "#c0caf5";
}
if (Object.keys(fg).length < 10) throw new Error("failed to parse theme tokens; theme would be incomplete");

export const theme = new Theme(fg, bg, "truecolor");

/** Strip ANSI so assertions can match plain numbers. */
export const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
