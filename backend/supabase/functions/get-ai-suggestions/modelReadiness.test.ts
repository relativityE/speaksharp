import { strict as assert } from 'node:assert';
import { runMicStartReadiness, type ProbeResult, type ReadinessStore } from './modelReadiness.ts';
const models = [{ id: 'incumbent', observedVersions: ['incumbent-001'] }, { id: 'alt', observedVersions: ['alt-002'] }];
const valid = (id: string): ProbeResult => ({ status: 200, coachingValid: true, observedVersion: id === 'incumbent' ? 'incumbent-001' : 'alt-002' });
const provider = (status: 429 | 503, scope: 'model' | 'project' | 'unknown', retryAfterMs?: number): ProbeResult => ({ status, scope, retryAfterMs });
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
Deno.test('healthy incumbent: both product shapes tested, never switch', async () => {
  const h = harness(valid);
  assert.equal(await runMicStartReadiness(live, h.options), 'healthy');
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'incumbent:focus_points']);
  assert.equal(h.results[0].promoteTo, undefined);
  assert.equal(h.discoveries(), 0);
});
for (const status of [429, 503] as const) {
  Deno.test(`model-scoped ${status}: only a discovered fallback validated on both product shapes may be promoted`, async () => {
    const h = harness((id) => id === 'incumbent' ? provider(status, 'model') : valid(id));
    assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
    assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic', 'alt:focus_points']);
    assert.equal(h.results[0].promoteTo, 'alt');
  });
}
Deno.test('shared or unknown 429 and retry-after stop without probing another model', async () => {
  for (const blocked of [provider(429, 'project'), provider(429, 'unknown'), provider(503, 'model', 7_000)]) {
    const h = harness(() => blocked);
    assert.equal(await runMicStartReadiness(live, h.options), 'unavailable');
    assert.equal(h.calls.length, 1);
    assert.equal(h.discoveries(), 0);
    assert.equal(h.results[0].promoteTo, undefined);
    if ('retryAfterMs' in blocked) assert.equal(h.results[0].retryAfterMs, blocked.retryAfterMs);
  }
});
Deno.test('HTTP 200 with malformed Focus coaching or mismatched model identity does not promote', async () => {
  for (const outcome of [
    { status: 200, coachingValid: false, observedVersion: 'alt-002' },
    { status: 200, coachingValid: true, observedVersion: 'unexpected' },
    { status: 200, coachingValid: true, observedVersion: null },
  ] as const) {
    const h = harness((id, product) => id === 'incumbent' ? provider(503, 'model') : product === 'open_mic' ? valid(id) : outcome);
    assert.equal(await runMicStartReadiness(live, h.options), 'unavailable');
    assert.equal(h.results[0].promoteTo, undefined);
  }
});
Deno.test('parallel Starts share the lease and stale compare-and-swap never reports activation', async () => {
  const h = harness((id) => id === 'incumbent' ? provider(503, 'model') : valid(id), false);
  assert.deepEqual(await Promise.all([runMicStartReadiness(live, h.options), runMicStartReadiness(live, h.options)]), ['stale', 'shared']);
  assert.equal(h.calls.length, 3);
  assert.equal(h.results.length, 1);
});

Deno.test('tries distinct variants in catalog order and stops at the first valid coaching response pair', async () => {
  const candidates = [...models, models[1], ...['third', 'unneeded'].map((id) => ({ id, observedVersions: [id] }))];
  const h = harness((id, product) => id === 'incumbent' ? { status: 'model_unavailable' }
    : id === 'alt' ? { status: 200, observedVersion: 'alt-002', coachingValid: product === 'open_mic' }
      : { status: 200, coachingValid: true, observedVersion: id }, true, candidates);
  assert.equal(await runMicStartReadiness(live, h.options), 'promoted');
  assert.deepEqual(h.calls, ['incumbent:open_mic', 'alt:open_mic', 'alt:focus_points', 'third:open_mic', 'third:focus_points']);
  assert.equal(h.results[0].promoteTo, 'third');
  assert.equal(h.discoveries(), 1);
});

Deno.test('falling back respects the variant cap and stops on shared throttling', async () => {
  const candidates = [...models, ...['third', 'fourth', 'fifth'].map((id) => ({ id, observedVersions: [id] }))];
  const capped = harness(() => ({ status: 'model_unavailable' }), true, candidates);
  assert.equal(await runMicStartReadiness(live, capped.options), 'unavailable');
  assert.deepEqual(capped.calls, ['incumbent:open_mic', 'alt:open_mic', 'third:open_mic', 'fourth:open_mic']);
  const shared = harness((id) => id === 'incumbent' ? { status: 'model_unavailable' } : provider(429, 'project'), true, candidates);
  assert.equal(await runMicStartReadiness(live, shared.options), 'unavailable');
  assert.deepEqual(shared.calls, ['incumbent:open_mic', 'alt:open_mic']);
  assert.equal(shared.results[0].promoteTo, undefined);
});

Deno.test('an expired lease cannot discover or promote', async () => {
  let at = 0;
  const h = harness(() => { at = 30_000; return { status: 'model_unavailable' }; });
  assert.equal(await runMicStartReadiness(live, { ...h.options, now: () => at }), 'unavailable');
  assert.equal(h.discoveries(), 0);
  assert.equal(h.results[0].promoteTo, undefined);
});
