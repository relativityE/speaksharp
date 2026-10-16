/**
 * #1258 coaching option A (PM 6156942445) — the provider retry POLICY, apart from the handler so every rule is testable.
 *
 * App quota is consumed once, before the provider loop; everything here happens inside that one consumption.
 *
 *   • RETRY SET: provider HTTP 408, 429 and 5xx, a transport error, and a per-attempt timeout. Every other 4xx, a schema
 *     refusal, a contract-invalid 200 and a missing model version are answered, not re-asked.
 *   • ONE BUDGET: `PROVIDER_BUDGET_MS` starts immediately before attempt 1 and covers every attempt AND every wait. Each
 *     attempt is capped at `PROVIDER_ATTEMPT_CAP_MS` and by what remains. Before any wait or attempt,
 *     `wait + MIN_ATTEMPT_MS <= remaining` must hold — otherwise stop now, without sleeping, keeping the last failure.
 *   • BACKOFF: full jitter, capped at 1 s after attempt 1 and 2 s after attempt 2. A valid `Retry-After` (delta-seconds
 *     or an HTTP-date) replaces the jitter when it fits the same check; a valid one that does not fit stops at once.
 *     Negative, fractional, past or otherwise malformed values fall back to the jitter. The header is read for this
 *     decision only — its raw value is never logged or returned.
 */
export const PROVIDER_BUDGET_MS = 45_000;
export const MIN_ATTEMPT_MS = 10_000;
export const PROVIDER_ATTEMPT_CAP_MS = 20_000;
export const MAX_PROVIDER_ATTEMPTS = 3;
/** Full-jitter cap for the wait AFTER attempt n (index n − 1). */
export const JITTER_CAP_MS: readonly number[] = [1_000, 2_000];
/** A delta-seconds value above this is still well-formed; it simply never fits the budget. */
const MAX_DELTA_SECONDS = 86_400;

/** Clock, randomness and an abortable sleep — injected so tests are deterministic and real time is never spent. */
export interface ProviderRetryRuntime {
  /** Monotonic milliseconds (budget accounting). */
  now(): number;
  /** Wall-clock epoch milliseconds (HTTP-date `Retry-After` only). */
  wallNow(): number;
  /** [0, 1). */
  random(): number;
  /** Resolves `true` after `ms`, or `false` as soon as `signal` aborts. Never rejects. */
  sleep(ms: number, signal: AbortSignal): Promise<boolean>;
}

export const realProviderRetryRuntime: ProviderRetryRuntime = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  random: () => Math.random(),
  sleep: (ms, signal) => new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  }),
};

export function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export type RetryAfter =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'valid'; ms: number };

const IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Parse a `Retry-After` header value. A past HTTP-date is malformed (it cannot ask us to wait). */
export function parseRetryAfter(value: string | null, wallNowMs: number): RetryAfter {
  if (value === null) return { kind: 'absent' };
  const v = value.trim();
  if (/^\d+$/.test(v)) {
    const seconds = Number(v);
    return { kind: 'valid', ms: Math.min(seconds, MAX_DELTA_SECONDS) * 1000 };
  }
  if (IMF_FIXDATE.test(v)) {
    const at = Date.parse(v);
    if (Number.isFinite(at) && at > wallNowMs) return { kind: 'valid', ms: at - wallNowMs };
  }
  return { kind: 'malformed' };
}

export type NextStep =
  | { kind: 'wait'; ms: number; source: 'jitter' | 'retry_after' }
  | { kind: 'stop'; why: 'attempt_cap' | 'budget' | 'retry_after_over_budget' };

/** What to do after a RETRYABLE failure of attempt `attemptsDone`, with `elapsedMs` of the budget spent. */
export function planNextAttempt(args: {
  attemptsDone: number;
  elapsedMs: number;
  retryAfter: RetryAfter;
  random: number;
}): NextStep {
  if (args.attemptsDone >= MAX_PROVIDER_ATTEMPTS) return { kind: 'stop', why: 'attempt_cap' };
  const remaining = PROVIDER_BUDGET_MS - args.elapsedMs;
  if (args.retryAfter.kind === 'valid') {
    return args.retryAfter.ms + MIN_ATTEMPT_MS <= remaining
      ? { kind: 'wait', ms: args.retryAfter.ms, source: 'retry_after' }
      : { kind: 'stop', why: 'retry_after_over_budget' };
  }
  const cap = JITTER_CAP_MS[Math.min(args.attemptsDone, JITTER_CAP_MS.length) - 1] ?? 0;
  const ms = Math.floor(Math.max(0, Math.min(0.999999, args.random)) * cap);
  return ms + MIN_ATTEMPT_MS <= remaining ? { kind: 'wait', ms, source: 'jitter' } : { kind: 'stop', why: 'budget' };
}

/**
 * PM 6206983551 — RE-ADMISSION. A wait is admitted against the budget before sleeping, but a timer can wake late. The
 * next attempt starts only if, FRESHLY measured, at least `MIN_ATTEMPT_MS` of the budget remains.
 */
export function canAdmitAttempt(elapsedMs: number): boolean {
  return PROVIDER_BUDGET_MS - elapsedMs >= MIN_ATTEMPT_MS;
}

/** The timeout for the next attempt: the cap, or what remains of the budget if less. */
export function attemptTimeoutMs(elapsedMs: number): number {
  return Math.max(0, Math.min(PROVIDER_ATTEMPT_CAP_MS, PROVIDER_BUDGET_MS - elapsedMs));
}
