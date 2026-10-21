import { executeClaimedAccountClosure, type ClosureDependencies, type ClosureProof, type ClosureResult } from './accountClosure.ts';

export interface CompletionRequest { userId: string; requestId: string }
export interface CompletionGrant extends CompletionRequest {
  executionId: string;
  scopeDigest: string;
  expiresAt: number;
  proof: Readonly<ClosureProof>;
  settled: Readonly<{ checkout: true; saves: true; coaching: true; portal: true }>;
}
// The terminal SQL port owns canonical residue verification and cleanup. The
// legacy verifier rejects the still-held fence and cannot precede that port.
type Policy = Omit<ClosureDependencies, 'consumeProof' | 'verifyResidue'>;
export interface CompletionPorts {
  now(): number;
  /** Independent backend release/config/schema binding, never browser input. */
  currentScopeDigest(): Promise<string>;
  /** Atomic account/request claim AND all-admitted-work readiness under canonical SQL locks. */
  claim(request: Readonly<CompletionRequest>, scopeDigest: string): Promise<unknown>;
  /** Current server authority; true only for this exact unexpired executor/request/scope. */
  inspect(grant: Readonly<CompletionGrant>): Promise<unknown>;
  /** Atomic fresh intent returns dispatch; existing started/unknown/completed never grants dispatch. */
  beginStage(grant: Readonly<CompletionGrant>, key: string): Promise<unknown>;
  finishStage(grant: Readonly<CompletionGrant>, key: string, outcome: 'completed' | 'unknown'): Promise<unknown>;
  /** Atomically verifies canonical residue, cleans terminal identity rows and commits the journal. */
  complete(grant: Readonly<CompletionGrant>): Promise<unknown>;
  /** Existing deletion policy adapters for the exact claimed target; no token claim. */
  policy(grant: Readonly<CompletionGrant>): Policy;
}
export type CompletionResult =
  | { outcome: 'pending' }
  | { outcome: 'hold'; reason: 'claim_unavailable' | 'authority_unavailable' | 'effect_unverified' | 'completion_unverified' }
  | { outcome: 'completed'; result: ClosureResult };

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const hold = (reason: Extract<CompletionResult, { outcome: 'hold' }>['reason']): CompletionResult => ({ outcome: 'hold', reason });

function grantFrom(value: unknown, request: CompletionRequest, scope: string, now: number): CompletionGrant | null {
  if (!closed(value, ['userId', 'requestId', 'executionId', 'scopeDigest', 'expiresAt', 'proof', 'settled'])
    || value.userId !== request.userId || value.requestId !== request.requestId || !uuid(value.executionId)
    || value.scopeDigest !== scope || !Number.isFinite(now) || typeof value.expiresAt !== 'number'
    || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt - now > 900_000
    || !closed(value.settled, ['checkout', 'saves', 'coaching', 'portal'])
    || Object.values(value.settled).some(v => v !== true)
    || !closed(value.proof, ['userId', 'requestId', 'email', 'customerId', 'expiresAt'])
    || value.proof.userId !== request.userId || value.proof.requestId !== request.requestId
    || value.proof.expiresAt !== value.expiresAt || typeof value.proof.email !== 'string'
    || !value.proof.email || value.proof.email !== value.proof.email.trim().toLowerCase()
    || !(value.proof.customerId === null || (typeof value.proof.customerId === 'string' && value.proof.customerId.length > 0))) return null;
  // Caller/port mutations after claim cannot retarget an in-flight request.
  const copy = structuredClone(value) as unknown as CompletionGrant;
  Object.freeze(copy.proof); Object.freeze(copy.settled);
  return Object.freeze(copy);
}

function receipt(value: unknown, grant: CompletionGrant, key: string, phase: string): boolean {
  return closed(value, ['userId', 'requestId', 'executionId', 'scopeDigest', 'key', 'phase'])
    && value.userId === grant.userId && value.requestId === grant.requestId
    && value.executionId === grant.executionId && value.scopeDigest === grant.scopeDigest
    && value.key === key && value.phase === phase;
}

/**
 * Inactive completion controller. No default RPC/provider implementation and no
 * token re-consumption. Every invoked adapter must be independently qualified;
 * mock success is never database or hosted authority. Unknown dispatch/receipts
 * retain the durable intent, never retry, reopen, or adopt another execution.
 */
