#!/usr/bin/env node
/**
 * Reproducible-build check: does a live deployment actually serve the code
 * in this checkout, or something else?
 *
 * This is not Subresource Integrity — Next.js injects its own script tags at
 * request time with no `integrity` attribute, and dynamic chunk splitting
 * means the set of scripts a page loads is not knowable until it runs, so the
 * browser cannot be handed a fixed allowlist of hashes the way SRI needs.
 * What *is* possible: build the exact commit yourself and diff, byte for
 * byte, against what the live site hands out. Next's own output is already
 * content-addressed (`_next/static/chunks/<hash>.js`), so this is really
 * asking one question — is the hash in the filename the live site serves the
 * same file its bytes actually hash to when fetched fresh — for every script
 * the page's initial HTML references.
 *
 * What this does NOT prove: a chunk that is only `import()`-ed after some
 * user interaction never appears in the pages this script loads, so it goes
 * unchecked. It is evidence against server-side tampering of the bulk of the
 * bundle, not a formal guarantee covering every byte a session could load.
 *
 * Usage:
 *   git checkout <commit-you-want-to-verify>
 *   npm ci && npm run build
 *   node scripts/verify-build.mjs https://your-deployment.example.com
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_DIR = join(ROOT, ".next", "static");

/** Pages crawled for script references. Covers the app's real surface, not exhaustively every route. */
const PAGES_TO_CRAWL = ["/", "/vault", "/offline"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads the local build's copy of a `/_next/static/...` URL path, or null if it was never built. */
function localHash(staticPath) {
  const withoutPrefix = staticPath.replace(/^\/_next\/static\//, "");
  const filePath = join(STATIC_DIR, withoutPrefix);
  if (!existsSync(filePath)) return null;
  return sha256(readFileSync(filePath));
}

function extractStaticUrls(html) {
  const urls = new Set();
  const pattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) urls.add(match[1]);
  return [...urls];
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/verify-build.mjs <deployed-url>");
    console.error("Run `npm run build` first, from the exact commit you want to verify.");
    process.exitCode = 2;
    return;
  }
  if (!existsSync(STATIC_DIR)) {
    console.error(`No local build at ${STATIC_DIR} — run \`npm run build\` first.`);
    process.exitCode = 2;
    return;
  }

  const origin = new URL(target).origin;
  const referenced = new Set();

  for (const page of PAGES_TO_CRAWL) {
    const res = await fetch(origin + page).catch(() => null);
    if (!res?.ok) {
      console.log(`? SKIP  ${page} (${res ? res.status : "unreachable"})`);
      continue;
    }
    for (const url of extractStaticUrls(await res.text())) referenced.add(url);
  }

  if (referenced.size === 0) {
    console.error("No /_next/static/ references found on any crawled page — nothing to verify.");
    process.exitCode = 2;
    return;
  }

  let mismatches = 0;
  let missingLocally = 0;

  for (const url of [...referenced].sort()) {
    const expected = localHash(url);
    if (!expected) {
      console.log(`?  MISSING LOCALLY  ${url}`);
      missingLocally++;
      continue;
    }
    const assetRes = await fetch(origin + url).catch(() => null);
    if (!assetRes?.ok) {
      console.log(`x  FETCH FAILED     ${url} (${assetRes ? assetRes.status : "unreachable"})`);
      mismatches++;
      continue;
    }
    const actual = sha256(Buffer.from(await assetRes.arrayBuffer()));
    if (actual === expected) {
      console.log(`ok MATCH            ${url}`);
    } else {
      console.log(`x  MISMATCH         ${url}`);
      mismatches++;
    }
  }

  console.log(
    `\n${referenced.size} asset(s) checked, ${mismatches} mismatch(es), ${missingLocally} missing locally.`,
  );

  if (mismatches > 0) {
    console.log("\nThe deployed bundle does NOT match this build. Do not trust it blindly.");
    process.exitCode = 1;
    return;
  }
  if (missingLocally > 0) {
    console.log(
      "\nSome referenced assets have no local counterpart, which usually means this checkout " +
        "is not the commit that produced the live build. Check out the right commit and rebuild.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nEvery initial-load script on the crawled pages is byte-identical to this build.");
}

await main();
