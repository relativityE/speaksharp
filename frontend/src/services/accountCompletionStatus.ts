/**
 * #1643 — App receiving side of the inactive account-completion status contract (CLI packet 6305110043, exact 3818759a,
 * `_shared/accountClosureCompletionStatus.ts`). Source preparation only: no route is selected and nothing here calls
 * the network.
 *
 * Every accepted state is closed (exact keys) and bound to the request the client holds. Anything else is
 * `unavailable` — never read as completion, absence or a reason to retry. `canRetry` is always false.
 */
export type PendingCompletionReason = 'coverage_unverified' | 'checkout_unsettled' | 'save_unsettled' | 'coaching_unsettled' | 'ready';
export type CompletionVerificationReason = 'auth_unknown' | 'operation_unknown' | 'execution_expired' | 'identity_unverified' | 'completion_unverified';
export type AccountCompletionStatus =
  | { outcome: 'pending'; requestId: string; reason: PendingCompletionReason; canRetry: false }
  | { outcome: 'processing'; requestId: string; canRetry: false }
  | { outcome: 'verification_pending'; requestId: string; reason: CompletionVerificationReason; canRetry: false }
  | { outcome: 'completed'; requestId: string; accountDeleted: true; canRetry: false }
  | { outcome: 'unavailable'; canRetry: false };
export interface StatusCapability { requestId: string; token: string; expiresAt: number }

const pendingReasons = new Set<string>(['coverage_unverified', 'checkout_unsettled', 'save_unsettled', 'coaching_unsettled', 'ready']);
const verificationReasons = new Set<string>(['auth_unknown', 'operation_unknown', 'execution_expired', 'identity_unverified', 'completion_unverified']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const TOKEN = /^[a-f0-9]{64}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const closed = (row: Record<string, unknown>, keys: string[]) =>
  Object.keys(row).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(row, key));
const unavailable = (): AccountCompletionStatus => ({ outcome: 'unavailable', canRetry: false });

export function accountCompletionStatus(value: unknown, heldRequestId: string): AccountCompletionStatus {
  const row = record(value);
  if (!row || row.canRetry !== false) return unavailable();
  if (row.outcome === 'unavailable') return unavailable();
  if (!UUID.test(heldRequestId) || row.requestId !== heldRequestId) return unavailable();
  const requestId = heldRequestId;
  const common = ['outcome', 'requestId', 'canRetry'];
  if (row.outcome === 'pending' && closed(row, [...common, 'reason']) && pendingReasons.has(row.reason as string)) {
    return { outcome: 'pending', requestId, reason: row.reason as PendingCompletionReason, canRetry: false };
  }
  if (row.outcome === 'processing' && closed(row, common)) return { outcome: 'processing', requestId, canRetry: false };
  if (row.outcome === 'verification_pending' && closed(row, [...common, 'reason']) && verificationReasons.has(row.reason as string)) {
    return { outcome: 'verification_pending', requestId, reason: row.reason as CompletionVerificationReason, canRetry: false };
  }
  if (row.outcome === 'completed' && closed(row, [...common, 'accountDeleted']) && row.accountDeleted === true) {
    return { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
  }
  return unavailable();
}

/** A capability reply for the held request: 64 lower-case hex token, integer epoch-ms deadline still in the future. */
export function accountStatusCapability(value: unknown, heldRequestId: string, now: number): StatusCapability | null {
  const row = record(value);
  if (!row || row.outcome !== 'status_capability' || !closed(row, ['outcome', 'requestId', 'token', 'expiresAt'])) return null;
  if (!UUID.test(heldRequestId) || row.requestId !== heldRequestId || typeof row.token !== 'string' || !TOKEN.test(row.token)) return null;
  if (typeof row.expiresAt !== 'number' || !Number.isSafeInteger(row.expiresAt) || !(row.expiresAt > now)) return null;
  return { requestId: heldRequestId, token: row.token, expiresAt: row.expiresAt };
}

/** True only for the held request's acknowledgment. Acknowledgment is not an effect grant. */
export function accountStatusAcknowledgment(value: unknown, heldRequestId: string): boolean {
  const row = record(value);
  return Boolean(row && row.outcome === 'status_acknowledged' && closed(row, ['outcome', 'requestId'])
    && UUID.test(heldRequestId) && row.requestId === heldRequestId);
}

/**
 * Application-lifetime, in-memory only: the raw key never reaches web storage, URLs or telemetry. One holding at a
 * time, bound to owner + request + the exact key. Observing the deadline (in get or acknowledge) clears the holding, so
 * an earlier clock cannot revive it; acknowledgment must name the held key and arrive before the deadline, so a delayed
 * ACK for a replaced key never acknowledges its replacement (Sam RETURN 1792547869).
 *
 * Owner switching is the CALLER's obligation: hold(newOwner) replaces the previous holding, but get/acknowledge as
 * another owner only refuse and do not evict. Account-change invalidation is not automatic until the page wires it.
 */
let held: { ownerId: string; capability: StatusCapability; acknowledged: boolean } | null = null;
/** Advances on every hold/clear, so a reply that was in flight across either can be recognised and dropped. */
let epoch = 0;
/** Advances only on clear (owner switch / explicit reset): it ends every in-flight issuance of the previous lifecycle. */
let lifecycle = 0;

const current = (ownerId: string, requestId: string, now: number) => {
  if (!held || held.ownerId !== ownerId || held.capability.requestId !== requestId) return null;
  if (!(held.capability.expiresAt > now)) {
    held = null;
    return null;
  }
  return held;
};

export const completionCapabilities = {
  hold(ownerId: string, capability: StatusCapability) {
    held = { ownerId, capability: { ...capability }, acknowledged: false };
    epoch += 1;
  },
  epoch(): number { return epoch; },
  lifecycle(): number { return lifecycle; },
  get(ownerId: string, requestId: string, now: number): (StatusCapability & { acknowledged: boolean }) | null {
    const holding = current(ownerId, requestId, now);
    return holding ? { ...holding.capability, acknowledged: holding.acknowledged } : null;
  },
  acknowledge(ownerId: string, requestId: string, token: string, now: number): boolean {
    const holding = current(ownerId, requestId, now);
    if (!holding || holding.capability.token !== token) return false;
    held = { ...holding, acknowledged: true };
    return true;
  },
  clear() {
    held = null;
    epoch += 1;
    lifecycle += 1;
  },
};
