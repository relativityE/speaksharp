#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

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
    suites: [],
    errors: [],
    stats: {
      expected: 0,
      unexpected: 0,
      flaky: 0,
      skipped: 0
    }
  };

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
    }
  });

  console.log('\n📊 Merged stats:', merged.stats);
  console.log(`📦 Total suites: ${merged.suites.length}`);

  // Write merged report
  try {
    fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2));
    console.log(`✅ Merged report written to ${outputFile}`);
  } catch (error) {
    console.error('❌ Error writing merged report:', error.message);
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: merge-reports.mjs <output-file> <input-file1> [input-file2] ...');
  process.exit(1);
}

const outputFile = args[0];
const inputFiles = args.slice(1);

mergeReports(inputFiles, outputFile);
