/**
 * #1262 — the testable core of the coverage merge/validate step, split out so the fail-closed edges are
 * covered by fast negative-fixture unit tests instead of only by a full CI run.
 *
 * Every function is pure with respect to process state: it RETURNS a result (never calls process.exit),
 * so tests can assert `ok`/`errors` directly and the CLI wrapper (scripts/merge-coverage.mjs) decides the
 * exit code. The governing rule (#1262): shard loss, a missing/malformed coverage report, a missing
 * coverage summary, and a declared per-file threshold whose file is absent from the summary are ALL hard
 * failures. Nothing here is allowed to pass on partial or absent data.
 */

import fs from 'node:fs';
import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import { COVERAGE_METRICS, COVERAGE_THRESHOLDS } from './coverage-thresholds.mjs';

/**
 * Load and merge every expected shard's `coverage-final.json`. A missing shard file (shard loss) or an
 * unparseable one (malformed report) is collected as a hard error — never skipped with a warning.
 *
 * @param {{ coverageDir: string, shards: number }} opts
 * @returns {{ ok: boolean, map: import('istanbul-lib-coverage').CoverageMap, mergedShards: number[], missing: number[], malformed: Array<{ shard: number, reason: string }>, errors: string[], timings: Array<{ shard: number, ms: number }> }}
 */
export function loadShardCoverage({ coverageDir, shards }) {
  const map = libCoverage.createCoverageMap();
  const mergedShards = [];
  const missing = [];
  const malformed = [];
  const timings = [];

  for (let shard = 1; shard <= shards; shard++) {
    const jsonPath = path.join(coverageDir, `shard-${shard}`, 'coverage-final.json');
    if (!fs.existsSync(jsonPath)) {
      missing.push(shard);
      continue;
    }
    const started = process.hrtime.bigint();
    let data;
    try {
      data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      malformed.push({ shard, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    map.merge(data);
    mergedShards.push(shard);
    timings.push({ shard, ms: Number(process.hrtime.bigint() - started) / 1e6 });
  }

  const errors = [];
  if (missing.length > 0) {
    errors.push(`shard loss: missing coverage-final.json for shard(s) ${missing.join(', ')} of ${shards} expected`);
  }
  for (const m of malformed) {
    errors.push(`malformed coverage report for shard ${m.shard}: ${m.reason}`);
  }

  return { ok: errors.length === 0, map, mergedShards, missing, malformed, errors, timings };
}

/**
 * Enforce global + per-file thresholds against a coverage-summary.json. Fail closed when the summary is
 * absent or unparseable, and when a file that HAS a declared per-file threshold is absent from the
 * summary (that absence usually means shard loss or an exclusion drift — never silently skip it).
 *
 * @param {{ summaryPath: string, thresholds?: typeof COVERAGE_THRESHOLDS }} opts
 * @returns {{ ok: boolean, errors: string[], checked: { global: boolean, files: string[] } }}
 */
export function enforceThresholds({ summaryPath, thresholds = COVERAGE_THRESHOLDS }) {
  const errors = [];
  const checked = { global: false, files: /** @type {string[]} */ ([]) };

  if (!fs.existsSync(summaryPath)) {
    return { ok: false, errors: [`coverage summary not found at ${summaryPath} — cannot verify thresholds (fail closed)`], checked };
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`coverage summary is malformed: ${e instanceof Error ? e.message : String(e)}`], checked };
  }

  // Global floors.
  const total = summary.total || {};
  checked.global = true;
  for (const key of COVERAGE_METRICS) {
    const actual = total[key] ? total[key].pct : 0;
    const expected = thresholds.global[key];
    if (actual < expected) {
      errors.push(`global ${key} ${actual}% is below the ${expected}% floor`);
    }
  }

  // Per-file floors. Summary keys are absolute paths; match the declared repo-relative path as a suffix.
  for (const [filePart, fileThresholds] of Object.entries(thresholds.files)) {
    const matchingKey = Object.keys(summary).find((k) => k.includes(filePart));
    if (!matchingKey) {
      // Fail closed: a declared threshold we cannot verify is a hard failure, not a warning.
      errors.push(`per-file threshold declared for ${filePart} but it is absent from the coverage summary (fail closed)`);
      continue;
    }
    checked.files.push(filePart);
    const fileSummary = summary[matchingKey];
    for (const key of COVERAGE_METRICS) {
      const actual = fileSummary[key] ? fileSummary[key].pct : 0;
      const expected = fileThresholds[key];
      if (actual < expected) {
        errors.push(`${filePart} ${key} ${actual}% is below the ${expected}% floor`);
      }
    }
  }

  return { ok: errors.length === 0, errors, checked };
}
