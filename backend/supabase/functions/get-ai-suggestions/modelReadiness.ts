/** Service-owned readiness protocol. A store implementation must serialize claims and compare both lease and revision on finish. */
export interface ApprovedModel {
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
  | { kind: 'busy' | 'fresh' | 'cooldown'; state: ReadinessState };
export type CheckResult = 'not_requested' | 'shared' | 'healthy' | 'promoted' | 'unavailable' | 'stale';
export type ProbeResult =
  | { status: 200; observedVersion: string | null; coachingValid: boolean }
  | { status: 429 | 503; scope: 'model' | 'project' | 'unknown'; retryAfterMs?: number }
  | { status: 'failed' };
export type ProbeProduct = 'open_mic' | 'focus_points';
export interface ReadinessStore {
  claim(): Promise<ClaimResult>;
  /** Must accept only a matching non-expired lease on the still-current revision; promotion and release are one transaction. */
  finish(lease: ProbeLease, result: {
    promoteTo?: string;
    verified?: boolean;
    retryAfterMs?: number;
  }): Promise<boolean>;
}
type Probe = (model: ApprovedModel, product: ProbeProduct, signal: AbortSignal) => Promise<ProbeResult>;

export async function runMicStartReadiness(
  input: { recordingConfirmed: boolean; coachingSelected: boolean },
  options: { store: ReadinessStore; approvedModels: readonly ApprovedModel[]; probe: Probe; now: () => number },
): Promise<CheckResult> {
  if (input.recordingConfirmed !== true || input.coachingSelected !== true) return 'not_requested';
  const { store, approvedModels, probe, now } = options;
  const claim = await store.claim();
  if (claim.kind !== 'claimed') return 'shared';
  const { lease } = claim;
  const active = approvedModels.find((entry) => entry.id === lease.state.model);
  const fallback = approvedModels.find((entry) => entry.id !== lease.state.model);
  let verified = false;
  let promoteTo: string | undefined;
  let retryAfterMs: number | undefined;
  const check = async (candidate: ApprovedModel): Promise<'valid' | 'local_failure' | 'blocked'> => {
    for (const product of ['open_mic', 'focus_points'] as const) {
      const availableMs = lease.deadlineMs - now();
      if (availableMs <= 0) return 'blocked';
      let status: ProbeResult;
      const signal = AbortSignal.timeout(Math.min(availableMs, 6_000));
      try { status = await probe(candidate, product, signal); }
      catch { return 'blocked'; }
      if (signal.aborted || now() >= lease.deadlineMs) return 'blocked';
      if (status.status === 200 && status.coachingValid && status.observedVersion !== null
        && candidate.observedVersions.includes(status.observedVersion)) continue;
      if (status.status === 200) return 'local_failure';
      if (status.status === 429 || status.status === 503) {
        const hint = status.retryAfterMs;
        if (typeof hint === 'number' && Number.isFinite(hint) && hint > 0) {
          retryAfterMs = Math.min(Math.ceil(hint), 86_400_000);
          return 'blocked';
        }
        // Only classified model capacity/rate failures may try a second known model. Shared or opaque quota must cool down.
        return status.scope === 'model' ? 'local_failure' : 'blocked';
      }
      return 'blocked';
    }
    return 'valid';
  };
  let accepted = false;
  try {
    if (active) {
      const status = await check(active);
      if (status === 'valid') verified = true;
      else if (status === 'local_failure' && fallback && await check(fallback) === 'valid') {
        verified = true;
        promoteTo = fallback.id;
      }
    }
  } finally {
    accepted = await store.finish(lease, { promoteTo, verified, retryAfterMs });
  }
  if (!accepted) return 'stale';
  return promoteTo ? 'promoted' : verified ? 'healthy' : 'unavailable';
}
