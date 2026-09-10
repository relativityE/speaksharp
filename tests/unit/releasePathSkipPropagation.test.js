/**
 * #1430 P1 — THE RELEASE-PATH SKIP CHECK MUST SURVIVE THE PIPELINE THAT FEEDS IT.
 *
 * The reporter emits `skippedTestFiles`; the validator rejects a manifest path that appears in it.
 * Between them sit two stages that dropped the field entirely: `merge-coverage.mjs` did not carry it
 * across shards, and `run-metrics.sh` never serialized it into `unit_tests`. The validator defaults a
 * missing field to `[]`, so on the sharded path — the only path CI takes — a required release-path
 * file whose acceptance casualty was skipped still qualified.
 *
 * The validator's own casualty injected `skippedTestFiles` directly, so it proved the rule and nothing
 * about the pipeline obliged to deliver it. That is the gap these cases close: the merge stage is
 * driven as a REAL SUBPROCESS over real shard files, and the shell stage is asserted against its own
 * source, because a rule expressed only in a shell script cannot otherwise be driven by a casualty.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MEANINGFUL_COVERAGE_MANIFEST,
  validateSoftwareQualityEvidence,
} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';

const REPO = resolve(__dirname, '..', '..');
const MERGE = join(REPO, 'scripts', 'merge-coverage.mjs');
const METRICS_SH = join(REPO, 'scripts', 'run-metrics.sh');
const MERGED_AT_ROOT = join(REPO, 'unit-metrics.json');

/** Drives the REAL merge script over two shard files and returns what it wrote. */
function mergeShards(shardPayloads) {
  const dir = mkdtempSync(join(tmpdir(), 'skip-propagation-'));
  shardPayloads.forEach((payload, index) => {
    const shardDir = join(dir, `shard-${index + 1}`);
    mkdirSync(shardDir, { recursive: true });
    writeFileSync(join(shardDir, 'unit-metrics.json'), JSON.stringify(payload));
    // The merge fails CLOSED on a missing `coverage-final.json` — shard loss is a real condition it
    // must refuse, so the fixture supplies a minimal one rather than the script being relaxed.
    writeFileSync(join(shardDir, 'coverage-final.json'), JSON.stringify({
      [`/repo/src/shard${index + 1}.ts`]: {
        path: `/repo/src/shard${index + 1}.ts`,
        statementMap: {}, fnMap: {}, branchMap: {}, s: {}, f: {}, b: {},
      },
    }));
  });

  // `merge-coverage.mjs` writes to the repo root by construction. Preserve anything already there so
  // a developer's real metrics file is never destroyed by running the suite.
  const stashed = existsSync(MERGED_AT_ROOT) ? `${MERGED_AT_ROOT}.testbak` : null;
  if (stashed) renameSync(MERGED_AT_ROOT, stashed);
  try {
    const run = spawnSync('node', [MERGE], {
      cwd: REPO,
      env: { ...process.env, COVERAGE_DIR: dir, UNIT_SHARDS: String(shardPayloads.length) },
      encoding: 'utf8',
    });
    /**
     * A NON-ZERO EXIT IS EXPECTED AND IS NOT THE SUBJECT.
     *
     * The script merges metrics FIRST and then enforces per-file coverage thresholds against the real
     * manifest, which a synthetic two-file fixture cannot satisfy. Making the fixture satisfy them
     * would couple this test to the coverage manifest and tell us nothing about skip propagation.
     *
     * So the exit status is tolerated, but not ignored: the merge line must be present, or a genuine
     * merge failure would masquerade as a pass.
     */
    expect(run.stdout, 'the metrics merge itself must have run')
      .toMatch(new RegExp(`Merged unit-metrics from ${shardPayloads.length}/${shardPayloads.length} shards`));
    return JSON.parse(readFileSync(MERGED_AT_ROOT, 'utf8'));
  } finally {
    rmSync(MERGED_AT_ROOT, { force: true });
    if (stashed) renameSync(stashed, MERGED_AT_ROOT);
    rmSync(dir, { recursive: true, force: true });
  }
}

// Counts kept internally consistent: the validator independently requires
// passed + failed + skipped === total, and an inconsistent fixture would fail for that reason
// instead of the one under test.
const shard = (testFiles, skippedTestFiles = []) => ({
  numPassedTests: 10, numFailedTests: 0, numFailedSuites: 0,
  numTotalTests: 10 + skippedTestFiles.length,
  totalDuration: 1000, numPendingTests: skippedTestFiles.length,
  testFiles, skippedTestFiles, failures: [],
});

