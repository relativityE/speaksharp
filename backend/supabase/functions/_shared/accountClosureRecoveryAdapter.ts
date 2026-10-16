import type { ClosureRecoveryAuthority, ClosureRecoveryDependencies } from './accountClosureRecovery.ts';

export interface ClosureRecoveryTarget { projectId: string; environment: 'production' | 'disposable'; url: string }
export interface ClosureRecoveryScope {
  attestationId: string;
  generation: string;
  bindingDigest: string;
  context: { candidateSha: string; configDigest: string; migrationDigest: string; projectId: string; environment: string };
}
/** One client, constructed for the verified target, owns both SQL and Auth reads. */
export interface ClosureRecoveryClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  auth: { admin: { getUserById(userId: string): Promise<unknown> } };
}
interface Ports {
  createAdminClient(url: string): ClosureRecoveryClient;
  /** Independently verified CURRENT backend facts; never copied from a browser or from the attestation being checked. */
  getCurrentScope(): Promise<unknown>;
  now?(): number;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown, length = 64): v is string => typeof v === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(v);
function stop(): never { throw new Error('closure_recovery_unavailable'); }
function identity(s: ClosureRecoveryScope) {
  return JSON.stringify([s.attestationId, s.generation, s.bindingDigest, s.context.candidateSha,
    s.context.configDigest, s.context.migrationDigest, s.context.projectId, s.context.environment]);
}

/**
 * Private adapter only: no public route, credential discovery, provider DELETE,
 * deployment/config mutation, automatic rebind or activation. The factory must
 * construct the real SDK client for the supplied verified URL; production wiring
 * must use its single backend-owned credential, not an operator/browser URL.
 * SQL wrappers perform the authoritative lock-time checks. Current-scope reads
 * surround each operation; ambiguity preserves the journal and never retries.
 */
