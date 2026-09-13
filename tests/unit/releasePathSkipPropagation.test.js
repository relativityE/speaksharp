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
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MEANINGFUL_COVERAGE_MANIFEST,
  validateSoftwareQualityEvidence,
} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';

const REPO = resolve(__dirname, '..', '..');
const MERGE = join(REPO, 'scripts', 'merge-coverage.mjs');
const METRICS_SH = join(REPO, 'scripts', 'run-metrics.sh');
const MERGED_AT_ROOT = join(REPO, 'unit-metrics.json');
const RUN_METRICS_SH = join(REPO, 'scripts', 'run-metrics.sh');
const EVIDENCE_WRITER = join(REPO, 'scripts', 'write-software-quality-evidence.mjs');

/**
 * Environment for a spawned fixture process.
 *
 * `NODE_V8_COVERAGE` MUST BE SET TO THE EMPTY STRING — **deleting it does not work.**
 *
 * Vitest points it at a shared `artifacts/coverage/.tmp`. A child that inherits it writes its own
 * `coverage-<pid>.json` into that directory while vitest is reading and cleaning it, which surfaced as
 * an unhandled `ENOENT ... coverage-43.json` that failed the whole unit run without failing a single
 * test. These subprocesses are FIXTURES, not code under measurement, so their coverage would also
 * pollute the very report they are used to verify.
 *
 * My first attempt deleted the key from the supplied `env` and asserted that suppressed it. It does
 * not: Node re-propagates the parent's coverage directory to children even when the key is absent from
 * `env`, because subprocess coverage is a deliberate feature. Measured on Node v22.12.0 — a child
 * spawned with the key deleted still observed the parent's directory, while a child given `''`
 * observed `''`. The race disappearing after that change was timing, not the change.
 *
 * The empty string is the documented "off" value, and `assertsFixtureCoverageDisabled` below proves a
 * real child observes it that way rather than trusting this comment.
 */
const fixtureEnv = (extra = {}) => ({ ...process.env, ...extra, NODE_V8_COVERAGE: '' });