export async function completePendingAccount(input: CompletionRequest, ports: CompletionPorts): Promise<CompletionResult> {
  let failure: Extract<CompletionResult, { outcome: 'hold' }>['reason'] = 'claim_unavailable';
  try {
    if (!closed(input, ['userId', 'requestId']) || !uuid(input.userId) || !uuid(input.requestId)) return hold(failure);
    const request = Object.freeze({ ...input });
    const scope = await ports.currentScopeDigest();
    if (!digest(scope)) return hold(failure);
    const claimed = await ports.claim(request, scope);
    if (closed(claimed, ['outcome']) && claimed.outcome === 'pending') return { outcome: 'pending' };
    const grant = grantFrom(claimed, request, scope, ports.now());
    if (!grant) return hold(failure);
    failure = 'authority_unavailable';
    const assertLiveWindow = () => {
      const now = ports.now();
      if (!Number.isFinite(now) || now >= grant.expiresAt) throw new Error('authority_unavailable');
    };
    const authority = async () => {
      if (await ports.currentScopeDigest() !== scope) throw new Error('authority_unavailable');
      assertLiveWindow();
      if (!receipt(await ports.inspect(grant), grant, 'authority', 'processing')) throw new Error('authority_unavailable');
      // Inspection can outlive its grant. Recheck after every awaited authority
      // source, including the independent binding read that follows inspection.
      if (await ports.currentScopeDigest() !== scope) throw new Error('authority_unavailable');
      assertLiveWindow();
    };
    await authority();
    assertLiveWindow();
    const policy = ports.policy(grant);
    const read = async <T>(operation: () => Promise<T>): Promise<T> => {
      await authority(); assertLiveWindow();
      const value = await operation();
      await authority(); assertLiveWindow(); return value;
    };
    const effect = async <T>(key: string, operation: () => Promise<T>, verified: (value: T) => boolean): Promise<T> => {
      await authority();
      assertLiveWindow();
      failure = 'effect_unverified';
      // A lost begin acknowledgement never dispatches the external operation.
      if (!receipt(await ports.beginStage(grant, key), grant, key, 'dispatch')) throw new Error('intent_unverified');
      let completionObserved = false;
      try {
        await authority();
        // No await may intervene between this local expiry check and dispatch.
        assertLiveWindow();
        const value = await operation();
        await authority();
        assertLiveWindow();
        if (!verified(value)) throw new Error('effect_unverified');
        if (!receipt(await ports.finishStage(grant, key, 'completed'), grant, key, 'completed')) throw new Error('effect_receipt_unverified');
        completionObserved = true;
        await authority();
        failure = 'authority_unavailable';
        return value;
      } catch {
        // Best-effort classification only; a failed write leaves the existing
        // started intent unresolved. It must never reset/replay that intent.
        if (!completionObserved) {
          try { await ports.finishStage(grant, key, 'unknown'); } catch { /* retained started intent remains non-replayable */ }
        }
        failure = 'effect_unverified';
        throw new Error('effect_unverified');
      }
    };
    let terminalVerified = false;
    const result = await executeClaimedAccountClosure(request.userId, grant.proof, {
      now: () => ports.now(),
      verifyCheckouts: (userId, customerId) => read(() => policy.verifyCheckouts(userId, customerId)),
      listSubscriptions: customerId => read(() => policy.listSubscriptions(customerId)),
      cancelSubscription: (id, options) => effect(`cancel:${id}`, () => policy.cancelSubscription(id, options), () => true),
      settleBilling: (userId, subscriptions) => effect('settle_billing', () => policy.settleBilling(userId, subscriptions), () => true),
      deleteCustomer: customerId => effect('delete_customer', () => policy.deleteCustomer(customerId), value => value?.deleted === true),
      preserveTrialEmail: (userId, email) => effect('retain_trial', () => policy.preserveTrialEmail(userId, email), () => true),
      removeOwnedStorage: userId => effect('remove_storage', () => policy.removeOwnedStorage(userId), () => true),
      deleteAuthUser: userId => effect('delete_auth', () => policy.deleteAuthUser(userId), value => value?.deleted === true),
      verifyResidue: async () => {
        failure = 'completion_unverified';
        await authority();
        assertLiveWindow();
        // The SQL statement removes only this executor's terminal identity
        // rows, verifies canonical residue and commits completion together.
        // A lost/invalid reply never becomes success or permits effect replay.
        if (!receipt(await ports.complete(grant), grant, 'completion', 'completed')) return { clean: false };
        terminalVerified = true;
        // inspect(processing) is no longer valid after the terminal commit.
        if (await ports.currentScopeDigest() !== scope) throw new Error('completion_unverified');
        assertLiveWindow();
        return { clean: true };
      },
    });
    if (result.outcome !== 'deleted' || !terminalVerified) return hold(failure);
    failure = 'completion_unverified';
    // The attempt is terminal now, so inspect(processing) is no longer valid.
    // Still pin the final reply to the same live release and execution window.
    if (await ports.currentScopeDigest() !== scope) return hold(failure);
    assertLiveWindow();
    // Completion is proved by the durable terminal receipt, not a now-invalid
    // owner JWT, generic 401, or existence of a request identifier.
    return { outcome: 'completed', result };
  } catch { return hold(failure); }
}
