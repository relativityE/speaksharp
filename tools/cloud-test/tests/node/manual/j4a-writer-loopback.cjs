'use strict';
// Opt-in local-only test in a socket-permitted environment. No provider, product or existing service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { decideJ4aWriters, verifyJ4aStoppedWriters } = require('../../../nightly/j4a-writer-evidence.cjs');

test('a forwarded loopback POST with complete HTTP 200 but no backend terminal state cannot mint a stopped proof', { timeout: 5000 }, async (t) => {
    let accepted = 0;
    let committed = 0;
    const pending = [];
    const server = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/fixture-write') {
            res.writeHead(404).end();
            return;
        }
        req.resume();
        req.on('end', () => {
            ++accepted;
            pending.push(() => { ++committed; }); // durable work remains unsettled after HTTP success
            res.writeHead(200, { 'Content-Length': '2', 'Connection': 'close' }).end('ok');
        });
    });
    t.after(() => { server.closeAllConnections(); server.close(); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const observed = await new Promise((resolve, reject) => {
        let finished = false;
        const req = http.request({
            host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/fixture-write',
            headers: { 'Content-Length': '0' }, agent: false,
        }, (res) => {
            res.resume();
            res.once('error', reject);
            res.once('end', () => resolve({
                responseStatus: res.statusCode, socketFinished: finished, responseBodyEnded: res.complete,
            }));
        });
        req.once('finish', () => { finished = true; });
        req.once('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('loopback fixture deadline')));
        req.end();
    });
    assert.deepEqual(observed, { responseStatus: 200, socketFinished: true, responseBodyEnded: true });
    assert.equal(accepted, 1);
    assert.equal(committed, 0);

    // Other observations deliberately set to the best-case fixture to isolate the missing terminal condition.
    // These flags do NOT attest Linux writer containment or real guard drain.
    const [binding, droppedSave, sentSave] = ['a', 'b', 'c'].map(c => c.repeat(64));
    const identity = { binding, runId: 'loopback-fixture', owner: '11111111-1111-4111-8111-111111111111' };
    const expected = { ...identity, droppedSave };
    const supervisor = { ...identity, exited: true, ownedPagesClosed: true, descendantCount: 0, interrupted: false,
        guardTransportDrained: true, writersClosedAt: 1 };
    const journal = { ...identity, armedBeforeLaunch: true, closedAfterLastWriter: true, integrityVerified: true,
        attempts: [
            { attempt: droppedSave, kind: 'save', decision: 'planned-request-lost', upstreamStarted: false },
            { attempt: sentSave, kind: 'save', decision: 'forwarded', upstreamStarted: true,
                terminal: { attempt: sentSave, ...observed } },
        ] };
    assert.deepEqual(decideJ4aWriters(expected, supervisor, journal), { verdict: 'HOLD', reason: 'backend-write-unresolved' });
    assert.equal(verifyJ4aStoppedWriters(expected, supervisor, journal), null);
    pending.shift()();
    assert.equal(committed, 1, 'the backend could still commit after the false transport-only witness');
    assert.equal(verifyJ4aStoppedWriters(expected, supervisor, journal), null, 'no endpoint-specific receipt was observed');
});
