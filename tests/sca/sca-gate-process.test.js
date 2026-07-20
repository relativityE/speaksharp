import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GATE = join(ROOT, 'scripts', 'sca-osv-gate.mjs');
const FAKE = join(HERE, 'fixtures', 'fake-osv.mjs');

// Valid osv-scanner envelope whose only critical is the ignored vitest GHSA →
// evaluation proceeds and PASSES (exit 0).
const IGNORED_CRITICAL = JSON.stringify({
  results: [{ packages: [{ package: { name: 'vitest', version: '3.2.4' },
    vulnerabilities: [{ id: 'GHSA-5xrq-8626-4rwp', aliases: ['GHSA-5xrq-8626-4rwp'], database_specific: { severity: 'CRITICAL' } }] }] }],
});

function runGate({ exit, stdout, stdoutDb, signal }) {
  return spawnSync(process.execPath, [GATE], {
    encoding: 'utf8',
    env: { ...process.env, OSV_SCANNER: FAKE,
      FAKE_OSV_EXIT: String(exit ?? 0),
      ...(stdout != null ? { FAKE_OSV_STDOUT: stdout } : {}),
      ...(stdoutDb != null ? { FAKE_OSV_STDOUT_DB: stdoutDb } : {}),
      ...(signal ? { FAKE_OSV_SIGNAL: signal } : {}) },
  });
}

// A non-ignored CRITICAL that must BLOCK.
const BLOCKING_CRITICAL = JSON.stringify({
  results: [{ packages: [{ package: { name: 'evil-pkg', version: '1.0.0' },
    vulnerabilities: [{ id: 'GHSA-0000-0000-0000', aliases: ['GHSA-0000-0000-0000'], database_specific: { severity: 'CRITICAL' } }] }] }],
});

describe('Gate 4 process-level scanner exit-code handling (fail-closed)', () => {
  it('exit 0 + valid JSON → proceeds normally (exit 0)', () => {
    const r = runGate({ exit: 0, stdout: '{"results":[]}' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PASS/);
  });
  it('exit 1 + valid JSON → proceeds to advisory evaluation (ignored critical → exit 0)', () => {
    const r = runGate({ exit: 1, stdout: IGNORED_CRITICAL });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/IGNORED/);
    expect(r.stdout).toMatch(/PASS/);
  });
  it('exit 127 + valid-looking JSON → fails closed (exit 2), does not parse', () => {
    const r = runGate({ exit: 127, stdout: IGNORED_CRITICAL });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/status 127|scanner\/infrastructure failure/);
  });
  it('exit 128 → fails closed (exit 2)', () => {
    expect(runGate({ exit: 128, stdout: '{"results":[]}' }).status).toBe(2);
  });
  it('exit 129 → fails closed (exit 2)', () => {
    expect(runGate({ exit: 129, stdout: '{"results":[]}' }).status).toBe(2);
  });
  it('signal termination → fails closed (exit 2)', () => {
    const r = runGate({ signal: 'SIGKILL', stdout: '{"results":[]}' });
    expect(r.status).toBe(2);
  });
});

describe('Gate 4 scans BOTH lockfiles (root + tests/db)', () => {
  it('clean → reports both lockfiles by name and passes', () => {
    const r = runGate({ exit: 0, stdout: '{"results":[]}' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/pnpm-lock\.yaml/);
    expect(r.stdout).toMatch(/tests\/db\/package-lock\.json/);
    expect(r.stdout).toMatch(/across 2 lockfile\(s\)/);
  });
  it('a BLOCKING critical present ONLY in the DB lockfile → FAILS (exit 1)', () => {
    const r = runGate({ exit: 1, stdout: '{"results":[]}', stdoutDb: BLOCKING_CRITICAL });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL/);
  });
  it('a BLOCKING critical in the root lockfile → FAILS (exit 1)', () => {
    const r = runGate({ exit: 1, stdout: BLOCKING_CRITICAL, stdoutDb: '{"results":[]}' });
    expect(r.status).toBe(1);
  });
});
