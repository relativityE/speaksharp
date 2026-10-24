import type { CompletionGrant, CompletionPorts, CompletionRequest } from './accountClosureCompletion.ts';

export interface CompletionBinding {
  projectId: string;
  environment: 'production' | 'disposable';
  url: string;
  scopeDigest: string;
}
interface Client { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
export interface CompletionRpcPorts {
  createAdminClient(url: string): Client;
  /** Independently verified backend facts; not request fields or the old global-drain grant. */
  currentBinding(): Promise<unknown>;
}
interface Ports extends CompletionRpcPorts {
  policy: CompletionPorts['policy'];
  now?(): number;
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const validBinding = (v: unknown): v is CompletionBinding => closed(v, ['projectId', 'environment', 'url', 'scopeDigest'])
  && typeof v.projectId === 'string' && /^[a-z0-9-]{1,63}$/.test(v.projectId)
  && (v.environment === 'production' || v.environment === 'disposable')
  && typeof v.url === 'string' && digest(v.scopeDigest);
function stop(): never { throw new Error('account_completion_unavailable'); }
const identity = (v: CompletionBinding) => JSON.stringify([v.projectId, v.environment, v.url, v.scopeDigest]);

/**
 * Server-only, inactive adapter. New RPCs are NOT installed or selected by this
 * factory. An absent schema, changed release, wrong project or ambiguous receipt
 * fails closed; no old token/drain fallback, retry, credential discovery or
 * automatic activation. One backend-owned client handles this fixed target.
 */
export function createAccountCompletionRpc(input: CompletionBinding, ports: CompletionRpcPorts) {
  const binding = structuredClone(input);
  if (!validBinding(binding)) stop();
  let url: URL;
  try { url = new URL(binding.url); } catch { return stop(); }
  const production = binding.environment === 'production' && url.protocol === 'https:'
    && url.hostname === `${binding.projectId}.supabase.co` && !url.port;
  const disposable = binding.environment === 'disposable' && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!production && !disposable) || url.username || url.password || url.search || url.hash || url.pathname !== '/') stop();
  const client = ports.createAdminClient(url.origin);
  if (typeof client?.rpc !== 'function') stop();
  const current = async () => {
    const actual = await ports.currentBinding();
    if (!validBinding(actual) || identity(actual) !== identity(binding)) stop();
    return binding.scopeDigest;
  };
  const names = new Set(['claim_account_pending_completion_v1','inspect_account_pending_completion_v1',
    'begin_account_completion_stage_v1','finish_account_completion_stage_v1','complete_account_pending_completion_v1',
    'issue_account_completion_status_v1','acknowledge_account_completion_status_v1','read_account_completion_status_v1']);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (!names.has(name) || !object(args)) stop();
    // Snapshot before the first await. A caller cannot mutate an argument while
    // the independent binding read is pending and retarget the eventual RPC.
    let snapshot: Record<string, unknown>;
    try { snapshot = structuredClone(args); } catch { return stop(); }
    if (snapshot.p_scope_digest !== binding.scopeDigest) stop();
    await current();
    let result: unknown;
    try { result = await client.rpc(name, snapshot); } catch { return stop(); }
    await current();
    if (!object(result) || result.error !== null || !Object.hasOwn(result, 'data')) stop();
    return result.data;
  };
  return { scopeDigest: binding.scopeDigest, currentScopeDigest: current, rpc };
}

/** Shares target binding with the separately owned status-wrapper integration. */
export function createAccountCompletionPorts(input: CompletionBinding, ports: Ports): CompletionPorts {
  const { scopeDigest, currentScopeDigest, rpc } = createAccountCompletionRpc(input, ports);
  const requestArgs = (request: CompletionRequest) => {
    if (!uuid(request.userId) || !uuid(request.requestId)) stop();
    return { p_user_id: request.userId, p_request_id: request.requestId, p_scope_digest: scopeDigest };
  };
  const grantArgs = (grant: CompletionGrant) => {
    if (!uuid(grant.executionId) || grant.scopeDigest !== scopeDigest) stop();
    return { ...requestArgs(grant), p_execution_id: grant.executionId };
  };
  const stage = (key: string) => {
    if (!/^(cancel:[A-Za-z0-9_-]{1,128}|settle_billing|delete_customer|retain_trial|remove_storage|delete_auth)$/.test(key)) stop();
    return key;
  };
  return {
    now: ports.now ?? Date.now,
    currentScopeDigest,
    claim: (request, scope) => {
      if (scope !== scopeDigest) return Promise.reject(new Error('account_completion_unavailable'));
      return rpc('claim_account_pending_completion_v1', requestArgs(request));
    },
    inspect: grant => rpc('inspect_account_pending_completion_v1', grantArgs(grant)),
    beginStage: (grant, key) => rpc('begin_account_completion_stage_v1', { ...grantArgs(grant), p_key: stage(key) }),
    finishStage: (grant, key, outcome) => {
      if (!['completed', 'unknown'].includes(outcome)) return Promise.reject(new Error('account_completion_unavailable'));
      return rpc('finish_account_completion_stage_v1', { ...grantArgs(grant), p_key: stage(key), p_outcome: outcome });
    },
    complete: grant => rpc('complete_account_pending_completion_v1', grantArgs(grant)),
    policy: grant => ports.policy(grant),
  };
}
