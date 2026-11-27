import { strict as assert } from 'node:assert';
import { runMicStartReadiness, type ProbeResult, type ReadinessStore } from './modelReadiness.ts';
const models = [{ id: 'incumbent', observedVersions: ['incumbent-001'] }, { id: 'alt', observedVersions: ['alt-002'] }];
const valid = (id: string): ProbeResult => ({ status: 200, coachingValid: true, observedVersion: id === 'incumbent' ? 'incumbent-001' : 'alt-002' });
const provider = (status: 429 | 503, scope: 'model' | 'project' | 'unknown', retryAfterMs?: number) => ({ status, scope, retryAfterMs } as const);
const live = { recordingConfirmed: true, coachingSelected: true };
function harness(read: (id: string, product: string) => ProbeResult, finishAccepted = true, available = models) {
  const calls: string[] = []; const results: Parameters<ReadinessStore['finish']>[1][] = [];
  let claims = 0, discoveries = 0;
  const store: ReadinessStore = {
    claim: () => {
      claims++;
      return Promise.resolve(claims > 1 ? { kind: 'busy', state: { model: 'incumbent', revision: 7 } }
        : { kind: 'claimed', lease: { state: { model: 'incumbent', revision: 7 }, token: 'synthetic', deadlineMs: 30_000 } });
    },
    finish: (_lease, result) => { results.push(result); return Promise.resolve(finishAccepted); },
  };
  return { calls, results, claims: () => claims, discoveries: () => discoveries, options: { store, now: () => 0,
    modelFor: (id: string) => available.find((m) => m.id === id) ?? null,
    discover: () => { discoveries++; return Promise.resolve(available); },
    probe: (m: { id: string }, p: string) => { calls.push(m.id + ':' + p); return Promise.resolve(read(m.id, p)); } } };
}
Deno.test('off, unknown-equivalent, or not recording: no backend claim or provider call', async () => {
  const h = harness(valid);
  assert.equal(await runMicStartReadiness({ ...live, coachingSelected: false }, h.options), 'not_requested');
  assert.equal(await runMicStartReadiness({ ...live, recordingConfirmed: false }, h.options), 'not_requested');
  assert.equal(h.claims(), 0); assert.equal(h.discoveries(), 0); assert.deepEqual(h.calls, []);
});
Deno.test('healthy incumbent: one representative coaching test, never switch, never discover', async () => {
  const h = harness(valid);
  assert.equal(await runMicStartReadiness(live, h.options), 'healthy');
  assert.deepEqual(h.calls, ['incumbent:open_mic']);
  assert.equal(h.results[0].promoteTo, undefined);
  assert.equal(h.discoveries(), 0);
});
for (const status of [429, 503] as const) {
  Deno.test(`model-scoped ${status}: only a discovered fallback validated on its one coaching test may be promoted`, async () => {
    const h = harness((id) => id === 'incumbent' ? provider(status, 'model') : valid(id));
    assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
    assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic']);
    assert.equal(h.results[0].promoteTo, 'alt');
  });
}
Deno.test('shared or unknown quota preserves prior verification without probing another model', async () => {
  for (const blocked of [provider(429, 'project'), provider(429, 'unknown'), provider(429, 'project', 7_000)]) {
    const h = harness(() => blocked);
    assert.equal(await runMicStartReadiness(live, h.options), blocked.retryAfterMs ? 'backoff' : 'inconclusive');
    assert.equal(h.results[0].verified, undefined);
    assert.equal(h.calls.length, 1);
    assert.equal(h.discoveries(), 0);
    assert.equal(h.results[0].promoteTo, undefined);
    if ('retryAfterMs' in blocked) assert.equal(h.results[0].retryAfterMs, blocked.retryAfterMs);
  }
});
Deno.test('HTTP 200 with malformed coaching or mismatched model identity does not promote', async () => {
  for (const outcome of [
    { status: 200, coachingValid: false, observedVersion: 'alt-002' },
    { status: 200, coachingValid: true, observedVersion: 'unexpected' },
    { status: 200, coachingValid: true, observedVersion: null },
  ] as const) {
    const h = harness((id) => id === 'incumbent' ? provider(503, 'model') : outcome);
    assert.equal(await runMicStartReadiness(live, h.options), 'unavailable');
    assert.equal(h.results[0].promoteTo, undefined);
  }
});
Deno.test('parallel Starts share the lease and stale compare-and-swap never reports activation', async () => {
  const h = harness((id) => id === 'incumbent' ? provider(503, 'model') : valid(id), false);
  assert.deepEqual(await Promise.all([runMicStartReadiness(live, h.options), runMicStartReadiness(live, h.options)]), ['stale', 'shared']);
  assert.equal(h.calls.length, 2);
  assert.equal(h.results.length, 1);
});

