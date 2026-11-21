'use strict';
// The J4.a parent save witness (j4a-save-witness.cjs), offline: the journal's shape and chain, the save-path rule (one lost save, one
// explicit Retry, one confirmed completion for that take), the parent's takes check, the stopped-writer proof it derives, the sealing
// around exactly one case launch, and the row gate. No network, account or production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { SCHEMA, decideSavePath, decideTakes, j4aSaveWitness, parseJournal, supervisorClose } = require('../j4a-save-witness.cjs');
const { readJ4aStoppedWriters } = require('../j4a-writer-evidence.cjs');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const BINDING = 'b'.repeat(64);
const RUN = '41325698722';
const OWNER = '11111111-1111-4111-8111-111111111111';
const T1 = '11111111-0000-4000-8000-000000000001';
const T2 = '22222222-0000-4000-8000-000000000002';

/** A journal's entries, in the guard's order: signup, Start 1, lost save, Retry, retried save, Start 2, save 2. `edit` bends one. */
function entries(edit = (e) => e) {
    let seq = 0;
    const e = (kind, o = {}) => {
        const attempt = sha(`${kind}-${seq}`);
        const decision = o.decision ?? 'forwarded';
        const terminal = o.terminal !== undefined ? o.terminal : decision === 'forwarded' ? { attempt, backendConfirmed: true, ...(kind === 'save' ? { savedRowCount: 1 } : {}) } : null;
        return { attempt, binding: BINDING, decision, kind, prev: null, runId: RUN, seq: (seq += 1), session: o.session ?? null, terminal, token: 't', upstreamStarted: o.upstreamStarted ?? decision === 'forwarded' };
    };
    return edit([e('signup'), e('start'), e('save', { session: sha(T1), decision: 'planned-request-lost', upstreamStarted: false }),
        e('retry-intent', { session: sha(T1), decision: 'intent', upstreamStarted: false }), e('save', { session: sha(T1) }), e('start'), e('save', { session: sha(T2) })]);
}
const expected = { binding: BINDING, runId: RUN };
const renumber = (x) => x.map((e, i) => ({ ...e, seq: i + 1 }));

test('save path: one lost save, one explicit Retry, one confirmed completion for that take, the next take saved once: CONFIRMED', () => {
    const v = decideSavePath(entries(), expected);
    assert.equal(v.verdict, 'CONFIRMED');
    assert.equal(v.boundSession, sha(T1));
    assert.deepEqual([...v.savedSessions].sort(), [sha(T1), sha(T2)].sort());
});

test('save path refuses every missing or contradicted fact (HOLD, content-free reason)', () => {
    const cases = [
        ['no lost save', (x) => renumber(x.filter((e) => e.decision !== 'planned-request-lost')), /saw 0/],
        ['two lost saves', (x) => [...x, { ...x[2], attempt: sha('x'), seq: 8, session: sha(T2) }], /saw 2/],
        ['an entry missing', (x) => x.filter((e) => e.seq !== 2), /out of order/],
        ['the lost save left', (x) => { x[2].upstreamStarted = true; return x; }, /upstream was not proven unstarted/],
        ['no Retry', (x) => renumber(x.filter((e) => e.kind !== 'retry-intent')), /explicit Retry, saw 0/],
        ['the Retry names another take', (x) => { x[3].session = sha(T2); return x; }, /not for the lost take/],
        ['the completion before the Retry', (x) => { [x[3], x[4]] = [x[4], x[3]]; [x[3].seq, x[4].seq] = [4, 5]; return x; }, /before the explicit Retry/],
        ['entries out of order', (x) => { [x[3], x[4]] = [x[4], x[3]]; return x; }, /out of order/],
        ['a third completion of the lost take', (x) => [...x, { ...x[4], attempt: sha('y'), seq: 8 }], /3 completion attempt/],
        ['the retried completion unconfirmed', (x) => { x[4].terminal = null; return x; }, /no backend-confirmed single saved row/],
        ['the retried completion saw two rows', (x) => { x[4].terminal.savedRowCount = 2; return x; }, /no backend-confirmed single saved row/],
        ['the next take completed twice', (x) => [...x, { ...x[6], attempt: sha('z'), seq: 8 }], /completed more than once/],
        ['an unresolved Start', (x) => { x[1].terminal = null; return x; }, /start attempt is unresolved/],
        ['another binding', (x) => { x[0].binding = 'c'.repeat(64); return x; }, /another binding or run/],
        ['another run', (x) => { x[5].runId = 'other'; return x; }, /another binding or run/],
        ['a repeated attempt', (x) => { x[5].attempt = x[1].attempt; return x; }, /malformed or repeated/],
        ['an unknown kind', (x) => { x[0].kind = 'payment'; return x; }, /unknown kind/],
    ];
    for (const [name, edit, why] of cases) {
        const v = decideSavePath(entries(edit), expected);
        assert.equal(v.verdict, 'HOLD', name);
        assert.match(v.reason, why, name);
    }
    assert.equal(decideSavePath(undefined, expected).verdict, 'HOLD');
    assert.equal(decideSavePath(entries(), { binding: 'nope', runId: RUN }).verdict, 'HOLD');
});

