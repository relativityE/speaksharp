import { describe, expect, it } from 'vitest';
import { readAccountClosureRuntimeBinding } from '../../backend/supabase/functions/_shared/accountClosureRuntimeBinding';

function fixture() {
  const manifest = { version: 1, deploymentId: 'fixture-project_function_1', scope: {
    attestationId: '10000000-0000-4000-8000-000000000001', generation: '9007199254740993', bindingDigest: 'a'.repeat(64),
    context: { candidateSha: 'b'.repeat(40), configDigest: 'c'.repeat(64), migrationDigest: 'd'.repeat(64),
      projectId: 'fixture-project', environment: 'production' },
  } };
  const values: Record<string, string> = { SUPABASE_URL: 'https://fixture-project.supabase.co',
    DENO_DEPLOYMENT_ID: manifest.deploymentId };
  const env = (key: string) => key === 'ACCOUNT_CLOSURE_RUNTIME_BINDING' ? JSON.stringify(manifest) : values[key];
  return { manifest, values, env };
}
describe('backend current facts → executing worker binding', () => {
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
