#!/usr/bin/env node
/**
 * Take a screenshot of a Home Assistant page in a real Chromium driven
 * by Playwright, reusing a persistent profile so login only happens once.
 *
 *   HA_URL=http://homeassistant.raccoon-beaufort.ts.net:8123 \
 *     node dev/screenshot.mjs <path> [out.png]
 *
 * Examples:
 *   HEADLESS=false node dev/screenshot.mjs /remote-studio first-run.png
 *     ↑ first time: opens a real window so you can log in. The auth
 *       state is saved into dev/.user-data and reused next time.
 *
 *   node dev/screenshot.mjs /remote-studio/<device_id> panel.png
 *     ↑ headless screenshot for subsequent runs.
 *
 * The integration's panel lives inside several nested shadow roots, so a
 * full-page screenshot is the most useful thing — DOM-poking is what
 * dev/browse.mjs is for.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HA_URL = process.env.HA_URL;
if (!HA_URL) {
  console.error("error: set HA_URL (e.g. http://homeassistant.local:8123)");
  process.exit(1);
}

const path = process.argv[2] || "/";
const out = resolve(process.argv[3] || "screenshot.png");
const headless = process.env.HEADLESS !== "false";
const userDataDir = resolve("dev/.user-data");

mkdirSync(dirname(out), { recursive: true });
mkdirSync(userDataDir, { recursive: true });

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless,
  viewport: { width: 1400, height: 900 },
});
const page = browser.pages()[0] ?? (await browser.newPage());
const url = new URL(path, HA_URL).toString();
console.log(`navigating to ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded" });

if (!headless) {
  console.log(
    "headed run — log in if prompted, then press Enter here to continue.",
  );
  await new Promise((r) => process.stdin.once("data", r));
}

// Give the panel a beat to settle (custom elements, shadow DOM, etc.).
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(800);

await page.screenshot({ path: out, fullPage: true });
console.log(`wrote ${out}`);
await browser.close();
