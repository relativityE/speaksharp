// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256, readAccountClosureCompletionRuntimeBinding } from '../../backend/supabase/functions/_shared/accountClosureCompletionRuntimeBinding';

function fixture() {
  const context = { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64),
    migrationDigest: ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256, projectId: 'fixture-project', environment: 'production' };
  const manifest = { version: 1, deploymentId: 'fixture-project_function_1', context, scopeDigest: '' };
  const values: Record<string, string> = { SUPABASE_URL: 'https://fixture-project.supabase.co', DENO_DEPLOYMENT_ID: manifest.deploymentId };
  const resign = () => { manifest.scopeDigest = createHash('sha256').update(JSON.stringify([1, manifest.deploymentId,
    context.candidateSha, context.configDigest, context.migrationDigest, context.projectId, context.environment,
    new URL(values.SUPABASE_URL).origin])).digest('hex'); };
  resign();
  const env = (key: string) => key === 'ACCOUNT_COMPLETION_RUNTIME_BINDING' ? JSON.stringify(manifest) : values[key];
  return { manifest, values, env, resign };
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('independent inactive completion runtime binding', () => {
  it('pins exact ordered account schema sources, not a claim they are applied', () => {
    const hashes = ['20261013180000_account_closure_tokens.sql', '20261016090000_account_closure_drain_persistence.sql',
      '20261016180000_account_closure_drain_enforcement.sql', '20261020230653_account_pending_completion_journal_1643.sql'].map(name =>
      createHash('sha256').update(readFileSync(`backend/supabase/migrations/${name}`)).digest('hex'));
    expect(createHash('sha256').update(JSON.stringify(hashes)).digest('hex')).toBe(ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256);
  });
  it('returns only the independent fixed target/scope for the actual worker', async () => {
    const f = fixture(); expect(await readAccountClosureCompletionRuntimeBinding(f.env)).toEqual({
      projectId: 'fixture-project', environment: 'production', url: f.values.SUPABASE_URL, scopeDigest: f.manifest.scopeDigest,
    });
  });
  it.each(['ACCOUNT_COMPLETION_RUNTIME_BINDING', 'SUPABASE_URL', 'DENO_DEPLOYMENT_ID'])('missing %s defaults to refusal', async missing => {
    const f = fixture(); await expect(readAccountClosureCompletionRuntimeBinding(key => key === missing ? undefined : f.env(key))).rejects.toThrow('account_completion_runtime_unavailable');
  });
  it.each([{ name: 'empty', raw: '' }, { name: 'truncated', raw: '{' }, { name: 'array', raw: '[]' },
    { name: 'null', raw: 'null' }, { name: 'missing-fields', raw: '{}' }, { name: 'oversize', raw: 'x'.repeat(8193) }])('malformed manifest never selects runtime: $name', async ({ raw }) => {
    const f = fixture(); await expect(readAccountClosureCompletionRuntimeBinding(key => key === 'ACCOUNT_COMPLETION_RUNTIME_BINDING' ? raw : f.env(key))).rejects.toThrow();
  });
  it('rejects a legacy global-drain grant even when its worker matches', async () => {
    const f = fixture(); const old = { version: 1, deploymentId: f.manifest.deploymentId, scope: { bindingDigest: f.manifest.scopeDigest } };
    await expect(readAccountClosureCompletionRuntimeBinding(key => key === 'ACCOUNT_COMPLETION_RUNTIME_BINDING' ? JSON.stringify(old) : f.env(key))).rejects.toThrow();
  });
  it.each(['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'] as const)('refuses unverified context %s', async key => {
    const f = fixture(); f.manifest.context[key] = 'invalid'; await expect(readAccountClosureCompletionRuntimeBinding(f.env)).rejects.toThrow();
  });
  it.each(['http://fixture-project.supabase.co', 'https://other.supabase.co', 'https://fixture-project.supabase.co:444',
    'https://fixture-project.supabase.co/path', 'https://fixture-project.supabase.co?key=private',
    'https://user:private@fixture-project.supabase.co', 'http://127.0.0.1:54321'])('refuses wrong/unsafe production target %s', async url => {
    const f = fixture(); f.values.SUPABASE_URL = url; await expect(readAccountClosureCompletionRuntimeBinding(f.env)).rejects.toThrow();
  });
  it.each(['fixture-project_function_0', 'other-project_function_1', ''])('refuses a different actual executing worker %s', async worker => {
    const f = fixture(); f.values.DENO_DEPLOYMENT_ID = worker; await expect(readAccountClosureCompletionRuntimeBinding(f.env)).rejects.toThrow();
  });
  it('environment labels cannot turn production HTTPS into a disposable target', async () => {
    const f = fixture(); f.manifest.context.environment = 'disposable'; f.resign();
    await expect(readAccountClosureCompletionRuntimeBinding(f.env)).rejects.toThrow();
  });
  it('a declared disposable target is loopback-only and still scope/worker-bound', async () => {
    const f = fixture(); f.manifest.context.environment = 'disposable'; f.values.SUPABASE_URL = 'http://127.0.0.1:54321'; f.resign();
    expect(await readAccountClosureCompletionRuntimeBinding(f.env)).toMatchObject({ environment: 'disposable', url: f.values.SUPABASE_URL });
    f.values.SUPABASE_URL = 'http://remote.example.test:54321'; f.resign(); await expect(readAccountClosureCompletionRuntimeBinding(f.env)).rejects.toThrow();
  });
  it('unre-signed context or target changes cannot reuse the configured scope', async () => {
    const f = fixture(); f.manifest.context.configDigest = 'd'.repeat(64);
    await expect(readAccountClosureCompletionRuntimeBinding(f.env)).rejects.toThrow();
  });
  it('detects configuration drift across the asynchronous digest boundary', async () => {
    const f = fixture(); let reads = 0;
    await expect(readAccountClosureCompletionRuntimeBinding(key => key === 'DENO_DEPLOYMENT_ID' && ++reads > 1
      ? 'fixture-project_function_2' : f.env(key))).rejects.toThrow();
  });
});
