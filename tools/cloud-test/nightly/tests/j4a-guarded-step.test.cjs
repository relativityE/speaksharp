'use strict';
// #1884 (Sam, 17 Nov): the actual J4.a call sites (signup, Start presses, coaching forwards) proven with BOUNDED fakes that count
// grants and transport effects separately, so a grant can never pass for a send. The real parent and child channel ends are joined
// in-process; the fake `nightly` keeps the bridge's contract (bounded kinds, one create, a throwing action propagates as lost).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachParentChannel, connectChildChannel } = require('../j4a-supervised-channel.cjs');
const { j4aGuardedRoutes } = require('../j4a-guarded-step.cjs');

const identity = Object.freeze({ campaignId: 'UNIT-NOT-A-RUN', runId: '41325698722', attempt: 1, caseId: 'AHT-05', requestSha256: '1'.repeat(64),
    planSha256: '2'.repeat(64), configSha256: '3'.repeat(64), sourceSha: 'b'.repeat(40), servedSha: 'b'.repeat(40) });

function portPair() {
    const a = new EventEmitter(), b = new EventEmitter();
    const link = (from, to) => { from.send = (m) => { setImmediate(() => to.emit('message', structuredClone(m))); return true; }; };
    link(a, b); link(b, a);
    return { parent: a, child: b, close: () => { a.emit('disconnect'); b.emit('disconnect'); } };
}

/** Bounded like the bridge: kinds capped, one create, an action that throws propagates (the channel reads it as lost). */
function boundedNightly(caps = { starts: 2, coaching: 2 }) {
    const grants = { starts: 0, coaching: 0, creates: 0 }, records = [], settled = [];
    return {
        grants, records, settled,
        send: async (leg, kind, fn) => {
            if (grants[kind] >= caps[kind]) return { sent: false, reason: `${kind} cap reached` };
            grants[kind] += 1;
            try { const value = await fn(); settled.push(`${kind}:ok`); return { sent: true, value }; }
            catch (e) { settled.push(`${kind}:lost`); throw e; }
        },
        cleanup: async (_leg, fn) => ({ sent: true, value: await fn() }),
        createAccount: async (leg, lookupRef, fn, options) => {
            if (grants.creates >= 1) return { sent: false, reason: 'a second create for the journey is refused' };
            grants.creates += 1; records.push({ leg, lookupRef, emailDomain: options?.emailDomain ?? null });
            return { sent: true, answered: true, value: await fn({ signal: new AbortController().signal, retries: 0 }) };
        },
        created: () => {},
    };
}

async function bound(t, nightly, factory) {
    const ports = portPair();
    t.after(ports.close);
    const parent = attachParentChannel({ port: ports.parent, identity, nightly });
    const cap = await connectChildChannel({ port: ports.child, identity, timeoutMs: 2000 });
    assert.match(await parent.bound, /^[a-f0-9]{64}$/);
    const routes = j4aGuardedRoutes(cap, { identity, domain: 'example.com', configuredDomain: 'example.com', factory: factory ?? (async () => ({ uid: 'u-1' })) });
    return { parent, cap, routes };
}

test('Start: each click runs inside its own grant; past the cap nothing is clicked', async (t) => {
    const nightly = boundedNightly();
    const { routes } = await bound(t, nightly);
    let clicks = 0;
    await routes.pressStart(async () => { clicks += 1; });
    await routes.pressStart(async () => { clicks += 1; });
    await assert.rejects(routes.pressStart(async () => { clicks += 1; }), { code: 'START_PRESS_CAP' });
    assert.deepEqual([nightly.grants.starts, clicks], [2, 2]);
    assert.deepEqual(nightly.settled, ['starts:ok', 'starts:ok']);
});

test('Start: a granted click that does not complete is NOT_RUN and the parent records it lost, never sent ok', async (t) => {
    const nightly = boundedNightly();
    const { routes, parent } = await bound(t, nightly);
    await assert.rejects(routes.pressStart(async () => { throw new Error('click timeout'); }), { code: 'NOT_RUN' });
    assert.equal(nightly.grants.starts, 1, 'the grant was spent');
    assert.deepEqual(nightly.settled, ['starts:lost'], 'the parent settled the grant as lost at once, not ok');
    assert.deepEqual((await parent.outcome()).violations, []);
});

test('coaching: forwarded only after a grant; the reservation settles only when the proxy reports the forward', async (t) => {
    const nightly = boundedNightly();
    const { routes } = await bound(t, nightly);
    let forwards = 0;
    const one = await routes.reserveCoaching();
    assert.equal(one.granted, true);
    forwards += 1; one.sent();
    const two = await routes.reserveCoaching();
    assert.equal(two.granted, true);
    two.failed(); // upstream unavailable: counted as a spent grant, recorded lost, never ok
    const three = await routes.reserveCoaching();
    assert.equal(three.granted, false, 'past the cap the proxy is told to deny');
    assert.deepEqual([nightly.grants.coaching, forwards], [2, 1]);
    await new Promise((r) => { setTimeout(r, 20); });
    assert.deepEqual(nightly.settled, ['coaching:ok', 'coaching:lost'], 'only the reported forward settles ok');
});

test('signup: the factory click runs once, inside the guarded create, with the fixed domain recorded; a second signup never clicks', async (t) => {
    const nightly = boundedNightly();
    let factoryCalls = 0;
    const { routes } = await bound(t, nightly, async (_page, email) => { factoryCalls += 1; assert.match(email, /^rwt-journey-j4-41325698722-1@example\.com$/); return { uid: 'u-1' }; });
    const first = await routes.signUp({});
    assert.equal(first.created, true);
    assert.deepEqual(nightly.records, [{ leg: 'J4.a', lookupRef: 'rwt-journey-j4-41325698722-1', emailDomain: 'example.com' }]);
    const second = await routes.signUp({});
    assert.equal(second.created, false);
    assert.deepEqual([nightly.grants.creates, factoryCalls], [1, 1]);
});

test('signup: an ambiguous create (the click ran, no answer) stays unresolved and is never retried', async (t) => {
    const nightly = boundedNightly();
    let factoryCalls = 0;
    const { routes } = await bound(t, nightly, async () => { factoryCalls += 1; throw new Error('response lost'); });
    const r = await routes.signUp({});
    assert.equal(r.created, false);
    assert.equal(r.unresolved, true);
    assert.equal((await routes.signUp({})).created, false);
    assert.equal(factoryCalls, 1);
});

test('no bound capability, or a domain that is not the configured one: refused before anything is touched', () => {
    assert.throws(() => j4aGuardedRoutes(null, { identity }), { code: 'NOT_RUN' });
    const cap = { send: async () => ({}), createAccount: async () => ({}) };
    assert.throws(() => j4aGuardedRoutes(cap, { identity, domain: 'example.com', configuredDomain: 'other.com', factory: async () => ({}) }), /not fixed to the configured test domain/);
});
