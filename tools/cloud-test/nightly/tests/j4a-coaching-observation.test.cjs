'use strict';
// #1884 (J4.a pilot evidence, Sam 17 Nov): what the coaching tap can and cannot say about a coaching request, offline. The
// sealed tap port (`oracles/pure/coachingGenerationTap.cjs`, read only) is driven by a fake page that emits Playwright-shaped
// request/response/requestfailed events. Four cases: a paired fast response, a request still unanswered at the existing
// cutoff, a real browser abort, and an HTTP response that arrives after the cutoff. Rules: a late response never becomes an
// answer (or a PASS), and a browser abort is never read as the provider ending the request. Evidence is states, counts and
// timings only: no request or response content leaves this test.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { CoachingGenerationTap } = require('../../harness/draft-adapters/oracles/pure/coachingGenerationTap.cjs');
const { COACHING_SETTLE_BOUND_MS } = require('../../harness/draft-adapters/oracles/pure/rwtCoachingEvidence.cjs');

const ENDPOINT = 'https://proj.supabase.co/functions/v1/get-ai-suggestions';
/** The test's own cutoff stands in for COACHING_SETTLE_BOUND_MS (60 s); the tap applies it per request, from its send. */
const CUTOFF_MS = 120;

function fakePage() {
    const handlers = {};
    return {
        on: (event, fn) => { handlers[event] = fn; },
        emit: (event, value) => handlers[event]?.(value),
    };
}
let n = 0;
function coachingRequest(sessionId) {
    n += 1;
    const body = { sessionId, product: 'open_mic', diagnostic_request_id: `req-${n}`, diagnostic_attempt_id: `att-${n}`, client_attempt: 1 };
    return { url: () => ENDPOINT, method: () => 'POST', postDataJSON: () => body };
}
function response(request, status, providerAttempts = 1) {
    return {
        request: () => request,
        status: () => status,
        json: async () => ({ diagnostics: { provider_attempts: providerAttempts }, suggestions: null }),
    };
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * The content-free J4.a observation of one take's coaching exchanges: per request a state and a client-side duration, plus
 * counts. `answered` needs a status the page received inside the cutoff; `unanswered_at_cutoff` is no status by the
 * cutoff; `browser_abort` is a request the browser failed (no provider outcome is known); `body_pending` is a status whose
 * body did not finish. Only `answered` exchanges carry provider facts, and a take is provable only when every sent
 * request was answered: otherwise HOLD, never PASS.
 */
function observe(tap) {
    const state = { answered: 'answered', unanswered: 'unanswered_at_cutoff', failed: 'browser_abort', body_pending: 'body_pending' };
    const requests = tap.exchanges.map((e) => ({
        state: state[e.outcome] ?? 'unknown',
        status: e.outcome === 'answered' ? e.status : null,
        clientMs: e.clientMs,
        providerAttemptsKnown: e.outcome === 'answered' && Number.isSafeInteger(e.diagnostics?.provider_attempts),
    }));
    const count = (s) => requests.filter((r) => r.state === s).length;
    const allAnswered = requests.length === tap.sentCount && requests.every((r) => r.state === 'answered' && r.providerAttemptsKnown);
    return {
        sent: tap.sentCount, answered: count('answered'), unansweredAtCutoff: count('unanswered_at_cutoff'),
        browserAborts: count('browser_abort'), bodyPending: count('body_pending'), inFlight: tap.sentCount - requests.length,
        requests, verdict: allAnswered ? 'PROVABLE' : 'HOLD',
    };
}

describe('J4.a coaching observation (#1884 pilot evidence): fast, unanswered, aborted and late requests', () => {
    it('the existing cutoff is the Edge provider budget plus the 15 s transport allowance', () => {
        assert.equal(COACHING_SETTLE_BOUND_MS, 60_000);
    });
    it('paired fast response: answered inside the cutoff, with its status, a duration and provider facts', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page);
        const req = coachingRequest('take-1');
        page.emit('request', req);
        page.emit('response', response(req, 200, 1));
        await tap.settle(CUTOFF_MS);
        const o = observe(tap);
        assert.deepEqual({ sent: o.sent, answered: o.answered, verdict: o.verdict }, { sent: 1, answered: 1, verdict: 'PROVABLE' });
        assert.equal(o.requests[0].status, 200);
        assert.ok(o.requests[0].clientMs !== null && o.requests[0].clientMs < CUTOFF_MS);
    });
    it('unanswered at the cutoff, beside an answered paired control: the take holds, with the control still answered', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page);
        const control = coachingRequest('take-1');
        const target = coachingRequest('take-1');
        page.emit('request', control);
        page.emit('request', target);
        page.emit('response', response(control, 200, 1));
        const settled = await tap.settle(CUTOFF_MS);
        assert.equal(settled.unanswered, 1);
        const o = observe(tap);
        assert.deepEqual({ sent: o.sent, answered: o.answered, unansweredAtCutoff: o.unansweredAtCutoff, verdict: o.verdict },
            { sent: 2, answered: 1, unansweredAtCutoff: 1, verdict: 'HOLD' });
        const unanswered = o.requests.find((r) => r.state === 'unanswered_at_cutoff');
        assert.equal(unanswered.status, null);
        assert.ok(unanswered.clientMs >= CUTOFF_MS, 'recorded only once its own cutoff passed');
        assert.equal(unanswered.providerAttemptsKnown, false);
    });
    it('a real browser abort is browser_abort: no status, no provider outcome, never provider termination, never PASS', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page);
        const req = coachingRequest('take-1');
        page.emit('request', req);
        page.emit('requestfailed', req);
        await tap.settle(CUTOFF_MS);
        const o = observe(tap);
        assert.deepEqual({ browserAborts: o.browserAborts, unansweredAtCutoff: o.unansweredAtCutoff, verdict: o.verdict },
            { browserAborts: 1, unansweredAtCutoff: 0, verdict: 'HOLD' });
        assert.equal(o.requests[0].status, null, 'the abort carries no provider status');
        assert.equal(o.requests[0].providerAttemptsKnown, false, 'no provider attempt count is inferred from an abort');
        assert.ok(o.requests[0].clientMs !== null && o.requests[0].clientMs < CUTOFF_MS, 'the abort is timed when it happened');
    });
    it('a late HTTP response after the cutoff stays unanswered_at_cutoff: one record, no status, no answer, never PASS', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page);
        const req = coachingRequest('take-1');
        page.emit('request', req);
        await tap.settle(CUTOFF_MS);
        await sleep(20);
        page.emit('response', response(req, 200, 1));
        await sleep(20);
        await tap.settle(CUTOFF_MS);
        const o = observe(tap);
        assert.equal(tap.exchanges.length, 1, 'the late response adds no second record');
        assert.deepEqual({ answered: o.answered, unansweredAtCutoff: o.unansweredAtCutoff, verdict: o.verdict },
            { answered: 0, unansweredAtCutoff: 1, verdict: 'HOLD' });
        assert.equal(o.requests[0].status, null, 'the late status is not attached to the closed request');
    });
    it('a status seen before the cutoff whose body never finishes is body_pending, not answered', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page);
        const req = coachingRequest('take-1');
        page.emit('request', req);
        page.emit('response', { request: () => req, status: () => 200, json: () => new Promise(() => {}) });
        const settled = await tap.settle(CUTOFF_MS);
        assert.equal(settled.bodyPending, 1);
        const o = observe(tap);
        assert.deepEqual({ answered: o.answered, bodyPending: o.bodyPending, verdict: o.verdict }, { answered: 0, bodyPending: 1, verdict: 'HOLD' });
    });
    it('evidence is content-free: states, counts and timings only', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page);
        const req = coachingRequest('take-secret-id');
        page.emit('request', req);
        page.emit('response', response(req, 200, 1));
        await tap.settle(CUTOFF_MS);
        const text = JSON.stringify(observe(tap));
        for (const leaked of ['take-secret-id', 'req-', 'att-', 'open_mic', 'suggestions']) assert.ok(!text.includes(leaked), leaked);
    });
});
