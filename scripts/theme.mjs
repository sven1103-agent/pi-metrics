/**
 * Builds a real `Theme` for the test harnesses.
 *
 * The HUD mixes colours through okhsl, so a stub theme that returns plain strings makes
 * rendering throw — and a harness that cannot render cannot verify the chart.
 *
 * The colours come from the theme JSON the package ships (`dist/.../theme/dark.json`),
 * which is a stable, schema-documented artifact. An earlier version of this file read an
 * internal `theme-tokens.js` instead; that broke on Pi 1.1.0, where the file does not
 * exist, and it was never a public interface.
 */
import { Theme } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../node_modules/@earendil-works/pi-coding-agent");

function loadThemeJson(name) {
  // Layout has moved between releases, so try the known locations before failing.
  const candidates = [
    resolve(packageRoot, `dist/modes/interactive/theme/${name}.json`),
    resolve(packageRoot, `dist/theme/${name}.json`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, "utf8"));
  }
  throw new Error(`could not locate Pi's ${name}.json theme; tried:\n  ${candidates.join("\n  ")}`);
}

const raw = loadThemeJson("dark");
const colors = raw.colors ?? {};
const vars = raw.vars ?? {};
if (Object.keys(colors).length < 10) {
  throw new Error(`theme ${raw.name ?? "?"} has too few colour tokens (${Object.keys(colors).length})`);
}

// `colors` reference `vars` by name (e.g. accent: "violet"), so resolve through them.
const resolveColor = (value) => {
  let out = value;
  for (let hop = 0; hop < 8 && typeof out === "string" && vars[out] !== undefined; hop++) out = vars[out];
  return out;
};

// Split by slot: background-suffixed tokens go to the background map, the rest to fg.
const fg = {};
const bg = {};
for (const [token, value] of Object.entries(colors)) {
  const resolved = resolveColor(value);
  if (typeof resolved !== "string" || resolved.length === 0) continue;
  if (/Bg$/.test(token)) bg[token] = resolved;
  else fg[token] = resolved;
}

export const theme = new Theme(fg, bg, "truecolor");

/** Strip ANSI so assertions can match plain numbers. */
export const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
