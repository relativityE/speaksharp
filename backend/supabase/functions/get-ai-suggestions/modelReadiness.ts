/** Service-owned readiness protocol. A store implementation must serialize claims and compare both lease and revision on finish. */
export interface ReadinessModel {
  id: string;
  observedVersions: readonly string[];
}
export type ReadinessState = { model: string; revision: number };
export interface ProbeLease {
  state: ReadinessState;
  token: string;
  deadlineMs: number;
}
export type ClaimResult = { kind: 'claimed'; lease: ProbeLease }
  | { kind: 'busy' | 'fresh' | 'cooldown'; state: ReadinessState; checkId?: string };
export type CheckResult = 'not_requested' | 'shared' | 'healthy' | 'promoted' | 'unavailable' | 'backoff' | 'inconclusive' | 'stale';
export type CheckOutcome = 'healthy' | 'promoted' | 'unavailable' | 'inconclusive' | 'provider_limited' | 'cancelled';
export type ProbeResult =
  | { status: 200; observedVersion: string | null; coachingValid: boolean }
  | { status: 429 | 503; scope: 'model' | 'project' | 'unknown'; retryAfterMs?: number }
  | { status: 'model_unavailable' | 'failed' };
export type ProbeProduct = 'open_mic' | 'focus_points';
export interface ReadinessStore {
  claim(): Promise<ClaimResult>;
  /** Must accept only a matching non-expired lease on the still-current revision; promotion and release are one transaction. */
  finish(lease: ProbeLease, result: {
    promoteTo?: string;
    verified?: boolean;
    retryAfterMs?: number;
  }, outcome: CheckOutcome): Promise<boolean>;
}
// Match the existing bounded catalog sweep and respect the shared lease deadline.
const MAX_FALLBACKS = 8;

type Probe = (model: ReadinessModel, product: ProbeProduct, signal: AbortSignal) => Promise<ProbeResult>;

export async function runMicStartReadiness(
  input: { recordingConfirmed: boolean; coachingSelected: boolean },
  options: { store: ReadinessStore;
    modelFor: (id: string) => ReadinessModel | null;
    discover: (signal: AbortSignal) => Promise<readonly ReadinessModel[] | null>;
    probe: Probe; now: () => number; callerSignal?: AbortSignal;
    candidateTimeout?: (ms: number) => AbortSignal },
): Promise<CheckResult> {
  if (input.recordingConfirmed !== true || input.coachingSelected !== true) return 'not_requested';
  const { store, modelFor, discover, probe, now, callerSignal, candidateTimeout = AbortSignal.timeout } = options;
  const claim = await store.claim();
  if (claim.kind !== 'claimed') return 'shared';
  const { lease } = claim;
  const active = modelFor(lease.state.model);
  // undefined is SQL NULL: uncertainty must not clear the last verified state.
  let verified: boolean | undefined;
  let blocked = false;
  let promoteTo: string | undefined;
  let retryAfterMs: number | undefined;
  const canContinue = () => !callerSignal?.aborted && now() < lease.deadlineMs;
  const check = async (candidate: ReadinessModel): Promise<'valid' | 'local_failure' | 'try_next' | 'blocked'> => {
    // One representative coaching test per candidate (PO 11-27): Open Mic covers what either product would do.
    for (const product of ['open_mic'] as const) {
      const availableMs = lease.deadlineMs - now();
      if (availableMs <= 0 || callerSignal?.aborted) return 'blocked';
      let status: ProbeResult | undefined;
      const signal = candidateTimeout(Math.min(availableMs, 6_000));
      try { status = await probe(candidate, product, signal); }
      catch { /* Only our model-specific timeout may continue a sweep, not an unknown transport failure. */ }
      if (!canContinue()) return 'blocked';
      // A per-candidate timeout says nothing conclusive about the selected model. Do not accept a late answer.
      if (signal.aborted) return 'try_next';
      if (!status) return 'blocked';
      if (status.status === 200 && status.coachingValid && status.observedVersion !== null
        && candidate.observedVersions.includes(status.observedVersion)) continue;
      if (status.status === 200 || status.status === 'model_unavailable') return 'local_failure';
      if (status.status === 429 || status.status === 503) {
        const hint = status.retryAfterMs;
        const bounded = typeof hint === 'number' && Number.isFinite(hint) && hint > 0
          ? Math.min(Math.ceil(hint), 86_400_000) : undefined;
        // A proven model-local limit is not a project-wide stop. The sweep
        // tracks that model in seen; it never spends the hint retrying it, and
        // the hint never becomes the shared hold (it belongs to that model only).
        if (status.scope === 'model') return 'local_failure';
        // A 503 can be isolated to a variant even without a structured quota scope.
        // Continue only inside the existing candidate and time budgets, without demoting on 503 alone.
        if (status.status === 503 && status.scope !== 'project') return 'try_next';
        if (status.scope === 'project') retryAfterMs = bounded;
        return 'blocked';
      }
      return 'blocked';
    }
    return 'valid';
  };
  let accepted = false;
  let outcome: CheckOutcome = 'inconclusive';
  try {
    if (active) {
      const status = await check(active);
      if (status === 'valid') verified = true;
      else if (status === 'blocked') blocked = true;
      else if (status === 'local_failure' || status === 'try_next') {
        if (status === 'local_failure') verified = false;
        else blocked = true;
        const remaining = lease.deadlineMs - now();
        const signal = canContinue() && remaining > 0 ? AbortSignal.timeout(Math.min(5_000, remaining)) : null;
        const candidates = signal ? await discover(signal).catch(() => null) : null;
        if (!candidates || !signal || signal.aborted || !canContinue()) blocked = true;
        else {
          const seen = new Set([active.id]);
          for (const candidate of candidates) {
            if (seen.size > MAX_FALLBACKS) break;
            if (!canContinue()) { blocked = true; break; }
            const fallback = modelFor(candidate.id);
            if (!fallback || seen.has(fallback.id)) continue;
            seen.add(fallback.id);
            const outcome = await check(fallback);
            if (outcome === 'blocked') { blocked = true; break; }
            if (outcome === 'try_next') blocked = true;
            if (outcome === 'valid') {
              verified = true;
              promoteTo = fallback.id;
              break;
            }
          }
        }
      }
    }
  } finally {
    // A blocked fallback says nothing about the incumbent beyond its own
    // already observed result. Preserve false if that result was conclusive.
    // Only a confirmed project-wide provider wait is recorded; a model-scoped hint never is.
    outcome = promoteTo ? 'promoted' : verified ? 'healthy'
      : retryAfterMs !== undefined ? 'provider_limited' : blocked || !active ? 'inconclusive' : 'unavailable';
    accepted = await store.finish(lease, { promoteTo, verified, retryAfterMs }, outcome);
  }
  if (!accepted) return 'stale';
  return outcome === 'provider_limited' ? 'backoff' : outcome;
}
