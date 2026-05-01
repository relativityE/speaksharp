import fs from 'fs';
import path from 'path';

/**
 * Aggregates Vitest JSON results from the custom VitestCIReporter.
 * @param {string} filePath - Path to the vitest-results.json file.
 * @returns {object} - { totalDurationMs: number, testCount: number }
 */
export function aggregateVitest(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[METRICS] Vitest result file not found: ${filePath}`);
    return { totalDurationMs: 0, testCount: 0 };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Standardize to integer milliseconds
    return {
      totalDurationMs: Math.round(raw.totalDuration || 0),
      testCount: raw.numTotalTests || 0
    };
  } catch (err) {
    console.error(`[METRICS] Failed to parse Vitest results at ${filePath}:`, err.message);
    return { totalDurationMs: 0, testCount: 0 };
  }
}

// CLI Execution Support
if (process.argv[1] === import.meta.url || process.argv[1].endsWith('aggregate-vitest.mjs')) {
  const target = process.argv[2] || 'test-results/unit/results.json';
  const results = aggregateVitest(path.resolve(process.cwd(), target));
  console.log(JSON.stringify(results, null, 2));
}
