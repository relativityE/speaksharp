// Shared absolute-deadline helper for the outbox workers. One deadline governs the whole run:
// reconcile, claim, source reads, provider sends, marks, discards, status reads, and the failure alert
// are ALL bounded so no remote operation can run past the deadline, and a reserved tail guarantees the
// final mark can complete.

export class DeadlineError extends Error {
  constructor() { super("deadline_exhausted"); this.name = "DeadlineError"; }
}

export type Budget = {
  start: number;
  remaining: () => number;
  /** Budget for a non-final op — reserves markReserveMs so the terminal mark always has time. */
  opBudget: (capMs: number) => number;
  /** Budget for the final mark — may use the whole remaining window. */
  markBudget: (capMs: number) => number;
};

export function makeBudget(nowFn: () => number, deadlineMs: number, markReserveMs: number): Budget {
  const start = nowFn();
  const remaining = () => deadlineMs - (nowFn() - start);
  return {
    start,
    remaining,
    opBudget: (capMs: number) => Math.min(capMs, remaining() - markReserveMs),
    markBudget: (capMs: number) => Math.min(capMs, remaining()),
  };
}

// deno-lint-ignore no-explicit-any
type PgResult = { data: any; error: any };

/** Run a Supabase builder produced by `factory(signal)` under an AbortController bounded to budgetMs.
 * budgetMs<=0 → aborted:true WITHOUT starting. An aborted/timed-out call reports aborted:true. */
export async function rpcBounded(
  factory: (signal: AbortSignal) => PromiseLike<PgResult>,
  budgetMs: number,
): Promise<{ data: unknown; error: unknown; aborted: boolean }> {
  if (budgetMs <= 0) return { data: null, error: null, aborted: true };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budgetMs);
  try {
    const res = await factory(ctl.signal);
    return { data: res?.data ?? null, error: res?.error ?? null, aborted: false };
  } catch (e) {
    return { data: null, error: e, aborted: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Run an arbitrary remote op (e.g. Sentry send) under a bounded AbortController. budgetMs<=0 throws
 * DeadlineError so the caller does not start it (and cannot keep the function alive past the deadline). */
export async function runBounded<T>(budgetMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (budgetMs <= 0) throw new DeadlineError();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budgetMs);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}