Deno.test('tries distinct variants in catalog order and stops at the first valid coaching response', async () => {
  const candidates = [...models, models[1], ...['third', 'unneeded'].map((id) => ({ id, observedVersions: [id] }))];
  const h = harness((id) => id === 'incumbent' ? { status: 'model_unavailable' }
    : id === 'alt' ? { status: 200, observedVersion: 'alt-002', coachingValid: false }
      : { status: 200, coachingValid: true, observedVersion: id }, true, candidates);
  assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic', 'third:open_mic']);
  assert.equal(h.results[0].promoteTo, 'third');
  assert.equal(h.discoveries(), 1);
});

Deno.test('falling back respects the variant cap and stops on shared throttling', async () => {
  const candidates = [...models, ...Array.from({ length: 8 }, (_, i) => {
    const id = 'candidate-' + (i + 2);
    return { id, observedVersions: [id] };
  })];
  const capped = harness(() => ({ status: 'model_unavailable' }), true, candidates);
  assert.equal(await runMicStartReadiness(live, capped.options), 'unavailable');
  assert.deepEqual(capped.calls, candidates.slice(0, 9).map(({ id }) => id + ':open_mic'));
  const shared = harness((id) => id === 'incumbent' ? { status: 'model_unavailable' } : provider(429, 'project'), true, candidates);
  assert.equal(await runMicStartReadiness(live, shared.options), 'inconclusive');
  assert.equal(shared.results[0].verified, false);
  assert.deepEqual(shared.calls, ['incumbent:open_mic', 'alt:open_mic']);
  assert.equal(shared.results[0].promoteTo, undefined);
});

Deno.test('an expired lease cannot discover or promote', async () => {
  let at = 0;
  const h = harness(() => { at = 30_000; return { status: 'model_unavailable' }; });
  assert.equal(await runMicStartReadiness(live, { ...h.options, now: () => at }), 'inconclusive');
  assert.equal(h.results[0].verified, undefined);
  assert.equal(h.discoveries(), 0);
  assert.equal(h.results[0].promoteTo, undefined);
});

Deno.test('confirmed model-scoped RetryInfo can switch without retrying the limited incumbent', async () => {
  const h = harness((id) => id === 'incumbent' ? provider(429, 'model', 86_400_000) : valid(id));
  assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic']);
  assert.deepEqual(h.results[0], { promoteTo: 'alt', verified: true, retryAfterMs: undefined });
});
Deno.test('client abort or unknown transport failure cannot demote a verified model', async () => {
  const h = harness(() => { throw new DOMException('abort', 'AbortError'); });
  assert.equal(await runMicStartReadiness(live, h.options), 'inconclusive');
  assert.equal(h.results[0].verified, undefined);
  assert.equal(h.discoveries(), 0);
});

Deno.test('a blocked fallback cannot restore the known-bad incumbent', async () => {
  const h = harness((id) => id === 'incumbent'
    ? { status: 200, coachingValid: false, observedVersion: 'incumbent-001' }
    : provider(429, 'project', 7_000));
  assert.equal(await runMicStartReadiness(live, h.options), 'backoff');
  assert.deepEqual(h.results[0], { promoteTo: undefined, verified: false, retryAfterMs: 7_000 });
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic']);
});

Deno.test('a failed catalog is inconclusive for fallback, not a failed or restored incumbent', async () => {
  const h = harness(() => ({ status: 'model_unavailable' }));
  const down = { ...h.options, discover: () => Promise.reject(new Error('catalog unavailable')) };
  assert.equal(await runMicStartReadiness(live, down), 'inconclusive');
  assert.deepEqual(h.results[0], { promoteTo: undefined, verified: false, retryAfterMs: undefined });
  assert.deepEqual(h.calls, ['incumbent:open_mic']);
});

