'use strict';
// Stand-in for run-guarded.cjs in the J4.a ENTRY-POINT proof (#1884, Sam's seal review). Spawned by the REAL supervisedCommand with
// run-guarded's real argument vector, it runs the supervisor's own pre-launch (bindSupervisedChild) and then the REAL guarded routes
// (j4a-guarded-step: signup inside the guarded create, the parent's confirmOwner, Start inside its grant). The browser is replaced by
// a fake database file: the signup factory writes the new auth user there, a Start writes a session row and a lease. The parent's
// fake admin client reads and deletes in the same file, so its confirmation, teardown and residue checks are the real ones.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bindSupervisedChild } = require('../../j4a-supervised-channel.cjs');
const { j4aGuardedRoutes } = require('../../j4a-guarded-step.cjs');
const { validateCaseConfig } = require('../../../harness/bundle/harness/case-results.cjs');

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
const wire = (e) => fs.appendFileSync(process.env.J4A_WIRE, `${e}\n`);
const db = (fn) => { const d = JSON.parse(fs.readFileSync(process.env.J4A_DB, 'utf8')); const r = fn(d); fs.writeFileSync(process.env.J4A_DB, JSON.stringify(d)); return r; };
const runDir = a['run-dir'];
const finishCase = (rows, reason, code) => {
    fs.writeFileSync(path.join(runDir, 'case-result.json'), JSON.stringify({ assertions: rows }), { mode: 0o600 });
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ reason, exitCode: code, ownedProcessesRemaining: [], endedAt: new Date().toISOString(),
        cleanupEvidence: { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false,
            mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true } }), { mode: 0o600 });
    try { process.disconnect(); } catch { /* closed */ }
    process.exitCode = code;
};
const pagesClosed = { id: 'owned-pages-closed', result: 'PASS', detail: 'offline', evidenceRefs: ['unit.json'] };

(async () => {
    const bytes = fs.readFileSync(a['case-config']);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== a['case-config-sha256']) throw new Error('case config hash');
    const caseConfig = validateCaseConfig(JSON.parse(bytes));
    let cap;
    try { cap = await bindSupervisedChild(a, caseConfig, { port: process, timeoutMs: 5_000 }); }
    catch (e) { wire(`refused:${e.code || e.message}`); return finishCase([], 'binding-refused', 78); }
    const uid = process.env.J4A_UID;
    const routes = j4aGuardedRoutes(cap, { identity: cap.identity, domain: process.env.LIVE_TEST_EMAIL_DOMAIN, configuredDomain: process.env.LIVE_TEST_EMAIL_DOMAIN,
        factory: async (_page, email) => { wire('signup'); db((d) => { d.users.push({ id: uid, email }); }); return { uid }; } });
    const su = await routes.signUp({});
    wire(`signup:${su.created ? 'created' : 'not-created'}`);
    if (!su.created) return finishCase([pagesClosed], 'step-error', 1);
    const owner = await cap.confirmOwner();
    wire(`owner:${owner.ok ? (owner.ownerId === uid ? 'confirmed-matches-page' : 'confirmed-other') : 'hold'}`);
    if (!owner.ok || owner.ownerId !== uid) return finishCase([pagesClosed], 'step-error', 1); // unbound: no Start, no save fault, no readback
    await routes.pressStart(async () => { wire('start-click'); db((d) => { d.sessions.push({ id: 'take-1', user_id: uid, status: 'completed', lease_id: 'lease-1', recording_fenced_at: null }); d.active_recording_lease.push({ user_id: uid, lease_id: 'lease-1' }); (d.account_save_obligations ??= []).push({ user_id: uid, lease_id: 'lease-1', phase: 'completed' }); }); });
    return finishCase([pagesClosed], 'completed', 0);
})();
