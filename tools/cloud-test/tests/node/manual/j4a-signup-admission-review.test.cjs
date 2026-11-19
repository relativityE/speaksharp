'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewSignupGate, PATH } = require('./j4a-signup-admission-review.cjs');
function setup(transport = async () => {}) {
    const identity = { binding: 'a'.repeat(64), context: 'b'.repeat(64), runId: '123', leg: 'J4.a', caseId: 'AHT-05' };
    const origin = 'https://auth.invalid';
    const emailDomain = 'example.test';
    const lookupRef = 'rwt-journey-j4-123-1';
    const calls = [];
    const signal = new AbortController();
    const gate = reviewSignupGate({ ...identity, origin, configuredDomain: emailDomain }, async (x) => { calls.push(x); await transport(); });
    const record = { ...identity, origin, emailDomain, lookupRef, attemptId: 'J4.a-1', durablyRecorded: true, retries: 0 };
    const body = Buffer.from(JSON.stringify({ email: lookupRef + '@' + emailDomain, password: 'synthetic-only' }));
    const request = { ...identity, method: 'POST', url: origin + PATH, contentType: 'application/json', body };
    return { record, signal, gate, request, calls };
}
test('default denial and copied child ticket never reach transport', async () => {
    const s = setup();
    assert.equal((await s.gate.send(s.request)).forwarded, false);
    const grant = s.gate.admitFromParent(s.record, s.signal.signal);
    assert.ok(grant);
    assert.equal((await s.gate.send(s.request, JSON.parse(JSON.stringify(grant)))).forwarded, false);
    assert.equal(s.calls.length, 0);
});
test('one exact attempt inside a parent grant, even when requests race', async () => {
    const s = setup();
    const grant = s.gate.admitFromParent(s.record, s.signal.signal);
    const replies = await Promise.all([s.gate.send(s.request, grant), s.gate.send(s.request, grant)]);
    assert.deepEqual(replies.map(r => r.forwarded), [true, false]);
    assert.equal(replies[0].outcome, 'unresolved');
    assert.equal(s.gate.admitFromParent(s.record, s.signal.signal), null);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].retries, 0);
    assert.equal(s.calls[0].redirects, 'error');
});
test('no parent ticket for missing durable record, wrong domain, owner context, case, origin, or retries', async () => {
    for (const change of [{ durablyRecorded: false }, { emailDomain: 'wrong.test' }, { context: 'c'.repeat(64) },
        { caseId: 'AHT-06' }, { leg: 'J4.b' }, { origin: 'https://other.invalid' }, { retries: 1 }, { lookupRef: 'different-user' }]) {
        const s = setup();
        assert.equal(s.gate.admitFromParent({ ...s.record, ...change }, s.signal.signal), null);
        assert.equal((await s.gate.send(s.request)).forwarded, false);
        assert.equal(s.calls.length, 0);
    }
});
test('wrong owner, domain, route, metadata or case never reaches transport with a valid grant', async () => {
    function body(email, extra = {}) { return Buffer.from(JSON.stringify({ email, password: 'synthetic-only', ...extra })); }
    for (const change of [{ context: 'c'.repeat(64) }, { caseId: 'AHT-06' }, { method: 'GET' },
        { url: 'https://auth.invalid' + PATH + '?redirect_to=x' }, { url: 'https://other.invalid' + PATH },
        { body: body('wrong-user@example.test') }, { body: body('rwt-journey-j4-123-1@other.test') },
        { body: body('rwt-journey-j4-123-1@example.test', { user_id: 'other-owner' }) },
        { body: Buffer.from('{"email":"bad@example.test","email":"rwt-journey-j4-123-1@example.test","password":"synthetic-only"}') }]) {
        const s = setup();
        const grant = s.gate.admitFromParent(s.record, s.signal.signal);
        assert.equal((await s.gate.send({ ...s.request, ...change }, grant)).forwarded, false);
        assert.equal((await s.gate.send(s.request, grant)).forwarded, false);
        assert.equal(s.calls.length, 0);
    }
});
test('expired grant does not send, and unanswered transport cannot be retried', async () => {
    const s = setup();
    const grant = s.gate.admitFromParent(s.record, s.signal.signal);
    s.signal.abort();
    assert.equal((await s.gate.send(s.request, grant)).forwarded, false);
    assert.equal(s.calls.length, 0);
    const a = setup(async () => { throw new Error('synthetic callback failure'); });
    const ticket = a.gate.admitFromParent(a.record, a.signal.signal);
    assert.deepEqual(await a.gate.send(a.request, ticket), { forwarded: true, outcome: 'unresolved' });
    assert.equal((await a.gate.send(a.request, ticket)).forwarded, false);
    assert.equal(a.calls.length, 1);
});
