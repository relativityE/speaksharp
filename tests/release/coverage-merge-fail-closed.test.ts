import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The merge validator's testable core. Importing the .mjs lib directly keeps these fixtures fast (no
// child process) and proves the fail-closed contract at the exact boundary CI relies on.
import { loadShardCoverage, enforceThresholds } from '../../scripts/coverage-merge-lib.mjs';
import { COVERAGE_THRESHOLDS } from '../../scripts/coverage-thresholds.mjs';

/**
 * #1262 — the merged unit-coverage gate must FAIL CLOSED. In CI it is the sole coverage authority, so a
 * lost shard, a malformed report, a missing summary, or a declared per-file threshold whose file never
 * appears in the summary must all be hard failures — never a warning that lets the pipeline pass on
 * partial or absent data. These are the negative fixtures the issue requires.
 */

let dir: string;
const shardDir = (n: number) => path.join(dir, `shard-${n}`);
const writeShard = (n: number, json: string) => {
  fs.mkdirSync(shardDir(n), { recursive: true });
  fs.writeFileSync(path.join(shardDir(n), 'coverage-final.json'), json);
};
// A minimal but VALID istanbul coverage-final.json merges cleanly (empty coverage map is fine here —
// the shard-loading contract under test is presence + parseability, not the numbers).
const validShardJson = () => JSON.stringify({});

/** Build a coverage summary that passes every declared floor (each pct = floor + 5, total = 100). */
function passingSummary(): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    total: { statements: { pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, lines: { pct: 100 } },
  };
  for (const [filePart, floors] of Object.entries(COVERAGE_THRESHOLDS.files)) {
    // Summary keys are absolute in real runs; enforceThresholds matches the declared path as a substring.
    summary[`/abs/repo/${filePart}`] = {
      statements: { pct: floors.statements + 5 },
      branches: { pct: floors.branches + 5 },
      functions: { pct: floors.functions + 5 },
      lines: { pct: floors.lines + 5 },
    };
  }
  return summary;
}
const writeSummary = (obj: unknown) =>
  fs.writeFileSync(path.join(dir, 'coverage-summary.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
const summaryPath = () => path.join(dir, 'coverage-summary.json');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-merge-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('#1262 — merged coverage loads fail closed on shard problems', () => {
  it('positive: all expected shards present and parseable → ok', () => {
    for (let n = 1; n <= 4; n++) writeShard(n, validShardJson());
    const r = loadShardCoverage({ coverageDir: dir, shards: 4 });
    expect(r.ok).toBe(true);
    expect(r.mergedShards).toEqual([1, 2, 3, 4]);
    expect(r.missing).toEqual([]);
  });

  it('shard loss: a missing shard is a hard failure', () => {
    writeShard(1, validShardJson());
    writeShard(2, validShardJson());
    // shard-3 and shard-4 never written.
    const r = loadShardCoverage({ coverageDir: dir, shards: 4 });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([3, 4]);
    expect(r.errors.join(' ')).toMatch(/shard loss/i);
  });

  it('malformed report: an unparseable shard is a hard failure (not a silent skip)', () => {
    for (let n = 1; n <= 3; n++) writeShard(n, validShardJson());
    writeShard(4, '{ this is not valid json');
    const r = loadShardCoverage({ coverageDir: dir, shards: 4 });
    expect(r.ok).toBe(false);
    expect(r.malformed.map((m) => m.shard)).toEqual([4]);
    expect(r.errors.join(' ')).toMatch(/malformed/i);
  });
});

describe('#1262 — threshold enforcement fails closed', () => {
  it('positive: a passing summary with every declared file present → ok', () => {
    writeSummary(passingSummary());
    const r = enforceThresholds({ summaryPath: summaryPath() });
    expect(r.ok).toBe(true);
    expect(r.checked.global).toBe(true);
    expect(r.checked.files.length).toBe(Object.keys(COVERAGE_THRESHOLDS.files).length);
  });

  it('missing summary: absent coverage-summary.json is a hard failure', () => {
    // Nothing written.
    const r = enforceThresholds({ summaryPath: summaryPath() });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/summary not found/i);
  });

  it('malformed summary: unparseable coverage-summary.json is a hard failure', () => {
    writeSummary('{ not json');
    const r = enforceThresholds({ summaryPath: summaryPath() });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/malformed/i);
  });

  it('missing threshold target: a declared per-file threshold absent from the summary is a hard failure', () => {
    const summary = passingSummary();
    const [firstFile] = Object.keys(COVERAGE_THRESHOLDS.files);
    delete summary[`/abs/repo/${firstFile}`]; // the file has a declared floor but never appears in coverage
    writeSummary(summary);
    const r = enforceThresholds({ summaryPath: summaryPath() });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/absent from the coverage summary/i);
  });

  it('threshold breach: a global metric below its floor is a hard failure', () => {
    const summary = passingSummary() as { total: { lines: { pct: number } } } & Record<string, unknown>;
    summary.total.lines = { pct: COVERAGE_THRESHOLDS.global.lines - 1 };
    writeSummary(summary);
    const r = enforceThresholds({ summaryPath: summaryPath() });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/global lines/i);
  });
});
