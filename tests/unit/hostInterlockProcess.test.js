/**
 * PROCESS-LEVEL casualties.
 *
 * Unit-testing the lock library proves the library; it does not prove the WRAPPER, and every defect
 * guarded here lived in the wrapper or the package scripts: a one-shot `check` that then ran unlocked,
 * a signal handler that released while the workload kept running, nested guarded commands whose first
 * inner release dropped the lock for the rest of the chain, and a lock whose liveness tracked the
 * wrapper rather than the workload.
 *
 * These spawn REAL long-running children and assert the opposing workload cannot start.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const CLI = join(REPO, 'scripts/host-interlock.mjs');
const CLEAN = { SPEAKSHARP_INTERLOCK: '', SPEAKSHARP_INTERLOCK_HELD: '', GITHUB_ACTIONS: '' };
let root;

const runGuard = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...CLEAN, ...env },
});

const startHeld = (kind, body = 'setInterval(()=>{},1e9)') => spawn(
    process.execPath, [CLI, 'hold', kind, '--', process.execPath, '-e', body],
    { cwd: root, stdio: 'ignore', env: { ...process.env, ...CLEAN } },
);

/**
 * Kill the wrapper AND the workload.
 *
 * The wrapper spawns the workload DETACHED, so the workload leads its own process group — killing the
 * wrapper's group does not touch it. The workload's pid is recorded in the lock (liveness tracks the
 * workload), so cleanup reads it from there.
 */
const workloadPids = (kind) => locksFor(kind).map((f) => {
    try { return JSON.parse(readFileSync(join(root, '.host-locks', f), 'utf8')).pid; } catch { return null; }
}).filter((n) => typeof n === 'number');

const killTree = (child, kind = 'local') => {
    for (const pid of workloadPids(kind)) {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* not a group leader */ }
        try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
    try { child.kill('SIGKILL'); } catch { /* gone */ }
};

