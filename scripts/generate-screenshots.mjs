#!/usr/bin/env node
/**
 * Retakes the manifest screenshots — the images an install dialog shows
 * before anyone commits to installing.
 *
 * Unlike the icons next door, these cannot be drawn from shapes: they are
 * photographs of the running application, so this one needs a real browser.
 * Playwright is deliberately not a dependency for it. Three PNGs that change
 * only when the interface does are not worth a browser engine sitting in the
 * tree of a project whose whole point is a small, auditable surface — so the
 * script asks for one to be brought along, and says how, rather than assuming
 * it is there.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run build && npm start &
 *   npm run screenshots
 *
 * Against a deployment instead of a local server:
 *
 *   npm run screenshots -- https://your-deployment.example.com
 *
 * If you already have a Chromium somewhere Playwright does not look — a
 * distribution package, a pre-provisioned image — point at it rather than
 * downloading a second copy:
 *
 *   CHROMIUM_PATH=/usr/bin/chromium npm run screenshots
 *
 * Output lands in public/screenshots/ and is committed, so a deploy never
 * depends on this script having run. The sizes below are repeated in
 * app/manifest.ts, which is what a browser actually reads: change one and
 * change the other, or the mismatched entry is ignored.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "screenshots");

/**
 * Both narrow shots share a viewport on purpose: a form factor whose
 * screenshots disagree on aspect ratio is dropped by Chrome rather than
 * letterboxed. Light theme, because a screenshot cannot follow the reader's
 * and the light one is the palette's base.
 */
const NARROW = { width: 412, height: 915 };
const WIDE = { width: 1280, height: 800 };

const SHOTS = [
  { file: "home-narrow.png", path: "/", viewport: NARROW },
  // The screen `start_url` lands on, so the dialog is not promising a
  // different app from the one that opens.
  { file: "vault-narrow.png", path: "/vault", viewport: NARROW },
  { file: "home-wide.png", path: "/", viewport: WIDE },
];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not installed, and it is not a dependency of this project on\n" +
      "purpose. To retake the screenshots, bring one along for the run:\n\n" +
      "  npm i --no-save playwright && npx playwright install chromium\n" +
      "  npm run build && npm start &\n" +
      "  npm run screenshots\n",
  );
  process.exit(2);
}

const origin = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

const reachable = await fetch(origin).then(
  (r) => r.ok,
  () => false,
);
if (!reachable) {
  console.error(`Nothing answering at ${origin} — start the app first, or pass a deployed URL.`);
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const { file, path, viewport } of SHOTS) {
    const page = await browser.newPage({ viewport, colorScheme: "light", deviceScaleFactor: 1 });
    await page.goto(origin + path, { waitUntil: "load" });
    // Long enough for the staged reveals to finish; a screenshot caught
    // mid-animation shows half-faded rows.
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(OUT_DIR, file) });
    await page.close();
    console.log(`ok  ${file}  ${viewport.width}x${viewport.height}  ${path}`);
  }
} finally {
  await browser.close();
}

console.log(`\n${SHOTS.length} screenshot(s) written to public/screenshots/.`);
