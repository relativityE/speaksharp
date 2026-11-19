'use strict';
// #1884 (Sam, 17 Nov, option a): the guarded-signup owner through the REAL guard entry points with bounded fakes.
//   - the reviewed oracle loader (durable-save-oracle.cjs, dynamicSessionBinding in the explicit guarded mode) and Guard.prototype
//     saveReadbackConfiguration / bindGuardedOwner / bindSaveReadback;
//   - save-fault-binding preflight/begin and browser-readback while unbound;
//   - the real AHT-05 driver (source-adapters run, via the proof fake-run harness) with a bound nightly channel and a bounded nightly.
// Unbound Start/save fault/readback, a mismatched owner, a replay/rebind and an ambiguous signup all refuse; an owner the parent can't
// confirm is HOLD (NOT RUN), never a weaker oracle. Offline: no browser, network or production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const CT = path.join(__dirname, '..', '..');
const ROOT = path.join(CT, 'harness');
const { loadReviewedOracle, GUARDED_SIGNUP_OWNER } = require(path.join(ROOT, 'bundle/harness/reviewed-oracle-loader.cjs'));
const { Guard } = require(path.join(ROOT, 'bundle/harness/guard-proxy.cjs'));
const { attachParentChannel, connectChildChannel } = require('../j4a-supervised-channel.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'draft-adapters/SOURCE.sha256.json'), 'utf8')).sourceSha;
const HOST = 'yxlapjuovrsvjswkwnrk.supabase.co';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** The real reviewed durable-save oracle in the explicit guarded-signup mode (a fresh module copy, since the loader caches by path). */
function guardedFactory(t, ownerId = GUARDED_SIGNUP_OWNER) {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-owner-')));
    t.after(() => fs.rmSync(d, { recursive: true, force: true }));
    fs.mkdirSync(path.join(d, 'draft-adapters'));
    for (const f of fs.readdirSync(path.join(ROOT, 'draft-adapters'))) {
        const src = path.join(ROOT, 'draft-adapters', f);
        if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(d, 'draft-adapters', f));
    }
    fs.cpSync(path.join(ROOT, 'draft-adapters', 'oracles'), path.join(d, 'draft-adapters', 'oracles'), { recursive: true });
    const oracleFile = path.join(d, 'draft-adapters/durable-save-oracle.cjs');
    const manifestFile = path.join(d, 'review.json');
    const bytes = Buffer.from(JSON.stringify({ version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'UNIT ONLY not production approval',
        reviewedAt: '2026-11-17T12:00:00Z', steps: [{ path: 'draft-adapters/durable-save-oracle.cjs', sha256: hash(fs.readFileSync(oracleFile)), dependencies: [] }] }));
    fs.writeFileSync(manifestFile, bytes, { mode: 0o600 });
    return loadReviewedOracle({ manifestFile, expectedManifestSha256: hash(bytes), stepRoot: d, oracleFile, sourceId: 'UNIT-NOT-RUNTIME',
        dynamicSessionBinding: { host: HOST, ownerId, sourceSha: PIN } });
}
/** A guard `this` carrying only what the owner methods read; the methods themselves are the real Guard.prototype ones. */
function guardWith(factory) {
    const logs = [];
    const g = { opts: { readbackOracle: factory }, saveReadbackInstalled: false, faults: [], logs, durableLog: (e) => logs.push(e) };
    for (const m of ['saveReadbackConfiguration', 'bindGuardedOwner', 'bindSaveReadback']) g[m] = Guard.prototype[m].bind(g);
    return g;
}

test('guard: the guarded owner starts unbound; save readback refuses until the one bind; no rebind; a mismatched owner refuses', (t) => {
    const g = guardWith(guardedFactory(t));
    assert.equal(g.saveReadbackConfiguration().accountSubjectSha256, null, 'unbound');
    assert.throws(() => g.bindSaveReadback({ baselineRow: {}, ownerId: OWNER, sessionId: OWNER, sourceSha: PIN }), /unbound/);
    assert.throws(() => g.bindGuardedOwner('not-a-uuid'), /exact account UUID/);
    assert.deepEqual(g.bindGuardedOwner(OWNER), { accountSubjectSha256: hash(OWNER) });
    assert.equal(g.saveReadbackConfiguration().accountSubjectSha256, hash(OWNER));
    assert.throws(() => g.bindGuardedOwner(OTHER), /already bound/, 'no rebind, not even to another owner');
    assert.throws(() => g.bindGuardedOwner(OWNER), /already bound/, 'no replay of the same bind');
    assert.throws(() => g.opts.readbackOracle.bindOwner(OTHER), /no rebind/, 'the reviewed oracle itself refuses a rebind, independent of the guard');
    assert.throws(() => g.bindSaveReadback({ baselineRow: {}, ownerId: OTHER, sessionId: OWNER, sourceSha: PIN }), /owner\/source mismatch/);
    assert.deepEqual(g.logs.map((e) => e.kind), ['guarded-owner-bound']);
});