const locksFor = (kind) => {
    const d = join(root, '.host-locks');
    return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith(`${kind}.`)) : [];
};
const waitFor = async (fn, ms = 15000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'interlock-proc-'));
    mkdirSync(join(root, 'scripts/lib'), { recursive: true });
    cpSync(CLI, join(root, 'scripts/host-interlock.mjs'));
    cpSync(join(REPO, 'scripts/lib/hostInterlock.mjs'), join(root, 'scripts/lib/hostInterlock.mjs'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a guarded command holds its lock for the WORKLOAD\'S whole lifetime', () => {
    it('CASUALTY: a benchmark cannot start while a long-running guarded local job is alive', async () => {
        const child = startHeld('local');
        try {
            expect(await waitFor(() => locksFor('local').length === 1)).toBe(true);
            expect(runGuard(['check', 'benchmark']).status).toBe(3);
            expect(runGuard(['hold', 'benchmark', '--', process.execPath, '-e', '0']).status).toBe(3);
        } finally { killTree(child); }
    }, 40000);

    it('CASUALTY: a local job cannot start while a guarded benchmark is alive', async () => {
        const child = startHeld('benchmark');
        try {
            expect(await waitFor(() => locksFor('benchmark').length === 1)).toBe(true);
            expect(runGuard(['check', 'local']).status).toBe(3);
        } finally { killTree(child, 'benchmark'); }
    }, 40000);

    it('CASUALTY: a forwarded SIGTERM does not drop the lock while the workload ignores it', async () => {
        // READINESS HANDSHAKE. The wrapper writes its lock BEFORE spawning the workload, so waiting on
        // the lock alone can send SIGTERM to a child that has not yet registered its handler — it then
        // dies on the default action and the test blames the interlock for a race of its own making.
        // Slower CI startup made that reproducible. The workload announces itself instead.
        const ready = join(root, 'workload-ready.txt');
        const child = startHeld('local',
            `require('node:fs').writeFileSync(${JSON.stringify(ready)},'1'); `
            + "process.on('SIGTERM',()=>{}); setInterval(()=>{},1e9)");
        try {
            expect(await waitFor(() => locksFor('local').length === 1)).toBe(true);
            expect(await waitFor(() => existsSync(ready)), 'workload never started').toBe(true);
            child.kill('SIGTERM');
            await new Promise((r) => setTimeout(r, 900));
            expect(locksFor('local').length, 'lock vanished while the workload was alive').toBe(1);
            expect(runGuard(['check', 'benchmark']).status).toBe(3);
        } finally { killTree(child); }
    }, 40000);

    it('CASUALTY: SIGKILLing the WRAPPER still blocks, because liveness tracks the workload', async () => {
        // SIGKILL cannot be caught, so the wrapper dies without releasing. If liveness were judged by
        // the wrapper's pid the lock would be reclaimed as stale and a benchmark could start beside a
        // still-running suite.
        const ready = join(root, 'kill-ready.txt');
        const child = startHeld('local',
            `require('node:fs').writeFileSync(${JSON.stringify(ready)},'1'); setInterval(()=>{},1e9)`);
        try {
            expect(await waitFor(() => locksFor('local').length === 1)).toBe(true);
            expect(await waitFor(() => existsSync(ready)), 'workload never started').toBe(true);
            child.kill('SIGKILL');
            await new Promise((r) => setTimeout(r, 900));
            expect(locksFor('local').length, 'the lock was reclaimed while the workload lived').toBe(1);
            expect(runGuard(['check', 'benchmark']).status).toBe(3);
        } finally { killTree(child); }
        // Once the workload is gone the lock is correctly reclaimable.
        expect(await waitFor(() => runGuard(['check', 'benchmark']).status === 0)).toBe(true);
    }, 40000);

    it('releases promptly once the workload exits normally', () => {
        const r = spawnSync(process.execPath, [CLI, 'hold', 'local', '--', process.execPath, '-e', '0'], {
            cwd: root, encoding: 'utf8', env: { ...process.env, ...CLEAN },
        });
        expect(r.status).toBe(0);
        expect(locksFor('local').length).toBe(0);
    }, 40000);
});

describe('nested guarded commands inherit rather than re-acquire', () => {
    it('CASUALTY: an inner guarded command does not drop the outer lock when it finishes', async () => {
        // test:full chains quality -> unit -> build -> e2e. If the first inner command released, the
        // rest of the chain would run unprotected.
        const inner = `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} hold local -- ${JSON.stringify(process.execPath)} -e 0`;
        const statusFile = join(root, 'inner-status.txt');
        // An inner failure must NOT crash the outer workload, or the test would measure the crash
        // instead of the lock. The inner's exit status is recorded and asserted separately.
        const child = startHeld('local', `
            const {execSync}=require('node:child_process'); const fs=require('node:fs');
            let st = 0;
            try { execSync(${JSON.stringify(inner)},{stdio:'ignore'}); } catch (e) { st = e.status ?? -1; }
            fs.writeFileSync(${JSON.stringify(statusFile)}, String(st));
            setInterval(()=>{},1e9);`);
        try {
            expect(await waitFor(() => locksFor('local').length === 1)).toBe(true);
            expect(await waitFor(() => existsSync(statusFile)), 'inner never ran').toBe(true);
            expect(readFileSync(statusFile, 'utf8'), 'the nested guarded command failed').toBe('0');
            expect(locksFor('local').length, 'the inner command released the outer lock').toBe(1);
            expect(runGuard(['check', 'benchmark']).status).toBe(3);
            // EXACTLY ONE lock for the whole chain. Owner-specific locks already make nesting SAFE —
            // an inner command can only ever delete its own file — so this is not a safety property.
            // What the ancestor check buys is that a four-deep chain (quality -> unit -> build -> e2e)
            // leaves one lock rather than four, so `readLocks` describes the host truthfully instead of
            // reporting four concurrent "jobs" that are one.
            expect(locksFor('local').length).toBe(1);
        } finally { killTree(child); }
    }, 40000);
});

describe('exemption is a proven remote runner, not a generic CI flag', () => {
    it('CASUALTY: a local CI=true does NOT bypass the interlock', async () => {
        // This repo's own test:unit sets `cross-env CI=true`, so keying the exemption on CI disabled the
        // interlock during exactly the suites it exists to catch.
        const child = startHeld('benchmark');
        try {
            expect(await waitFor(() => locksFor('benchmark').length === 1)).toBe(true);
            expect(runGuard(['check', 'local'], { CI: 'true' }).status).toBe(3);
            expect(runGuard(['check', 'local'], { GITHUB_ACTIONS: 'true' }).status).toBe(0);
        } finally { killTree(child, 'benchmark'); }
    }, 40000);
});
