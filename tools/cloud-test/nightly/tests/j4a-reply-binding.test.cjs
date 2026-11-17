'use strict';
// #1884 (Sam, seal review of f34804e1): every child reply is bound to the operation that issued it, and a protocol violation is never
// accepted alongside a cleanup verification. The parent is the real attachParentChannel; the child end is driven RAW so the test can
// send exactly the wrong-kind or replayed messages a faulty or hostile child could. Bounded fake nightly; offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachParentChannel } = require('../j4a-supervised-channel.cjs');
const { acknowledgeBinding } = require('../j4a-supervised-binding.cjs');

const identity = Object.freeze({ campaignId: 'UNIT-NOT-A-RUN', runId: '41325698722', attempt: 1, caseId: 'AHT-05', requestSha256: '1'.repeat(64),
    planSha256: '2'.repeat(64), configSha256: '3'.repeat(64), sourceSha: 'b'.repeat(40), servedSha: 'b'.repeat(40) });

/** A raw child: it acknowledges the real offer, then the test scripts every further message. */
async function rawSession(t) {
    const parentPort = new EventEmitter(), childPort = new EventEmitter();
    const inbox = [];
    parentPort.send = (m) => { setImmediate(() => childPort.emit('message', structuredClone(m))); return true; };
    childPort.send = (m) => { setImmediate(() => parentPort.emit('message', structuredClone(m))); return true; };
    childPort.on('message', (m) => inbox.push(m));
    t.after(() => parentPort.emit('disconnect'));
    const settled = [];
    const nightly = {
        send: async (_l, kind, fn) => { try { const v = await fn(); settled.push(`${kind}:ok`); return { sent: true, value: v }; } catch (e) { settled.push(`${kind}:lost`); throw e; } },
        cleanup: async (_l, fn) => ({ sent: true, value: await fn() }),
        createAccount: async (_l, _r, fn) => { try { const v = await fn({ signal: new AbortController().signal, retries: 0 }); settled.push('create:answered'); return { sent: true, answered: true, value: v }; } catch (e) { settled.push('create:lost'); throw e; } },
        created: () => {},
    };
    const parent = attachParentChannel({ port: parentPort, identity, nightly });
    const next = async (pred) => { for (let i = 0; i < 200; i += 1) { const k = inbox.findIndex(pred); if (k >= 0) return inbox.splice(k, 1)[0]; await new Promise((r) => { setTimeout(r, 5); }); } throw new Error('no such message'); };
    const offer = await next((m) => m.t === 'offer');
    childPort.send({ t: 'ack', ack: acknowledgeBinding(identity, offer.offer) });
    assert.match(await parent.bound, /^[a-f0-9]{64}$/);
    const tick = () => new Promise((r) => { setTimeout(r, 20); });
    return { parent, send: (m) => childPort.send(m), next, settled, tick, digest: offer.offer.digest };
}
const zeroReader = async () => 0;
const cleanReport = { steps: [{ kind: 'account', ref: 'rwt-journey-j4-41325698722-1', action: 'delete', outcome: 'done' }], left: [] };

test('a wrong-kind reply (createResult for a send grant) settles the grant lost and is a violation, never a send', async (t) => {
    const s = await rawSession(t);
    s.send({ t: 'req', id: 'r-1', op: 'send', kind: 'starts' });
    const go = await s.next((m) => m.t === 'go' && m.id === 'r-1');
    s.send({ t: 'createResult', id: go.id, value: { outcome: 'created' } });
    const res = await s.next((m) => m.t === 'res' && m.id === 'r-1');
    assert.equal(res.ok, false);
    assert.equal(res.lost, true);
    assert.deepEqual(s.settled, ['starts:lost']);
    assert.match((await s.parent.outcome()).violations.join(), /wrong-kind reply createResult for done/);
});

test('a done for a create is wrong-kind too: the create stays unanswered (no confirmed scope)', async (t) => {
    const s = await rawSession(t);
    s.send({ t: 'req', id: 'r-1', op: 'createAccount', lookupRef: 'rwt-journey-j4-41325698722-1' });
    const go = await s.next((m) => m.t === 'createGo');
    s.send({ t: 'done', id: go.id, value: { outcome: 'created' } });
    const res = await s.next((m) => m.t === 'res' && m.id === 'r-1');
    assert.equal(res.answered, false);
    assert.equal((await s.parent.outcome()).confirmedAccount, null);
});

test('a replay followed by a valid cleanup report: the report is recorded but NO verification is accepted', async (t) => {
    // Identical to the control below (confirmed create, valid report, trusted zero reader) except for ONE replayed reply.
    const s = await rawSession(t);
    s.send({ t: 'req', id: 'r-1', op: 'createAccount', lookupRef: 'rwt-journey-j4-41325698722-1' });
    const go = await s.next((m) => m.t === 'createGo');
    s.send({ t: 'createResult', id: go.id, value: { outcome: 'created' } });
    assert.equal((await s.next((m) => m.t === 'res' && m.id === 'r-1')).answered, true);
    s.send({ t: 'createResult', id: go.id, value: { outcome: 'created' } }); // replayed reply
    await s.tick();
    s.send({ t: 'req', id: 'r-2', op: 'reportCleanup', digest: s.digest, report: cleanReport });
    assert.equal((await s.next((m) => m.t === 'res' && m.id === 'r-2')).ok, true);
    const out = await s.parent.outcome({ readResidue: zeroReader });
    assert.equal(out.confirmedAccount, 'rwt-journey-j4-41325698722-1');
    assert.match(out.violations.join(), /replayed reply r-1/);
    assert.equal(out.nightlyCleanup.verification, undefined, 'no verification alongside a violation');
    assert.deepEqual(out.nightlyCleanup.steps, cleanReport.steps);
});

test('control: the same valid run without the replay keeps its trusted verification', async (t) => {
    const s = await rawSession(t);
    s.send({ t: 'req', id: 'r-1', op: 'createAccount', lookupRef: 'rwt-journey-j4-41325698722-1' });
    const go = await s.next((m) => m.t === 'createGo');
    s.send({ t: 'createResult', id: go.id, value: { outcome: 'created' } });
    assert.equal((await s.next((m) => m.t === 'res' && m.id === 'r-1')).answered, true);
    s.send({ t: 'req', id: 'r-2', op: 'reportCleanup', digest: s.digest, report: cleanReport });
    assert.equal((await s.next((m) => m.t === 'res' && m.id === 'r-2')).ok, true);
    const out = await s.parent.outcome({ readResidue: zeroReader });
    assert.deepEqual(out.violations, []);
    assert.equal(out.nightlyCleanup.verification.kind, 'zero-residue');
});

test('an unsolicited reply (no pending operation) is a violation', async (t) => {
    const s = await rawSession(t);
    s.send({ t: 'done', id: 'r-99', value: null });
    await s.tick();
    assert.match((await s.parent.outcome()).violations.join(), /reply for no pending operation/);
});
