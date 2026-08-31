/**
 * BIDIRECTIONAL HOST INTERLOCK — benchmark vs local test/build.
 *
 * A benchmark and a local test suite on the same machine contaminate each other's timing. This has
 * happened twice; the second time cost the v2 and q4 latency of a four-arm 600 that had already run for
 * an hour. Both times the control was a written reminder, and both times the reminder lost.
 *
 * DESIGN, corrected after review:
 *
 *  - OWNER-SPECIFIC LOCK FILES. Each job writes `<kind>.<pid>.lock`. A single shared `local.lock` let one
 *    job delete another's lock on exit, so two local jobs could silently disarm the interlock for a
 *    benchmark starting between them.
 *  - HOLD, NOT CHECK. A one-shot check leaves a window: check (clear) → suite runs unlocked → benchmark
 *    starts, sees nothing → both overlap. Local commands must HOLD for their whole lifetime.
 *  - A BENCHMARK REFUSES ANOTHER BENCHMARK. Two concurrent benchmarks contaminate each other exactly as
 *    a suite does; only local jobs may coexist with each other.
 *  - AN OVERRIDE IS RECORDED, NOT INVISIBLE. Bypassing does not silently produce normal-looking timing:
 *    `overrideActive()` is written into the artifact and marks its timing ineligible.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const LOCK_DIR = '.host-locks';
export const KINDS = Object.freeze(['benchmark', 'local']);
/** What each kind refuses to run alongside. A benchmark tolerates nothing; local jobs tolerate each other. */
const BLOCKED_BY = Object.freeze({ benchmark: ['local', 'benchmark'], local: ['benchmark'] });

export class InterlockError extends Error {}

const dirFor = (root) => join(root, LOCK_DIR);
const lockPath = (root, kind, pid) => join(dirFor(root), `${kind}.${pid}.lock`);

/**
 * Remote CI is exempt — runners are separate hosts, so enforcing only produces false refusals.
 *
 * The check is a PROVEN REMOTE RUNNER (`GITHUB_ACTIONS`), not a generic `CI=true`. `CI` is set by
 * plenty of local tooling — this repo's own `test:unit` script sets `cross-env CI=true` — so keying on
 * it silently disabled the interlock during exactly the local suites it exists to catch.
 */
export function remoteRunner(env = process.env) {
    return env.GITHUB_ACTIONS === 'true';
}

export function interlockDisabled(env = process.env) {
    return remoteRunner(env) || env.SPEAKSHARP_INTERLOCK === 'off';
}

/** An ancestor already holds a lock for this workload; nested commands must not re-acquire. */
export function heldByAncestor(env = process.env) {
    return typeof env.SPEAKSHARP_INTERLOCK_HELD === 'string' && env.SPEAKSHARP_INTERLOCK_HELD !== '';
}

/** True when the interlock was bypassed by hand — recorded in evidence, never merely tolerated. */
export function overrideActive(env = process.env) {
    return env.SPEAKSHARP_INTERLOCK === 'off' && !remoteRunner(env);
}

const isAliveDefault = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Every lock currently on disk for `kind`, each classified. */
export function readLocks(root, kind, { host = hostname(), isAlive = isAliveDefault } = {}) {
    const dir = dirFor(root);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.startsWith(`${kind}.`) && f.endsWith('.lock'))
        .map((f) => {
            const path = join(dir, f);
            let body = null;
            try { body = JSON.parse(readFileSync(path, 'utf8')); } catch { /* malformed */ }
            if (!body || typeof body.pid !== 'number' || typeof body.host !== 'string') {
                return { path, state: 'malformed' };
            }
            const state = body.host !== host ? 'foreign_host'
                : isAlive(body.pid) ? 'live' : 'stale_same_host';
            return { ...body, path, state };
        });
}

/**
 * Refuse if anything this kind is blocked by is held. Stale same-host locks are reclaimed; foreign-host
 * locks are never reclaimed automatically, because this process cannot see that machine's processes.
 */
