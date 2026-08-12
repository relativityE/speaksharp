import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { loadShardCoverage, enforceThresholds } from './coverage-merge-lib.mjs';
import { COVERAGE_THRESHOLDS } from './coverage-thresholds.mjs';

/**
 * #1262 — merge sharded unit coverage and enforce thresholds, FAIL CLOSED.
 *
 * In CI this is the SOLE coverage gate (vitest thresholds are disabled under CI_SHARD_MODE), so every
 * edge that used to `console.warn` and continue is now a hard failure: shard loss, a malformed shard
 * report, a missing/malformed coverage summary, and a declared per-file threshold whose file is absent
 * from the summary. Thresholds come from the shared authority (scripts/coverage-thresholds.mjs) so they
 * can never drift from vitest's local copy.
 *
 * Env overrides (used by the negative-fixture tests and for local runs):
 *   COVERAGE_DIR  — where shard-<n>/ live and where reports are written (default artifacts/coverage).
 *   UNIT_SHARDS   — expected shard count (default 4). A missing expected shard is shard loss.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const coverageDir = process.env.COVERAGE_DIR
  ? path.resolve(process.env.COVERAGE_DIR)
  : path.join(ROOT, 'artifacts/coverage');
const SHARDS = Number(process.env.UNIT_SHARDS || 4);

const ms = (start) => `${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(0)}ms`;
const fail = (lines) => {
  for (const line of lines) console.error(`ERROR: ${line}`);
  process.exit(1);
};

// ── Stage 1: load + merge shard coverage (fail closed on shard loss / malformed) ────────────────────
const mergeStart = process.hrtime.bigint();
const shardResult = loadShardCoverage({ coverageDir, shards: SHARDS });
for (const t of shardResult.timings) {
  console.log(`Merged shard-${t.shard} coverage (${t.ms.toFixed(0)}ms)`);
}
console.log(
  `Coverage merge: ${shardResult.mergedShards.length}/${SHARDS} shards merged in ${ms(mergeStart)}` +
    `${shardResult.missing.length ? `, missing [${shardResult.missing.join(', ')}]` : ''}`,
);
if (!shardResult.ok) {
  fail(shardResult.errors);
}

// ── Stage 2: write the merged reports ───────────────────────────────────────────────────────────────
const reportStart = process.hrtime.bigint();
const context = libReport.createContext({ dir: coverageDir, coverageMap: shardResult.map });
for (const kind of ['json-summary', 'json', 'text', 'html', 'clover']) {
  reports.create(kind).execute(context);
}
console.log(`Generated merged coverage reports (${ms(reportStart)})`);

// ── Stage 3: merge unit-metrics.json across shards (diagnostic; per-shard test counts) ──────────────
const mergedMetrics = {
  numPassedTests: 0,
  numFailedTests: 0,
  numFailedSuites: 0,
  numTotalTests: 0,
  totalDuration: 0,
  numPendingTests: 0,
  failures: [],
};
let metricsMergedCount = 0;
for (let shard = 1; shard <= SHARDS; shard++) {
  const shardMetricsPath = path.join(coverageDir, `shard-${shard}`, 'unit-metrics.json');
  if (!fs.existsSync(shardMetricsPath)) {
    console.warn(`Note: no unit-metrics.json for shard-${shard} (diagnostic only)`);
    continue;
  }
  try {
    const data = JSON.parse(fs.readFileSync(shardMetricsPath, 'utf8'));
    mergedMetrics.numPassedTests += data.numPassedTests || 0;
    mergedMetrics.numFailedTests += data.numFailedTests || 0;
    mergedMetrics.numFailedSuites += data.numFailedSuites || 0;
    mergedMetrics.numTotalTests += data.numTotalTests || 0;
    mergedMetrics.totalDuration += data.totalDuration || 0;
    mergedMetrics.numPendingTests += data.numPendingTests || 0;
    if (Array.isArray(data.failures)) mergedMetrics.failures = mergedMetrics.failures.concat(data.failures);
    metricsMergedCount++;
    console.log(
      `shard-${shard}: ${data.numTotalTests || 0} tests (${data.numPassedTests || 0} passed, ` +
        `${data.numFailedTests || 0} failed) in ${((data.totalDuration || 0) / 1000).toFixed(1)}s`,
    );
  } catch (e) {
    console.warn(`Failed to parse ${shardMetricsPath}: ${e.message}`);
  }
}
if (metricsMergedCount > 0) {
  fs.writeFileSync(path.join(ROOT, 'unit-metrics.json'), JSON.stringify(mergedMetrics, null, 2));
  console.log(
    `Merged unit-metrics from ${metricsMergedCount}/${SHARDS} shards: ${mergedMetrics.numTotalTests} tests total, ` +
      `${(mergedMetrics.totalDuration / 1000).toFixed(1)}s`,
  );
}

// ── Stage 4: enforce thresholds (fail closed on missing summary / missing per-file target) ──────────
const enforceStart = process.hrtime.bigint();
const summaryPath = path.join(coverageDir, 'coverage-summary.json');
const result = enforceThresholds({ summaryPath });
const totalPerFile = Object.keys(COVERAGE_THRESHOLDS.files).length;
console.log(
  `Threshold check (${ms(enforceStart)}): global=${result.checked.global}, ` +
    `per-file=${result.checked.files.length}/${totalPerFile}`,
);
if (!result.ok) {
  fail([...result.errors, 'One or more coverage thresholds were not met.']);
}
console.log('✅ All coverage thresholds met.');