/** J4.b (response lost): the dropped completion reached the server (upstream started) and the page saw no answer. */
const responseLost = (x) => {
    Object.assign(x[2], { decision: 'planned-response-lost', upstreamStarted: true,
        terminal: { attempt: x[2].attempt, backendConfirmed: true, savedRowCount: 1, pageAnswered: false } });
    return x;
};
const j4b = { ...expected, fault: 'response-lost' };

test('J4.b save path: the lost answer\'s request reached the server, one explicit Retry, one confirmed single row: CONFIRMED', () => {
    const v = decideSavePath(entries(responseLost), j4b);
    assert.equal(v.verdict, 'CONFIRMED');
    assert.equal(v.boundSession, sha(T1));
    assert.deepEqual([...v.savedSessions].sort(), [sha(T1), sha(T2)].sort());
});

test('J4.b save path refuses the other fault, a request that never left, a seen answer, and a doubled save; faults never cross', () => {
    const cases = [
        ['J4.a journal under the J4.b witness', (x) => x, /other planned save fault/],
        ['the request never left', (x) => { responseLost(x); x[2].upstreamStarted = false; return x; }, /lost answer was not proven/],
        ['the server never answered', (x) => { responseLost(x); x[2].terminal = null; return x; }, /lost answer was not proven/],
        ['the page saw the answer', (x) => { responseLost(x); x[2].terminal.pageAnswered = true; return x; }, /lost answer was not proven/],
        ['the answer is another attempt\'s', (x) => { responseLost(x); x[2].terminal.attempt = x[4].attempt; return x; }, /lost answer was not proven/],
        ['the server saved two rows first', (x) => { responseLost(x); x[2].terminal.savedRowCount = 2; return x; }, /lost answer was not proven/],
        ['the Retry saved a second row', (x) => { responseLost(x); x[4].terminal.savedRowCount = 2; return x; }, /no backend-confirmed single saved row/],
        ['no Retry', (x) => renumber(responseLost(x).filter((e) => e.kind !== 'retry-intent')), /explicit Retry, saw 0/],
        ['a second completion after the Retry', (x) => [...responseLost(x), { ...x[4], attempt: sha('w'), seq: 8 }], /3 completion attempt/],
        ['both faults in one journal', (x) => [...responseLost(x), { ...x[6], attempt: sha('v'), seq: 8, decision: 'planned-request-lost', upstreamStarted: false, terminal: null }],
            /other planned save fault/],
    ];
    for (const [name, edit, why] of cases) {
        const v = decideSavePath(entries(edit), j4b);
        assert.equal(v.verdict, 'HOLD', name);
        assert.match(v.reason, why, name);
    }
    // A J4.b journal never passes the J4.a witness, and an unknown fault never passes at all.
    assert.equal(decideSavePath(entries(responseLost), expected).verdict, 'HOLD');
    assert.equal(decideSavePath(entries(), { ...expected, fault: 'both' }).verdict, 'HOLD');
    assert.throws(() => j4aSaveWitness({ dir: path.join(os.tmpdir(), 'x'), fault: 'both' }), /planned save fault/);
});

test('takes: the retried take reads back exactly once and the saved takes are exactly the confirmed ones', () => {
    const save = decideSavePath(entries(), expected);
    const ok = [{ id: T1, status: 'completed' }, { id: T2, status: 'completed' }];
    assert.equal(decideTakes(ok, save).verdict, 'CONFIRMED');
    for (const [rows, why] of [
        [[...ok, { id: T1, status: 'completed' }], /reads back 2 time/],
        [[ok[1]], /reads back 0 time/],
        [[ok[0]], /do not match the confirmed saves/],
        [[...ok, { id: 'extra', status: 'completed' }], /do not match/],
        [[{ id: T1, status: 'active' }, ok[1]], /1 take\(s\) are not saved/],
        [[{ id: 5, status: 'completed' }], /malformed/],
        [null, /not read by the parent/],
    ]) assert.match(decideTakes(rows, save).reason, why);
    assert.equal(decideTakes(ok, { verdict: 'HOLD' }).verdict, 'HOLD');
});

