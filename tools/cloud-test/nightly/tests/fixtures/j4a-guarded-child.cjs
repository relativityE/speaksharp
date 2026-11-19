'use strict';
// Stand-in for run-guarded.cjs in the adapter-level J4.a test: a real separate process spawned by the REAL supervisedCommand with the
// REAL run-guarded argument vector. Its pre-launch is the supervisor's own: hash-check and validate the case config, then
// bindSupervisedChild (the exact function run-guarded.cjs calls before launchGuarded). "launch" on the wire stands for the browser
// launch, written only after binding. Effects go to a fake database file that only the parent's trusted reader reads back.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bindSupervisedChild } = require('../../j4a-supervised-channel.cjs');
const { validateCaseConfig } = require('../../../harness/bundle/harness/case-results.cjs');

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
const wire = (event) => fs.appendFileSync(process.env.J4A_WIRE, `${event}\n`);
const db = (fn) => { const d = JSON.parse(fs.readFileSync(process.env.J4A_DB, 'utf8')); fn(d); fs.writeFileSync(process.env.J4A_DB, JSON.stringify(d)); };
const runDir = a['run-dir'];
const summary = (reason, exitCode) => fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ reason, exitCode, ownedProcessesRemaining: [],
    endedAt: new Date().toISOString(), cleanupEvidence: { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0,
        launchCleanupFailure: false, mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true } }), { mode: 0o600 });
const finish = (code) => { try { process.disconnect(); } catch { /* closed */ } process.exitCode = code; };

(async () => {
    const bytes = fs.readFileSync(a['case-config']);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== a['case-config-sha256']) throw new Error('case config hash');
    const caseConfig = validateCaseConfig(JSON.parse(bytes));
    let cap;
    if (a['j4a-binding'] !== undefined) {
        try { cap = await bindSupervisedChild(a, caseConfig, { port: process, timeoutMs: 5_000 }); }
        catch (e) { wire(`refused:${e.code || e.message}`); summary('binding-refused', 78); return finish(78); }
    }
    wire('launch');
    if (!cap) { summary('completed', 0); fs.writeFileSync(path.join(runDir, 'case-result.json'), JSON.stringify({ assertions: [] })); return finish(0); }
    const account = process.env.J4A_ACCOUNT;
    const create = await cap.createAccount(account, async ({ retries }) => {
        wire(`create:retries=${retries}`); db((d) => { d.account[account] = 1; }); return { outcome: 'created' };
    });
    wire(`create-result:${create.ok ? create.outcome : 'unanswered'}`);
    for (let i = 0; i < 2; i += 1) await cap.send('starts', async () => { wire('starts'); db((d) => { d.session[account] = (d.session[account] ?? 0) + 1; }); return null; });
    await cap.cleanup(async () => { wire('cleanup'); db((d) => { d.account[account] = 0; d.session[account] = 0; d.lease[account] = 0; }); return true; });
    const reported = await cap.reportCleanup({ steps: [{ kind: 'account', ref: account, action: 'delete', outcome: 'done' }], left: [] });
    wire(`report:${reported.ok ? 'accepted' : 'refused'}`);
    fs.writeFileSync(path.join(runDir, 'case-result.json'), JSON.stringify({ assertions: [] }), { mode: 0o600 });
    summary('completed', 0);
    return finish(0);
})();
