'use strict';
// #1884 (Sam, seal review of f34804e1): the INTENDED J4.a entry point (j4a-nightly-entry composeJ4aNightly, the composition `main`
// runs) exercised offline. Real layers: the nightly bridge's admission and routes, the sealed createAdapter runCase, the real
// supervisedCommand with its IPC option, a child running the supervisor's pre-launch and the real guarded routes, and the parent's
// own confirmJ4aOwner / j4aParentTeardown / zero-residue reads. Fakes: the Supabase admin client (over a database file the child's
// fake browser also writes) and the spawned script (the stand-in child instead of a browser). No network, account or production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const B = path.join(__dirname, '..', '..', 'harness', 'bundle');
const { supervisedCommand } = require(path.join(B, 'harness', 'admission.cjs'));
const { runIdentity } = require(path.join(B, 'harness', 'identity-check.cjs'));
const { Ledger } = require(path.join(B, 'harness', 'campaign-ledger.cjs'));
const { approvedAdminOrigin, composeJ4aNightly, main } = require('../j4a-nightly-entry.cjs');
const CHILD = path.join(__dirname, 'fixtures', 'j4a-entry-child.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha = 'b'.repeat(40);
const RUN = '41325698722';
const EMAIL = `rwt-journey-j4-${RUN}-1@example.com`;
const UID = '11111111-1111-4111-8111-111111111111';

/** The parent's admin client over the shared database file; every call is counted. */
function fakeAdmin(dbFile) {
    const calls = [];
    const read = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const write = (d) => fs.writeFileSync(dbFile, JSON.stringify(d));
    const notFound = { status: 404, code: 'user_not_found', message: 'User not found' };
    return { calls, admin: {
        auth: { admin: {
            listUsers: async ({ page, perPage }) => { calls.push('listUsers'); return { data: { users: read().users.slice((page - 1) * perPage, page * perPage) }, error: null }; },
            getUserById: async (id) => { calls.push('getUserById'); const u = read().users.find((x) => x.id === id); return u ? { data: { user: { email: u.email } }, error: null } : { data: { user: null }, error: notFound }; },
            deleteUser: async (id) => { calls.push('deleteUser'); const d = read(); d.users = d.users.filter((u) => u.id !== id); for (const t of ['sessions', 'active_recording_lease']) d[t] = d[t].filter((r) => r.user_id !== id); write(d); return { error: null }; },
        } },
        from: (table) => ({
            delete: () => ({ eq: async (col, v) => { calls.push(`delete:${table}`); const d = read(); d[table] = (d[table] ?? []).filter((r) => r[col] !== v); write(d); return { error: null }; } }),
            select: () => ({ eq: async (col, v) => { calls.push(`count:${table}`); return { count: (read()[table] ?? []).filter((r) => r[col] === v).length, error: null }; } }),
        }),
    } };
}

function setup(t, { preUsers = [] } = {}) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-entry-')));
    const checkout = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-entry-checkout-')));
    fs.chmodSync(root, 0o700);
    t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(checkout, { recursive: true, force: true }); });
    const driverFile = path.join(root, 'driver.cjs'), configFile = path.join(root, 'case.json'), admissionConfigFile = path.join(root, 'admission.json'),
        stepManifestFile = path.join(root, 'review.json'), runtimeQualification = path.join(root, 'runtime-qualification.json');
    const code = "module.exports=async()=>{throw Error('no step execution in this unit test')};module.exports.preflight=async()=>{};module.exports.contract={requiredOracles:[]};";
    fs.writeFileSync(driverFile, code, { mode: 0o600 });
    const deadline = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const cfg = { checkoutDir: checkout, campaignId: 'UNIT-NOT-A-RUN', sourceSha: sha, expectedServedSha: sha, identityCap: 18, approvedDeadlineAt: deadline,
        identityLedger: path.join(root, 'identity'), campaignLedger: path.join(root, 'ledger'), policyFile: path.join(root, 'policy.json'), securityApprovalFile: path.join(root, 'security.json') };
    fs.writeFileSync(cfg.policyFile, '{}'); fs.writeFileSync(cfg.securityApprovalFile, '{}');
    fs.writeFileSync(admissionConfigFile, JSON.stringify(cfg), { mode: 0o600 });
    fs.writeFileSync(stepManifestFile, JSON.stringify({ version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'UNIT ONLY not approval', reviewedAt: '2026-10-27T12:00:00Z', steps: [{ path: 'driver.cjs', sha256: hash(code), dependencies: [] }] }), { mode: 0o600 });
    const plan = { campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app/', identityCap: 18, deadlineAt: deadline,
        identityLedger: cfg.identityLedger, campaignLedger: cfg.campaignLedger, admissionConfigFile, admissionConfigSha256: hash(fs.readFileSync(admissionConfigFile)), stepRoot: root, stepManifestFile,
        stepManifestSha256: hash(fs.readFileSync(stepManifestFile)), runRoot: root, cleanupReserveMs: 1000, requestSha256: '1'.repeat(64), executionIdentity: { runId: RUN, attempt: 1 },
        consumedPlanSha256: '2'.repeat(64), runIdentity: { runner: { codeManifestSha256: hash(fs.readFileSync(path.join(B, 'CODE.sha256'))) }, frontend: { sourceSha: sha }, cases: {} } };
    fs.writeFileSync(configFile, JSON.stringify({ caseId: 'AHT-05', campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app', requiredAssertions: ['unit-not-live'], account: { mode: 'nightly-guarded-signup', emailDomain: 'example.com' } }), { mode: 0o600 });
    const c = { id: 'AHT-05', driverFile, driverSha256: hash(code), configFile, configSha256: hash(fs.readFileSync(configFile)), maxMs: 8000 };
    plan.cases = [c];
    const wireFile = path.join(root, 'wire.log'), dbFile = path.join(root, 'db.json');
    fs.writeFileSync(wireFile, '');
    fs.writeFileSync(dbFile, JSON.stringify({ users: [{ id: 'other-uid', email: 'someone@example.com' }, ...preUsers], sessions: [{ user_id: 'other-uid' }], active_recording_lease: [], trial_entitlements: [] }));
    const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + sha + '"};</script></html>';
    const commandRunner = async (node, args, options, deps) => {
        if (args[0].endsWith('admission.cjs')) {
            const out = args[args.indexOf('--out') + 1]; fs.mkdirSync(out, { recursive: true, mode: 0o700 });
            fs.writeFileSync(path.join(out, 'browser.json'), '{}', { mode: 0o600 }); fs.writeFileSync(runtimeQualification, '{}', { mode: 0o600 });
            const campaignLedgerIdentity = Ledger.initialize(plan.campaignLedger, { total: 500 });
            fs.writeFileSync(path.join(out, 'admission-receipt.json'), JSON.stringify({ result: 'ADMISSION PASS', runtimeQualificationReceipt: runtimeQualification, binding: { campaignLedgerIdentity } }), { mode: 0o600 });
            return { status: 0, stdout: '', stderr: '', cleanupIncomplete: false };
        }
        if (args[0].endsWith('identity-check.cjs')) {
            const at = (k) => args[args.indexOf(k) + 1];
            const r = runIdentity({ ledger: at('--ledger'), binding: { url: at('--url'), expectedSha: at('--expect-sha'), cap: Number(at('--cap')), phase: at('--phase') } },
                (_cmd, x) => { fs.writeFileSync(x[x.indexOf('--output') + 1], body); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body) }; });
            return { status: r.exitCode, stdout: JSON.stringify(r.receipt) + '\n', stderr: '', cleanupIncomplete: false };
        }
        assert.ok(args[0].endsWith(path.join('harness', 'run-guarded.cjs')));
        return supervisedCommand(node, [CHILD, ...args.slice(1)], options, { env: { ...deps.env, PATH: process.env.PATH, J4A_WIRE: wireFile, J4A_DB: dbFile, J4A_UID: UID, LIVE_TEST_EMAIL_DOMAIN: 'example.com' } });
    };
    const evidenceDir = path.join(root, 'evidence'); fs.mkdirSync(evidenceDir);
    const fa = fakeAdmin(dbFile);
    const composed = composeJ4aNightly({ plan, bundle: B, admin: fa.admin, configuredDomain: 'example.com', adapterOptions: { commandRunner },
        nightly: { runDir: path.join(root, 'nightly-run'), evidenceDir, runId: 'unit-entry-1', selected: ['J4.a'], satisfiedGates: [] } });
    const wire = () => fs.readFileSync(wireFile, 'utf8').trim().split('\n').filter(Boolean);
    const db = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    return { ...composed, plan, c, wire, db, calls: fa.calls };
}