/** The evidence shape `run-metrics.sh` produces, built from the merged metrics. */
const evidenceFrom = (merged) => ({
  tests: {
    unit: {
      passed: merged.numPassedTests,
      failed: merged.numFailedTests,
      skipped: merged.numPendingTests,
      total: merged.numTotalTests,
      testFiles: merged.testFiles,
      skippedTestFiles: merged.skippedTestFiles,
    },
    e2e: { passed: 20, failed: 0, skipped: 0, total: 20 },
  },
  runtime: { totalRuntimeSeconds: 120 },
  performance: { initialChunkSize: '412K' },
  targets: { coverage: { releaseFloor: 75 } },
  coverage: { statements: 80, branches: 80, functions: 80, lines: 80 },
});

describe('#1430 P1 — a skipped release path survives merge -> metrics -> validation', () => {
  const required = MEANINGFUL_COVERAGE_MANIFEST[0];
  const allRequired = MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile);

  it('CASUALTY: a required file skipped in ONE shard yields meaningful_coverage_path_skipped', () => {
    // End to end: the real merge subprocess unions the field across shards, and the validator then
    // rejects the path. Deleting either the merge push or the dedupe breaks this.
    const merged = mergeShards([
      shard(allRequired, [required.testFile]),
      shard(allRequired, []),
    ]);

    expect(merged.skippedTestFiles, 'the merge carried the skip across shards')
      .toContain(required.testFile);

    const result = validateSoftwareQualityEvidence(evidenceFrom(merged));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`meaningful_coverage_path_skipped:${required.id}`);
  });

  it('POSITIVE CONTROL: an unrelated skipped file is reported but blocks no required path', () => {
    const unrelated = 'frontend/src/services/__tests__/someUnrelatedThing.test.ts';
    const merged = mergeShards([
      shard(allRequired, [unrelated]),
      shard(allRequired, []),
    ]);

    expect(merged.skippedTestFiles, 'it is reported, not hidden').toContain(unrelated);

    const result = validateSoftwareQualityEvidence(evidenceFrom(merged));
    expect(result.valid, 'an unrelated skip is not a release-path claim').toBe(true);
    expect(result.reasons.join(' ')).not.toMatch(/meaningful_coverage_path_skipped/);
  });

  it('CASUALTY: the merge DEDUPES a path skipped in more than one shard', () => {
    const merged = mergeShards([
      shard(allRequired, [required.testFile]),
      shard(allRequired, [required.testFile]),
    ]);

    expect(merged.skippedTestFiles.filter((f) => f === required.testFile))
      .toHaveLength(1);
  });

  it('CASUALTY: run-metrics.sh both READS and SERIALIZES the field', () => {
    /**
     * A wiring assertion, deliberately. The shell stage cannot be driven from vitest without invoking
     * the whole metrics run, and it is exactly where the field was silently absent: the extraction and
     * the serialization are two separate lines and dropping either reproduces the defect. Asserting
     * both is what makes the mutation that deletes the pass-through fail.
     */
    const src = readFileSync(METRICS_SH, 'utf8');
    expect(src, 'extracted from the merged metrics').toMatch(/unit_skipped_test_files=\$\(jq '\.skippedTestFiles \/\/ \[\]'/);
    expect(src, 'serialized into unit_tests').toMatch(/"skippedTestFiles": \$unit_skipped_test_files/);
    /**
     * ...AND BOUND AS A JQ VARIABLE. This is the line I originally omitted, and CI caught it:
     *
     *   jq: error: $unit_skipped_test_files is not defined at <top-level>, line 8
     *
     * The serialization sits inside a jq PROGRAM, so a shell variable of the same name is invisible to
     * it — the value has to be passed with `--argjson`. Asserting the serialization alone proved the
     * field was named and nothing about it being reachable, which is the same "wired at one end only"
     * defect this whole test exists to prevent. Three lines are required, so three are asserted.
     */
    expect(src, 'bound as a jq variable').toMatch(/--argjson unit_skipped_test_files\s+"\$unit_skipped_test_files"/);
    // And defaulted on the no-metrics-file branch, or jq receives an unset variable and fails the same way.
    expect(src, 'defaulted when no metrics file exists').toMatch(/unit_skipped_test_files="\[\]"/);
  });
});
