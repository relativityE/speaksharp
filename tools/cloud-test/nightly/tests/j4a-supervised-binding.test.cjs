'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const bindingPath = require.resolve('../j4a-supervised-binding.cjs');
const { beginBinding, acknowledgeBinding } = require(bindingPath);

const identity = Object.freeze({
    campaignId: 'fixture-campaign', runId: 'fixture-run', attempt: 1, caseId: 'AHT-05',
    requestSha256: '1'.repeat(64), planSha256: '2'.repeat(64), configSha256: '3'.repeat(64),
    sourceSha: '4'.repeat(40), servedSha: '5'.repeat(40),
});

async function childReply(t, childIdentity, offer) {
    // The fake child has its own pinned identity. IPC carries only the challenge.
    const fixture = `
        const { acknowledgeBinding } = require(process.argv[1]);
        const expected = JSON.parse(process.argv[2]);
        process.once('message', (offer) => {
            try { process.send({ ack: acknowledgeBinding(expected, offer) }, () => process.disconnect()); }
            catch (error) { process.send({ refusal: error.message }, () => process.disconnect()); }
        });
    `;
    const child = spawn(process.execPath, ['-e', fixture, bindingPath, JSON.stringify(childIdentity)],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {} });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const closed = once(child, 'close');
    const received = Promise.race([
        once(child, 'message').then(([message]) => message),
        closed.then(() => { throw new Error('fake child closed before replying'); }),
    ]);
    child.send(offer);
    const reply = await received;
    assert.deepEqual(await closed, [0, null]);
    return reply;
}

test('matching supervised child binds the exact J4.a identity once', { timeout: 5000 }, async (t) => {
    const parent = beginBinding(identity);
    const independent = Object.fromEntries(Object.entries(identity).reverse());
    const reply = await childReply(t, independent, parent.offer);
    assert.equal(parent.accept(reply.ack), parent.offer.digest);
    assert.throws(() => parent.accept(reply.ack), /ALREADY_CONSUMED/);
});

test('a different served release at the child never gets an acknowledgement', { timeout: 5000 }, async (t) => {
    const parent = beginBinding(identity);
    const reply = await childReply(t, { ...identity, servedSha: '6'.repeat(40) }, parent.offer);
    assert.deepEqual(reply, { refusal: 'J4A_BINDING_REJECTED' });
    assert.throws(() => parent.accept(reply.ack), /BINDING_REJECTED/);
});

test('run, campaign, source, request, plan and config are all bound', () => {
    const parent = beginBinding(identity);
    for (const [key, value] of Object.entries({
        campaignId: 'other-campaign', runId: 'other-run',
        sourceSha: 'a'.repeat(40), requestSha256: 'a'.repeat(64),
        planSha256: 'a'.repeat(64), configSha256: 'a'.repeat(64),
    })) assert.throws(() => acknowledgeBinding({ ...identity, [key]: value }, parent.offer), /BINDING_REJECTED/, key);
});

test('wrong case, retry attempt, shortened digest and extra fields are refused', () => {
    for (const extra of [
        { caseId: 'AHT-06' }, { attempt: 2 }, { planSha256: 'abc123' }, { token: 'fixture' },
    ]) assert.throws(() => beginBinding({ ...identity, ...extra }), /BINDING_INVALID/);
    const parent = beginBinding(identity);
    assert.throws(() => acknowledgeBinding(identity, { ...parent.offer, fallback: true }), /BINDING_REJECTED/);
    assert.throws(() => acknowledgeBinding(identity), /BINDING_REJECTED/);
});

test('a stale reply cannot bind another attempt, and rejection is terminal', () => {
    const first = beginBinding(identity);
    const second = beginBinding(identity);
    const oldReply = acknowledgeBinding(identity, first.offer);
    assert.equal(first.offer.digest, second.offer.digest);
    assert.notEqual(first.offer.nonce, second.offer.nonce);
    assert.throws(() => second.accept(oldReply), /BINDING_REJECTED/);
    assert.throws(() => second.accept(acknowledgeBinding(identity, second.offer)), /ALREADY_CONSUMED/);
});
