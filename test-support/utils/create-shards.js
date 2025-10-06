#!/usr/bin/env node
/**
 * create-shards.js
 *
 * Dynamically creates E2E test shards based on their measured runtimes.
 * This utility reads docs/e2e-test-runtimes.json, groups test files into
 * shards whose cumulative runtime <= 420 seconds (7 mins), and outputs
 * a JSON file test-support/shards/shard-manifest.json for test-audit.sh.
 *
 * Core Principles:
 * - Trust but Verify: All shard data must come from the real code and runtime JSON.
 * - Single Source of Truth: Never hardcode shard lists; always regenerate.
 * - No bloat: Only the script and final manifest may persist.
 */

import fs from "fs";
import path from "path";

const RUNTIME_FILE = path.resolve("docs/e2e-test-runtimes.json");
const OUTPUT_DIR = path.resolve("test-support/shards");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "shard-manifest.json");

const MAX_SHARD_TIME = 420; // seconds (7 mins)
const MAX_TEST_TIME = 240;  // seconds (4 mins per test)

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function createShardsFromRuntimes() {
  if (!fs.existsSync(RUNTIME_FILE)) {
    console.error(`[ERROR] Missing runtime file: ${RUNTIME_FILE}`);
    console.error("Please run 'test-audit.sh' baseline collection first.");
    process.exit(1);
  }

  const runtimes = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf-8"));
  const sortedTests = Object.entries(runtimes)
    .sort((a, b) => b[1] - a[1]); // sort by descending runtime

  const shards = [];
  let currentShard = [];
  let currentTotal = 0;

  for (const [testFile, runtime] of sortedTests) {
    if (runtime > MAX_TEST_TIME) {
      console.warn(`[WARN] ${testFile} exceeds max test time (${runtime}s). Consider splitting it.`);
    }

    // If adding this test exceeds shard limit, start new shard
    if (currentTotal + runtime > MAX_SHARD_TIME) {
      shards.push(currentShard);
      currentShard = [];
      currentTotal = 0;
    }

    currentShard.push(testFile);
    currentTotal += runtime;
  }

  // Push the last shard if not empty
  if (currentShard.length) shards.push(currentShard);

  // Write shard manifest
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), shards }, null, 2)
  );

  console.log(`[INFO] ✅ Shard manifest generated successfully at ${OUTPUT_FILE}`);
  console.log(`[INFO] Total shards: ${shards.length}`);
  shards.forEach((shard, i) =>
    console.log(`  • Shard ${i + 1}: ${shard.length} tests`)
  );
}

// Run generator
createShardsFromRuntimes();