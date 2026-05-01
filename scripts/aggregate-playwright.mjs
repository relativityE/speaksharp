import fs from 'fs';
import path from 'path';

/**
 * Aggregates Playwright JSON results from the custom TelemetryReporter.
 * @param {string} filePath - Path to the playwright-results.json file.
 * @returns {object} - { totalDurationMs: number, retryOverheadMs: number, testCount: number, breakdown: object, topSlowTests: array }
 */
export function aggregatePlaywright(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[METRICS] Playwright result file not found: ${filePath}`);
    return { totalDurationMs: 0, retryOverheadMs: 0, testCount: 0, breakdown: {}, topSlowTests: [] };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let totalDurationMs = 0;
    let retryOverheadMs = 0;
    const breakdown = {};
    const allTests = [];
    
    const tests = raw.tests || [];
    console.log("[METRICS] PW TEST COUNT RAW:", tests.length);

    for (const test of tests) {
      const duration = Math.round(test.duration || 0);
      const overhead = Math.round(test.retryOverheadMs || 0);
      const attempts = test.attempts || 1;
      
      totalDurationMs += duration;
      retryOverheadMs += overhead;

      // Track for hotspot detection
      allTests.push({
        title: test.title,
        duration,
        retryOverheadMs: overhead,
        attempts
      });

      // Extract file name from title
      const parts = test.title.split(' › ');
      const file = parts.find(p => p.endsWith('.spec.ts')) || 'unknown';

      if (!breakdown[file]) {
        breakdown[file] = 0;
      }
      breakdown[file] += duration;
    }

    // Surface hotspots: Top 10 slowest tests
    const topSlowTests = allTests
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    return { 
      totalDurationMs, 
      retryOverheadMs,
      testCount: tests.length,
      breakdown,
      topSlowTests
    };
  } catch (err) {
    console.error(`[METRICS] Failed to parse Playwright results at ${filePath}:`, err.message);
    return { totalDurationMs: 0, retryOverheadMs: 0, testCount: 0, breakdown: {}, topSlowTests: [] };
  }
}

// CLI Execution Support
if (process.argv[1] === import.meta.url || process.argv[1].endsWith('aggregate-playwright.mjs')) {
  const target = process.argv[2] || 'test-results/playwright-results.json';
  const results = aggregatePlaywright(path.resolve(process.cwd(), target));
  console.log(JSON.stringify(results, null, 2));
}
