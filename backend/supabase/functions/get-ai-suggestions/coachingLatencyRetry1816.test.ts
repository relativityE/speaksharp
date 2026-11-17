import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler, providerRetryHooks } from './index.ts';
import { PROVIDER_ATTEMPT_CAP_MS, PROVIDER_BUDGET_MS, type ProviderRetryRuntime } from './providerRetry.ts';

/**
 * #1816 C9 FIRST-TRY LATENCY and C10 TRUTHFUL FAILURE + RETRY, layer L2 (handback/1816-coaching-bot-test-plan-2026-11-17.md).
 *
 * C9: a healthy provider is answered on the FIRST attempt, inside the 15 s attempt cap; a provider that never answers ends in
 *     a closed failure inside the 45 s budget, charged once, with nothing saved.
 * C10: a failed generation says so (no coaching, a closed reason, "try again"), saves nothing and charges at most once; the
 *      user's Retry is a NEW request that serves and saves exactly the pair it returns, charged once.
 *
 * Each check runs the real handler on an injected clock (no real time is spent) and is paired with the fault it must catch.
 * Provider faults are scripted provider answers; page-side faults (a failure dressed as coaching, a Retry that replays the
 * old failure, a Retry sent twice) wrap the handler the way a broken client would. Every pair is a SYNTHETIC CONTROL.
 *
 * The other test files in `test:edge` replace `fetch` and the retry runtime at module load. This file swaps both, and the
 * provider key, only for the length of each request and puts them back, so it never disturbs them.
 */
const OWNER = '00000000-0000-4000-8000-000000000001';
const TAKE = '10000000-0000-4000-8000-00000000000a';
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
/** The release bar's numbers, written out so a change to the handler's constants cannot move the bar with it. */
const FIRST_TRY_CAP_MS = 15_000;
const FAILURE_BUDGET_MS = 45_000;
const CLOSED_FAILURE_REASONS = new Set(['provider_http_5xx', 'provider_transport', 'provider_timeout', 'missing_text', 'invalid_shape']);

const PAIR = { version: 'gemini_coaching_v1', what_worked: 'Leading with the onboarding checklist result made the update clear.', what_to_try_next: 'Name the verification delay before asking for setup help.' } as const;
const OTHER_TAKE_PAIR = { version: 'gemini_coaching_v1', what_worked: 'Opening with renters arguing over the electric bill hooked attention.', what_to_try_next: 'Slow down when you share the pilot results on late payments.' } as const;

/** One scripted provider answer: a pair after `ms`, an HTTP status after `ms`, or no answer at all (the attempt times out). */
type Answer = { kind: 'ok'; ms: number } | { kind: 'status'; status: number; ms: number } | { kind: 'stall' };

