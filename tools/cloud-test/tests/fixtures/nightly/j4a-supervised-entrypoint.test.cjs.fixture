'use strict';
// #1884: the REAL supervisor entry point (run-guarded.cjs) refuses an unbound J4.a child BEFORE any browser launch, with exit 78.
// The repository seal is not changed: each test runs run-guarded from a temporary copy of the bundle whose CODE.sha256 is
// regenerated in the copy (assertSecurityApproval verifies the copy's own manifest), under the existing local-fixture qualification
// admission (loopback fixture policy, a UNIT-ONLY approval record scoped to that copy, a reviewed step manifest). The approval
// record is a test fixture for the temporary copy only; it approves nothing real. Offline: no browser, network or production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { attachParentChannel } = require('../j4a-supervised-channel.cjs');
const { beginBinding } = require('../j4a-supervised-binding.cjs');

const CT = path.join(__dirname, '..', '..');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha = 'b'.repeat(40);
const write = (file, value) => { fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); return file; };

/** A temporary copy of the bundle (plus the two nightly modules it requires) with its own regenerated CODE.sha256. */
function bundleCopy(root) {
    const ct = path.join(root, 'ct');
    fs.cpSync(path.join(CT, 'harness', 'bundle'), path.join(ct, 'harness', 'bundle'), { recursive: true });
    fs.mkdirSync(path.join(ct, 'nightly'));
    for (const f of ['j4a-supervised-channel.cjs', 'j4a-supervised-binding.cjs']) fs.copyFileSync(path.join(CT, 'nightly', f), path.join(ct, 'nightly', f));
    const b = path.join(ct, 'harness', 'bundle');
    const lines = fs.readFileSync(path.join(b, 'CODE.sha256'), 'utf8').trim().split('\n')
        .map((l) => { const rel = l.slice(66); return `${hash(fs.readFileSync(path.join(b, rel)))}  ${rel}`; });
    fs.writeFileSync(path.join(b, 'CODE.sha256'), `${lines.join('\n')}\n`);
    return b;
}

function fixture(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-entrypoint-')));
    fs.chmodSync(root, 0o700);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const bundle = bundleCopy(root);
    const w = path.join(root, 'w'); fs.mkdirSync(w, { mode: 0o700 });
    const steps = path.join(w, 'steps'); fs.mkdirSync(steps, { mode: 0o700 });
    const now = Date.now();
    const policy = write(path.join(w, 'policy.json'), { version: 1, testOnly: true, sourceSha: 'a'.repeat(40),
        hosts: { 'a.test': { port: 443, rules: [{ id: 'fixture', methods: ['GET'], path: '^/.*$', cap: 'public', reviewedSourceSha: 'a'.repeat(40) }] } },
        caps: { total: 10, navigations: 10, public: 10 }, maxInFlight: 2, queueWaitMs: 100, requestTimeoutMs: 100,
        deadlineAt: new Date(now + 3_600_000).toISOString(), upstream: { mode: 'override', override: { 'a.test': '127.0.0.1:54321' } } });
    const approval = write(path.join(w, 'approval.json'), { version: 1, runtime: 'Claude SpeakSharp R4', action: 'ephemeral-browser-spki-exception',
        ownerApprovalReference: 'UNIT-ONLY-temporary-bundle-copy', approvedBy: 'UNIT ONLY not approval', approvalSource: 'explicit-user-message',
        reviewedCodeManifestSha256: hash(fs.readFileSync(path.join(bundle, 'CODE.sha256'))), notBefore: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(), allowedHosts: ['a.test'], installTrustRoot: false, globalCertificateBypass: false, environmentSecurityChanges: false });
    const code = "module.exports=async()=>{throw Error('no step execution in this unit test')};module.exports.preflight=async()=>{};";
    const driver = write(path.join(steps, 'driver.cjs'), code);
    const manifest = write(path.join(steps, 'review.json'), { version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'UNIT ONLY not approval',
        reviewedAt: new Date(now - 60_000).toISOString(), steps: [{ path: 'driver.cjs', sha256: hash(code), dependencies: [] }] });
    const caseFile = write(path.join(w, 'case.json'), { caseId: 'AHT-05', campaignId: 'UNIT-NOT-A-RUN', sourceSha: sha, servedSha: sha,
        targetUrl: 'https://speaksharp-public.vercel.app', requiredAssertions: ['unit-not-live'], credentialVars: { email: 'THROWAWAY_TEST_EMAIL', password: 'THROWAWAY_TEST_PASSWORD' } });
    const identity = { campaignId: 'UNIT-NOT-A-RUN', runId: '41325698722', attempt: 1, caseId: 'AHT-05', requestSha256: '1'.repeat(64),
        planSha256: '2'.repeat(64), configSha256: hash(fs.readFileSync(caseFile)), sourceSha: sha, servedSha: sha };
    const runtimeStart = write(path.join(w, 'runtime-start.json'), { schema: 'speaksharp.cloud-test.runtime-start-consumption.v1', consumer: 'runtime-start',
        ...identity, consumedAtUtc: new Date(now).toISOString() });
    const runDir = path.join(w, 'run');
    const args = [path.join(bundle, 'harness', 'run-guarded.cjs'), '--browser', write(path.join(w, 'browser.json'), '{}'), '--policy', policy,
        '--qualification-local-only', 'true', '--security-approval', approval, '--campaign-id', identity.campaignId,
        '--step-root', steps, '--step-manifest', manifest, '--step-manifest-sha256', hash(fs.readFileSync(manifest)), '--script', driver,
        '--case-config', caseFile, '--case-config-sha256', identity.configSha256, '--run-dir', runDir, '--ledger', path.join(w, 'ledger'), '--max-ms', '20000',
        '--j4a-binding', 'true', '--runtime-start', runtimeStart, '--runtime-start-sha256', hash(fs.readFileSync(runtimeStart))];
    return { args, identity, runtimeStart, runDir };
}

