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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const LOCK_DIR = '.host-locks';
export const KINDS = Object.freeze(['benchmark', 'local']);
/** What each kind refuses to run alongside. A benchmark tolerates nothing; local jobs tolerate each other. */
const BLOCKED_BY = Object.freeze({ benchmark: ['local', 'benchmark'], local: ['benchmark'] });

export class InterlockError extends Error {}

const dirFor = (root) => join(root, LOCK_DIR);
const lockPath = (root, kind, pid) => join(dirFor(root), `${kind}.${pid}.lock`);

export function interlockDisabled(env = process.env) {
    return env.CI === 'true' || env.SPEAKSHARP_INTERLOCK === 'off';
}

/** True when the interlock was bypassed by hand — recorded in evidence, never merely tolerated. */
export function overrideActive(env = process.env) {
    return env.SPEAKSHARP_INTERLOCK === 'off' && env.CI !== 'true';
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
export function acquire(kind, {
    root = process.cwd(), env = process.env, now = () => new Date().toISOString(),
    /** Owner id for this lock. Defaults to the pid; overridable so two distinct jobs are testable. */
    owner = process.pid,
    ...opts
} = {}) {
    const result = assertClear(kind, { root, env, ...opts });
    if (!result.enforced) return { release: () => {}, path: null, ...result };

    const path = lockPath(root, kind, owner);
    mkdirSync(dirFor(root), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ kind, pid: owner, host: hostname(), startedAt: now() }, null, 2)}\n`);
    let released = false;
    return {
        ...result,
        path,
        release: () => { if (!released) { released = true; rmSync(path, { force: true }); } },
    };
}
