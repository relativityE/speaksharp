'use strict';
// Stand-in for run-guarded.cjs in the J4.a SAVE-RETRY proof (Sam, 21 Nov: one lost save, one Retry, exactly one saved take). Spawned
// by the REAL supervisedCommand with run-guarded's real argument vector, it binds through the supervisor's own pre-launch
// (bindSupervisedChild) and runs the REAL guarded routes (j4a-guarded-step: signup inside the guarded create, the parent's
// confirmOwner, each Start inside its grant). The browser and the guard are replaced: the page writes a fake database file that the
// parent's fake admin client also reads, and the guard appends the parent-armed save journal (J4A_SAVE_JOURNAL, its token, the line
// before's digest), one line per writer attempt and per explicit Retry. J4A_SCENARIO bends one fact so a test can watch it refused.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bindSupervisedChild } = require('../../j4a-supervised-channel.cjs');
const { j4aGuardedRoutes } = require('../../j4a-guarded-step.cjs');
const { validateCaseConfig } = require('../../../harness/bundle/harness/case-results.cjs');

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
const scenario = process.env.J4A_SCENARIO || 'ok';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const wire = (e) => fs.appendFileSync(process.env.J4A_WIRE, `${e}\n`);
const db = (fn) => { const d = JSON.parse(fs.readFileSync(process.env.J4A_DB, 'utf8')); const r = fn(d); fs.writeFileSync(process.env.J4A_DB, JSON.stringify(d)); return r; };
const runDir = a['run-dir'];
const ROWS = ['owner-bound', 'fault-exercised', 'recovery-truthful', 'retry-saved-once', 'review-reopen', 'next-take-isolated', 'completion-attempts',
    'start-press-budget', 'no-cloud-stt', 'owned-pages-closed'];
const finishCase = (rows, reason, code) => {
    fs.writeFileSync(path.join(runDir, 'case-result.json'), JSON.stringify({ assertions: rows }), { mode: 0o600 });
    // The guard's own completion summary always claims the exact two attempts: the parent witness must not rest on it.
    const op = 'd'.repeat(64);
    const guard = { completionAttempts: { attempts: [{ operationDigest: op, permitted: true }, { operationDigest: op, permitted: true }], attemptCount: 2, retryMarked: true, exactExpectedAttempts: true } };
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ reason, exitCode: code, ownedProcessesRemaining: [], endedAt: new Date().toISOString(), guard,
        cleanupEvidence: { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false,
            mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true } }), { mode: 0o600 });
    try { process.disconnect(); } catch { /* closed */ }
    process.exitCode = code;
};
const row = (id) => ({ id, result: 'PASS', detail: 'offline stand-in', evidenceRefs: ['unit.json'] });

/** The stand-in guard's journal writer: every line carries the parent's token and the digest of the line before it. */
function guardJournal(cap) {
    const file = process.env.J4A_SAVE_JOURNAL;
    const token = process.env.J4A_SAVE_JOURNAL_TOKEN;
    if (scenario === 'no-journal' || !file || !token) return { attempt: () => sha(crypto.randomUUID()) };
    let prev = sha(fs.readFileSync(file, 'utf8').split('\n')[0]);
    let seq = 0;
    return {
        attempt(kind, { session = null, decision = 'forwarded', upstreamStarted = true, confirmed = true, savedRowCount = undefined } = {}) {
            const attempt = sha(crypto.randomUUID());
            const terminal = decision === 'forwarded' && confirmed ? { attempt, backendConfirmed: true, ...(savedRowCount === undefined ? {} : { savedRowCount }) } : null;
            const line = JSON.stringify({ attempt, binding: cap.digest, decision, kind, prev, runId: cap.identity.runId, seq: (seq += 1), session, terminal, token, upstreamStarted });
            fs.appendFileSync(file, `${line}\n`);
            prev = sha(line);
            return attempt;
        },
    };
}