/** Runs the real supervisor; `parent` decides what the parent end does with the IPC channel (null: spawned with no IPC at all). */
const PRELOAD = fs.existsSync('/proc') ? [] : ['--require', path.join(__dirname, 'fixtures', 'no-proc-shim.cjs')];
async function supervise(t, f, parent, extraArgs = []) {
    const child = spawn(process.execPath, [...PRELOAD, ...f.args, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe', ...(parent ? ['ipc'] : [])], env: { PATH: process.env.PATH } });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const calls = [];
    const nightly = new Proxy({}, { get: (_t, k) => (...x) => { calls.push(String(k)); return x[x.length - 1]?.(); } });
    const channel = parent ? parent(child, nightly) : null;
    const code = await new Promise((r) => child.on('exit', (c) => r(c)));
    const read = (n) => { try { return fs.readFileSync(path.join(f.runDir, n), 'utf8'); } catch { return null; } };
    const summary = JSON.parse(read('summary.json') ?? 'null');
    return { code, stderr, calls, summary, log: read('step.log') ?? '', outcome: channel ? await channel.outcome() : null };
}
const honest = (f) => (child, nightly) => attachParentChannel({ port: child, identity: f.identity, nightly });

function assertRefusedBeforeLaunch(r, why) {
    assert.equal(r.code, 78, r.stderr);
    assert.equal(r.summary?.reason, 'binding-refused', 'refused by the binding step, not by admission');
    assert.match(r.log, new RegExp(`j4a binding refused: ${why}`));
    assert.doesNotMatch(r.log, /j4a binding accepted|step completed/);
    assert.equal(r.summary.guard, undefined, 'no guard/browser was ever launched');
    assert.deepEqual(r.calls, [], 'nothing reached the nightly routes');
}

test('control: an honest parent binds, and the supervisor proceeds past the binding (stopping before launch on a missing oracle file)', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    const r = await supervise(t, f, honest(f), ['--oracle-config', path.join(path.dirname(f.runDir), 'absent-oracle.json')]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.log, /j4a binding accepted/);
    assert.equal(r.summary.reason, 'step-error');
    assert.equal(r.summary.guard, undefined);
    assert.match(r.outcome.digest, /^[a-f0-9]{64}$/);
});

test('entry point: a parent offering a different served release is refused before launch (exit 78)', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    const r = await supervise(t, f, (child, nightly) => attachParentChannel({ port: child, identity: { ...f.identity, servedSha: 'c'.repeat(40) }, nightly }));
    assertRefusedBeforeLaunch(r, 'J4A_BINDING_REJECTED');
    assert.equal(r.outcome.digest, null);
});

test('entry point: a runtime-start receipt changed after its hash was pinned is refused before launch (exit 78)', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.runtimeStart, JSON.stringify({ ...JSON.parse(fs.readFileSync(f.runtimeStart, 'utf8')), runId: '99999999999' }));
    assertRefusedBeforeLaunch(await supervise(t, f, honest(f)), 'J4A_BINDING_REFUSED');
});

test('entry point: no IPC channel at all is refused before launch (exit 78), never an unbound fall-through', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    assertRefusedBeforeLaunch(await supervise(t, f, null), 'J4A_BINDING_REFUSED');
});

test('entry point: a parent that disconnects before offering is refused before launch (exit 78)', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    assertRefusedBeforeLaunch(await supervise(t, f, (child) => { child.disconnect(); return null; }), 'J4A_CHANNEL_CLOSED');
});

// Sam (release boundary 1, seal review of 28ceb3bb): sending the acknowledgement is not enough. The child launches only on the parent's
// explicit confirmation of the same digest. A parent that rejects, confirms another digest, or never confirms stops it before launch.
const parentThat = (f, onAck) => (child) => {
    const binding = beginBinding(f.identity);
    child.on('message', (m) => { if (m?.t === 'ack') onAck(child, binding, m.ack); });
    child.send({ t: 'offer', offer: binding.offer });
    return null;
};
test('entry point: a parent that explicitly rejects the acknowledgement stops the child before launch (exit 78)', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    assertRefusedBeforeLaunch(await supervise(t, f, parentThat(f, (child) => child.send({ t: 'rejected' }))), 'J4A_BINDING_REJECTED');
});
test('entry point: a parent that confirms a DIFFERENT digest stops the child before launch (exit 78)', { timeout: 30_000 }, async (t) => {
    const f = fixture(t);
    assertRefusedBeforeLaunch(await supervise(t, f, parentThat(f, (child) => child.send({ t: 'bound', digest: 'f'.repeat(64) }))), 'J4A_BINDING_REJECTED');
});
test('entry point: a parent that takes the acknowledgement but never confirms stops the child before launch (exit 78)', { timeout: 40_000 }, async (t) => {
    const f = fixture(t);
    assertRefusedBeforeLaunch(await supervise(t, f, parentThat(f, () => {})), 'J4A_CHANNEL_CLOSED');
});