export function createAccountClosureRecoveryAdapter(targetInput: ClosureRecoveryTarget, ports: Ports) {
  const target = structuredClone(targetInput);
  if (!closed(target, ['projectId', 'environment', 'url'])
    || !/^[a-z0-9-]{1,63}$/.test(target.projectId) || !['production', 'disposable'].includes(target.environment)) stop();
  let url: URL;
  try { url = new URL(target.url); } catch { return stop(); }
  const cloud = url.protocol === 'https:' && url.hostname === `${target.projectId}.supabase.co` && !url.port;
  const loopback = target.environment === 'disposable' && url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!cloud && !loopback) || url.username || url.password || url.search || url.hash || url.pathname !== '/') stop();
  const client = ports.createAdminClient(url.origin);
  if (!client || typeof client.rpc !== 'function' || typeof client.auth?.admin?.getUserById !== 'function') stop();
  const now = ports.now ?? Date.now;
  let pinnedScope: ClosureRecoveryScope | undefined;
  let boundRequest: Readonly<{ userId: string; requestId: string }> | undefined;
  function bound(userId: string, requestId = boundRequest?.requestId) {
    if (!boundRequest || userId !== boundRequest.userId || requestId !== boundRequest.requestId) stop();
    return boundRequest;
  }

  async function scope() {
    const value = structuredClone(await ports.getCurrentScope());
    if (!closed(value, ['attestationId', 'generation', 'bindingDigest', 'context'])
      || !uuid(value.attestationId) || typeof value.generation !== 'string'
      || !/^(0|[1-9][0-9]{0,18})$/.test(value.generation) || BigInt(value.generation) > 9223372036854775807n
      || !sha(value.bindingDigest) || !closed(value.context, ['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'])
      || !sha(value.context.candidateSha, 40) || !sha(value.context.configDigest) || !sha(value.context.migrationDigest)
      || value.context.projectId !== target.projectId || value.context.environment !== target.environment) stop();
    const current = value as unknown as ClosureRecoveryScope;
    if (pinnedScope && identity(pinnedScope) !== identity(current)) stop();
    pinnedScope ??= current;
    return current;
  }
  async function unchanged(first: ClosureRecoveryScope) {
    if (identity(first) !== identity(await scope())) stop();
  }
  function args(userId: string, requestId: string, s: ClosureRecoveryScope) {
    if (!uuid(userId) || !uuid(requestId)) stop();
    bound(userId, requestId);
    return { p_user_id: userId, p_request_id: requestId, p_attestation_id: s.attestationId,
      p_generation: s.generation, p_binding_digest: s.bindingDigest, p_context: structuredClone(s.context) };
  }
  async function rpc(name: string, parameters: Record<string, unknown>, current: ClosureRecoveryScope) {
    let result: unknown;
    try { result = await client.rpc(name, structuredClone(parameters)); } catch { return stop(); }
    await unchanged(current);
    if (!object(result) || !Object.hasOwn(result, 'data') || result.error !== null) stop();
    return result.data;
  }
  async function inspect(userId: string, requestId: string, current: ClosureRecoveryScope) {
    const value = await rpc('inspect_account_closure_authority', args(userId, requestId, current), current);
    const actualNow = now();
    if (!closed(value, ['authority', 'attempt'])
      || !closed(value.authority, ['userId', 'requestId', 'generation', 'bindingDigest', 'validFrom', 'expiresAt'])
      || !closed(value.attempt, ['userId', 'requestId', 'email', 'phase'])
      || value.authority.userId !== userId || value.authority.requestId !== requestId
      || value.attempt.userId !== userId || value.attempt.requestId !== requestId
      || value.authority.generation !== current.generation || value.authority.bindingDigest !== current.bindingDigest
      || typeof value.authority.validFrom !== 'number' || typeof value.authority.expiresAt !== 'number'
      || ![value.authority.validFrom, value.authority.expiresAt, actualNow].every(Number.isFinite)
      || value.authority.validFrom > actualNow || value.authority.expiresAt <= actualNow
      || value.authority.expiresAt <= value.authority.validFrom
      || value.authority.expiresAt - value.authority.validFrom > 900_000
      || typeof value.attempt.email !== 'string' || value.attempt.email.length === 0
      || value.attempt.email !== value.attempt.email.trim().toLowerCase()
      || typeof value.attempt.phase !== 'string'
      || !['auth_unknown', 'auth_deleted', 'completed'].includes(value.attempt.phase)) stop();
    return { authority: value.authority as unknown as ClosureRecoveryAuthority,
      attempt: value.attempt as { userId: string; requestId: string; email: string; phase: string } };
  }

  const dependencies: ClosureRecoveryDependencies = {
    now,
    readAuthority: async (userId, requestId) => (await inspect(userId, requestId, await scope())).authority,
    inspectAttempt: async (userId, requestId) => (await inspect(userId, requestId, await scope())).attempt,
    readAuthUser: async (userId) => {
      if (!uuid(userId)) stop();
      bound(userId);
      const current = await scope();
      const response = await client.auth.admin.getUserById(userId);
      await unchanged(current);
      return response;
    },
    recordAuthState: async (userId, requestId, state, authority) => {
      if (!['auth_deleted', 'completed'].includes(state)) stop();
      const current = await scope();
      const proof = await inspect(userId, requestId, current);
      if (!closed(authority, ['userId', 'requestId', 'generation', 'bindingDigest', 'validFrom', 'expiresAt'])
        || (Object.keys(proof.authority) as (keyof ClosureRecoveryAuthority)[])
          .some((key) => proof.authority[key] !== authority[key])) stop();
      const result = await rpc('record_account_closure_auth_state_with_drain',
        { ...args(userId, requestId, current), p_state: state }, current);
      // SQL RETURNS void maps to null. Anything else is an ambiguous receipt;
      // the controller will hold rather than replay, and re-read on recovery.
      if (result !== null) stop();
    },
    verifyResidue: async (userId, email) => {
      const current = await scope();
      // The authoritative RPC uses the journal's own email, never this input.
      // Check the requested private binding as well before issuing that RPC.
      const request = bound(userId);
      const proof = await inspect(userId, request.requestId, current);
      if (proof.attempt.email !== email) stop();
      return await rpc('verify_account_closure_residue_with_drain', args(userId, request.requestId, current), current) === true;
    },
  };
  // A per-invocation adapter must be bound to one request. Do not share a mutable
  // global request cache across concurrent recoveries or use an email lookup.
  return {
    forRequest(request: { userId: string; requestId: string }): ClosureRecoveryDependencies {
      if (boundRequest || !closed(request, ['userId', 'requestId']) || !uuid(request.userId) || !uuid(request.requestId)) stop();
      boundRequest = Object.freeze({ ...request });
      return dependencies;
    },
  };
}