(async () => {
    const bytes = fs.readFileSync(a['case-config']);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== a['case-config-sha256']) throw new Error('case config hash');
    const caseConfig = validateCaseConfig(JSON.parse(bytes));
    let cap;
    try { cap = await bindSupervisedChild(a, caseConfig, { port: process, timeoutMs: 5_000 }); }
    catch (e) { wire(`refused:${e.code || e.message}`); return finishCase([], 'binding-refused', 78); }
    const guard = guardJournal(cap);
    const uid = process.env.J4A_UID;
    const routes = j4aGuardedRoutes(cap, { identity: cap.identity, domain: process.env.LIVE_TEST_EMAIL_DOMAIN, configuredDomain: process.env.LIVE_TEST_EMAIL_DOMAIN,
        factory: async (_page, email) => { wire('signup'); guard.attempt('signup'); db((d) => { d.users.push({ id: uid, email }); }); return { uid }; } });
    const su = await routes.signUp({});
    wire(`signup:${su.created ? 'created' : 'not-created'}`);
    if (!su.created) return finishCase([row('owned-pages-closed')], 'step-error', 1);
    const owner = await cap.confirmOwner();
    wire(`owner:${owner.ok ? (owner.ownerId === uid ? 'confirmed-matches-page' : 'confirmed-other') : 'hold'}`);
    if (!owner.ok || owner.ownerId !== uid) return finishCase([row('owned-pages-closed')], 'step-error', 1);

    const take = (n) => ({ id: `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`, lease: `lease-${n}` });
    const first = take(1); const second = take(2);
    const startTake = async (t) => {
        await routes.pressStart(async () => {
            wire(`start-click:${t.lease}`); guard.attempt('start');
            db((d) => { d.sessions.push({ id: t.id, user_id: uid, status: 'active', lease_id: t.lease, recording_fenced_at: null }); d.active_recording_lease.push({ user_id: uid, lease_id: t.lease });
                (d.account_save_obligations ??= []).push({ user_id: uid, lease_id: t.lease, phase: 'admitted' }); });
        });
    };
    const saved = (t, copies = 1) => db((d) => {
        for (const s of d.sessions) if (s.id === t.id) s.status = 'completed';
        for (let i = 1; i < copies; i += 1) d.sessions.push({ id: t.id, user_id: uid, status: 'completed', lease_id: t.lease, recording_fenced_at: null });
        for (const o of d.account_save_obligations) if (o.lease_id === t.lease) o.phase = 'completed';
    });

    // Take 1: Start, Stop, the completion is dropped before it leaves (the planned fault), the page offers Retry, one Retry saves it.
    await startTake(first);
    wire('save:lost');
    guard.attempt('save', { session: sha(first.id), decision: 'planned-request-lost', upstreamStarted: scenario === 'lost-save-left', confirmed: false });
    if (scenario === 'lost-save-landed') saved(first);
    if (scenario === 'retry-before-intent') guard.attempt('save', { session: sha(first.id), savedRowCount: 1 });
    if (scenario !== 'no-retry-intent') { wire('retry:pressed'); guard.attempt('retry-intent', { session: sha(first.id), decision: 'intent', upstreamStarted: false, confirmed: false }); }
    if (scenario !== 'retry-before-intent') guard.attempt('save', { session: sha(first.id), savedRowCount: 1, confirmed: scenario !== 'retry-unconfirmed' });
    if (scenario === 'second-retry') guard.attempt('save', { session: sha(first.id), savedRowCount: 1 });
    wire('save:retried');
    if (scenario !== 'lost-save-landed') saved(first, scenario === 'saved-twice' ? 2 : 1);
    // Take 2: the next take is isolated and saved by its one completion.
    await startTake(second);
    guard.attempt('save', { session: sha(second.id), savedRowCount: 1 });
    saved(second);
    wire('next-take:saved');
    return finishCase(ROWS.map(row), 'completed', 0);
})();
