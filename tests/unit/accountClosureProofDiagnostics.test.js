// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { captureOwnedDatabaseDiagnostics, proofImageEvidence, proofPostgresVersion, proofSubprocessFailure, redactProofText } from '../db/account-closure-full-chain-diagnostics.mjs';

const owned = 'supabase_db_closure-proof-0123456789abcdef';
describe('explicit original/provider-fixed disposable image comparison', () => {
  const id = `sha256:${'a'.repeat(64)}`;
  const digest = `ghcr.io/supabase/postgres@sha256:${'b'.repeat(64)}`;
  const image = { Id: id, Architecture: 'amd64', Os: 'linux', RepoDigests: [digest] };
  it('keeps the original image by default and refuses arbitrary version input', () => {
    expect(proofPostgresVersion()).toBe('17.6.1.106');
    expect(proofPostgresVersion('17.6.1.155')).toBe('17.6.1.155');
    expect(() => proofPostgresVersion('latest')).toThrow('unreviewed');
  });
  it('binds actual running image, immutable digest and original architecture without claiming production proof', () => {
    const evidence = proofImageEvidence('17.6.1.155', { Config: { Image: 'ghcr.io/supabase/postgres:17.6.1.155' }, Image: id }, image);
    expect(evidence).toMatchObject({ repositoryDigest: digest, imageId: id, architecture: 'amd64',
      comparisonOnly: true, productionRepresentativenessVerified: false });
  });
  it.each([
    ['wrong image', { Config: { Image: 'ghcr.io/supabase/postgres:17.6.1.106' }, Image: id }, image],
    ['wrong inspected image', { Config: { Image: 'ghcr.io/supabase/postgres:17.6.1.155' }, Image: 'sha256:other' }, image],
    ['wrong architecture', { Config: { Image: 'ghcr.io/supabase/postgres:17.6.1.155' }, Image: id }, { ...image, Architecture: 'arm64' }],
    ['missing digest', { Config: { Image: 'ghcr.io/supabase/postgres:17.6.1.155' }, Image: id }, { ...image, RepoDigests: [] }],
  ])('fails closed on %s', (_name, container, metadata) => {
    expect(() => proofImageEvidence('17.6.1.155', container, metadata)).toThrow();
  });
  it('runs both environments independently and never converts original failure to success', () => {
    const workflow = readFileSync('.github/workflows/account-closure-full-chain-proof.yml', 'utf8');
    expect(workflow).toContain("postgres_version: ['17.6.1.106', '17.6.1.155']");
    expect(workflow).toContain('fail-fast: false');
    expect(workflow).not.toContain('continue-on-error');
    expect(workflow).toContain('account-closure-full-chain-${{ matrix.postgres_version }}-');
    const driver = readFileSync('tests/db/account-closure-full-chain.mjs', 'utf8');
    expect(driver).toContain("join(directory, '.temp', 'postgres-version'), postgresVersion");
    expect(driver.indexOf("readFileSync('tests/db/account-closure-denial-control.sql'")).toBeLessThan(driver.indexOf("cpSync(join(root, candidate)"));
    const sql = readFileSync('tests/db/account-closure-denial-control.sql', 'utf8');
    expect(sql).toContain('SET LOCAL ROLE service_role;');
    expect(sql).toContain('EXCEPTION WHEN insufficient_privilege THEN NULL;');
    expect(sql).toContain('SET LOCAL ROLE anon;');
    expect(sql).toContain('ROLLBACK;');
  });
});
describe('disposable proof diagnostics retain crash evidence before cleanup', () => {
  it('retains actual partial stdout/stderr, status and stage when a subprocess fails', () => {
    const result = spawnSync(process.execPath, ['-e', "process.stdout.write('CLOSURE_STAGE claim:start\\n'); process.stderr.write('lost connection\\n'); process.exit(7)"], { encoding: 'utf8' });
    expect(proofSubprocessFailure('node', ['fixture'], result)).toMatchObject({ status: 7, signal: null,
      stdout: 'CLOSURE_STAGE claim:start\n', stderr: 'lost connection\n', stages: ['CLOSURE_STAGE claim:start'] });
  });
  it('distinguishes a killed process from a normal error exit', () => {
    const result = spawnSync(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"], { encoding: 'utf8' });
    expect(proofSubprocessFailure('node', ['fixture'], result)).toMatchObject({ status: null, signal: 'SIGTERM' });
  });
  it('bounds output while retaining beginning and tail and redacting credential-shaped values', () => {
    const value = 'postgres://user:password@host/db password=secret user@example.test eyJabc.def.ghi\n' + 'x'.repeat(20_000) + '\nCLOSURE_STAGE last:done';
    const result = redactProofText(value, 1024);
    expect(result.length).toBeLessThanOrEqual(1024);
    expect(result).not.toMatch(/user:password|password=secret|user@example|eyJabc/);
    expect(result).toContain('database-url-redacted'); expect(result).toContain('CLOSURE_STAGE last:done');
    const escape = String.fromCharCode(27);
    expect(redactProofText(`${escape}[31mFATAL: backend stopped${escape}[0m`)).toBe('FATAL: backend stopped');
  });
  it('captures only the owned container state/image and sanitized server crash lines', () => {
    const execute = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ image: 'supabase/postgres:17.6', imageId: 'sha256:abc',
        state: { Status: 'running', OOMKilled: false, ExitCode: 0, Error: '', Env: ['PASSWORD=should-not-appear'] } }) })
      .mockReturnValueOnce({ status: 0, stdout: 'LOG: server process was terminated by signal 11: Segmentation fault\nDETAIL: Failed process was running: secret SQL\nSTATEMENT: private SQL\nLOG: database system is ready to accept connections', stderr: '' });
    const evidence = captureOwnedDatabaseDiagnostics(owned, {}, execute);
    expect(evidence).toMatchObject({ capturedBeforeCleanup: true, metadata: { image: 'supabase/postgres:17.6',
      state: { Status: 'running', OOMKilled: false, ExitCode: 0 } } });
    expect(evidence.serverDiagnostics).toContain('signal 11');
    expect(JSON.stringify(evidence)).not.toMatch(/should-not-appear|private SQL|secret SQL/);
    expect(execute).toHaveBeenCalledTimes(2);
    for (const [, args, options] of execute.mock.calls) {
      expect(args.at(-1)).toBe(owned); expect(options.timeout).toBe(5000); expect(options.maxBuffer).toBe(128 * 1024);
    }
    expect(execute.mock.calls[0][1][2]).not.toContain('.Config.Env');
  });
  it('refuses an unowned container before any Docker operation', () => {
    const execute = vi.fn();
    expect(() => captureOwnedDatabaseDiagnostics('supabase_db_someone-else', {}, execute)).toThrow('unowned');
    expect(execute).not.toHaveBeenCalled();
  });
  it('records unavailable Docker evidence without pretending the server was healthy', () => {
    const execute = vi.fn(() => ({ status: 1, stdout: '', stderr: 'unavailable' }));
    expect(captureOwnedDatabaseDiagnostics(owned, {}, execute)).toMatchObject({ metadata: null, inspectStatus: 1, logsStatus: 1 });
  });
  it('collects evidence before finally cleanup and retains existing transaction/rollback and proof gates', () => {
    const driver = readFileSync('tests/db/account-closure-full-chain.mjs', 'utf8');
    expect(driver.indexOf('captureOwnedDatabaseDiagnostics(containerName, env)')).toBeLessThan(driver.indexOf('cleanupOwned({ id, stage, networkName, subnet });'));
    expect(driver).toContain('subprocess-failure.json'); expect(driver).toContain('database-version.json');
    const sql = readFileSync('tests/db/account-closure-enforcement-full-chain.sql', 'utf8');
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1); expect(sql.match(/^ROLLBACK;$/gm)).toHaveLength(1);
    for (const marker of ['register:start', 'disabled-issuance:refused', 'legacy-issue:start', 'legacy-claim:start',
      'legacy-reconcile:start', 'guarded-issuance:start', 'claim-replay:start', 'auth-unknown:start', 'auth-delete:start', 'residue:start', 'completion:ack']) {
      expect(sql).toContain(`CLOSURE_STAGE ${marker}`);
    }
    expect(sql).toContain('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED');
  });
});