/** Drives the REAL merge script over two shard files and returns what it wrote. */
function mergeShards(shardPayloads) {
  const dir = mkdtempSync(join(tmpdir(), 'skip-propagation-'));
  shardPayloads.forEach((payload, index) => {
    const shardDir = join(dir, `shard-${index + 1}`);
    mkdirSync(shardDir, { recursive: true });
    /*
     * `null` OMITS the artifact and the string 'UNPARSEABLE' corrupts it, so the three ways a shard can
     * fail to deliver skip identities are all reachable from one fixture. CI's `Rename Unit Metrics`
     * step uses `mv ... || true`, so "the file simply is not there" is a real production condition,
     * not a hypothetical.
     */
    if (payload !== null) {
      writeFileSync(
        join(shardDir, 'unit-metrics.json'),
        payload === 'UNPARSEABLE' ? '{ this is not json' : JSON.stringify(payload),
      );
    }
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
      env: fixtureEnv({ COVERAGE_DIR: dir, UNIT_SHARDS: String(shardPayloads.length) }),
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
    /*
     * The denominator is the EXPECTED shard count and the numerator is how many actually delivered a
     * parseable artifact, so a fixture that deliberately loses a shard asserts `1/2` rather than
     * `2/2`. Asserting the pair — not just the word "Merged" — keeps a real merge failure from
     * masquerading as a pass while still letting the shard-loss casualties below run.
     */
    const delivering = shardPayloads.filter(
      (payload) => payload !== null && payload !== 'UNPARSEABLE',
    ).length;
    expect(run.stdout, 'the metrics merge itself must have run')
      .toMatch(new RegExp(`Merged unit-metrics from ${delivering}/${shardPayloads.length} shards`));
    const mergedRaw = readFileSync(MERGED_AT_ROOT, 'utf8');
    return { merged: JSON.parse(mergedRaw), mergedRaw, status: run.status, stderr: run.stderr };
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

/**
 * #1430 P1 — DRIVE THE REAL RELEASE REPORT CHAIN, NOT A RECONSTRUCTION OF IT.
 *
 * `evidenceFrom()` above builds the evidence object in JavaScript. That proves the merge and the
 * validator agree, and NOTHING about the two stages between them, which is where this field was lost
 * twice: `run-metrics.sh` reads the merged file with jq, serializes the field into `unit_tests`, and
 * binds it as a jq variable; `write-software-quality-evidence.mjs` then reads that serialized report
 * and maps `unit_tests` onto `tests.unit`. A quoting, type, path or serialization regression anywhere
 * across those two survives a hand-built evidence object — as the shipped
 * `jq: error: $unit_skipped_test_files is not defined` proved, having passed a source-text assertion.
 *
 * So this runs what `full-evidence` runs: real merge -> real `run-metrics.sh` -> the serialized
 * `test-results/metrics.json` -> the real evidence writer, which calls the release validator itself
 * and exits non-zero when it refuses.
 *
 * HERMETIC. Everything downstream of the merge is driven in a temp cwd, because both scripts resolve
 * their inputs and outputs from `process.cwd()`. Nothing in the developer's repo is read or written by
 * these stages, and the run is independent of whether coverage, e2e or a build happen to be present.
 * (The merge itself writes to its own module root, which is why the helper above still stashes.)
 */
function runRealReportChain(shardPayloads) {
  const { mergedRaw } = mergeShards(shardPayloads);
  const cwd = mkdtempSync(join(tmpdir(), 'release-chain-'));
  const write = (rel, body) => {
    const target = join(cwd, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  };

  // The merge's own bytes, unmodified: this is the file `run-metrics.sh` reads in CI.
  write('unit-metrics.json', mergedRaw);

  /*
   * The rest of the report's inputs, staged only so the run reaches the skip check. Each is set to a
   * PASSING value, so the sole reason the validator can refuse is the one under test — if any of these
   * were the cause, the control case below would fail too.
   */
  write('frontend/coverage/coverage-summary.json', JSON.stringify({
    total: {
      statements: { pct: 95 }, branches: { pct: 95 }, functions: { pct: 95 }, lines: { pct: 95 },
    },
  }));
  write('test-results/playwright/results.json', JSON.stringify({
    stats: { expected: 20, unexpected: 0, flaky: 0, skipped: 0 },
  }));
  // `initial_chunk_size` is read from the emitted entry chunk; the validator refuses
  // `initial_chunk_metric_missing_or_unknown`, which is what a missing build would produce.
  write('frontend/dist/index.html', '<script type="module" src="/assets/index-real.js"></script>');
  write('frontend/dist/assets/index-real.js', 'console.log("chunk");\n'.repeat(300));
  /*
   * EVERY source dir the report measures must exist. `run-metrics.sh` runs
   * `du -sk frontend/src backend docs scripts tests` under `set -o pipefail`, so a single missing
   * directory makes the pipeline non-zero and `set -e` aborts the whole report — silently, with an
   * empty stderr. The real repo has all five; a fixture with fewer fails for a reason that has
   * nothing to do with skip identities.
   */
  for (const sourceDir of ['frontend/src', 'backend', 'docs', 'scripts', 'tests']) {
    write(`${sourceDir}/.keep`, 'source-size probe\n');
  }

  try {
    const metricsRun = spawnSync('bash', [RUN_METRICS_SH], {
      cwd,
      /*
       * `CI` IS DELIBERATELY INHERITED, NOT CLEARED.
       *
       * `run-metrics.sh` hard-exits under CI on a missing e2e results file and a missing entry chunk.
       * Both are staged above, so CI mode cannot trigger them — and running with the variable as the
       * lane actually sets it keeps this from silently becoming a local-only path. Clearing it would
       * exercise a branch CI never takes.
       */
      env: fixtureEnv({ TOTAL_RUNTIME_SECONDS: '120' }),
      encoding: 'utf8',
    });
    expect(metricsRun.status, `run-metrics.sh failed: ${metricsRun.stderr}`).toBe(0);

    const serializedPath = join(cwd, 'test-results', 'metrics.json');
    expect(existsSync(serializedPath), 'the report stage wrote test-results/metrics.json').toBe(true);
    const serialized = JSON.parse(readFileSync(serializedPath, 'utf8'));

    const writerRun = spawnSync('node', [EVIDENCE_WRITER], {
      cwd,
      env: fixtureEnv(),
      encoding: 'utf8',
    });
    const evidencePath = join(cwd, 'product_release', 'evidence', 'software-quality.latest.json');
    const evidence = existsSync(evidencePath)
      ? JSON.parse(readFileSync(evidencePath, 'utf8'))
      : null;

    return { serialized, writerRun, evidence };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('#1430 P1 — a skipped release path survives merge -> metrics -> validation', () => {
  const required = MEANINGFUL_COVERAGE_MANIFEST[0];
  const allRequired = MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile);

  it('CASUALTY: a required file skipped in ONE shard yields meaningful_coverage_path_skipped', () => {
    // End to end: the real merge subprocess unions the field across shards, and the validator then
    // rejects the path. Deleting either the merge push or the dedupe breaks this.
    const { merged } = mergeShards([
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
    const { merged } = mergeShards([
      shard(allRequired, [unrelated]),
      shard(allRequired, []),
    ]);

    expect(merged.skippedTestFiles, 'it is reported, not hidden').toContain(unrelated);

    const result = validateSoftwareQualityEvidence(evidenceFrom(merged));
    expect(result.valid, 'an unrelated skip is not a release-path claim').toBe(true);
    expect(result.reasons.join(' ')).not.toMatch(/meaningful_coverage_path_skipped/);
  });

  it('CASUALTY: the merge DEDUPES a path skipped in more than one shard', () => {
    const { merged } = mergeShards([
      shard(allRequired, [required.testFile]),
      shard(allRequired, [required.testFile]),
    ]);

    expect(merged.skippedTestFiles.filter((f) => f === required.testFile))
      .toHaveLength(1);
  });

  it('CASUALTY: a shard that OMITS skip identities is unmeasured, not clean — the merge fails closed', () => {
    /**
     * #1430 P1. The merge silently ignored a shard whose `skippedTestFiles` was absent or not an array.
     * Counts and `testFiles` still merged, `run-metrics.sh` defaulted the field to `[]`, and the
     * validator reads a missing value as "no skipped paths" — so the evidence could qualify having
     * never observed skip identities at all. Codex reproduced `valid: true` with the field omitted.
     *
     * That is absence substituted for a measured zero, which is the exact substitution this field was
     * added to prevent. A shard reporting counts but no identities is shard loss for this evidence.
     */
    const withoutField = { ...shard(allRequired, []) };
    delete withoutField.skippedTestFiles;

    const { stderr } = mergeShards([shard(allRequired, []), withoutField]);

    /**
     * ASSERTED ON THE SPECIFIC MESSAGE, NOT THE EXIT STATUS.
     *
     * The merge already exits non-zero on per-file coverage thresholds that a synthetic two-file
     * fixture cannot satisfy, so `status !== 0` is true whether or not this correction exists — it
     * would have passed before the fix and proved nothing. The named reason is the only assertion that
     * discriminates. The control below is its mirror.
     */
    expect(stderr, 'the merge names the shard and the reason')
      .toMatch(/did not supply a parseable unit metrics artifact with a `skippedTestFiles` array/);
    expect(stderr, 'and identifies which shard').toMatch(/shard\(s\) 2/);
  });

  it('CASUALTY: a shard with NO metrics artifact at all is shard loss, not a clean shard', () => {
    /**
     * #1430 P1. The guard added above ran only AFTER the file existed and parsed, so the two branches
     * that reach neither state still warned and continued: a shard could publish valid coverage and no
     * usable `unit-metrics.json`, and the merge would then serialize skip identities from only the
     * remaining shards. CI's rename step tolerates a missing output with `mv ... || true`, so this is
     * the likeliest of the three failures, and it was the one left open.
     */
    const { stderr } = mergeShards([shard(allRequired, []), null]);

    expect(stderr, 'a missing artifact is unmeasured, not empty')
      .toMatch(/did not supply a parseable unit metrics artifact with a `skippedTestFiles` array/);
    expect(stderr, 'and the shard is named').toMatch(/shard\(s\) 2/);
  });

  it('CASUALTY: a shard whose metrics artifact does not parse is shard loss too', () => {
    /**
     * Indistinguishable from absence for this evidence: we hold no skip identities from that shard and
     * must not infer it had none. Previously this branch warned and continued as well.
     */
    const { stderr } = mergeShards([shard(allRequired, []), 'UNPARSEABLE']);

    expect(stderr, 'an unparseable artifact is unmeasured, not empty')
      .toMatch(/did not supply a parseable unit metrics artifact with a `skippedTestFiles` array/);
    expect(stderr, 'and the shard is named').toMatch(/shard\(s\) 2/);
  });

  it('CONTROL: an EMPTY array from every shard is a measured zero and still qualifies', () => {
    // Failing closed on absence must not fail on a genuine "nothing was skipped". `[]` is evidence.
    const { merged, stderr } = mergeShards([shard(allRequired, []), shard(allRequired, [])]);

    expect(stderr, 'an empty array is a measured zero, not field loss')
      .not.toMatch(/without a valid `skippedTestFiles` array/);
    expect(merged.skippedTestFiles).toEqual([]);
    expect(validateSoftwareQualityEvidence(evidenceFrom(merged)).valid).toBe(true);
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

  it('CASUALTY: under a coverage-ACTIVE parent, fixtureEnv leaves the child with coverage disabled', () => {
    /**
     * #1430 P1. Proves the suppression instead of asserting it in a comment.
     *
     * TWO LEVELS, DELIBERATELY. Propagation happens only from a process where V8 coverage is genuinely
     * active, and that cannot be simulated by putting the key into a child's `env` object — an earlier
     * version of this case did exactly that and its control read `null`, because the vitest worker had
     * no coverage of its own. So a real coverage-active PARENT is spawned and IT spawns the children.
     * That is the CI topology: vitest runs under V8 coverage and these fixtures are its grandchildren.
     *
     * IT IS BOUND TO `fixtureEnv`, NOT TO THE STRING `''`. The probe reproduces whatever `fixtureEnv`
     * decided — the key set to its value, or the key absent if it omits it — so reverting the helper to
     * `delete env.NODE_V8_COVERAGE` makes the first expectation read the parent's directory and fail.
     * A previous version hardcoded `''` in the probe and the mutant survived, which is the whole reason
     * this note exists.
     *
     * The `deleted` control makes the first expectation non-vacuous: it shows Node handing the parent's
     * directory to a child that never asked for it.
     */
    const probe = mkdtempSync(join(tmpdir(), 'cov-probe-'));
    try {
      const child = join(probe, 'child.mjs');
      const parent = join(probe, 'parent.mjs');
      const covDir = join(probe, 'cov');
      writeFileSync(child, 'process.stdout.write(JSON.stringify(process.env.NODE_V8_COVERAGE ?? null));');

      // What the helper under test ACTUALLY produces for this key.
      const produced = fixtureEnv();
      const decision = {
        sets: Object.prototype.hasOwnProperty.call(produced, 'NODE_V8_COVERAGE'),
        value: produced.NODE_V8_COVERAGE ?? null,
      };

      writeFileSync(parent, [
        "import { spawnSync } from 'node:child_process';",
        `const child = ${JSON.stringify(child)};`,
        `const decision = ${JSON.stringify(decision)};`,
        "const read = (env) => spawnSync(process.execPath, [child], { env, encoding: 'utf8' }).stdout;",
        // Reproduce fixtureEnv's decision exactly, whatever it was.
        "const asFixture = { ...process.env };",
        "if (decision.sets) { asFixture.NODE_V8_COVERAGE = decision.value; }",
        "else { delete asFixture.NODE_V8_COVERAGE; }",
        "const deleted = { ...process.env };",
        "delete deleted.NODE_V8_COVERAGE;",
        'process.stdout.write(JSON.stringify({',
        '  underFixture: JSON.parse(read(asFixture)),',
        '  deleted: JSON.parse(read(deleted)),',
        '}));',
      ].join('\n'));

      const run = spawnSync(process.execPath, [parent], {
        // The parent really runs under coverage; this is what enables propagation at all.
        env: { ...process.env, NODE_V8_COVERAGE: covDir },
        encoding: 'utf8',
      });
      expect(run.status, `coverage probe failed: ${run.stderr}`).toBe(0);
      const observed = JSON.parse(run.stdout);

      expect(observed.underFixture,
        'a fixture child spawned under fixtureEnv sees coverage DISABLED, not the parent directory')
        .toBe('');
      expect(observed.deleted,
        'CONTROL: omitting the key does NOT suppress it — Node propagates the parent directory')
        .toBe(covDir);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it('CASUALTY: the REAL merge -> ci report -> evidence-writer chain refuses a skipped release path', () => {
    /**
     * The chain, end to end, with a skipped required path. The evidence writer runs the release
     * validator itself and exits non-zero, so the refusal is observed where the release lane observes
     * it — not by re-implementing the evidence object in the test.
     */
    const { serialized, writerRun, evidence } = runRealReportChain([
      shard(allRequired, [required.testFile]),
      shard(allRequired, []),
    ]);

    /*
     * THE SERIALIZATION IS ASSERTED ON ITS TYPE, NOT JUST ITS CONTENT.
     *
     * The defect that shipped was a jq variable that was named but never bound. Its neighbours were
     * quoting mistakes that turn an array into a string. `toContain` alone is true for the string
     * '["...path..."]', so the array-ness is asserted first and separately.
     */
    expect(Array.isArray(serialized.unit_tests.skippedTestFiles),
      'run-metrics.sh serialized skippedTestFiles as a JSON array').toBe(true);
    expect(serialized.unit_tests.skippedTestFiles,
      'and carried the skipped release path into the report').toContain(required.testFile);

    // The writer maps `unit_tests` onto `tests.unit`; a rename or a dropped field lands here.
    expect(writerRun.status, 'the evidence writer must REFUSE this report').toBe(1);
    expect(`${writerRun.stdout}${writerRun.stderr}`, 'naming the skipped requirement')
      .toContain(`meaningful_coverage_path_skipped:${required.id}`);
    expect(evidence, 'and must not publish qualified evidence').toBeNull();
  });

  it('CONTROL: the same REAL chain qualifies when every shard reports an explicit empty array', () => {
    /**
     * The casualty's mirror, and the reason it discriminates. `[]` is a measured zero and must travel
     * the whole chain as one: if the refusal above came from the staged coverage, e2e, runtime or
     * bundle inputs rather than from the skip, this case would refuse too.
     */
    const { serialized, writerRun, evidence } = runRealReportChain([
      shard(allRequired, []),
      shard(allRequired, []),
    ]);

    expect(Array.isArray(serialized.unit_tests.skippedTestFiles)).toBe(true);
    expect(serialized.unit_tests.skippedTestFiles, 'a measured zero, not a missing field').toEqual([]);

    expect(writerRun.status,
      `the evidence writer must ACCEPT this report: ${writerRun.stdout}${writerRun.stderr}`).toBe(0);
    expect(evidence, 'qualified evidence was published').not.toBeNull();
    expect(evidence.tests.unit.skippedTestFiles,
      'and the empty array survived into the published evidence').toEqual([]);
    expect(evidence.qualification.status).toBe('valid');
  });
});
