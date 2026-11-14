// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { checkPartition, PARTITION_HOLD } from '../../scripts/ci-unit-partition-check.mjs';
import { durationsFromShards, combineDurationReceipts } from '../../scripts/ci-unit-durations-refresh.mjs';

const root = '/repo';
const discovered = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ file: `/repo/tests/${n}.test.js` }));
const record = (...names) => ({
  schemaVersion: 1,
  kind: 'vitest-executed-files',
  files: names.map((n) => ({ path: `tests/${n}.test.js`, state: 'pass', durationMs: 100 })),
});
const fourShards = (a, b, c, d) => [a, b, c, d].map((r, i) => ({ shard: i + 1, record: r }));

describe('unit shard partition check (fail closed)', () => {
  it('accepts exactly one execution of every discovered file', () => {
    const result = checkPartition({ root, discovered, shards: fourShards(record('a', 'b'), record('c'), record('d'), record('e')) });
    expect(result).toMatchObject({ ok: true, reasons: [], discoveredCount: 5, executedCount: 5 });
  });

  it('accepts an empty shard when there are fewer files than shards', () => {
    expect(checkPartition({ root, discovered, shards: fourShards(record('a', 'b', 'c'), record('d'), record('e'), record()) }).ok).toBe(true);
  });

  it('rejects a discovered file that no shard executed', () => {
    const result = checkPartition({ root, discovered, shards: fourShards(record('a', 'b'), record('c'), record('d'), record()) });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([`${PARTITION_HOLD.NOT_EXECUTED}:tests/e.test.js`]);
  });

  it('rejects a file executed by two shards', () => {
    const result = checkPartition({ root, discovered, shards: fourShards(record('a', 'b'), record('b', 'c'), record('d'), record('e')) });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([`${PARTITION_HOLD.DUPLICATED}:tests/b.test.js:shard-1+shard-2`]);
  });

  it('rejects an executed file that discovery does not know', () => {
    const result = checkPartition({ root, discovered, shards: fourShards(record('a', 'b'), record('c'), record('d'), record('e', 'zz')) });
    expect(result.reasons).toEqual([`${PARTITION_HOLD.UNDISCOVERED}:tests/zz.test.js`]);
  });

  it('rejects a missing, foreign or malformed shard record', () => {
    for (const bad of [null, {}, { schemaVersion: 2, kind: 'vitest-executed-files', files: [] },
      { schemaVersion: 1, kind: 'other', files: [] }, { schemaVersion: 1, kind: 'vitest-executed-files', files: 'x' },
      { schemaVersion: 1, kind: 'vitest-executed-files', files: [{ path: '' }] },
      { schemaVersion: 1, kind: 'vitest-executed-files', files: [{ path: '../outside.test.js' }] }]) {
      const result = checkPartition({ root, discovered, shards: fourShards(record('a', 'b'), record('c'), record('d'), bad) });
      expect(result.ok).toBe(false);
      expect(result.reasons).toContain(`${PARTITION_HOLD.SHARD_MISSING}:shard-4`);
    }
  });

  it('rejects missing, malformed or empty discovery instead of trusting the shards', () => {
    const shards = fourShards(record('a'), record('b'), record('c'), record('d', 'e'));
    expect(checkPartition({ root, discovered: null, shards }).reasons).toEqual([PARTITION_HOLD.DISCOVERY_MISSING]);
    expect(checkPartition({ root, discovered: [{ nope: 1 }], shards }).reasons).toEqual([PARTITION_HOLD.DISCOVERY_MISSING]);
    expect(checkPartition({ root, discovered: [], shards }).reasons).toEqual([PARTITION_HOLD.DISCOVERY_EMPTY]);
  });
});

