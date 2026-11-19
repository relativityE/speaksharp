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
const { approvedAdminOrigin, composeJ4aNightly, j4aAdminTransport, main } = require('../j4a-nightly-entry.cjs');

/**
 * TEST-ONLY save-journal cleanup capability (logic coverage, NOT cleanup proof): over the shared database file, every call one send
 * through the transport. The real capability is a separately reviewed change; production supplies none.
 */
function journalCapability(dbFile, transport, calls = []) {
    const read = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const write = (d) => fs.writeFileSync(dbFile, JSON.stringify(d));
    return { reviewed: 'UNIT ONLY - not a reviewed capability', bind: ({ runId, owner }) => Object.freeze({
        bound: { runId, owner },
        settle: async (uid) => { calls.push('journal:settle'); await transport.fetch('admin://journal'); const d = read(); for (const r of d.account_save_obligations ?? []) if (r.user_id === uid) r.phase = 'completed'; write(d); return { error: null }; },
        remove: async (uid) => { calls.push('journal:remove'); await transport.fetch('admin://journal'); const d = read(); d.account_save_obligations = (d.account_save_obligations ?? []).filter((r) => !(r.user_id === uid && r.phase === 'completed')); write(d); return { error: null }; },
        readBack: async (uid) => { calls.push('journal:readBack'); await transport.fetch('admin://journal'); return { count: (read().account_save_obligations ?? []).filter((r) => r.user_id === uid).length, error: null }; },
    }) };
}
const { offlineWriterProof } = require('./fixtures/j4a-writer-proof.cjs');
const CHILD = path.join(__dirname, 'fixtures', 'j4a-entry-child.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha = 'b'.repeat(40);
const RUN = '41325698722';
const EMAIL = `rwt-journey-j4-${RUN}-1@example.com`;
const UID = '11111111-1111-4111-8111-111111111111';

/** The parent's admin client over the shared database file; every call is counted and is one send through the REAL bounded transport. */
function fakeAdmin(dbFile, transport) {
    const calls = [];
    const send = (name) => transport.fetch(`admin://${name}`);
    const read = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const write = (d) => fs.writeFileSync(dbFile, JSON.stringify(d));
    const notFound = { status: 404, code: 'user_not_found', message: 'User not found' };
    return { calls, admin: {
        auth: { admin: {
            listUsers: async ({ page, perPage }) => { calls.push('listUsers'); await send('listUsers'); return { data: { users: read().users.slice((page - 1) * perPage, page * perPage) }, error: null }; },
            getUserById: async (id) => { calls.push('getUserById'); await send('getUserById'); const u = read().users.find((x) => x.id === id); return u ? { data: { user: { email: u.email } }, error: null } : { data: { user: null }, error: notFound }; },
            deleteUser: async (id) => { calls.push('deleteUser'); await send('deleteUser'); const d = read(); d.users = d.users.filter((u) => u.id !== id); for (const t of Object.keys(d)) if (t !== 'users' && t !== 'trial_entitlements' && t !== 'account_save_obligations') d[t] = d[t].filter((r) => r.user_id !== id && r.id !== id); write(d); return { error: null }; },
        } },
        from: (table) => ({
            delete: () => ({ eq: async (col, v) => { calls.push(`delete:${table}`); await send('delete'); const d = read(); d[table] = (d[table] ?? []).filter((r) => r[col] !== v); write(d); return { error: null }; } }),
            select: (_cols, opts) => ({ eq: async (col, v) => { calls.push(`count:${table}`); await send('select');
                if (table === 'account_save_obligations') return { data: null, count: null, error: { code: '42501', message: 'permission denied' } }; const rows = (read()[table] ?? []).filter((r) => r[col] === v); return opts?.head ? { count: rows.length, error: null } : { data: rows, error: null }; } }),
        }),
    } };
}

function setup(t, { preUsers = [], caseExtra = {}, journal = true, writerProof = true, forcedClose = false, forcedDescendants = false, protocolViolation = false } = {}) {
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
    fs.writeFileSync(configFile, JSON.stringify({ caseId: 'AHT-05', campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app', requiredAssertions: ['unit-not-live'], account: { mode: 'nightly-guarded-signup', emailDomain: 'example.com' }, ...caseExtra }), { mode: 0o600 });
    const c = { id: 'AHT-05', driverFile, driverSha256: hash(code), configFile, configSha256: hash(fs.readFileSync(configFile)), maxMs: 8000 };
    plan.cases = [c];
    plan.selection = { ids: ['AHT-05'], ownerApprovalReference: 'unit-offline-proof-not-a-run', reason: 'J4.a entry offline proof' };
    const wireFile = path.join(root, 'wire.log'), dbFile = path.join(root, 'db.json');
    fs.writeFileSync(wireFile, '');
    fs.writeFileSync(dbFile, JSON.stringify({ users: [{ id: 'other-uid', email: 'someone@example.com' }, ...preUsers], sessions: [{ user_id: 'other-uid' }], active_recording_lease: [], trial_entitlements: [] }));
    const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + sha + '"};</script></html>';
    const envs = [];
    const commandRunner = async (node, args, options, deps) => {
        if (!args[0].endsWith(path.join('harness', 'run-guarded.cjs'))) envs.push({ kind: path.basename(args[0]), env: { ...(deps?.env ?? {}) } });
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
        envs.push({ kind: 'case', env: { ...(deps?.env ?? {}) } });
        const r = await supervisedCommand(node, [CHILD, ...args.slice(1)], options, { env: { ...deps.env, PATH: process.env.PATH, J4A_WIRE: wireFile, J4A_DB: dbFile, J4A_UID: UID, J4A_FAKE_VIOLATION: protocolViolation ? '1' : '0', J4A_FAKE_KILLED: forcedDescendants ? '1' : '0' } });
        return forcedClose ? { ...r, reason: 'command-deadline' } : r;
    };
    const evidenceDir = path.join(root, 'evidence'); fs.mkdirSync(evidenceDir);
    const transport = j4aAdminTransport(async () => ({}));
    const fa = fakeAdmin(dbFile, transport);
    const saveJournal = journal ? journalCapability(dbFile, transport, fa.calls) : undefined;
    const composed = composeJ4aNightly({ plan, bundle: B, admin: fa.admin, transport, saveJournal, configuredDomain: 'example.com', adapterOptions: { commandRunner }, offlineStoppedWritersVerifier: writerProof ? offlineWriterProof : null,
        nightly: { runDir: path.join(root, 'nightly-run'), evidenceDir, runId: 'unit-entry-1', selected: ['J4.a'], satisfiedGates: [] } });
    const wire = () => fs.readFileSync(wireFile, 'utf8').trim().split('\n').filter(Boolean);
    const db = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    return { ...composed, plan, c, wire, db, calls: fa.calls, envs, root, transport };
}

async function runJ4a(s) {
    await s.io.preflightCase(s.c);
    const admission = await s.io.admit(s.plan);
    return s.io.runCase(s.c, s.plan, admission, {});
}

const PARENT_SECRET = 'unit-parent-only-service-role-value';
function withParentSecret(t) {
    const saved = { k: process.env.SUPABASE_SERVICE_ROLE_KEY, d: process.env.LIVE_TEST_EMAIL_DOMAIN };
    process.env.SUPABASE_SERVICE_ROLE_KEY = PARENT_SECRET; process.env.LIVE_TEST_EMAIL_DOMAIN = 'example.com';
    t.after(() => { for (const [name, v] of [['SUPABASE_SERVICE_ROLE_KEY', saved.k], ['LIVE_TEST_EMAIL_DOMAIN', saved.d]]) { if (v === undefined) delete process.env[name]; else process.env[name] = v; } });
}
test('entry point: signup, parent-confirmed owner, Start in its grant, then parent teardown (journal settled, removed, read back) and zero residue', { timeout: 30_000 }, async (t) => {
    withParentSecret(t);
    const s = setup(t);
    const ran = await runJ4a(s);
    assert.deepEqual(s.wire(), ['signup', 'signup:created', 'owner:confirmed-matches-page', 'start-click']);
    assert.equal(ran.j4aBinding.bound, true);
    assert.deepEqual(ran.j4aBinding.violations, []);
    assert.equal(ran.j4aBinding.teardownHold, null);
    assert.deepEqual(ran.nightlyCleanup.steps.map((x) => [x.action, x.outcome]),
        [['settle-save-journal', 'done'], ['pre-delete-trial-entitlements', 'done'], ['delete', 'done'], ['prove-deleted', 'done'], ['remove-save-journal', 'done']]);
    const stores = require('../residue-inventory.cjs').j4aRequiredStores();
    assert.deepEqual(ran.nightlyCleanup.verification.queries.map((q) => q.store), stores.map((x) => x.id), 'one scoped read per required store');
    assert.ok(ran.nightlyCleanup.verification.queries.every((q) => q.count === 0 && q.scope === `rwt-journey-j4-${RUN}-1`));
    assert.deepEqual(s.db().users.map((u) => u.id), ['other-uid'], 'only the run-owned account was deleted');
    assert.deepEqual(s.db().sessions, [{ user_id: 'other-uid' }]);
    assert.deepEqual(s.db().account_save_obligations, [], 'the completed journal row that survived the Auth delete was removed by the journal path');
    assert.ok(!s.calls.includes('count:account_save_obligations'), 'never a service-role read of the journal');
    // Every admin call (the test-only journal included) went through the bounded transport, each phase on its own allowance:
    // bind = one lookup page + the re-read; teardown = re-read, takes, leases, settle, trial pre-delete, delete, proof, remove, then
    // one read per required store (the journal's by its own read-back).
    assert.deepEqual(s.transport.sent(), { bind: 2, teardown: 8 + stores.length });
    assert.equal(s.calls.length, 2 + 8 + stores.length, 'no admin call bypassed the transport');
    // Sam: the child gets the validated non-secret domain explicitly; the parent-only key reaches NO subprocess (admission, identity, case).
    // Every subprocess this path starts (admission and the case; identity reads belong to runCampaign) is checked.
    assert.deepEqual([...new Set(s.envs.map((e) => e.kind))].sort(), ['admission.cjs', 'case']);
    assert.equal(s.envs.find((e) => e.kind === 'case').env.LIVE_TEST_EMAIL_DOMAIN, 'example.com');
    for (const e of s.envs) {
        assert.equal(e.env.SUPABASE_SERVICE_ROLE_KEY, undefined, `${e.kind} env carries no service-role key`);
        assert.ok(!Object.values(e.env).includes(PARENT_SECRET), `${e.kind} env carries the secret under no name`);
    }
});

test('entry point: an ambiguous reserved email (two accounts) is HOLD: no Start, no delete, no verification', { timeout: 30_000 }, async (t) => {
    const s = setup(t, { preUsers: [{ id: 'dup-uid', email: EMAIL }] });
    const ran = await runJ4a(s);
    assert.deepEqual(s.wire(), ['signup', 'signup:created', 'owner:hold']);
    // The bind-time lookup was ambiguous, so no owner was preserved; teardown then refuses to guess whom to delete.
    assert.match(String(ran.j4aBinding.teardownHold), /no owner was preserved/);
    assert.equal(ran.nightlyCleanup.verification, undefined);
    assert.equal(s.calls.filter((x) => /^delete/.test(x)).length, 0, 'nothing deleted');
    assert.equal(s.db().users.length, 3);
});

test('entry point refuses absent stopped evidence, a forced close or an IPC violation before invoking teardown', { timeout: 30_000 }, async (t) => {
    for (const [setupOpts, why] of [
        [{ writerProof: false }, /no verified stopped-writer evidence/],
        [{ forcedClose: true }, /did not complete a clean supervised close/],
        [{ forcedDescendants: true }, /did not complete a clean supervised close/],
        [{ protocolViolation: true }, /binding is absent, refused or violated/],
    ]) {
        const s = setup(t, setupOpts);
        const ran = await runJ4a(s);
        assert.deepEqual(s.transport.sent(), { bind: 2, teardown: 0 });
        assert.match(ran.j4aBinding.teardownHold, why);
        assert.equal(ran.nightlyCleanup.verification, undefined);
        assert.ok(s.db().users.some((u) => u.id === UID));
        assert.ok(!s.calls.some((c) => /delete|journal:/.test(c)));
    }
});

test('guarded-signup mode refuses a case config that names credential variables, before admission', { timeout: 30_000 }, async (t) => {
    const s = setup(t, { caseExtra: { credentialVars: { email: 'THROWAWAY_TEST_EMAIL', password: 'THROWAWAY_TEST_PASSWORD' } } });
    await assert.rejects(s.io.preflightCase(s.c), /must not name credential variables/);
});

// Sam (seal review of dc7a5ccb): the CLI uses the campaign runner's own admission path (pinned plan bytes, fixed bundle, validated paths,
// no-replay lock) and the approved admin target; every refusal happens before any admin client is built.
function pinnedPlan(t, mutate = (p) => p) {
    const s = setup(t);
    const bytes = Buffer.from(JSON.stringify(mutate(JSON.parse(JSON.stringify(s.plan)))));
    const file = path.join(s.root, 'plan.json'); fs.writeFileSync(file, bytes, { mode: 0o600 });
    return { s, file, digest: crypto.createHash('sha256').update(bytes).digest('hex') };
}
const cliArgs = (file, digest, extra = []) => ['--plan', file, '--plan-sha256', digest, '--evidence-dir', path.join(path.dirname(file), 'evidence'),
    '--run-dir', path.join(path.dirname(file), 'cli-run'), '--run-id', 'cli-1', '--execute', 'true', ...extra];
const parentEnv = (url) => ({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'unit-not-a-key', LIVE_TEST_EMAIL_DOMAIN: 'example.com' });
const APPROVED = require('../../harness/draft-adapters/durable-save-oracle.cjs').readbackContract.host;

const servedRelease = (sha) => ({
    releaseFetch: async () => new Response('<script>window.__APP_RELEASE__="' + sha + '";</script>'),
    readReleaseGitHub: async () => ({ status: 'ahead', behind_by: 0, base_commit: { sha } }),
});

test('CLI: a different or unreadable production marker refuses before building an admin client', async (t) => {
    for (const marker of ['f'.repeat(40), 'not-a-release']) {
        const p = pinnedPlan(t);
        let built = 0;
        const r = await main(cliArgs(p.file, p.digest), parentEnv(`https://${APPROVED}`), {
            ...servedRelease(marker), saveJournal: journalCapability('/nonexistent', null),
            createClient: () => { built += 1; throw new Error('must not build'); },
        });
        assert.equal(r.exitCode, 78);
        assert.match(r.reason, /live production release/);
        assert.equal(built, 0);
        assert.equal(fs.existsSync(path.join(p.s.root, '.campaign.lock')), false);
    }
});

test('CLI: altered plan bytes, another case, an alternate bundle, missing inputs or a wrong project build no admin client', { timeout: 30_000 }, async (t) => {
    const cases = [];
    { const p = pinnedPlan(t); cases.push(['altered plan bytes', cliArgs(p.file, 'f'.repeat(64)), APPROVED]); }
    { const p = pinnedPlan(t, (x) => ({ ...x, selection: { ...x.selection, ids: ['AHT-06'] } })); cases.push(['another case', cliArgs(p.file, p.digest), APPROVED]); }
    { const p = pinnedPlan(t); cases.push(['alternate bundle', cliArgs(p.file, p.digest, ['--bundle', '/tmp/other-bundle']), APPROVED]); }
    { const p = pinnedPlan(t); cases.push(['no execute', cliArgs(p.file, p.digest).slice(0, -2), APPROVED]); }
    for (const url of ['https://abcdefghijklmnopqrst.supabase.co', `https://${APPROVED}.evil.example`, `http://${APPROVED}`, `https://${APPROVED}:8443`,
        `https://user:pw@${APPROVED}`, `https://${APPROVED}/rest/v1`, `https://${APPROVED}/?x=1`, 'not a url']) {
        const p = pinnedPlan(t); cases.push([`wrong project ${url}`, cliArgs(p.file, p.digest), url]);
    }
    for (const [name, argv, host] of cases) {
        let built = 0;
        const r = await main(argv, parentEnv(host.includes('://') || host === 'not a url' ? host : `https://${host}`), { createClient: () => { built += 1; throw new Error('must not be built'); } });
        assert.equal(r.exitCode, 78, name);
        assert.equal(built, 0, `no admin client: ${name}`);
        const runRoot = path.dirname(argv[1]);
        assert.equal(fs.existsSync(path.join(runRoot, '.campaign.lock')), false, `lock released: ${name}`);
    }
    assert.equal((await main([], {})).exitCode, 78);
});

test('CLI: the pinned J4.a-only plan and the approved project reach the admin client, built for that origin only', { timeout: 30_000 }, async (t) => {
    const p = pinnedPlan(t);
    let target = null;
    await assert.rejects(main(cliArgs(p.file, p.digest), parentEnv(`https://${APPROVED}/`),
        { ...servedRelease(p.s.plan.servedSha), saveJournal: journalCapability('/nonexistent', null), createClient: (origin) => { target = origin; throw new Error('STOP_AFTER_BINDING'); } }), /STOP_AFTER_BINDING/);
    assert.equal(target, `https://${APPROVED}`);
    assert.equal(fs.existsSync(path.join(p.s.root, '.campaign.lock')), false, 'lock released after the stop');
    assert.throws(() => approvedAdminOrigin(`https://${APPROVED}`, 'not-a-project-host'), /not the approved project/);
});

test('the parent hooks refuse to exist without the bounded transport; teardown\'s window is exactly the J4 cleanup reserve', () => {
    const { j4aParentHooks, teardownWindowMs } = require('../j4a-nightly-entry.cjs');
    const { cleanupReserve, CLEANUP_REQUEST_DEADLINE_S } = require('../cleanup-plan.cjs');
    const admin = { from: () => ({}), auth: { admin: { listUsers: async () => ({}) } } };
    const saveJournal = journalCapability('/nonexistent', null);
    for (const transport of [undefined, null, {}, { setPhase() {}, remaining() {} }])
        assert.throws(() => j4aParentHooks({ admin, transport, saveJournal, evidenceDir: '/x', recordRunId: 'r', emailRunId: 'e', configuredDomain: 'example.com' }), /bounded transport/);
    for (const cap of [undefined, null, {}, { bind() {} }, { reviewed: ' ', bind() {} }])
        assert.throws(() => j4aParentHooks({ admin, transport: j4aAdminTransport(async () => ({})), saveJournal: cap, evidenceDir: '/x', recordRunId: 'r', emailRunId: 'e', configuredDomain: 'example.com' }),
            /no reviewed save-journal cleanup capability/);
    assert.equal(teardownWindowMs(), cleanupReserve('J4').requests * CLEANUP_REQUEST_DEADLINE_S * 1000);
    assert.equal(j4aAdminTransport(async () => ({})).remaining('teardown'), cleanupReserve('J4').requests);
});

test('ADMISSION CONTROL (Sam, 17 Nov): with no save-journal cleanup capability the pilot is HOLD before anything: zero locks, admin clients, admin sends, browser launches or signups', { timeout: 30_000 }, async (t) => {
    const counts = { lock: 0, clientBuilt: 0, adminSends: 0, launches: 0 };
    const deps = (saveJournal) => ({ saveJournal,
        createClient: () => { counts.clientBuilt += 1; throw new Error('STOP_AFTER_BINDING'); },
        fetchImpl: async () => { counts.adminSends += 1; return {}; },
        adapterOptions: { commandRunner: () => { counts.launches += 1; throw new Error('must not launch'); } } });
    for (const missing of [undefined, null, {}, { reviewed: 'x' }, { bind() {} }]) {
        const p = pinnedPlan(t);
        const r = await main(cliArgs(p.file, p.digest), parentEnv(`https://${APPROVED}`), deps(missing));
        assert.equal(r.exitCode, 78);
        assert.match(r.reason, /^HOLD: no reviewed save-journal cleanup capability/);
        assert.equal(fs.existsSync(path.join(p.s.root, '.campaign.lock')), false);
        assert.equal(fs.existsSync(path.join(p.s.root, 'cli-run')), false, 'no run directory, so no nightly admission or send record');
        assert.equal(fs.existsSync(path.join(p.s.root, 'evidence', 'J4')), false, 'no durable create record, so no signup was attempted');
    }
    assert.deepEqual(counts, { lock: 0, clientBuilt: 0, adminSends: 0, launches: 0 });
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'j4a-nightly-entry.cjs'), 'utf8').includes('saveJournal: journalCapability'), 'the production entry supplies no capability');
    // CONTRAST: the same inputs WITH a capability get past admission to the admin-client binding, so the capability is what stopped it.
    const p = pinnedPlan(t);
    await assert.rejects(main(cliArgs(p.file, p.digest), parentEnv(`https://${APPROVED}`), { ...deps(journalCapability('/nonexistent', null)), ...servedRelease(p.s.plan.servedSha) }), /STOP_AFTER_BINDING/);
    assert.equal(counts.clientBuilt, 1);
});

test('composition refuses without the capability (defense in depth): no adapter, so nothing can run', { timeout: 30_000 }, async (t) => {
    assert.throws(() => setup(t, { journal: false }), /no reviewed save-journal cleanup capability/);
});
