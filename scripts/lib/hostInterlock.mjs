/**
 * BIDIRECTIONAL HOST INTERLOCK — benchmark vs local test/build.
 *
 * A benchmark and a local test suite on the same machine contaminate each other's timing. This has now
 * happened twice on this repo: the second time cost the v2 and q4 latency of a four-arm 600 that had
 * already run for an hour. Both times the control was a written reminder, and both times the reminder
 * lost to a background job. A reminder is not a control; this is.
 *
 * Two locks, and each side refuses while the other is held:
 *   - `benchmark` — held for the life of a matrix/benchmark run;
 *   - `local`     — held for the life of a local test or build.
 *
 * REMOTE CI IS EXEMPT. CI runners are separate hosts, so the interlock would only ever produce false
 * refusals there; `CI=true` disables it, which is the one exemption and is stated rather than implied.
 *
 * STALE LOCKS ARE NOT SILENTLY IGNORED. A lock whose PID is gone is stale and reclaimable; a lock from
 * ANOTHER HOST is never reclaimed automatically, because this process cannot see that machine's
 * processes and "the PID isn't running here" says nothing about whether the job is still running there.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

export const LOCK_DIR = '.host-locks';
export const KINDS = Object.freeze(['benchmark', 'local']);
/** Each kind refuses while the OTHER is held. */
const OPPOSITE = Object.freeze({ benchmark: 'local', local: 'benchmark' });

export class InterlockError extends Error {}

const lockPath = (root, kind) => join(root, LOCK_DIR, `${kind}.lock`);

/** True when this process must not enforce the interlock at all. */
export function interlockDisabled(env = process.env) {
    return env.CI === 'true' || env.SPEAKSHARP_INTERLOCK === 'off';
}

function readLock(root, kind) {
    const p = lockPath(root, kind);
    if (!existsSync(p)) return null;
    try {
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        if (!raw || typeof raw.pid !== 'number' || typeof raw.host !== 'string') return { malformed: true, path: p };
        return { ...raw, path: p };
    } catch {
        return { malformed: true, path: p };
    }
}

/**
 * Classify a held lock. `live` blocks; `stale_same_host` is reclaimable; `foreign_host` is NOT, and is
 * reported for a human to resolve rather than deleted on a guess.
 */
export function classifyLock(lock, { host = hostname(), isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
    if (!lock) return 'absent';
    if (lock.malformed) return 'malformed';
    if (lock.host !== host) return 'foreign_host';
    return isAlive(lock.pid) ? 'live' : 'stale_same_host';
}

/**
 * Refuse if the opposing lock is held. Returns what it found so a caller can report it.
 */
export function assertClear(kind, { root = process.cwd(), env = process.env, ...opts } = {}) {
    if (!KINDS.includes(kind)) throw new InterlockError(`unknown interlock kind "${kind}"`);
    if (interlockDisabled(env)) return { enforced: false, reason: 'disabled' };

    const other = OPPOSITE[kind];
    const lock = readLock(root, other);
    const state = classifyLock(lock, opts);

    if (state === 'absent') return { enforced: true, state };
    if (state === 'stale_same_host') {
        rmSync(lock.path, { force: true });
        return { enforced: true, state, reclaimed: true };
    }
    if (state === 'malformed') {
        throw new InterlockError(
            `refusing to start ${kind}: the ${other} lock at ${lock.path} is unreadable. `
            + 'Inspect and remove it deliberately — a lock that cannot be parsed cannot be proven stale.',
        );
    }
    if (state === 'foreign_host') {
        throw new InterlockError(
            `refusing to start ${kind}: the ${other} lock is held by host "${lock.host}" (pid ${lock.pid}). `
            + 'This process cannot see that machine\'s processes, so the lock is NOT reclaimed automatically. '
            + 'Confirm that job has ended, then remove the lock on that host.',
        );
    }
    throw new InterlockError(
        `refusing to start ${kind}: a ${other} job is running (pid ${lock.pid} on ${lock.host}, `
        + `started ${lock.startedAt}). Running both on one host contaminates benchmark timing. `
        + `Wait for it to finish, or set SPEAKSHARP_INTERLOCK=off if you accept contaminated timing.`,
    );
}

/** Take the lock for `kind`, after asserting the opposite side is clear. Returns a release function. */
export function acquire(kind, { root = process.cwd(), env = process.env, now = () => new Date().toISOString(), ...opts } = {}) {
    const result = assertClear(kind, { root, env, ...opts });
    if (!result.enforced) return { release: () => {}, ...result };

    const p = lockPath(root, kind);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify({ kind, pid: process.pid, host: hostname(), startedAt: now() }, null, 2)}\n`);
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        rmSync(p, { force: true });
    };
    return { release, path: p, ...result };
}
