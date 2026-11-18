import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

/**
 * #1816 C6 WRONG TAKE ON REOPEN, layer L2 (handback/1816-coaching-bot-test-plan-2026-11-17.md). Reopening a saved take must
 * replay the coaching saved for THAT take, from the cache, with no provider call, for an Open Mic take and a Focus take alike.
 *
 * The existing suite's Supabase double returns one session whatever id is asked for, so it cannot see a swap. This double keeps
 * several saved takes and answers a `sessions` read only for the exact id and owner the handler filtered on. The injected fault
 * is a cross-wired store that ignores the id and returns the most recently saved take; the check must FAIL on it.
 * All rows and pairs are SYNTHETIC CONTROLS; no network call is made.
 */
const OWNER = '00000000-0000-4000-8000-000000000001';
const X = '10000000-0000-4000-8000-00000000000a'; // Open Mic take (om-01 fixture text)
const Y = '10000000-0000-4000-8000-00000000000b'; // Open Mic take (om-03 fixture text)
const F = '10000000-0000-4000-8000-00000000000f'; // Focus take (fp-02 fixture text), saved last

const PAIR = {
  [X]: { version: 'gemini_coaching_v1', what_worked: 'Leading with the onboarding checklist result made the update clear.', what_to_try_next: 'Name the verification delay before asking for setup help.' },
  [Y]: { version: 'gemini_coaching_v1', what_worked: 'Opening with renters arguing over the electric bill hooked attention.', what_to_try_next: 'Slow down when you share the pilot results on late payments.' },
  [F]: { version: 'gemini_coaching_focus_v1', what_worked: 'Explaining that glass now goes in the blue bin was clear.', what_to_try_next: 'Add one sentence on why the plant now sorts the glass.' },
} as const;

const row = (id: string, product: 'open_mic' | 'focus_points', transcript: string) => ({
  id, user_id: OWNER, product, transcript, transcript_state: 'available', duration: 60, total_words: 120, filler_words: { um: { count: 1 } },
  clarity_score: 80, wpm: 140, pause_metrics: { extendedPauses: 0 }, ai_suggestions: PAIR[id as keyof typeof PAIR],
});
/** Saved in this order: X, Y, then F (the newest). */
const ROWS = [
  row(X, 'open_mic', 'This week the onboarding team finished the new checklist.'),
  row(Y, 'open_mic', 'Our app helps renters split utility bills automatically.'),
  row(F, 'focus_points', 'Starting in June, glass goes in the blue bin with cans and plastic.'),
];
/** F's saved Focus results (fp-02): "Why it changes" not detected. */
const FOCUS = {
  objective: { id: 'obj-f', brief_id: 'brief-f', source_session_id: F },
  brief: { event_goal: 'Recycling change' },
  points: [{ id: 'p1', label: 'What changes', sort_order: 0 }, { id: 'p2', label: 'Why it changes', sort_order: 1 }, { id: 'p3', label: 'What to do with old crates', sort_order: 2 }],
  evidence: [{ brief_point_id: 'p1', verdict: 'detected', detected_at_seconds: 3 }, { brief_point_id: 'p2', verdict: 'not_detected', detected_at_seconds: null }, { brief_point_id: 'p3', verdict: 'detected', detected_at_seconds: 15 }],
};

let providerCalls = 0;
/** Counts any outbound call during a reopen; the real fetch is put back after each reopen so other test files are untouched. */
const countingFetch = ((_url: string | URL | Request) => { providerCalls += 1; return Promise.reject(new TypeError('no provider in this check')); }) as typeof fetch;