// PO 11-27 (J1.b cooldown): a model-scoped limit belongs to that model. Even when no fallback passes inside the lease, its
// hint (up to 24 h) must never become the shared wait that held every check (and, before this fix, every coaching request).
Deno.test('a model-scoped hint never becomes the shared hold, even when no fallback passes', async () => {
  const h = harness((id) => id === 'incumbent' ? provider(429, 'model', 86_400_000) : { status: 'model_unavailable' });
  assert.equal(await runMicStartReadiness(live, h.options), 'unavailable');
  assert.deepEqual(h.results[0], { promoteTo: undefined, verified: false, retryAfterMs: undefined });
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic']);
});

// This morning's provider pattern (from an admin one-word check, NOT production coaching evidence): 3.8 and 3.7 answered 503,
// 3.6 answered 429, 3.5 Flash-Lite answered. The deployed selector must still require valid coaching before promotion.
const ladder = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']
  .map((id) => ({ id, observedVersions: [id] }));
function ladderHarness(read: (id: string) => ProbeResult) {
  const calls: string[] = []; const results: Parameters<ReadinessStore['finish']>[1][] = [];
  const store: ReadinessStore = {
    claim: () => Promise.resolve({ kind: 'claimed', lease: { state: { model: 'gemini-3.6-flash', revision: 3 }, token: 't', deadlineMs: 30_000 } }),
    finish: (_lease, result) => { results.push(result); return Promise.resolve(true); },
  };
  return { calls, results, options: { store, now: () => 0, modelFor: (id: string) => ladder.find((m) => m.id === id) ?? null,
    discover: () => Promise.resolve(ladder),
    probe: (m: { id: string }) => { calls.push(m.id); return Promise.resolve(read(m.id)); } } };
}
Deno.test('ladder: proven candidate-specific failures reach the working 3.5 Flash-Lite', async () => {
  // Incumbent 3.6 hits ITS OWN quota (model-scoped 429); 3.8 is not offered to this key (404); 3.7 returns invalid coaching.
  const h = ladderHarness((id) => id === 'gemini-3.6-flash' ? provider(429, 'model', 3_600_000)
    : id === 'gemini-3.8-flash' ? { status: 'model_unavailable' }
      : id === 'gemini-3.7-flash' ? { status: 200, coachingValid: false, observedVersion: id }
        : { status: 200, coachingValid: true, observedVersion: id });
  assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
  assert.deepEqual(h.calls, ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite']);
  assert.deepEqual(h.results[0], { promoteTo: 'gemini-3.5-flash-lite', verified: true, retryAfterMs: undefined });
});
Deno.test('ladder: two opaque 503s do not hide a working 3.5 Flash-Lite', async () => {
  const h = ladderHarness((id) => id === 'gemini-3.6-flash' ? provider(429, 'model', 3_600_000)
    : id === 'gemini-3.8-flash' || id === 'gemini-3.7-flash' ? provider(503, 'unknown', 7_000)
      : { status: 200, coachingValid: true, observedVersion: id });
  assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
  assert.deepEqual(h.calls, ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite']);
  assert.deepEqual(h.results[0], { promoteTo: 'gemini-3.5-flash-lite', verified: true, retryAfterMs: undefined });
});
Deno.test('a 503 without a successful fallback preserves the incumbent verification', async () => {
  const h = harness(() => provider(503, 'unknown', 7_000));
  assert.equal(await runMicStartReadiness(live, h.options), 'inconclusive');
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic']);
  assert.deepEqual(h.results[0], { promoteTo: undefined, verified: undefined, retryAfterMs: undefined });
});
Deno.test('ladder: a shared 429 with a provider-wide wait stops and records only that wait', async () => {
  const h = ladderHarness((id) => id === 'gemini-3.6-flash' ? provider(429, 'project', 7_000) : { status: 200, coachingValid: true, observedVersion: id });
  assert.equal(await runMicStartReadiness(live, h.options), 'backoff');
  assert.deepEqual(h.calls, ['gemini-3.6-flash']);
  assert.deepEqual(h.results[0], { promoteTo: undefined, verified: undefined, retryAfterMs: 7_000 });
});