export function assertClear(kind, { root = process.cwd(), env = process.env, ...opts } = {}) {
    if (!KINDS.includes(kind)) throw new InterlockError(`unknown interlock kind "${kind}"`);
    if (interlockDisabled(env)) return { enforced: false, reason: 'disabled', override: overrideActive(env) };
    if (heldByAncestor(env)) return { enforced: false, reason: 'held_by_ancestor', override: false };

    for (const other of BLOCKED_BY[kind]) {
        for (const lock of readLocks(root, other, opts)) {
            // Re-entry only: a kind is not blocked by its OWN lock of the SAME kind. Skipping any
            // same-pid lock would let a process hold `local` and still start a benchmark.
            if (lock.state === 'live' && other === kind && lock.pid === process.pid) continue;
            if (lock.state === 'stale_same_host') { rmSync(lock.path, { force: true }); continue; }
            if (lock.state === 'malformed') {
                throw new InterlockError(
                    `refusing to start ${kind}: an unreadable ${other} lock at ${lock.path}. `
                    + 'A lock that cannot be parsed cannot be proven stale — inspect and remove it deliberately.',
                );
            }
            if (lock.state === 'foreign_host') {
                throw new InterlockError(
                    `refusing to start ${kind}: a ${other} lock is held by host "${lock.host}" (pid ${lock.pid}). `
                    + 'This process cannot see that machine\'s processes, so it is NOT reclaimed automatically.',
                );
            }
            throw new InterlockError(
                `refusing to start ${kind}: a ${other} job is running (pid ${lock.pid} on ${lock.host}, `
                + `started ${lock.startedAt}). Running these together on one host contaminates benchmark `
                + 'timing. Wait for it to finish, or set SPEAKSHARP_INTERLOCK=off — which marks the run\'s '
                + 'timing INELIGIBLE and is recorded in the artifact.',
            );
        }
    }
    return { enforced: true, state: 'clear' };
}

/** Take an OWNER-SPECIFIC lock for this process. Releasing it can never remove another job's lock. */
/**
 * A cross-process mutex around scan-and-acquire. `mkdir` is atomic on every platform we run on, so
 * exactly one process can hold it. Without this, two benchmarks can both scan an empty directory
 * before either writes its owner file and both proceed — the check is not the same as the claim.
 */
function withAcquireMutex(root, fn, { attempts = 200, waitMs = 25 } = {}) {
    const gate = join(dirFor(root), '.acquire');
    mkdirSync(dirFor(root), { recursive: true });
    for (let i = 0; i < attempts; i++) {
        try {
            mkdirSync(gate);                       // atomic: throws EEXIST if another process holds it
            try { return fn(); } finally { try { rmdirSync(gate); } catch { /* already gone */ } }
        } catch (e) {
            if (e?.code !== 'EEXIST') throw e;
            const until = Date.now() + waitMs;
            while (Date.now() < until) { /* brief spin; this section is milliseconds long */ }
        }
    }
    throw new InterlockError(
        `could not obtain the interlock acquire mutex at ${gate}. If no job is starting, remove that `
        + 'directory — it is a mutex, not a lock, and is never held for more than a few milliseconds.',
    );
}

export function acquire(kind, {
    root = process.cwd(), env = process.env, now = () => new Date().toISOString(),
    /** Owner id for this lock. Defaults to the pid; overridable so two distinct jobs are testable. */
    owner = process.pid,
    ...opts
} = {}) {
    // The scan and the write are ONE critical section, so two starters cannot both see a clear host.
    return withAcquireMutex(root, () => {
        const result = assertClear(kind, { root, env, ...opts });
        // Same SHAPE as the enforced return: a caller must not have to know whether the lock was
        // actually taken. Omitting `adopt` here threw a TypeError in every nested command.
        if (!result.enforced) return { release: () => {}, adopt: () => {}, path: null, ...result };

        const path = lockPath(root, kind, owner);
        writeFileSync(path, `${JSON.stringify({ kind, pid: owner, host: hostname(), startedAt: now() }, null, 2)}\n`);
        let released = false;
        return {
            ...result,
            path,
            /**
             * Re-point the lock at the WORKLOAD's pid once it exists.
             *
             * Liveness must track the process doing the work, not the wrapper. A SIGKILL on the wrapper
             * cannot be caught, so the wrapper dies while its child keeps running — and a lock judged by
             * the wrapper's pid would then be classified stale and reclaimed, letting a benchmark start
             * alongside a live test suite. Judged by the child's pid, the lock correctly stays live.
             */
            adopt: (workloadPid) => {
                if (released) return;
                writeFileSync(path, `${JSON.stringify({
                    kind, pid: workloadPid, wrapperPid: owner, host: hostname(), startedAt: now(),
                }, null, 2)}\n`);
            },
            release: () => { if (!released) { released = true; rmSync(path, { force: true }); } },
        };
    });
}