describe('duration refresh turns executed-file costs into hints only', () => {
  it('keeps passing files with a valid cost and leaves the rest to the median estimate', () => {
    const shards = [
      { shard: 1, record: { schemaVersion: 1, kind: 'vitest-executed-files', files: [
        { path: 'b.test.js', state: 'pass', durationMs: 20.4 },
        { path: 'a.test.js', state: 'fail', durationMs: 50 },
      ] } },
      { shard: 2, record: { schemaVersion: 1, kind: 'vitest-executed-files', files: [
        { path: 'c.test.js', state: 'pass', durationMs: 0 },
        { path: 'd.test.js', state: 'pass', durationMs: 4_000_000 },
        { path: 'a2.test.js', state: 'pass', durationMs: 7 },
      ] } },
    ];
    expect(durationsFromShards(shards)).toEqual({ 'a2.test.js': 7, 'b.test.js': 20 });
    expect(Object.keys(durationsFromShards(shards))).toEqual(['a2.test.js', 'b.test.js']);
  });

  it('refuses malformed, duplicated or missing shard records', () => {
    const ok = { schemaVersion: 1, kind: 'vitest-executed-files', files: [{ path: 'a.test.js', state: 'pass', durationMs: 1 }] };
    expect(() => durationsFromShards([{ shard: 1, record: null }])).toThrow();
    expect(() => durationsFromShards([{ shard: 1, record: ok }, { shard: 2, record: ok }])).toThrow();
    expect(() => durationsFromShards([{ shard: 1, record: { ...ok, files: [{ path: '../x' }] } }])).toThrow();
  });
});

describe('combining hints from several runs', () => {
  const receipt = (runId, durationsMs) => ({ schemaVersion: 1,
    source: { repository: 'o/r', commit: 'a'.repeat(40), runId, basis: 'x' }, durationsMs });

  it('averages each file over the runs that measured it and records every source run', () => {
    const combined = combineDurationReceipts([receipt(1, { 'b.test.js': 100, 'a.test.js': 30 }), receipt(2, { 'b.test.js': 200, 'c.test.js': 9 })]);
    expect(combined.durationsMs).toEqual({ 'a.test.js': 30, 'b.test.js': 150, 'c.test.js': 9 });
    expect(Object.keys(combined.durationsMs)).toEqual(['a.test.js', 'b.test.js', 'c.test.js']);
    expect(combined.source.runs).toEqual([{ runId: 1, commit: 'a'.repeat(40) }, { runId: 2, commit: 'a'.repeat(40) }]);
  });

  it('refuses a single run, a repeated run, mixed repositories or a malformed file', () => {
    expect(() => combineDurationReceipts([receipt(1, {})])).toThrow();
    expect(() => combineDurationReceipts([receipt(1, {}), receipt(1, {})])).toThrow();
    const other = receipt(2, {});
    other.source.repository = 'x/y';
    expect(() => combineDurationReceipts([receipt(1, {}), other])).toThrow();
    expect(() => combineDurationReceipts([receipt(1, {}), { schemaVersion: 1, durationsMs: {} }])).toThrow();
  });

  it('refuses a damaged duration instead of dropping it from the average', () => {
    for (const bad of ['100', 0, -5, 4_000_000, Number.NaN, null]) {
      expect(() => combineDurationReceipts([receipt(1, { 'a.test.js': bad }), receipt(2, { 'a.test.js': 200 })])).toThrow(/malformed duration/);
    }
    expect(() => combineDurationReceipts([receipt(1, { '../a.test.js': 1 }), receipt(2, {})])).toThrow(/malformed duration/);
  });

  it('the committed hints are a combination the sequencer accepts', () => {
    const committed = JSON.parse(readFileSync('scripts/ci-unit-durations.json', 'utf8'));
    expect(committed.schemaVersion).toBe(1);
    expect(committed.source.runs.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(committed.durationsMs).every((ms) => Number.isInteger(ms) && ms > 0 && ms <= 3_600_000)).toBe(true);
  });
});

