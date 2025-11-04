#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const METRICS_FILE = path.resolve(process.cwd(), 'test-results/metrics.json');

function printMetrics() {
  if (!fs.existsSync(METRICS_FILE)) {
    console.error(`❌ Error: Metrics file not found at ${METRICS_FILE}`);
    process.exit(1);
  }

  try {
    const metricsData = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));

    console.log("\n--- 📊 Software Quality Metrics Summary ---");

    // Unit Tests
    const { unit_tests } = metricsData;
    console.log("\n🧪 Unit Tests:");
    console.log(`  Passed: ${unit_tests.passed} / ${unit_tests.total}`);
    console.log(`  Coverage: ${unit_tests.coverage.lines}%`);

    // E2E Tests
    const { e2e_tests } = metricsData;
    console.log("\n🌐 E2E Tests:");
    console.log(`  Passed: ${e2e_tests.passed}`);
    console.log(`  Failed: ${e2e_tests.failed}`);
    console.log(`  Skipped: ${e2e_tests.skipped}`);

    // Performance
    const { performance } = metricsData;
    console.log("\n⏱️ Performance:");
    console.log(`  Initial Chunk Size: ${performance.initial_chunk_size}`);

    console.log("\n------------------------------------------");
    console.log("📈 For a detailed report, see the CI run which updates docs/PRD.md");

  } catch (error) {
    console.error(`❌ Error parsing metrics file: ${error.message}`);
    process.exit(1);
  }
}

printMetrics();