test('guard: a pre-provisioned owner stays fixed by configuration and can never be bound at runtime', (t) => {
    const g = guardWith(guardedFactory(t, OWNER));
    assert.equal(g.saveReadbackConfiguration().accountSubjectSha256, hash(OWNER));
    assert.throws(() => g.bindGuardedOwner(OWNER), /unavailable or already bound/);
});

test('save fault and readback refuse while the guarded owner is unbound; preflight accepts only an unbound guard', async (t) => {
    const saveFault = require(path.join(ROOT, 'draft-adapters/save-fault-binding.cjs'));
    const readback = require(path.join(ROOT, 'draft-adapters/browser-readback.cjs'));
    const c = { caseId: 'AHT-05', sourceSha: PIN, servedSha: PIN, account: { mode: 'nightly-guarded-signup', emailDomain: 'example.com' },
        readback: { projectRef: 'yxlapjuovrsvjswkwnrk', anonKey: 'placeholder', origin: `https://${HOST}`, schemaSha256: 'b'.repeat(64), ownerReadApproved: true, rlsReadQualificationReceipt: 'rls.json' } };
    const g = guardWith(guardedFactory(t));
    const guard = { ...g, capturedSaveOperation() {}, markCompletionRetry() {}, completionAttemptSummary() {}, armFault() {}, summary() {} };
    assert.equal(saveFault.preflight('AHT-05', c, guard), true, 'unbound guard accepted at preflight');
    assert.throws(() => saveFault.begin({ page: {}, caseConfig: c }), /UUID/, 'save fault injection refuses unbound');
    await assert.rejects(readback.sessions({}, c), /UUID/, 'readback refuses unbound');
    g.bindGuardedOwner(OWNER);
    assert.throws(() => saveFault.preflight('AHT-05', c, guard), /owner\/backend mismatch/, 'a pre-bound guard with no confirmed case owner refuses');
});

// --- The real AHT-05 driver with a bound nightly channel (fake-run: browser modules stubbed, driver flow real) ---
function portPair() {
    const a = new EventEmitter(), b = new EventEmitter();
    const link = (from, to) => { from.send = (m) => { setImmediate(() => to.emit('message', structuredClone(m))); return true; }; };
    link(a, b); link(b, a);
    return { parent: a, child: b, close: () => { a.emit('disconnect'); b.emit('disconnect'); } };
}
const identity = Object.freeze({ campaignId: 'UNIT-NOT-A-RUN', runId: '41325698722', attempt: 1, caseId: 'AHT-05', requestSha256: '1'.repeat(64),
    planSha256: '2'.repeat(64), configSha256: '3'.repeat(64), sourceSha: PIN, servedSha: PIN });

