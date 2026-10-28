import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { load } from 'js-yaml';
import { bootstrapSql, cases, candidate } from '../db/content-free-retention-evidence.realpg.mjs';

const workflowPath = '.github/workflows/retention-current-contract-matrix.yml';
const workflow = readFileSync(workflowPath, 'utf8');
const parsed = load(workflow);
const fixture = readFileSync('tests/db/content-free-retention-evidence.realpg.mjs', 'utf8');
const pins = JSON.parse(readFileSync('tests/db/retention-owner-matrix-pins.json', 'utf8'));
const matches = (path, pattern) => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern;

describe('#1610 current-contract owner matrix wiring', () => {
  it('retains the sixteen current cases plus all three original native lock cases', () => {
    expect(Object.keys(cases)).toHaveLength(16);
    for (const name of ['native-statement-nowait-refusal-and-retry', 'native-service-prelocked-session-nowait-and-retry',
      'native-prelocked-recovery-delete-nowait-and-retry']) expect(fixture).toContain(name);
    expect(fixture).toContain('for (const [name, body] of Object.entries(cases))');
    expect(fixture).toContain('if (failure) throw failure');
    expect(candidate()).toContain('retention_successful_replacement_required');
  });
  it('loads the unchanged current bootstrap including pending, recording and coaching guards', () => {
    const sql = bootstrapSql();
    for (const token of ['CREATE ROLE closure_owner NOSUPERUSER', 'account_coaching_operations',
      'account_pending_completion', 'recording_fenced_reason', 'expire_transcripts_newest_one']) expect(sql).toContain(token);
    expect(fixture).not.toContain('SET session_replication_role');
    expect(fixture).toContain('assertRetentionOwners(owners.rows)');
  });
  it('runs three pinned source builds and never substitutes Docker digests or floating packages', () => {
    expect(pins.kind).toBe('postgresql-source-tarball-sha256-not-container-digest');
    expect(pins.versions.map(p => p.major)).toEqual([15, 16, 17]);
    expect(pins.versions.map(p => p.version)).toEqual(['15.19', '16.15', '17.11']);
    for (const p of pins.versions) expect(p.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.jobs['native-owner'].strategy.matrix.major).toEqual([15, 16, 17]);
    expect(workflow).toContain('sha256sum --check --strict');
    expect(workflow.indexOf('sha256sum --check --strict')).toBeLessThan(workflow.indexOf('tar --extract'));
    expect(workflow).not.toMatch(/docker|supabase link|secrets\.|apt-get|sudo/);
    expect(parsed.permissions).toEqual({ contents: 'read' });
  });
  it('bounds every acquisition/build/test phase and opts into native execution only inside CI', () => {
    expect(parsed.jobs['native-owner']['timeout-minutes']).toBe(35);
    for (const command of ['--max-time 180', 'timeout --kill-after=10s 120 ./configure',
      'timeout --kill-after=10s 900 make -j2', 'timeout --kill-after=10s 120 make install']) expect(workflow).toContain(command);
    expect(workflow).toContain("RETENTION_MATRIX_NATIVE: '1'");
    expect(workflow).toContain('node --test tests/db/retention-owner-matrix.test.mjs');
    const driver = readFileSync('tests/db/retention-owner-matrix.test.mjs', 'utf8');
    expect(driver).toContain("assert.equal(process.env.GITHUB_ACTIONS, 'true'");
    expect(driver).toContain('ownerMatrix: true');
    expect(driver).toContain('expectedVersion: pin.version');
  });
  it('covers transitive SQL/bootstrap/helper dependencies, not only the migration under test', () => {
    const paths = parsed.on.pull_request.paths;
    const seen = new Set();
    function visit(path) {
      if (seen.has(path)) return;
      seen.add(path);
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
        if (match[1].startsWith('.')) visit(resolve(dirname(path), match[1]).slice(process.cwd().length + 1));
      }
      for (const match of text.matchAll(/['"]([\w]+\.sql)['"]/g)) seen.add(`backend/supabase/migrations/${match[1]}`);
      for (const match of text.matchAll(/readFileSync\(\s*['"]([^'"]+)['"]/g)) seen.add(match[1]);
    }
    visit('tests/db/content-free-retention-evidence.realpg.mjs');
    visit('tests/db/retention-owner-matrix.test.mjs');
    // pendingBootstrap extracts this fixture's real SQL, rather than importing TS.
    seen.add('tests/db/account-closure-tokens.integration.test.ts');
    for (const path of [...seen, workflowPath, 'tests/db/retention-owner-matrix-pins.json',
      'tests/unit/retentionCurrentContractMatrix.test.js']) {
      expect(paths.some(pattern => matches(path, pattern)), `missing workflow trigger: ${path}`).toBe(true);
    }
    expect(seen.size).toBeGreaterThan(25);
  });
  it('cannot label a case run PASS without owned process/socket/data cleanup', () => {
    expect(fixture).toContain('receipt.bodyComplete === true && receipt.cleanupVerified === true');
    expect(fixture).not.toContain('if (!started)');
    expect(fixture).toContain("assert.equal(after.processes.length, 0");
    expect(fixture).toContain("assert.equal(after.socketPresent, false");
    expect(fixture).toContain("assert.equal(after.pidFilePresent, false");
    expect(fixture).toContain('ownedRetentionProcessIds(processes');
    expect(fixture).toContain("-c listen_addresses=''");
  });
});