test('journal: armed header, token and chain are required; any break is HOLD', () => {
    const header = JSON.stringify({ schema: SCHEMA, token: 'tok' });
    const chain = (list) => {
        let prev = sha(header); const lines = [header];
        for (const e of list) { const line = JSON.stringify({ ...e, token: 'tok', prev }); lines.push(line); prev = sha(line); }
        return Buffer.from(`${lines.join('\n')}\n`);
    };
    assert.equal(parseJournal(chain(entries()), 'tok').entries.length, 7);
    assert.match(parseJournal(chain(entries()), 'other').hold, /not armed by this witness/);
    assert.match(parseJournal(Buffer.from(''), 'tok').hold, /empty or torn/);
    assert.match(parseJournal(chain(entries()).subarray(0, -1), 'tok').hold, /empty or torn/);
    const dropped = chain(entries()).toString().split('\n'); dropped.splice(3, 1);
    assert.match(parseJournal(Buffer.from(dropped.join('\n')), 'tok').hold, /chain is broken/);
    const extra = chain(entries((x) => { x[0].note = 'x'; return x; }));
    assert.match(parseJournal(extra, 'tok').hold, /wrong shape/);
});

test('supervisor close: only the parent\'s clean exit with no descendants and a closed guard counts', () => {
    const ce = { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false, mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true };
    const clean = supervisorClose({ status: 0, signal: null, reason: null, cleanupIncomplete: false }, { ownedProcessesRemaining: [], cleanupEvidence: ce });
    assert.deepEqual({ ...clean }, { exited: true, interrupted: false, descendantCount: 0, ownedPagesClosed: true, guardTransportDrained: true });
    assert.equal(supervisorClose({ status: 0, signal: null, reason: 'command-deadline', cleanupIncomplete: false }, { ownedProcessesRemaining: [], cleanupEvidence: ce }).interrupted, true);
    assert.equal(supervisorClose({ status: 0, signal: null, reason: null, cleanupIncomplete: true }, { ownedProcessesRemaining: [], cleanupEvidence: ce }).descendantCount, null);
    assert.equal(supervisorClose({ status: 0, signal: null, reason: null, cleanupIncomplete: false }, { ownedProcessesRemaining: [], killedLeftovers: [{}], cleanupEvidence: ce }).descendantCount, null);
    assert.equal(supervisorClose({ status: 0, signal: null, reason: null, cleanupIncomplete: false }, { ownedProcessesRemaining: [], cleanupEvidence: { ...ce, browserCloseError: true } }).ownedPagesClosed, false);
    assert.equal(supervisorClose(null, null).exited, false);
});

/** A witness around one fake case launch whose "guard" writes `list` into the armed journal and whose close is `close`. */
async function witnessRun(t, { list = entries(), close = { status: 0, signal: null, reason: null, cleanupIncomplete: false }, after = null, fault = undefined } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-witness-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
    const w = j4aSaveWitness({ dir: path.join(root, 'journal'), ...(fault ? { fault } : {}) });
    const inner = async (_node, args, _options, deps) => {
        if (!args[0].endsWith('run-guarded.cjs')) return { status: 0, signal: null, reason: null, cleanupIncomplete: false, passedThrough: deps.env.J4A_SAVE_JOURNAL === undefined };
        const file = deps.env.J4A_SAVE_JOURNAL;
        let prev = sha(fs.readFileSync(file, 'utf8').split('\n')[0]);
        for (const e of list) { const line = JSON.stringify({ ...e, token: deps.env.J4A_SAVE_JOURNAL_TOKEN, prev }); fs.appendFileSync(file, `${line}\n`); prev = sha(line); }
        fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ ownedProcessesRemaining: [], cleanupEvidence: { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1',
            ownedProcessesRemaining: 0, launchCleanupFailure: false, mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true } }));
        return close;
    };
    const run = w.commandRunner(inner);
    const passthrough = await run('node', ['admission.cjs'], {}, { env: {} }).catch(() => 'refused');
    await run('node', [path.join('x', 'harness', 'run-guarded.cjs'), '--run-dir', runDir], {}, { env: {} });
    if (after) after(root);
    const token = w.verifier({ binding: BINDING, runId: RUN, owner: OWNER });
    return { w, token, run, runDir, passthrough };
}

test('witness: armed before the launch, sealed after a clean close, it derives the stopped-writer proof; the takes then confirm the save rows', async (t) => {
    const { w, token, run, runDir } = await witnessRun(t);
    assert.ok(readJ4aStoppedWriters(token, { binding: BINDING, runId: RUN, owner: OWNER }), 'a verified stopped-writer token for exactly this run and owner');
    assert.equal(readJ4aStoppedWriters(token, { binding: BINDING, runId: RUN, owner: '22222222-2222-4222-8222-222222222222' }), null);
    assert.equal(w.verdict().verdict, 'HOLD', 'not CONFIRMED until the parent has read the takes');
    w.observeTakes([{ id: T1, status: 'completed' }, { id: T2, status: 'completed' }]);
    assert.equal(w.verdict().verdict, 'CONFIRMED');
    const gated = w.gate({ assertions: [{ id: 'retry-saved-once', result: 'PASS' }] });
    assert.deepEqual(gated.assertions, [{ id: 'retry-saved-once', result: 'PASS' }]);
    await assert.rejects(run('node', [path.join('x', 'harness', 'run-guarded.cjs'), '--run-dir', runDir], {}, { env: {} }), /one case launch per witness/);
});