describe('workflow and config wiring', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const shardSteps = workflow.jobs['unit-shard'].steps;
  const mergeSteps = workflow.jobs['unit-coverage-merge'].steps;

  it('uploads each shard executed-file record next to its unit metrics', () => {
    const rename = shardSteps.find((s) => s.name === 'Rename Unit Metrics');
    expect(rename.run).toContain('mv unit-file-timings.json artifacts/coverage/shard-${{ matrix.shard }}/unit-file-timings.json');
    const upload = shardSteps.find((s) => s.name === 'Upload Unit Artifacts');
    expect(upload.with.path).toBe('artifacts/coverage');
  });

  it('proves the partition after downloading shard artifacts and before coverage is qualified', () => {
    const names = mergeSteps.map((s) => s.name);
    const check = names.indexOf('Verify Every Unit Test File Executed Exactly Once');
    expect(check).toBeGreaterThan(names.indexOf('Download Artifacts'));
    expect(check).toBeLessThan(names.indexOf('Run Coverage Merge'));
    const step = mergeSteps[check];
    expect(step['continue-on-error']).toBeUndefined();
    expect(step.if).toBeUndefined();
    expect(step.run).toContain('set -euo pipefail');
    expect(step.run).toContain('vitest list --filesOnly --config frontend/vitest.config.mjs');
    expect(step.run).toContain('node scripts/ci-unit-partition-check.mjs');
  });

  it('refreshes scheduling hints from the same run only after the partition is proven', () => {
    const names = mergeSteps.map((s) => s.name);
    const refresh = names.indexOf('Report Shard Balance And Refreshed Scheduling Hints');
    expect(refresh).toBeGreaterThan(names.indexOf('Verify Every Unit Test File Executed Exactly Once'));
    const step = mergeSteps[refresh];
    expect(step['continue-on-error']).toBeUndefined();
    expect(step.run).toContain('node scripts/ci-unit-durations-refresh.mjs artifacts/coverage --repository "$GITHUB_REPOSITORY"');
    expect(step.run).toContain('--commit "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID"');
    expect(mergeSteps[names.indexOf('Upload Refreshed Scheduling Hints')].with['if-no-files-found']).toBe('error');
  });

  it('activates the duration sequencer only for CI shard runs', () => {
    const config = readFileSync('frontend/vitest.config.mjs', 'utf8');
    expect(config).toContain("sequence: process.env.CI_SHARD_MODE === 'true' ? { sequencer: DurationSequencer } : undefined");
    expect(readFileSync('scripts/test-audit.sh', 'utf8')).toMatch(/CI_SHARD_MODE=true pnpm exec vitest run[^\n]*--shard=/);
  });
});

it('real Vitest shards with the real reporter pass the real partition check, and a dropped file fails it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unit-partition-'));
  try {
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
    const sequencer = here('../../scripts/ci-duration-sequencer.mjs');
    const reporter = here('../../scripts/vitest-ci-reporter.mjs');
    const checker = here('../../scripts/ci-unit-partition-check.mjs');
    writeFileSync(join(dir, 'vitest.config.mjs'), `import DurationSequencer from ${JSON.stringify(sequencer)};
export default { test: { environment: 'node', include: ['cases/**/*.test.js'], pool: 'forks', maxWorkers: 1, minWorkers: 1,
  sequence: process.env.CI_SHARD_MODE === 'true' ? { sequencer: DurationSequencer } : undefined } };`);
    mkdirSync(join(dir, 'cases', 'nested'), { recursive: true });
    for (let i = 0; i < 9; i++) {
      const sub = i % 3 === 0 ? 'nested/' : '';
      writeFileSync(join(dir, 'cases', `${sub}case-${i}.test.js`), `import { it, expect } from 'vitest'; it('runs', () => expect(${i}).toBe(${i}));`);
    }
    const cli = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
    for (let shard = 1; shard <= 4; shard++) {
      const run = spawnSync(process.execPath, [cli, 'run', '--config', 'vitest.config.mjs', `--shard=${shard}/4`,
        '--reporter=default', `--reporter=${reporter}`], { cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, CI_SHARD_MODE: 'true' } });
      expect(run.status).toBe(0);
      mkdirSync(join(dir, 'coverage', `shard-${shard}`), { recursive: true });
      renameSync(join(dir, 'unit-file-timings.json'), join(dir, 'coverage', `shard-${shard}`, 'unit-file-timings.json'));
    }
    const list = spawnSync(process.execPath, [cli, 'list', '--filesOnly', '--config', 'vitest.config.mjs', '--json=discovered.json'],
      { cwd: dir, encoding: 'utf8', timeout: 30000 });
    expect(list.status).toBe(0);

    const pass = spawnSync(process.execPath, [checker, 'discovered.json', 'coverage'], { cwd: dir, encoding: 'utf8' });
    expect(pass.status).toBe(0);
    expect(pass.stdout).toContain('discovered=9 executed=9');

    // Negative control on the same real artifacts: drop one executed file from one shard.
    const target = [1, 2, 3, 4].map((s) => join(dir, 'coverage', `shard-${s}`, 'unit-file-timings.json'))
      .find((file) => JSON.parse(readFileSync(file, 'utf8')).files.length > 0);
    const data = JSON.parse(readFileSync(target, 'utf8'));
    const dropped = data.files.pop();
    writeFileSync(target, JSON.stringify(data));
    const fail = spawnSync(process.execPath, [checker, 'discovered.json', 'coverage'], { cwd: dir, encoding: 'utf8' });
    expect(fail.status).not.toBe(0);
    expect(fail.stdout).toContain(`${PARTITION_HOLD.NOT_EXECUTED}:${dropped.path}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);
