import type { ClosureRecoveryScope, ClosureRecoveryTarget } from './accountClosureRecoveryAdapter.ts';

type Env = (key: string) => string | undefined;
// Contract test binds this runtime literal to the ordered117/118/119 source hashes.
export const ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 = '9683155d96d6e38269a63767470715ac92105d5ec15f0d7aeb0bc5908dd30fba';
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const sha = (v: unknown, n = 64): v is string => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
function stop(): never { throw new Error('closure_runtime_binding_unavailable'); }

/**
 * Backend-only, independently prepared current deployment/config/schema facts.
 * Never construct this manifest from an emailed token, browser input or a stored
 * attestation. The release controller must invalidate BEFORE context changes,
 * verify deployment/drain facts, then configure this binding separately. Missing
 * configuration refuses work; this reader does not register or enable deletion.
 *
 * Supabase supplies DENO_DEPLOYMENT_ID as project_ref_function_id_version:
 * https://supabase.com/docs/guides/functions/secrets . Check the actual executing
 * worker as well as the backend manifest; a stale version cannot adopt a newer
 * version's configured grant. External termination remains a rollout proof.
 */
export function readAccountClosureRuntimeBinding(env: Env): { target: ClosureRecoveryTarget; scope: ClosureRecoveryScope } {
  return verifyAccountClosureRuntimeBinding(env('ACCOUNT_CLOSURE_RUNTIME_BINDING'), env('SUPABASE_URL'), env('DENO_DEPLOYMENT_ID'));
}

/** The operator uses an independently fetched platform ID, never a made-up worker environment. */
export function verifyAccountClosureRuntimeBinding(raw: string | undefined, targetUrl: string | undefined, actualDeploymentId: string | undefined): { target: ClosureRecoveryTarget; scope: ClosureRecoveryScope } {
  let manifest: unknown; let url: URL;
  try {
    manifest = JSON.parse(raw ?? '');
    url = new URL(targetUrl ?? '');
  } catch { return stop(); }
  if (!closed(manifest, ['version', 'deploymentId', 'scope']) || manifest.version !== 1
    || typeof manifest.deploymentId !== 'string' || !manifest.deploymentId
    || manifest.deploymentId !== actualDeploymentId
    || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') stop();
  const match = /^([a-z0-9-]{1,63})\.supabase\.co$/.exec(url.hostname);
  if (!match || !manifest.deploymentId.startsWith(`${match[1]}_`)) stop();
  const s = manifest.scope;
  if (!closed(s, ['attestationId', 'generation', 'bindingDigest', 'context'])
    || !uuid(s.attestationId) || typeof s.generation !== 'string'
    || !/^(0|[1-9][0-9]{0,18})$/.test(s.generation) || BigInt(s.generation) > 9223372036854775807n
    || !sha(s.bindingDigest) || !closed(s.context, ['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'])
    || !sha(s.context.candidateSha, 40) || !sha(s.context.configDigest)
    || s.context.migrationDigest !== ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256
    || s.context.projectId !== match[1] || !['production', 'disposable'].includes(String(s.context.environment))) stop();
  return { target: { projectId: match[1], environment: s.context.environment as 'production' | 'disposable', url: url.origin },
    scope: structuredClone(s) as unknown as ClosureRecoveryScope };
}
