import { describe, expect, it } from 'vitest';
import { readAccountClosureRuntimeBinding, ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from '../../backend/supabase/functions/_shared/accountClosureRuntimeBinding';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 as expectedDigest } from '../../scripts/lib/accountClosureEnforcementIdentity.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function fixture() {
  const manifest = { version: 1, deploymentId: 'fixture-project_function_1', scope: {
    attestationId: '10000000-0000-4000-8000-000000000001', generation: '9007199254740993', bindingDigest: 'a'.repeat(64),
    context: { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64), migrationDigest: ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256,
      projectId: 'fixture-project', environment: 'production' },
  } };
  const values: Record<string, string> = { SUPABASE_URL: 'https://fixture-project.supabase.co',
    DENO_DEPLOYMENT_ID: manifest.deploymentId };
  const env = (key: string) => key === 'ACCOUNT_CLOSURE_RUNTIME_BINDING' ? JSON.stringify(manifest) : values[key];
  return { manifest, values, env };
}
describe('backend current facts → executing worker binding', () => {
  it('binds runtime and operator evidence to the actual three reviewed migration sources', () => {
    const hashes = ['20261013180000_account_closure_tokens.sql', '20261016090000_account_closure_drain_persistence.sql',
      '20261016180000_account_closure_drain_enforcement.sql'].map((name) =>
      createHash('sha256').update(readFileSync(`backend/supabase/migrations/${name}`)).digest('hex'));
    expect(ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256).toBe(expectedDigest);
    expect(expectedDigest).toBe(createHash('sha256').update(JSON.stringify(hashes)).digest('hex'));
  });
  it('binds one actual worker and exact target without losing bigint generation precision', () => {
    const { manifest, env } = fixture();
    expect(readAccountClosureRuntimeBinding(env)).toEqual({
      target: { projectId: 'fixture-project', environment: 'production', url: 'https://fixture-project.supabase.co' },
      scope: manifest.scope,
    });
  });
  it.each(['SUPABASE_URL', 'DENO_DEPLOYMENT_ID', 'ACCOUNT_CLOSURE_RUNTIME_BINDING'])('missing %s never defaults to enabled or guessed facts', (missing) => {
    const { env } = fixture();
    expect(() => readAccountClosureRuntimeBinding((key) => key === missing ? undefined : env(key))).toThrow('closure_runtime_binding_unavailable');
  });
  it.each(['fixture-project_function_0', 'other-project_function_1', ''])('a stale or different executing worker refuses the manifest: %s', (id) => {
    const { env, values } = fixture(); values.DENO_DEPLOYMENT_ID = id;
    expect(() => readAccountClosureRuntimeBinding(env)).toThrow();
  });
  it.each(['http://fixture-project.supabase.co', 'https://other.supabase.co', 'https://fixture-project.supabase.co/other',
    'https://user:secret@fixture-project.supabase.co', 'https://fixture-project.supabase.co?token=secret', 'http://127.0.0.1:54321'])('refuses mismatched or unsafe backend target %s', (url) => {
    const { env, values } = fixture(); values.SUPABASE_URL = url;
    expect(() => readAccountClosureRuntimeBinding(env)).toThrow();
  });
  it.each(['-1', '1.5', '01', '9223372036854775808'])('rejects a noncanonical generation %s', (generation) => {
    const { env, manifest } = fixture(); manifest.scope.generation = generation;
    expect(() => readAccountClosureRuntimeBinding(env)).toThrow();
  });
  it.each(['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'] as const)('rejects invalid current %s', (field) => {
    const { env, manifest } = fixture(); manifest.scope.context[field] = 'invalid';
    expect(() => readAccountClosureRuntimeBinding(env)).toThrow();
  });
  it('does not accept attestation contents as a runtime manifest', () => {
    const { manifest, env } = fixture();
    expect(() => readAccountClosureRuntimeBinding((key) => key === 'ACCOUNT_CLOSURE_RUNTIME_BINDING'
      ? JSON.stringify({ ...manifest, record: { candidateSha: manifest.scope.context.candidateSha } }) : env(key))).toThrow();
  });
});

describe('J1.f/J7.d disposable stack: the target decides the mode, never the manifest', () => {
  // `supabase functions serve` gives the function SUPABASE_URL=http://kong:8000 (set after the env-file, not overridable).
  const KONG = 'http://kong:8000';
  const local = (url = KONG, environment = 'disposable') => {
    const { manifest, values, env } = fixture();
    manifest.scope.context.environment = environment; values.SUPABASE_URL = url;
    return { manifest, env };
  };
  it('the local CLI stack (exactly http://kong:8000) is admitted only for a manifest that declares disposable', () => {
    const { manifest, env } = local();
    expect(readAccountClosureRuntimeBinding(env)).toEqual({
      target: { projectId: 'fixture-project', environment: 'disposable', url: KONG }, scope: manifest.scope });
    expect(readAccountClosureRuntimeBinding(local('http://kong:8000/').env).target.url).toBe(KONG);
  });
  it('a production manifest is refused on the local stack', () => {
    expect(() => readAccountClosureRuntimeBinding(local(KONG, 'production').env)).toThrow('closure_runtime_binding_unavailable');
  });
  it('a hosted target can never enter the local mode by claiming disposable: it keeps the hosted rule and hosted URL', () => {
    const { env } = local('https://fixture-project.supabase.co');
    expect(readAccountClosureRuntimeBinding(env).target.url).toBe('https://fixture-project.supabase.co');
    expect(() => readAccountClosureRuntimeBinding(local('https://other.supabase.co').env)).toThrow();
    expect(() => readAccountClosureRuntimeBinding(local('https://fixture-project.supabase.co:8443').env)).toThrow();
  });
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://kong', 'http://kong:8001', 'https://kong:8000',
    'http://kong.example.test:8000', 'http://kong:8000.example.test', 'http://10.0.0.5:8000', 'http://fixture-project.supabase.co', 'https://example.test'])(
    'a disposable manifest is refused on any target but exactly http://kong:8000: %s', (url) => {
      expect(() => readAccountClosureRuntimeBinding(local(url).env)).toThrow('closure_runtime_binding_unavailable');
    });
  it.each(['http://user:secret@kong:8000', 'http://kong:8000/rest', 'http://kong:8000?x=1', 'http://kong:8000#x'])(
    'the local target with credentials, a path, a query or a fragment is refused: %s', (url) => {
      expect(() => readAccountClosureRuntimeBinding(local(url).env)).toThrow();
    });
  it('the executing worker must still belong to the manifest project on the local stack', () => {
    const { env } = local();
    expect(() => readAccountClosureRuntimeBinding((key) => key === 'DENO_DEPLOYMENT_ID' ? 'other-project_function_1' : env(key))).toThrow();
  });
});