/** One saved take, the owner's quota, and the persistence call, counted. */
function account() {
  const counts = { quota: 0, persisted: [] as unknown[], providerCalls: 0 };
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: OWNER } }, error: null }) },
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (name === 'check_usage_limit') return Promise.resolve({ data: { can_start: true, is_pro: true }, error: null });
      if (name === 'begin_account_coaching_v1') return Promise.resolve({ data: { admitted: true, operationId: args?.p_operation_id }, error: null });
      if (name === 'finish_account_coaching_failure_v1' || name === 'finish_account_coaching_local_v1') return Promise.resolve({ data: true, error: null });
      if (name === 'read_ai_suggestion_authority_v1') return Promise.resolve({ data: [], error: null });
      if (name === 'persist_ai_suggestion_with_authority_v1' || name === 'persist_account_coaching_v1') {
        counts.persisted.push(args?.p_suggestions);
        return Promise.resolve({ data: args?.p_suggestions, error: null });
      }
      if (name === 'consume_ai_suggestion_quota') {
        counts.quota += 1;
        return Promise.resolve({ data: { allowed: true, remaining: 20 - counts.quota, limit: 20, used: counts.quota }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'not_in_this_check' } });
    },
    from: (table: string) => ({
      select: (_columns: string) => {
        const result = () => table === 'user_profiles' ? { data: { subscription_status: 'pro' }, error: null }
          : table === 'sessions' ? { data: {
            id: TAKE, user_id: OWNER, product: 'open_mic', transcript: 'This week the onboarding team finished the new checklist.',
            transcript_state: 'available', duration: 60, total_words: 120, filler_words: { um: { count: 1 } }, clarity_score: 80, wpm: 140,
            pause_metrics: { extendedPauses: 0 }, ai_suggestions: counts.persisted.at(-1) ?? null,
          }, error: null }
            : { data: null, error: null };
        const query: Record<string, unknown> = {
          eq: () => query, order: () => query, limit: () => query,
          single: () => Promise.resolve(result()), maybeSingle: () => Promise.resolve(result()),
          then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
        };
        return query;
      },
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { create: () => client as any, counts };
}

interface Observed {
  status: number;
  body: { suggestions?: unknown; error?: string; reason?: string; code?: string; diagnostics?: Record<string, unknown> };
  /** Time on the injected clock from the request to its answer. */
  elapsedMs: number;
  attemptTimeouts: number[];
  providerCalls: number;
  quota: number;
  persisted: number;
}

/**
 * Send one coaching request for TAKE through the real handler, with `answers` scripted per provider attempt (the last one
 * repeats). `lateWakeMs` makes every wait wake that much late (a slow timer).
 */
async function request(acct: ReturnType<typeof account>, answers: Answer[], { lateWakeMs = 0, clientAttempt = 1 } = {}): Promise<Observed> {
  const clock = { mono: 0 };
  const attemptTimeouts: number[] = [];
  let currentTimeout: AbortController | null = null;
  const runtime: ProviderRetryRuntime = {
    now: () => clock.mono,
    wallNow: () => Date.parse('2026-11-17T12:00:00Z') + clock.mono,
    random: () => 0.5,
    sleep: (ms, signal) => {
      if (signal.aborted) return Promise.resolve(false);
      clock.mono += ms + lateWakeMs;
      return Promise.resolve(true);
    },
    timeout: (ms) => { attemptTimeouts.push(ms); currentTimeout = new AbortController(); return currentTimeout.signal; },
  };
  const script = [...answers];
  const callsBefore = acct.counts.providerCalls;
  const quotaBefore = acct.counts.quota;
  const persistedBefore = acct.counts.persisted.length;
  const fakeFetch = (async (url: string | URL | Request) => {
    if (new URL(url.toString()).origin !== GEMINI_ORIGIN) return new Response('Not Found', { status: 404 });
    acct.counts.providerCalls += 1;
    const answer = script.length > 1 ? script.shift()! : script[0];
    const cap = attemptTimeouts.at(-1) ?? PROVIDER_ATTEMPT_CAP_MS;
    if (answer.kind === 'stall' || answer.ms > cap) {
      // No answer inside this attempt's own timeout: the clock reaches it and the attempt's signal fires.
      clock.mono += cap;
      currentTimeout?.abort(new DOMException('Signal timed out.', 'TimeoutError'));
      throw new DOMException('Signal timed out.', 'TimeoutError');
    }
    clock.mono += answer.ms;
    if (answer.kind === 'status') return new Response('upstream unavailable', { status: answer.status });
    return new Response(JSON.stringify({ modelVersion: 'gemini-3.6-flash', candidates: [{ content: { parts: [{ text: JSON.stringify(PAIR) }] } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const realFetch = globalThis.fetch;
  const realRuntime = providerRetryHooks.runtime;
  const realKey = Deno.env.get('GEMINI_API_KEY');
  globalThis.fetch = fakeFetch;
  providerRetryHooks.runtime = runtime;
  Deno.env.set('GEMINI_API_KEY', 'test-key');
  let res: Response;
  try {
    res = await handler(new Request('http://localhost/get-ai-suggestions', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: TAKE, product: 'open_mic', client_attempt: clientAttempt, accepted_coaching_versions: ['gemini_coaching_v1', 'gemini_coaching_focus_v1'] }),
    }), acct.create);
  } finally {
    globalThis.fetch = realFetch;
    providerRetryHooks.runtime = realRuntime;
    if (realKey === undefined) Deno.env.delete('GEMINI_API_KEY'); else Deno.env.set('GEMINI_API_KEY', realKey);
  }
  return {
    status: res.status, body: await res.json(), elapsedMs: clock.mono, attemptTimeouts,
    providerCalls: acct.counts.providerCalls - callsBefore, quota: acct.counts.quota - quotaBefore,
    persisted: acct.counts.persisted.length - persistedBefore,
  };
}

type Verdict = 'PASS' | 'FAIL';
const verdict = (why: string[]): { verdict: Verdict; why: string[] } => ({ verdict: why.length ? 'FAIL' : 'PASS', why });
const log = (entry: Record<string, unknown>) => console.log(`#1816_BOT_CHECK ${JSON.stringify(entry)}`);

/** C9 (first try): coaching is served on the first provider attempt, inside the 15 s cap, charged once and saved once. */
function firstTryLatency(o: Observed) {
  const why: string[] = [];
  if (o.status !== 200 || o.body.suggestions === undefined) why.push('no coaching served');
  else if (o.providerCalls !== 1 || o.body.diagnostics?.provider_attempts !== 1) why.push('answered only after a retry');
  if ((o.attemptTimeouts[0] ?? Infinity) > FIRST_TRY_CAP_MS) why.push('the first attempt was allowed past the 15 s cap');
  if (o.status === 200 && o.elapsedMs > FIRST_TRY_CAP_MS) why.push('answered after the 15 s first-try cap');
  if (o.quota !== 1) why.push(`charged ${o.quota} times`);
  return verdict(why);
}

/** C9 (budget): a provider that never answers ends in a closed failure inside 45 s, charged once, nothing saved. */
function closedFailureInBudget(o: Observed) {
  const why: string[] = [];
  if (o.status !== 502 || o.body.suggestions !== undefined) why.push('not a closed failure');
  if (!CLOSED_FAILURE_REASONS.has(String(o.body.reason))) why.push(`unclosed reason ${String(o.body.reason)}`);
  if (o.elapsedMs > FAILURE_BUDGET_MS) why.push('the failure came after the 45 s budget');
  if (o.quota !== 1) why.push(`charged ${o.quota} times`);
  if (o.persisted !== 0) why.push('something was saved for a failed generation');
  return verdict(why);
}

/** C10: the failure is truthful, and the user's Retry is a new request that serves and saves exactly what it shows. */
function truthfulFailureThenRetry(first: Observed, retry: Observed) {
  const why: string[] = [];
  if (first.status < 500 || first.body.suggestions !== undefined) why.push('a failure was shown as coaching');
  // The wire names the failure with a closed reason and code; the page owns the "try again" words (C10 L3, AISuggestions).
  if (!CLOSED_FAILURE_REASONS.has(String(first.body.reason)) || first.body.code !== first.body.reason || first.body.diagnostics?.outcome !== 'failure') {
    why.push('the failure does not say what happened');
  }
  if (first.persisted !== 0) why.push('something was saved for the failed generation');
  if (first.quota > 1) why.push('the failed generation was charged more than once');
  if (retry.providerCalls < 1) why.push('Retry made no new request');
  if (retry.status !== 200 || JSON.stringify(retry.body.suggestions) !== JSON.stringify(PAIR)) why.push('Retry did not show this take\'s coaching');
  if (retry.persisted !== 1) why.push(`Retry saved ${retry.persisted} pairs`);
  if (retry.quota !== 1) why.push(`Retry was charged ${retry.quota} times`);
  return verdict(why);
}

// ── C9 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Deno.test('#1816 C9 control: a 3.6 s answer is served on the first try inside the 15 s cap, charged and saved once', async () => {
  // The bar is the handler's own cap: if the handler's constant moves, this check says so instead of moving with it.
  assertEquals([PROVIDER_ATTEMPT_CAP_MS, PROVIDER_BUDGET_MS], [FIRST_TRY_CAP_MS, FAILURE_BUDGET_MS]);
  const o = await request(account(), [{ kind: 'ok', ms: 3_600 }]);
  const v = firstTryLatency(o);
  log({ check: 'C9 first try control', elapsedMs: o.elapsedMs, attempts: o.providerCalls, verdict: v.verdict, why: v.why });
  assertEquals(v, { verdict: 'PASS', why: [] });
  assertEquals(o.persisted, 1);
});

Deno.test('#1816 C9 FAULT: a 16 s first answer times out and is served only on the retry, and the first-try check FAILs', async () => {
  const o = await request(account(), [{ kind: 'ok', ms: 16_000 }, { kind: 'ok', ms: 2_000 }]);
  const v = firstTryLatency(o);
  log({ check: 'C9 first try fault (16 s answer)', status: o.status, elapsedMs: o.elapsedMs, attempts: o.providerCalls, verdict: v.verdict, why: v.why });
  assertEquals(o.status, 200, 'setup: the retry does serve the pair, so only the first-try rule can fail');
  assertEquals(v.why, ['answered only after a retry', 'answered after the 15 s first-try cap']);
});

Deno.test('#1816 C9 control: a provider that never answers ends in a closed provider_timeout inside 45 s, charged once, nothing saved', async () => {
  const o = await request(account(), [{ kind: 'stall' }]);
  const v = closedFailureInBudget(o);
  log({ check: 'C9 budget control (provider stalls)', status: o.status, reason: o.body.reason, elapsedMs: o.elapsedMs, attempts: o.providerCalls, verdict: v.verdict, why: v.why });
  assertEquals(v, { verdict: 'PASS', why: [] });
  assertEquals(o.body.reason, 'provider_timeout');
  // The same stalled take is a FAIL for first-try latency: the two halves of C9 are separate verdicts.
  assertEquals(firstTryLatency(o).why, ['no coaching served']);
});

Deno.test('#1816 C9 FAULT: a timer that wakes 40 s late pushes the failure past 45 s, and the budget check FAILs', async () => {
  const o = await request(account(), [{ kind: 'stall' }], { lateWakeMs: 40_000 });
  const v = closedFailureInBudget(o);
  log({ check: 'C9 budget fault (late timer)', status: o.status, reason: o.body.reason, elapsedMs: o.elapsedMs, attempts: o.providerCalls, verdict: v.verdict, why: v.why });
  assertEquals(o.status, 502, 'setup: still a closed failure, so only the budget rule can fail');
  assertEquals(v.why, ['the failure came after the 45 s budget']);
});

// ── C10 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
Deno.test('#1816 C10 control: 503 on every attempt is a truthful failure; Retry asks again and shows and saves the pair', async () => {
  const acct = account();
  const first = await request(acct, [{ kind: 'status', status: 503, ms: 400 }]);
  const retry = await request(acct, [{ kind: 'ok', ms: 2_000 }], { clientAttempt: 2 });
  const v = truthfulFailureThenRetry(first, retry);
  log({ check: 'C10 control', first: { status: first.status, reason: first.body.reason, attempts: first.providerCalls }, retry: { status: retry.status, attempts: retry.providerCalls }, verdict: v.verdict, why: v.why });
  assertEquals(v, { verdict: 'PASS', why: [] });
  assertEquals([first.providerCalls, first.body.reason], [3, 'provider_http_5xx']);
});

Deno.test('#1816 C10 FAULT: a page that dresses the failure as another take\'s coaching is caught', async () => {
  const acct = account();
  const real = await request(acct, [{ kind: 'status', status: 503, ms: 400 }]);
  // The broken client: on failure it shows the last pair it had (another take's) as if it were this take's coaching.
  const first: Observed = { ...real, status: 200, body: { suggestions: OTHER_TAKE_PAIR } };
  const retry = await request(acct, [{ kind: 'ok', ms: 2_000 }], { clientAttempt: 2 });
  const v = truthfulFailureThenRetry(first, retry);
  log({ check: 'C10 fault (failure shown as coaching)', verdict: v.verdict, why: v.why });
  assertEquals(v.why, ['a failure was shown as coaching', 'the failure does not say what happened']);
});

Deno.test('#1816 C10 FAULT: a Retry that replays the old failure instead of asking again is caught', async () => {
  const acct = account();
  const first = await request(acct, [{ kind: 'status', status: 503, ms: 400 }]);
  // The broken client: Retry re-renders the failed answer and sends nothing.
  const retry: Observed = { ...first, providerCalls: 0, quota: 0, persisted: 0 };
  const v = truthfulFailureThenRetry(first, retry);
  log({ check: 'C10 fault (Retry replays the failure)', verdict: v.verdict, why: v.why });
  assertEquals(v.why, ['Retry made no new request', 'Retry did not show this take\'s coaching', 'Retry saved 0 pairs', 'Retry was charged 0 times']);
});

Deno.test('#1816 C10 control: a Retry press that sends two requests is still charged once and saved once (the second replays the saved pair)', async () => {
  const acct = account();
  const first = await request(acct, [{ kind: 'status', status: 503, ms: 400 }]);
  // A double-sent Retry: the first request generates and saves; the second must be answered from that saved pair.
  const a = await request(acct, [{ kind: 'ok', ms: 2_000 }], { clientAttempt: 2 });
  const b = await request(acct, [{ kind: 'ok', ms: 2_000 }], { clientAttempt: 2 });
  const retry: Observed = { ...b, providerCalls: a.providerCalls + b.providerCalls, quota: a.quota + b.quota, persisted: a.persisted + b.persisted };
  const v = truthfulFailureThenRetry(first, retry);
  log({ check: 'C10 control (Retry sent twice)', second: { status: b.status, source: b.body.diagnostics?.source ?? null, attempts: b.providerCalls }, quota: retry.quota, persisted: retry.persisted, verdict: v.verdict, why: v.why });
  assertEquals(v, { verdict: 'PASS', why: [] });
  assertEquals([b.body.diagnostics?.source, b.providerCalls, b.quota], ['cache', 0, 0]);
});