async function runJ4a(s) {
    await s.io.preflightCase(s.c);
    const admission = await s.io.admit(s.plan);
    return s.io.runCase(s.c, s.plan, admission, {});
}

test('entry point: signup, parent-confirmed owner, Start in its grant, then parent teardown and zero residue for that owner', { timeout: 30_000 }, async (t) => {
    const s = setup(t);
    const ran = await runJ4a(s);
    assert.deepEqual(s.wire(), ['signup', 'signup:created', 'owner:confirmed-matches-page', 'start-click']);
    assert.equal(ran.j4aBinding.bound, true);
    assert.deepEqual(ran.j4aBinding.violations, []);
    assert.equal(ran.j4aBinding.teardownHold, null);
    assert.deepEqual(ran.nightlyCleanup.steps.map((x) => [x.action, x.outcome]), [['pre-delete-trial-entitlements', 'done'], ['delete', 'done'], ['prove-deleted', 'done']]);
    assert.deepEqual(ran.nightlyCleanup.verification, { kind: 'zero-residue', queries: ['account', 'session', 'lease'].map((kind) => ({ kind, scope: `rwt-journey-j4-${RUN}-1`, count: 0 })) });
    assert.deepEqual(s.db().users.map((u) => u.id), ['other-uid'], 'only the run-owned account was deleted');
    assert.deepEqual(s.db().sessions, [{ user_id: 'other-uid' }]);
    assert.ok(s.calls.includes('listUsers') && s.calls.includes('deleteUser'), 'the parent confirmation and teardown were reached');
});