async function driverRun(t, { parentOwner, pageUid, createAnswered = true }) {
    const cases = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-owner-cases-')));
    t.after(() => fs.rmSync(cases, { recursive: true, force: true }));
    fs.mkdirSync(path.join(cases, 'cases'));
    const cfg = { caseId: 'AHT-05', campaignId: 'UNIT-NOT-A-RUN', sourceSha: PIN, servedSha: PIN, targetUrl: 'https://speaksharp-public.vercel.app',
        requiredAssertions: require(path.join(ROOT, 'draft-adapters/source-adapters.cjs')).CONTRACTS['AHT-05'].rows,
        account: { mode: 'nightly-guarded-signup', emailDomain: 'example.com', effectiveFeatureAccessApproved: true }, observerSourceReviewed: true,
        observerQualificationReceipt: 'obs.json', fixture: { name: 'x', sha256: 'a'.repeat(64), launchSha256: 'a'.repeat(64), speechDurationMs: 6000 },
        readback: { projectRef: 'yxlapjuovrsvjswkwnrk', anonKey: 'placeholder', origin: `https://${HOST}`, schemaSha256: 'b'.repeat(64), ownerReadApproved: true, rlsReadQualificationReceipt: 'rls.json' } };
    fs.writeFileSync(path.join(cases, 'cases', 'AHT-05.json'), JSON.stringify(cfg));
    process.env.CT_PROOF_CASES_DIR = path.join(cases);
    process.env.LIVE_TEST_EMAIL_DOMAIN = 'example.com';
    delete require.cache[require.resolve(path.join(CT, 'tests/node/proof/helpers/fake-run.cjs'))];
    const { fake } = require(path.join(CT, 'tests/node/proof/helpers/fake-run.cjs'));
    const grants = { starts: 0, creates: 0, owner: 0 }, effects = { signupClicks: 0, startClicks: 0 };
    const nightly = {
        send: async (_l, kind, fn) => { grants[kind] = (grants[kind] ?? 0) + 1; return { sent: true, value: await fn() }; },
        cleanup: async (_l, fn) => ({ sent: true, value: await fn() }),
        createAccount: async (_l, _ref, fn) => {
            grants.creates += 1; const value = await fn({ signal: new AbortController().signal, retries: 0 });
            return createAnswered ? { sent: true, answered: true, value } : { sent: true, answered: false };
        },
        created: () => {},
    };
    const ports = portPair();
    t.after(ports.close);
    attachParentChannel({ port: ports.parent, identity, nightly,
        confirmOwner: async () => { grants.owner += 1; return parentOwner ? { owner: parentOwner } : { hold: 'the independent lookup is zero' }; } });
    const cap = await connectChildChannel({ port: ports.child, identity, timeoutMs: 2000 });
    const g = guardWith(guardedFactory(t));
    const guard = { ...g, armDownloadFault: () => 'dl1', summary: () => ({ faults: [{ id: 'f1', fired: true }] }) };
    const browserActions = require(path.join(ROOT, 'draft-adapters/browser-actions.cjs'));
    const { res } = await fake('AHT-05', {
        cfg, guard, capabilities: { nightly: cap },
        ui: {
            // the driver's own recorder, bound in the same real browser-actions instance the real pressStart below reads
            bindStartPressRecorder: (p, recorder) => browserActions.bindStartPressRecorder(p, recorder),
            signUpDisposable: async () => { effects.signupClicks += 1; return { uid: pageUid }; },
            // the REAL pressStart (and so the adapter's real wrapsClick recorder); only the control's click is counted here
            start: async (p) => { const orig = p.getByTestId; p.getByTestId = (id) => { const l = orig(id); if (id === 'mic-start') { const click = l.click; l.click = async (...a) => { effects.startClicks += 1; return click(...a); }; } return l; }; await browserActions.pressStart(p, 'mic-start'); },
        },
    });
    return { res, grants, effects, guard: g };
}
const row = (res, id) => res.assertions.find((a) => a.id === id)?.result;

test('driver: the parent-confirmed owner equal to the page session binds once; the Start click then runs inside its grant', async (t) => {
    const r = await driverRun(t, { parentOwner: OWNER, pageUid: OWNER });
    assert.equal(row(r.res, 'owner-bound'), 'PASS');
    assert.equal(r.guard.saveReadbackConfiguration().accountSubjectSha256, hash(OWNER));
    assert.deepEqual([r.grants.creates, r.effects.signupClicks, r.grants.owner], [1, 1, 1]);
    assert.ok(r.grants.starts >= 1);
    assert.equal(r.effects.startClicks, r.grants.starts, 'every Start click ran inside its own grant, and only there');
});

for (const [name, opts, expectOwnerAsk] of [
    ['a page session that is not the parent-confirmed owner (mismatched owner)', { parentOwner: OWNER, pageUid: OTHER }, 1],
    ['an owner the parent cannot independently confirm (HOLD)', { parentOwner: null, pageUid: OWNER }, 1],
    ['an ambiguous signup (create sent, never answered)', { parentOwner: OWNER, pageUid: OWNER, createAnswered: false }, 0],
]) {
    test(`driver: ${name} refuses: the owner stays unbound and no Start is clicked`, async (t) => {
        const r = await driverRun(t, opts);
        assert.notEqual(row(r.res, 'owner-bound'), 'PASS');
        assert.equal(r.guard.saveReadbackConfiguration().accountSubjectSha256, null, 'never bound');
        assert.deepEqual([r.grants.starts ?? 0, r.effects.startClicks], [0, 0]);
        assert.equal(r.grants.owner, expectOwnerAsk);
        assert.equal(r.effects.signupClicks, 1, 'the signup ran once and was never retried');
    });
}

test('channel: the parent confirms the owner once; a replayed confirmation is refused', async (t) => {
    const ports = portPair();
    t.after(ports.close);
    const nightly = { send: async () => ({ sent: false }), cleanup: async () => ({ sent: false }), created: () => {},
        createAccount: async (_l, _r, fn) => ({ sent: true, answered: true, value: await fn({ signal: new AbortController().signal, retries: 0 }) }) };
    let asked = 0;
    const parent = attachParentChannel({ port: ports.parent, identity, nightly, confirmOwner: async () => { asked += 1; return { owner: OWNER }; } });
    const cap = await connectChildChannel({ port: ports.child, identity, timeoutMs: 2000 });
    const none = await cap.confirmOwner();
    assert.equal(none.ok, false, 'no confirmed create yet: HOLD');
    const again = await cap.confirmOwner();
    assert.equal(again.ok, false);
    assert.match((await parent.outcome()).violations.join(','), /no rebind/);
    assert.equal(asked, 0);
});
