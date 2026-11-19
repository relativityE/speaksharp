'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideJ4aWriters, verifyJ4aStoppedWriters, readJ4aStoppedWriters } = require('../j4a-writer-evidence.cjs');
const [binding, droppedSave, sentSave, coaching] = ['a', 'b', 'c', 'd'].map(c => c.repeat(64));
const completed = (attempt, kind) => ({ attempt, kind, decision: 'forwarded', upstreamStarted: true, terminal: { attempt, backendConfirmed: true } });
function fixture() {
    return [{ binding, droppedSave },
        { binding, exited: true, ownedPagesClosed: true, descendantCount: 0, interrupted: false, guardTransportDrained: true },
        { binding, armedBeforeLaunch: true, closedAfterLastWriter: true, integrityVerified: true, attempts: [
            { attempt: droppedSave, kind: 'save', decision: 'planned-request-lost', upstreamStarted: false },
            completed(sentSave, 'save'), completed(coaching, 'coaching'),
        ] }];
}
const refusal = (name, reason, mutate) => test(name, () => {
    const input = fixture();
    mutate(...input);
    assert.deepEqual(decideJ4aWriters(...input), { verdict: 'HOLD', reason });
});
test('bound planned non-forward plus terminal backend witnesses stops the observed writers', () => {
    assert.deepEqual(decideJ4aWriters(...fixture()), { verdict: 'STOPPED', reason: null });
});
refusal('surviving descendant despite closed pages and exited child', 'writers-not-stopped', (_, s) => { s.descendantCount = 1; });
refusal('interrupted supervisor never proves stopped', 'writers-not-stopped', (_, s) => { s.interrupted = true; });
refusal('late observer does not prove complete coverage', 'incomplete-observation', (_, s, j) => { j.armedBeforeLaunch = false; });
refusal('planned drop with upstream already started is not non-forward evidence', 'backend-write-unresolved', (_, s, j) => { j.attempts[0].upstreamStarted = true; });
refusal('ordinary save abort after upstream send remains unresolved', 'backend-write-unresolved', (_, s, j) => { j.attempts[1].terminal = { attempt: sentSave, browserAborted: true }; });
refusal('coaching upstream socket finish without terminal response stays unresolved', 'backend-write-unresolved', (_, s, j) => { j.attempts[2].terminal = { attempt: coaching, socketFinished: true }; });
refusal('terminal receipt from another attempt cannot be borrowed', 'backend-write-unresolved', (_, s, j) => { j.attempts[2].terminal.attempt = sentSave; });
refusal('duplicate attempt identity invalidates the journal', 'attempt-integrity', (_, s, j) => { j.attempts.push(completed(sentSave, 'save')); });
refusal('cross-run journal is rejected', 'binding', (_, s, j) => { j.binding = 'e'.repeat(64); });


test('parent cannot brand stopped writers with HTTP transport evidence alone', () => {
    const [expected, supervisor, journal] = fixture();
    const identity = { runId: 'closed-proof-negative', owner: '11111111-1111-4111-8111-111111111111' };
    for (const part of [expected, supervisor, journal]) Object.assign(part, identity);
    supervisor.writersClosedAt = 1;
    const positive = verifyJ4aStoppedWriters(expected, supervisor, journal);
    assert.ok(readJ4aStoppedWriters(positive, expected));
    assert.equal(readJ4aStoppedWriters(positive, { ...expected, runId: 'wrong-run' }), null);
    assert.equal(readJ4aStoppedWriters(positive, { ...expected, owner: 'wrong-owner' }), null);
    for (const transport of [
        { responseStatus: 200, socketFinished: true, responseBodyEnded: true },
        { responseStatus: 202, socketFinished: true, responseBodyEnded: true },
        { responseStatus: 200, browserAborted: true },
    ]) {
        journal.attempts[1].terminal = { attempt: sentSave, ...transport };
        assert.equal(verifyJ4aStoppedWriters(expected, supervisor, journal), null);
    }
});
