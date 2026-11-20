// Deterministic controls for scripts/ci/install-supabase-cli.mjs, the bounded installer that replaces the unbounded
// `supabase/setup-cli@v2` step in .github/workflows/account-closure-full-chain-proof.yml. No real network: a local HTTP
// server serves a fake CLI archive and can stall (headers and part of the body, then silence), fail with 5xx/404, or
// serve the wrong bytes. The workflow policy test proves the current unbounded setup path fails the bound, and that the
// proof steps cannot run unless the bounded installer succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installSupabaseCli, downloadOnce, SUPABASE_CLI, DEFAULT_LIMITS } from '../../scripts/ci/install-supabase-cli.mjs';

const VERSION = '9.9.9';
const LIMITS = { attempts: 3, attemptTimeoutMs: 2_000, stallTimeoutMs: 150, backoffMs: 0 };

/** A fake CLI archive: `supabase --version` prints VERSION; a sibling `supabase-go` is extracted too. */
function fakeArchive() {
    const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'));
    writeFileSync(join(dir, 'supabase'), `#!/bin/sh\necho ${VERSION}\n`);
    writeFileSync(join(dir, 'supabase-go'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(dir, 'supabase'), 0o755);
    chmodSync(join(dir, 'supabase-go'), 0o755);
    const archive = join(dir, 'cli.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', dir, 'supabase', 'supabase-go']);
    const bytes = readFileSync(archive);
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const ARCHIVE = fakeArchive();

/** Serve one behaviour per request, in order; the last repeats. Records the request count. */
async function server(behaviours) {
    let n = 0;
    const open = new Set();
    const srv = http.createServer((req, res) => {
        const behaviour = behaviours[Math.min(n, behaviours.length - 1)];
        n += 1;
        open.add(res);
        res.on('close', () => open.delete(res));
        if (behaviour === 'ok') { res.writeHead(200, { 'content-length': ARCHIVE.bytes.length }); res.end(ARCHIVE.bytes); return; }
        if (behaviour === 'stall') { res.writeHead(200, { 'content-length': ARCHIVE.bytes.length }); res.write(ARCHIVE.bytes.subarray(0, 64)); return; }
        if (behaviour === 'wrong') { res.writeHead(200); res.end(Buffer.from('not the pinned archive')); return; }
        if (behaviour === 'stall503') { res.writeHead(503, { 'content-length': 1000 }); res.write('partial error body'); return; }
        res.writeHead(behaviour); res.end();
    });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${srv.address().port}/cli.tar.gz`;
    return { url, requests: () => n, openResponses: () => open.size,
        close: () => { for (const r of open) r.destroy(); return new Promise((resolve) => srv.close(resolve)); } };
}
const install = (url, overrides = {}) => installSupabaseCli({ url, sha256: ARCHIVE.sha256, version: VERSION,
    destDir: mkdtempSync(join(tmpdir(), 'cli-dest-')), limits: LIMITS, ...overrides });

test('a clean download installs the exact pinned CLI and reports its version', async () => {
    const s = await server(['ok']);
    try {
        const dir = await install(s.url);
        assert.equal(execFileSync(join(dir, 'supabase'), ['--version'], { encoding: 'utf8' }).trim(), VERSION);
        assert.equal(s.requests(), 1);
    } finally { await s.close(); }
});

test('a stalled download is aborted by the no-progress deadline (it does not wait for the job limit)', async () => {
    const s = await server(['stall']);
    try {
        const started = Date.now();
        await assert.rejects(downloadOnce(s.url, LIMITS), (e) => e.transient === true && /stalled: no bytes for 150 ms/.test(e.message));
        assert.ok(Date.now() - started < 1_500, 'aborted well inside the attempt deadline');
    } finally { await s.close(); }
});

test('CONTROL: the same stall leaves an unbounded download (the previous setup path) still waiting', async () => {
    const s = await server(['stall']);
    try {
        const unbounded = fetch(s.url).then(async (r) => { for await (const _chunk of r.body) { /* drain */ } return 'finished'; }).catch(() => 'aborted');
        const outcome = await Promise.race([unbounded, new Promise((resolve) => setTimeout(() => resolve('still waiting'), 1_000))]);
        assert.equal(outcome, 'still waiting');                   // nothing bounds it: on CI it ran until the 30-minute job limit
    } finally { await s.close(); }
});

test('stall then recover: a transient stall is retried and the clean retry installs', async () => {
    const s = await server(['stall', 'ok']);
    try {
        const dir = await install(s.url);
        assert.equal(execFileSync(join(dir, 'supabase'), ['--version'], { encoding: 'utf8' }).trim(), VERSION);
        assert.equal(s.requests(), 2);
    } finally { await s.close(); }
});

test('a persistent stall fails explicitly after the bounded attempts, within the bound', async () => {
    const s = await server(['stall']);
    try {
        const started = Date.now();
        await assert.rejects(install(s.url), /not installed after 3 attempt\(s\): download stalled/);
        assert.equal(s.requests(), 3);
        assert.ok(Date.now() - started < 3 * LIMITS.attemptTimeoutMs, 'never longer than the attempts allow');
    } finally { await s.close(); }
});

test('HTTP 5xx is retried; 404 is not (it cannot succeed on a retry)', async () => {
    const recovering = await server([503, 'ok']);
    try { await install(recovering.url); assert.equal(recovering.requests(), 2); } finally { await recovering.close(); }
    const missing = await server([404]);
    try {
        await assert.rejects(install(missing.url), /after 1 attempt\(s\): HTTP 404/);
        assert.equal(missing.requests(), 1);
    } finally { await missing.close(); }
});

test('Codex P2: a 5xx whose error body stalls is cancelled before the retry (no request left open to hold the step)', async () => {
    const s = await server(['stall503', 'ok']);
    try {
        await install(s.url);
        assert.equal(s.requests(), 2);
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(s.openResponses(), 0, 'the stalled 503 response was cancelled, not left streaming');
    } finally { await s.close(); }
});

test('bytes that do not match the pinned digest are refused, never retried into acceptance', async () => {
    const s = await server(['wrong', 'ok']);
    try {
        await assert.rejects(install(s.url), /does not match the pinned/);
        assert.equal(s.requests(), 1);
    } finally { await s.close(); }
});

test('a binary reporting another version is refused', async () => {
    const s = await server(['ok']);
    try { await assert.rejects(install(s.url, { version: '2.101.0' }), /reports "9.9.9", pinned 2.101.0/); } finally { await s.close(); }
});

test('the production pin and limits: exact version, digest and URL; the worst case fits inside the step bound', () => {
    assert.equal(SUPABASE_CLI.version, '2.101.0');
    assert.equal(SUPABASE_CLI.sha256, '285877ef9de845d76487772e0d36019a095ee28b527b9abbd6739eeba4d3dbf9');
    assert.equal(SUPABASE_CLI.url, 'https://github.com/supabase/cli/releases/download/v2.101.0/supabase_linux_amd64.tar.gz');
    const worstMs = DEFAULT_LIMITS.attempts * DEFAULT_LIMITS.attemptTimeoutMs + DEFAULT_LIMITS.backoffMs * (DEFAULT_LIMITS.attempts * (DEFAULT_LIMITS.attempts - 1)) / 2;
    const workflow = readFileSync('.github/workflows/account-closure-full-chain-proof.yml', 'utf8');
    const step = /- name: Install pinned Supabase CLI \(bounded, verified\)\n\s+timeout-minutes: (\d+)\n\s+run: node scripts\/ci\/install-supabase-cli\.mjs/.exec(workflow);
    assert.ok(step, 'the workflow installs the CLI through the bounded installer, with a step timeout');
    assert.ok(worstMs + 60_000 <= Number(step[1]) * 60_000, 'retries finish (or fail explicitly) before the step timeout');
});

test('policy: no unbounded CLI setup remains, and no proof step can run unless the bounded install succeeded', () => {
    const workflow = readFileSync('.github/workflows/account-closure-full-chain-proof.yml', 'utf8');
    // The previous path (`uses: supabase/setup-cli@v2`, no deadline) is what stalled for 29m51s; it must not return.
    assert.doesNotMatch(workflow, /supabase\/setup-cli/);
    const steps = workflow.split('\n      - ').slice(1);
    const install = steps.findIndex((s) => s.startsWith('name: Install pinned Supabase CLI (bounded, verified)'));
    const proofs = ['name: Prove native closure concurrency', 'name: Replay actual baseline and closure migration']
        .map((p) => steps.findIndex((s) => s.startsWith(p)));
    assert.ok(install >= 0 && proofs.every((i) => i > install), 'the proofs follow the install');
    for (const i of [install, ...proofs]) {
        assert.doesNotMatch(steps[i], /\n\s+if:|continue-on-error/, 'a failed install stops the job; no proof runs or passes');
    }
});