test('entry point: an ambiguous reserved email (two accounts) is HOLD: no Start, no delete, no verification', { timeout: 30_000 }, async (t) => {
    const s = setup(t, { preUsers: [{ id: 'dup-uid', email: EMAIL }] });
    const ran = await runJ4a(s);
    assert.deepEqual(s.wire(), ['signup', 'signup:created', 'owner:hold']);
    assert.match(String(ran.j4aBinding.teardownHold), /ambiguous/);
    assert.equal(ran.nightlyCleanup.verification, undefined);
    assert.equal(s.calls.filter((x) => /^delete/.test(x)).length, 0, 'nothing deleted');
    assert.equal(s.db().users.length, 3);
});

test('entry point CLI refuses without explicit execution, inputs and the parent environment (nothing is built or run)', async () => {
    assert.equal((await main([], {})).exitCode, 78);
    assert.equal((await main(['--plan', 'p', '--bundle', 'b', '--evidence-dir', 'e', '--run-dir', 'r', '--run-id', 'x', '--execute', 'true'], {})).exitCode, 78);
});

// Sam (release boundary 2): the parent admin client is bound to the approved project (the reviewed save oracle's readback host) BEFORE it is
// built or any admin call is made. A wrong project makes zero client constructions and zero admin calls.
test('CLI: a wrong or lookalike project builds no admin client and makes no admin call; the approved one is the only target', async (t) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-cli-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const planFile = path.join(dir, 'plan.json'); fs.writeFileSync(planFile, JSON.stringify({ executionIdentity: { runId: RUN } }));
    const argv = ['--plan', planFile, '--bundle', B, '--evidence-dir', dir, '--run-dir', path.join(dir, 'run'), '--run-id', 'cli-1', '--execute', 'true'];
    const approved = require('../../harness/draft-adapters/durable-save-oracle.cjs').readbackContract.host;
    for (const url of ['https://abcdefghijklmnopqrst.supabase.co', `https://${approved}.evil.example`, `http://${approved}`, `https://${approved}:8443`,
        `https://user:pw@${approved}`, `https://${approved}/rest/v1`, `https://${approved}/?x=1`, 'not a url', '']) {
        let built = 0;
        const r = await main(argv, { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'unit-not-a-key', LIVE_TEST_EMAIL_DOMAIN: 'example.com' },
            { createClient: () => { built += 1; throw new Error('must not be built'); } });
        assert.equal(r.exitCode, 78, url);
        assert.equal(built, 0, `no admin client for ${url || '(empty)'}`);
    }
    // The approved origin is the only target the client is ever built for (stopped right there: nothing runs).
    let target = null;
    await assert.rejects(main(argv, { SUPABASE_URL: `https://${approved}/`, SUPABASE_SERVICE_ROLE_KEY: 'unit-not-a-key', LIVE_TEST_EMAIL_DOMAIN: 'example.com' },
        { createClient: (origin) => { target = origin; throw new Error('STOP_AFTER_BINDING'); } }), /STOP_AFTER_BINDING/);
    assert.equal(target, `https://${approved}`);
    assert.throws(() => approvedAdminOrigin(`https://${approved}`, 'not-a-project-host'), /not the approved project/);
});