/** `crossWired`: the injected fault, a store that ignores the requested id and returns the newest saved take. */
function keyedStore({ crossWired = false } = {}) {
  const sessionReads: Array<Record<string, unknown>> = [];
  const quotaOrPersist: string[] = [];
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: OWNER } }, error: null }) },
    rpc: (name: string) => {
      if (name === 'check_usage_limit') return Promise.resolve({ data: { can_start: true, is_pro: true }, error: null });
      if (name === 'record_ai_suggestion_cache_read_v1') return Promise.resolve({ data: true, error: null });
      if (name === 'read_ai_suggestion_authority_v1') return Promise.resolve({ data: [], error: null });
      quotaOrPersist.push(name);
      return Promise.resolve({ data: null, error: { code: 'not_in_this_check' } });
    },
    from: (table: string) => ({
      select: (_columns: string) => {
        const filters: Record<string, unknown> = {};
        const result = (): { data: unknown; error: unknown } => {
          if (table === 'user_profiles') return { data: { id: OWNER }, error: null };
          if (table === 'practice_privacy_choices') {
            return { data: filters.user_id === OWNER
              ? { transcript_save: true, ai_coaching: true, consent_version: 1, choice_revision: 1 } : null, error: null };
          }
          if (table === 'sessions') {
            sessionReads.push({ ...filters });
            const found = crossWired ? ROWS.at(-1) : ROWS.find((r) => r.id === filters.id && r.user_id === filters.user_id);
            return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116' } };
          }
          if (table === 'objective_session') return { data: filters.source_session_id === FOCUS.objective.source_session_id ? FOCUS.objective : null, error: null };
          if (table === 'objective_brief') return { data: filters.id === FOCUS.objective.brief_id ? FOCUS.brief : null, error: null };
          if (table === 'objective_brief_point') return { data: filters.brief_id === FOCUS.objective.brief_id ? FOCUS.points : [], error: null };
          if (table === 'objective_evidence') return { data: filters.session_id === FOCUS.objective.id ? FOCUS.evidence : [], error: null };
          return { data: null, error: null };
        };
        const query: Record<string, unknown> = {
          eq: (column: string, value: unknown) => { filters[column] = value; return query; },
          order: () => query,
          limit: () => query,
          single: () => Promise.resolve(result()),
          maybeSingle: () => Promise.resolve(result()),
          then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
        };
        return query;
      },
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { create: () => client as any, sessionReads, quotaOrPersist };
}

const reopen = async (sessionId: string, product: 'open_mic' | 'focus_points', store = keyedStore()) => {
  const before = providerCalls;
  const realFetch = globalThis.fetch;
  globalThis.fetch = countingFetch;
  let res: Response;
  try {
    res = await handler(new Request('http://localhost/get-ai-suggestions', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, product, accepted_coaching_versions: ['gemini_coaching_v1', 'gemini_coaching_focus_v1'] }),
    }), store.create);
  } finally {
    globalThis.fetch = realFetch;
  }
  const body = await res.json() as { suggestions?: unknown; diagnostics?: Record<string, unknown> };
  return { status: res.status, body, providerCalls: providerCalls - before, store };
};
const binding = async (sessionId: string) => [...new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(JSON.stringify({ user_id: OWNER, session_id: sessionId })),
))].map((b) => b.toString(16).padStart(2, '0')).join('');

type Verdict = 'PASS' | 'FAIL';
/** The C6 check: the reopened take shows its OWN saved pair, from the cache, bound to that take, with no provider work. */
async function ownPairOnReopen(sessionId: string, r: Awaited<ReturnType<typeof reopen>>): Promise<{ verdict: Verdict; why: string[] }> {
  const why: string[] = [];
  if (r.status !== 200) why.push(`status ${r.status}`);
  if (JSON.stringify(r.body.suggestions) !== JSON.stringify(PAIR[sessionId as keyof typeof PAIR])) why.push('another take\'s coaching was shown');
  if (r.body.diagnostics?.source !== 'cache') why.push('not served from the saved pair');
  if (r.body.diagnostics?.session_binding_sha256 !== await binding(sessionId)) why.push('response not bound to the reopened take');
  if (r.providerCalls !== 0 || r.store.quotaOrPersist.length !== 0) why.push('provider, quota or persistence work on a reopen');
  return { verdict: why.length ? 'FAIL' : 'PASS', why };
}

Deno.test('#1816 C6 reopen shows each take\'s own saved coaching: two Open Mic takes and a Focus take, no provider call', async () => {
  for (const [id, product] of [[X, 'open_mic'], [Y, 'open_mic'], [F, 'focus_points'], [X, 'open_mic']] as const) {
    const r = await reopen(id, product);
    const v = await ownPairOnReopen(id, r);
    console.log(`#1816_BOT_CHECK ${JSON.stringify({ check: 'C6 reopen control', take: id.slice(-1), product, verdict: v.verdict, why: v.why })}`);
    assertEquals(v, { verdict: 'PASS', why: [] }, id);
    // The handler asked the store for exactly this take of exactly this owner.
    assertEquals(r.store.sessionReads.at(-1), { id, user_id: OWNER });
  }
});

Deno.test('#1816 C6 FAULT: a store that ignores the take id makes the reopen of X show the newest take\'s coaching, and the check FAILs', async () => {
  const r = await reopen(X, 'open_mic', keyedStore({ crossWired: true }));
  const v = await ownPairOnReopen(X, r);
  console.log(`#1816_BOT_CHECK ${JSON.stringify({ check: 'C6 reopen fault (cross-wired store)', take: 'a', status: r.status, verdict: v.verdict, why: v.why })}`);
  assertEquals(v.verdict, 'FAIL');
  // The handler refuses the cross-wired Focus row as a product mismatch (422), so the swap never reaches the page either way.
  assertEquals(r.status === 422 || v.why.includes('another take\'s coaching was shown'), true);
});

Deno.test('#1816 C6 FAULT: an Open Mic take swapped for another Open Mic take is caught by the pair check (the binding still names the requested take)', async () => {
  // A cross-wired store whose newest row is Y (no Focus take saved yet): the product matches, so only the pair check can catch it.
  const store = keyedStore({ crossWired: true });
  const saved = ROWS.splice(2, 1);
  try {
    const r = await reopen(X, 'open_mic', store);
    const v = await ownPairOnReopen(X, r);
    console.log(`#1816_BOT_CHECK ${JSON.stringify({ check: 'C6 reopen fault (Open Mic swap)', take: 'a', status: r.status, verdict: v.verdict, why: v.why })}`);
    assertEquals(r.status, 200);
    assertEquals(v.verdict, 'FAIL');
    assertEquals(v.why, ['another take\'s coaching was shown']);
  } finally {
    ROWS.push(...saved);
  }
});
