/**
 * Keeps the README's images resolvable after publication.
 *
 * README.md references its animations with *relative* paths:
 *
 *   ![The pi-metrics HUD, braille graphs](docs/assets/hud-braille.webp)
 *
 * That is deliberately not an absolute URL, so the same file works on GitHub, in an editor
 * preview, and in a local checkout. The cost is that every consumer has to resolve
 * `docs/assets/*` against the artefact it actually received, and npm gives us only what
 * `files` in package.json whitelists.
 *
 * For 0.1.0 it whitelisted three of the four files that matter, so the published tarball
 * carried README.md without the two animations it points at. GitHub rendered them from the
 * repository; npm and the Pi gallery did not. The gallery rewrites relative README paths to
 * a jsDelivr URL *inside the tarball*, so it shipped two 404s:
 *
 *   https://cdn.jsdelivr.net/npm/@sven1103-agent/pi-metrics@0.1.0/docs/assets/hud-braille.gif
 *
 * Nothing caught it. `npm pack --dry-run` prints the file list but no test read it, and
 * docs-sync compares README *text*, not the images that text references.
 *
 * So: every relative image path in README.md must be present in the packed tarball.
 * Regenerate the animations with scripts/record-demo.sh; if you add a new one, add it to
 * the README and this test follows automatically. It names no file extension on purpose, so
 * the GIF -> WebP change (0.1.1) needed no edit here.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, posix, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const readme = readFileSync(resolve(root, "README.md"), "utf8");

// Markdown images plus raw <img src>. Absolute URLs (badges, and any deliberate CDN link)
// do not depend on `files`, so only relative paths are in scope.
const references = [
  ...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g),
  ...readme.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g),
].map((match) => match[1]);

const isRelative = (ref) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const relative = [...new Set(references.filter(isRelative))];

assert.ok(relative.length > 0, "README.md should reference at least one relative image");

// `npm pack --dry-run --json` reports exactly what would be published, honouring `files`.
// It still touches the network for nothing, so prefer the local manifest when possible.
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" }),
)[0].files.map((entry) => posix.normalize(entry.path));

const missing = relative.filter((ref) => {
  // README paths are relative to the package root, which is the tarball root.
  const normalised = posix.normalize(ref.replace(/^\.\//, ""));
  return !packed.includes(normalised);
});

if (missing.length > 0) {
  console.error("README.md references images that `files` keeps out of the published tarball.\n");
  for (const ref of missing) {
    console.error(`  ${ref}`);
    console.error(`    GitHub renders this from the repo, but npm and the Pi gallery would 404.`);
  }
  console.error(`\nAdd the missing paths to "files" in package.json, then re-run:\n`);
  console.error(`  npm pack --dry-run\n`);
}
assert.deepEqual(missing, [], "every relative README image must be published");

console.log(`README's ${relative.length} relative image(s) are all in the published tarball`);
