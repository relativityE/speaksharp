import type { CompletionBinding } from './accountClosureCompletionAdapter.ts';

type Env = (name: string) => string | undefined;
// Source identity of the ordered three account migrations plus completion SQL.
// It is not a receipt that those migrations are installed on any database.
export const ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256 = 'dc21c7b3cdb1184ca945e75989bbc845b6e3aebc974292d14ac99bc767069781';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> => object(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sha = (value: unknown, size = 64): value is string => typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
function stop(): never { throw new Error('account_completion_runtime_unavailable'); }

/**
 * Independent, default-disabled completion binding. A release controller must
 * separately verify the actual worker, release/config and installed schema and
 * configure the matching SQL scope. No value is registered or activated here.
 * Never derive this from a browser, old drain attestation or status capability.
 */
export async function readAccountClosureCompletionRuntimeBinding(env: Env): Promise<CompletionBinding> {
  const raw = env('ACCOUNT_COMPLETION_RUNTIME_BINDING');
  const target = env('SUPABASE_URL');
  const worker = env('DENO_DEPLOYMENT_ID');
  if (!raw || raw.length > 8192 || !target || !worker) stop();
  let manifest: unknown, url: URL;
  try { manifest = JSON.parse(raw); url = new URL(target); } catch { return stop(); }
  if (!closed(manifest, ['version', 'deploymentId', 'context', 'scopeDigest']) || manifest.version !== 1
    || manifest.deploymentId !== worker || !sha(manifest.scopeDigest)
    || !closed(manifest.context, ['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'])) stop();
  const context = manifest.context;
  if (!sha(context.candidateSha, 40) || !sha(context.configDigest)
    || context.migrationDigest !== ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256
    || typeof context.projectId !== 'string' || !/^[a-z0-9-]{1,63}$/.test(context.projectId)
    || !new RegExp(`^${context.projectId}_[A-Za-z0-9_-]{1,255}$`).test(worker)
    || !['production', 'disposable'].includes(String(context.environment))) stop();
  const production = context.environment === 'production' && url.protocol === 'https:'
    && url.hostname === `${context.projectId}.supabase.co` && !url.port;
  const disposable = context.environment === 'disposable' && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!production && !disposable) || url.username || url.password || url.search || url.hash || url.pathname !== '/') stop();
  // Canonical tuple, including the actual executing worker and normalized target.
  const tuple = [1, worker, context.candidateSha, context.configDigest, context.migrationDigest,
    context.projectId, context.environment, url.origin];
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(tuple)))), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.scopeDigest || raw !== env('ACCOUNT_COMPLETION_RUNTIME_BINDING')
    || target !== env('SUPABASE_URL') || worker !== env('DENO_DEPLOYMENT_ID')) stop();
  return { projectId: context.projectId, environment: context.environment as CompletionBinding['environment'],
    url: url.origin, scopeDigest: digest };
}
