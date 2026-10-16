/**
 * Playback pacing of the README animation.
 *
 * This is a regression guard for a bug that was invisible in review: the recorded GIF ran at
 * roughly **6x real time**, so each TPS chart column advanced every ~25ms and the graph read
 * as a blinking panel instead of an instrument. Nothing in the diff looked wrong — the cause
 * was two independent speed factors that multiplied:
 *
 *   1. `DEMO_FRAME_MS=25` in record-demo.sh: the demo slept 25ms per 100ms of virtual time.
 *   2. `agg --speed 1.5`: the encoder then sped the result up again.
 *
 * Neither is a syntax error, neither fails a typecheck, and the GIF still "works" — it is
 * just unwatchable, and it misrepresents the product. So the pacing is asserted rather than
 * left to taste:
 *
 *   - the demo must report ~1.0x on its own, and
 *   - record-demo.sh must not apply a second speed factor, and must not stack a hold.
 *
 * A speed-up is legitimate if it is deliberate and in one place; if this test fails, either
 * revert to real time or update the expectation here on purpose.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

/* ------------------------------------------------ the demo plays at real time ---- */

const timing = JSON.parse(
  execFileSync(process.execPath, [resolve(here, "demo.mjs"), "braille", "--timing"], {
    cwd: root,
    encoding: "utf8",
  }),
);

// Tolerance is for the frame quantisation only (the last frame may be partial), not slack to
// quietly speed things up.
check(
  Math.abs(timing.speedFactor - 1) < 0.05,
  `demo.mjs playback factor is ${timing.speedFactor.toFixed(2)}x, expected ~1.0x ` +
    `(frameMs=${timing.frameMs}, realFrameMs=${timing.realFrameMs})`,
);
check(
  timing.realFrameMs === timing.frameMs,
  `demo.mjs renders ${timing.frameMs}ms of virtual time every ${timing.realFrameMs}ms of real ` +
    `time; these must match or the numbers on screen drift out of step with the animation`,
);

/* ------------------------------------- the recorder does not multiply that again ---- */

const recorder = readFileSync(resolve(root, "scripts/record-demo.sh"), "utf8");

// Strip comments: the file explains this rule at length, and the explanation must not be
// mistaken for a violation.
const code = recorder
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

check(
  !/--speed\b/.test(code),
  "record-demo.sh passes --speed to agg; the demo already plays at real time, so this would " +
    "multiply the pacing again (the original ~6x bug). Speed up in one place, not two.",
);

check(
  !/DEMO_FRAME_MS=/.test(code),
  "record-demo.sh sets DEMO_FRAME_MS; the demo steps 100ms of virtual time per 100ms of real " +
    "time, and exporting this overrides that in the recording.",
);

// The demo already ends with its own HOLD_MS pause on the finished HUD. agg's
// --last-frame-duration adds a second one, stretching the loop past the timeline the chart
// is still displaying.
const lastFrame = /--last-frame-duration\s+(\S+)/.exec(code);
check(
  lastFrame === null || Number(lastFrame[1]) === 0,
  `record-demo.sh sets --last-frame-duration ${lastFrame?.[1]}; the demo's own HOLD_MS already ` +
    "holds the final frame, so this stacks a second hold onto the loop",
);

/* ------------------------------------------------------------ one knob, documented ---- */

check(
  /speedFactor|real time/i.test(recorder),
  "record-demo.sh should document why pacing lives in exactly one place, so the next person " +
    "does not reintroduce a second factor",
);

assert.equal(failures.length, 0, `\n${failures.join("\n\n")}\n`);

console.log(
  `demo plays at ${timing.speedFactor.toFixed(2)}x ` +
    `(${timing.frames} frames, ${(timing.virtualMs / 1000).toFixed(1)}s virtual, ` +
    `${timing.frameMs}ms/frame) and the recorder does not re-scale it`,
);