test('J4.b witness: the response-lost journal derives the stopped-writer proof and, with one saved row each, confirms the rows', async (t) => {
    const { w, token } = await witnessRun(t, { list: entries(responseLost), fault: 'response-lost' });
    assert.ok(readJ4aStoppedWriters(token, { binding: BINDING, runId: RUN, owner: OWNER }));
    w.observeTakes([{ id: T1, status: 'completed' }, { id: T2, status: 'completed' }]);
    assert.equal(w.verdict().verdict, 'CONFIRMED');
    // The Retry after a committed save must not add a row: two rows for the lost take hold the leg.
    w.observeTakes([{ id: T1, status: 'completed' }, { id: T1, status: 'completed' }, { id: T2, status: 'completed' }]);
    assert.match(w.verdict().reason, /reads back 2 time/);
    // A J4.a journal under the J4.b witness issues no token and holds the rows.
    const crossed = await witnessRun(t, { fault: 'response-lost' });
    assert.equal(readJ4aStoppedWriters(crossed.token, { binding: BINDING, runId: RUN, owner: OWNER }), null);
    assert.equal(crossed.w.gate({ assertions: [] }).j4aSaveWitness.verdict, 'HOLD');
});

test('witness: missing proof holds the save rows and issues no stopped-writer token', async (t) => {
    const ok = [{ id: T1, status: 'completed' }, { id: T2, status: 'completed' }];
    for (const [name, opts, why] of [
        ['no journal lines', { list: [] }, /saw 0/],
        ['a deadline-killed case', { close: { status: 0, signal: null, reason: 'command-deadline', cleanupIncomplete: false } }, /^the writers were not proven stopped$/],
        ['leftover processes', { close: { status: 0, signal: null, reason: null, cleanupIncomplete: true } }, /no owned descendants/],
        ['a line added after the seal', { after: (root) => { const f = fs.readdirSync(path.join(root, 'journal'))[0]; const p = path.join(root, 'journal', f); fs.chmodSync(p, 0o600); fs.appendFileSync(p, '{}\n'); } }, /changed after it was sealed/],
    ]) {
        const { w, token } = await witnessRun(t, opts);
        w.observeTakes(ok);
        assert.equal(readJ4aStoppedWriters(token, { binding: BINDING, runId: RUN, owner: OWNER }), null, name);
        assert.match(w.verdict().reason, why, name);
        const gated = w.gate({ assertions: [{ id: 'retry-saved-once', result: 'PASS' }] });
        assert.deepEqual(gated.assertions.filter((a) => a.result === 'HOLD').map((a) => a.id), ['fault-exercised', 'retry-saved-once', 'completion-attempts'], name);
    }
});

test('witness: only the case launch is wrapped; no directory or runner is refused before anything runs', async (t) => {
    const { passthrough } = await witnessRun(t);
    assert.equal(passthrough.passedThrough, true, 'other commands (admission, identity) pass through untouched, with no journal');
    assert.throws(() => j4aSaveWitness({ dir: 'relative' }), /absolute private directory/);
    assert.throws(() => j4aSaveWitness({ dir: os.tmpdir() }).commandRunner(null), /wraps a supervised command runner/);
    assert.equal(j4aSaveWitness({ dir: os.tmpdir() }).verifier({ binding: BINDING, runId: RUN, owner: OWNER }), null, 'never armed, no proof');
});

test('composition: the witness is the only writer proof and must be whole', () => {
    const { composeJ4aNightly } = require('../j4a-nightly-entry.cjs');
    const w = j4aSaveWitness({ dir: os.tmpdir() });
    const base = { plan: {}, bundle: '/x', admin: {}, transport: {}, saveJournal: { reviewed: 'x', bind() {} }, configuredDomain: 'example.com', nightly: { evidenceDir: '/x', runId: 'r' } };
    assert.throws(() => composeJ4aNightly({ ...base, saveWitness: w, offlineStoppedWritersVerifier: () => null }), /only writer proof/);
    assert.throws(() => composeJ4aNightly({ ...base, saveWitness: { commandRunner() {}, verifier() {} } }), /only writer proof/);
});
