import { createAccountCompletionRpc, type CompletionBinding, type CompletionRpcPorts } from './accountClosureCompletionAdapter.ts';

export type PendingCompletionReason = 'coverage_unverified' | 'checkout_unsettled' | 'save_unsettled' | 'coaching_unsettled' | 'ready';
export type CompletionVerificationReason = 'auth_unknown' | 'operation_unknown' | 'execution_expired' | 'identity_unverified' | 'completion_unverified';
export type AccountCompletionStatus =
  | { outcome: 'pending'; requestId: string; reason: PendingCompletionReason; canRetry: false }
  | { outcome: 'processing'; requestId: string; canRetry: false }
  | { outcome: 'verification_pending'; requestId: string; reason: CompletionVerificationReason; canRetry: false }
  | { outcome: 'completed'; requestId: string; accountDeleted: true; canRetry: false }
  | { outcome: 'unavailable'; canRetry: false };
export type StatusCapabilityReply =
  | { outcome: 'status_capability'; requestId: string; token: string; expiresAt: number }
  | Extract<AccountCompletionStatus, { outcome: 'unavailable' }>;
/**
 * J1.f/J7.d step 6: the server's owner- and request-bound readiness DECISION for one completion effect. Distinct from
 * the generic status reason: it re-authenticates the live owner, proves that owner holds this exact acknowledged
 * capability (an idempotent UPDATE on that already-acknowledged row), and reads `pending/ready` twice under the deployed
 * scope. It never issues, rotates, extends or newly acknowledges a capability, never returns a token, and expires within READINESS_TTL_MS. The executor re-checks
 * everything independently; this decision only lets the page offer the button.
 */
export type ExecutionReadiness =
  | { outcome: 'execution_ready'; requestId: string; expiresAt: number }
  | Extract<AccountCompletionStatus, { outcome: 'unavailable' }>;
export const READINESS_TTL_MS = 60_000;
export type StatusAcknowledgment =
  | { outcome: 'status_acknowledged'; requestId: string }
  | Extract<AccountCompletionStatus, { outcome: 'unavailable' }>;

