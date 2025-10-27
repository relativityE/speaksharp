#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

<<<<<<< HEAD
function mergeReports(outputFile, reportFiles) {
  console.log(`Merging ${reportFiles.length} shard reports...`);

  const merged = {
    config: {},
=======
function mergeReports(reportFiles, outputFile) {
  console.log(`Merging ${reportFiles.length} shard reports...`);

  const reports = reportFiles.map((file, index) => {
    try {
      // Check if it's actually a file
      const stats = fs.statSync(file);
      if (!stats.isFile()) {
        console.error(`❌ ${file} is not a file (it's a directory)`);
        return null;
      }

      const content = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(content);
      console.log(`✅ Shard ${index}: ${parsed.stats?.expected || 0} passed, ${parsed.stats?.skipped || 0} skipped`);
      return parsed;
    } catch (error) {
      console.error(`❌ Error reading ${file}:`, error.message);
      return null;
    }
  }).filter(Boolean);

  if (reports.length === 0) {
    console.error('❌ No valid reports found');
    process.exit(1);
  }

  // Merge config from first report
  const merged = {
    config: reports[0].config || {},
>>>>>>> main
    suites: [],
    errors: [],
    stats: {
      expected: 0,
      unexpected: 0,
      flaky: 0,
      skipped: 0
    }
  };

<<<<<<< HEAD
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
=======
  // Aggregate data from all reports
  reports.forEach((report, index) => {
    // Merge suites
    if (report.suites && Array.isArray(report.suites)) {
      merged.suites.push(...report.suites);
    }

    // Merge errors
    if (report.errors && Array.isArray(report.errors)) {
      merged.errors.push(...report.errors);
    }

    // Sum stats
    if (report.stats) {
      merged.stats.expected += report.stats.expected || 0;
      merged.stats.unexpected += report.stats.unexpected || 0;
      merged.stats.flaky += report.stats.flaky || 0;
      merged.stats.skipped += report.stats.skipped || 0;
>>>>>>> main
    }
  });

  console.log('\n📊 Merged stats:', merged.stats);
  console.log(`📦 Total suites: ${merged.suites.length}`);

<<<<<<< HEAD
=======
  // Write merged report
>>>>>>> main
  try {
    fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2));
    console.log(`✅ Merged report written to ${outputFile}`);
  } catch (error) {
    console.error('❌ Error writing merged report:', error.message);
    process.exit(1);
  }
}

<<<<<<< HEAD
=======
// Main execution
>>>>>>> main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: merge-reports.mjs <output-file> <input-file1> [input-file2] ...');
  process.exit(1);
}

const outputFile = args[0];
const inputFiles = args.slice(1);

<<<<<<< HEAD
mergeReports(outputFile, inputFiles);
=======
mergeReports(inputFiles, outputFile);
>>>>>>> main
