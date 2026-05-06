#!/usr/bin/env node
/**
 * Headed Chromium that pierces HA's nested shadow roots and runs a small
 * inspection on the panel — handy for "is the cog actually in the DOM?"
 * style debugging.
 *
 *   HA_URL=http://homeassistant.local:8123 node dev/browse.mjs <path>
 *
 * Default path is /remote-studio. Reuses the same persistent profile as
 * dev/screenshot.mjs so login is shared.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const HA_URL = process.env.HA_URL;
if (!HA_URL) {
  console.error("error: set HA_URL (e.g. http://homeassistant.local:8123)");
  process.exit(1);
}

const path = process.argv[2] || "/remote-studio";
const headless = process.env.HEADLESS === "true";
const userDataDir = resolve("dev/.user-data");
mkdirSync(userDataDir, { recursive: true });

const browser = await chromium.launchPersistentContext(userDataDir, {
  headless,
  viewport: { width: 1400, height: 900 },
});
const page = browser.pages()[0] ?? (await browser.newPage());
const url = new URL(path, HA_URL).toString();
console.log(`opening ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded" });

if (!headless) {
  console.log("If a login form is showing, sign in first.");
}

await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);

// Pierce HA's nested shadow roots until we land inside the panel, then
// dump the rendered HTML of the relevant header so you can see whether
// .device-cog is actually there.
const result = await page.evaluate(() => {
  const piercePath = [
    "home-assistant",
    "home-assistant-main",
    "partial-panel-resolver",
    "remote-studio-panel",
  ];
  let node = document;
  for (const sel of piercePath) {
    const el = (node.shadowRoot || node).querySelector(sel) || (node.querySelector?.(sel));
    if (!el) return { error: `couldn't find ${sel} (got as far as ${piercePath.indexOf(sel)})` };
    node = el;
  }
  const root = node.shadowRoot;
  if (!root) return { error: "panel has no shadowRoot" };
  return {
    deviceCog: root.querySelector(".device-cog")?.outerHTML ?? null,
    deviceTitle: root.querySelector(".device-title")?.outerHTML ?? null,
    headerHtml: root.querySelector(".page-header")?.outerHTML ?? null,
    bodyHasContent: root.innerHTML.length,
  };
});

console.log("\n=== panel inspection ===");
console.log(JSON.stringify(result, null, 2));

if (!headless) {
  console.log("\nbrowser stays open. Press Enter to close.");
  await new Promise((r) => process.stdin.once("data", r));
}
await browser.close();