interface Ports extends CompletionRpcPorts {
  /** Authoritative getUser response for this request and the SAME pinned Auth target; never getSession/JWT metadata. */
  authenticate(request: Request, targetUrl: string): Promise<unknown>;
  now?(): number;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const secret = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const unavailable = (): Extract<AccountCompletionStatus, { outcome: 'unavailable' }> => ({ outcome: 'unavailable', canRetry: false });
const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const hash = async (token: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
const pendingReasons = new Set(['coverage_unverified', 'checkout_unsettled', 'save_unsettled', 'coaching_unsettled', 'ready']);
const verificationReasons = new Set(['auth_unknown', 'operation_unknown', 'execution_expired', 'identity_unverified', 'completion_unverified']);

function deadline(value: unknown, now: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(now) && value > now && value - now <= 900_000;
}
function status(value: unknown, requestId: string, now: number): AccountCompletionStatus {
  if (!object(value) || value.requestId !== requestId || value.canRetry !== false || !deadline(value.expiresAt, now)) return unavailable();
  const common = ['outcome', 'requestId', 'canRetry', 'expiresAt'];
  if (value.outcome === 'pending' && closed(value, [...common, 'reason']) && pendingReasons.has(value.reason as string)) {
    return { outcome: 'pending', requestId, reason: value.reason as PendingCompletionReason, canRetry: false };
  }
  if (value.outcome === 'processing' && closed(value, common)) return { outcome: 'processing', requestId, canRetry: false };
  if (value.outcome === 'verification_pending' && closed(value, [...common, 'reason']) && verificationReasons.has(value.reason as string)) {
    return { outcome: 'verification_pending', requestId, reason: value.reason as CompletionVerificationReason, canRetry: false };
  }
  if (value.outcome === 'completed' && closed(value, [...common, 'accountDeleted']) && value.accountDeleted === true) {
    return { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
  }
  return unavailable();
}

/**
 * Inactive server wrapper: no public route, default client, activation, effect,
 * rebind or secret-store access. All RPCs reuse the exact completion target.
 * A future HTTP caller must use POST/no-store, redact bodies, keep the raw
 * capability out of URLs/logs/analytics and prove client acknowledgment before
 * separately authorized destructive work. This reader never grants that work.
 */
export function createAccountCompletionStatus(input: CompletionBinding, ports: Ports) {
  const binding = structuredClone(input);
  const transport = createAccountCompletionRpc(binding, ports);
  const target = new URL(binding.url).origin;
  const now = ports.now ?? Date.now;
  const owner = async (request: Request): Promise<string | null> => {
    const authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer \S{1,4096}$/.test(authorization)) return null;
    await transport.currentScopeDigest();
    const result = structuredClone(await ports.authenticate(request, target));
    await transport.currentScopeDigest();
    if (!object(result) || result.error !== null || !object(result.data) || !object(result.data.user)
      || !uuid(result.data.user.id)) return null;
    return result.data.user.id;
  };
  return {
    async issue(request: Request, input: unknown): Promise<StatusCapabilityReply> {
      try {
        const body = structuredClone(input);
        if (!closed(body, ['requestId']) || !uuid(body.requestId) || !Number.isFinite(now())) return unavailable();
        const userId = await owner(request);
        if (!userId) return unavailable();
        const token = hex(crypto.getRandomValues(new Uint8Array(32)));
        const tokenHash = await hash(token);
        const result = structuredClone(await transport.rpc('issue_account_completion_status_v1', {
          p_user_id: userId, p_request_id: body.requestId, p_scope_digest: transport.scopeDigest, p_token_hash: tokenHash,
        }));
        if (!closed(result, ['requestId', 'expiresAt']) || result.requestId !== body.requestId || !deadline(result.expiresAt, now())) return unavailable();
        return { outcome: 'status_capability', requestId: body.requestId, token, expiresAt: result.expiresAt };
      } catch { return unavailable(); }
    },
    async acknowledge(request: Request, input: unknown): Promise<StatusAcknowledgment> {
      try {
        const body = structuredClone(input);
        if (!closed(body, ['requestId', 'token']) || !uuid(body.requestId) || !secret(body.token) || !Number.isFinite(now())) return unavailable();
        const userId = await owner(request);
        if (!userId) return unavailable();
        const tokenHash = await hash(body.token);
        const result = await transport.rpc('acknowledge_account_completion_status_v1', {
          p_user_id: userId, p_request_id: body.requestId, p_scope_digest: transport.scopeDigest, p_token_hash: tokenHash,
        });
        if (result !== true) return unavailable();
        // An acknowledgment can commit before expiry and arrive after it. Read
        // back the exact capability/deadline; a stale boolean grants nothing.
        const readback = structuredClone(await transport.rpc('read_account_completion_status_v1', {
          p_request_id: body.requestId, p_token_hash: tokenHash, p_scope_digest: transport.scopeDigest,
        }));
        return status(readback, body.requestId, now()).outcome !== 'unavailable'
          ? { outcome: 'status_acknowledged', requestId: body.requestId } : unavailable();
      } catch { return unavailable(); }
    },
    async readiness(request: Request, input: unknown): Promise<ExecutionReadiness> {
      try {
        const body = structuredClone(input);
        if (!closed(body, ['requestId', 'token']) || !uuid(body.requestId) || !secret(body.token) || !Number.isFinite(now())) return unavailable();
        const requestId: string = body.requestId;
        const userId = await owner(request);
        if (!userId) return unavailable();
        const tokenHash = await hash(body.token);
        const readArgs = { p_request_id: requestId, p_token_hash: tokenHash, p_scope_digest: transport.scopeDigest };
        const ready = (value: unknown) => {
          const parsed = status(value, requestId, now());
          return parsed.outcome === 'pending' && parsed.reason === 'ready';
        };
        // GUARD — read FIRST. The read RPC answers only for an already-acknowledged, unexpired capability, so an
        // unacknowledged token is refused here and can never reach the write below.
        if (!ready(structuredClone(await transport.rpc('read_account_completion_status_v1', readArgs)))) return unavailable();
        // Owner binding — an idempotent UPDATE, not a read: true only for THIS authenticated owner + request + scope +
        // token. On the already-acknowledged row it rewrites the same acknowledged_at (coalesce); it never inserts,
        // rotates or extends. The guard above is what keeps it from ever acknowledging a fresh token.
        const owned = await transport.rpc('acknowledge_account_completion_status_v1', {
          p_user_id: userId, p_request_id: requestId, p_scope_digest: transport.scopeDigest, p_token_hash: tokenHash,
        });
        if (owned !== true) return unavailable();
        const readback = structuredClone(await transport.rpc('read_account_completion_status_v1', readArgs));
        if (!ready(readback)) return unavailable();
        await transport.currentScopeDigest(); // the deployed scope must still be the one every read above used
        const capabilityDeadline = (readback as Record<string, unknown>).expiresAt as number;
        return { outcome: 'execution_ready', requestId,
          expiresAt: Math.min(now() + READINESS_TTL_MS, capabilityDeadline) };
      } catch { return unavailable(); }
    },
    async read(input: unknown): Promise<AccountCompletionStatus> {
      try {
        const body = structuredClone(input);
        if (!closed(body, ['requestId', 'token']) || !uuid(body.requestId) || !secret(body.token) || !Number.isFinite(now())) return unavailable();
        const tokenHash = await hash(body.token);
        const result = structuredClone(await transport.rpc('read_account_completion_status_v1', {
          p_request_id: body.requestId, p_token_hash: tokenHash, p_scope_digest: transport.scopeDigest,
        }));
        return status(result, body.requestId, now());
      } catch { return unavailable(); }
    },
  };
}
