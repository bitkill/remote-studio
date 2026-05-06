#!/usr/bin/env node
/**
 * Tiny helper called by semantic-release's `@semantic-release/exec` plugin.
 * Updates the `version` field in the integration's manifest.json so HA's
 * Devices & Services UI shows the released version after install.
 *
 *   node scripts/bump-manifest.mjs 1.2.3
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , version] = process.argv;
if (!version) {
  console.error("usage: bump-manifest.mjs <version>");
  process.exit(1);
}

const path = "custom_components/remote_studio/manifest.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.version = version;
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json -> ${version}`);
