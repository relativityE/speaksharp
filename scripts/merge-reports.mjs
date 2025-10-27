#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function mergeReports(outputFile, reportFiles) {
  console.log(`Merging ${reportFiles.length} shard reports...`);

  const merged = {
    config: {},
    suites: [],
    errors: [],
    stats: {
      expected: 0,
      unexpected: 0,
      flaky: 0,
      skipped: 0
    }
  };

  let configHasBeenSet = false;

  reportFiles.forEach((file, index) => {
    try {
      if (!fs.existsSync(file)) {
        console.warn(`⚠️ Report file not found: ${file}. Skipping.`);
        return;
      }

      const content = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(content);

      if (!configHasBeenSet && parsed.config) {
        merged.config = parsed.config;
        configHasBeenSet = true;
      }

      if (parsed.suites && Array.isArray(parsed.suites)) {
        merged.suites.push(...parsed.suites);
      }

      if (parsed.errors && Array.isArray(parsed.errors)) {
        merged.errors.push(...parsed.errors);
      }

      if (parsed.stats) {
        merged.stats.expected += parsed.stats.expected || 0;
        merged.stats.unexpected += parsed.stats.unexpected || 0;
        merged.stats.flaky += parsed.stats.flaky || 0;
        merged.stats.skipped += parsed.stats.skipped || 0;
      }
      console.log(`✅ Merged shard ${index}: ${file}`);
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
    }
  });

  console.log('\n📊 Merged stats:', merged.stats);
  console.log(`📦 Total suites: ${merged.suites.length}`);

  try {
    fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2));
    console.log(`✅ Merged report written to ${outputFile}`);
  } catch (error) {
    console.error('❌ Error writing merged report:', error.message);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: merge-reports.mjs <output-file> <input-file1> [input-file2] ...');
  process.exit(1);
}

const outputFile = args[0];
const inputFiles = args.slice(1);

mergeReports(outputFile, inputFiles);
