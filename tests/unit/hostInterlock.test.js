import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    InterlockError, LOCK_DIR, acquire, assertClear, interlockDisabled, overrideActive, readLocks,
} from '../../scripts/lib/hostInterlock.mjs';

let root;
const NOT_CI = { CI: undefined };
/** Another job's pid. Never this process, so "own lock" logic cannot mask a real conflict. */
const OTHER = 424242;
/** These tests decide liveness explicitly; the real prober would call it dead. */
const LIVE = { isAlive: () => true };
const opts = (extra = {}) => ({ root, env: NOT_CI, ...LIVE, ...extra });

const lockPath = (name) => join(root, LOCK_DIR, `${name}.lock`);
const writeLock = (name, body) => {
    mkdirSync(join(root, LOCK_DIR), { recursive: true });
    writeFileSync(lockPath(name), typeof body === 'string' ? body : JSON.stringify(body));
};
const held = (kind, pid = OTHER) => writeLock(`${kind}.${pid}`, { kind, pid, host: hostname(), startedAt: 'now' });

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'interlock-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('BOTH directions refuse — the whole point of an interlock', () => {
    it('CASUALTY: a benchmark refuses to start while a local test/build holds a lock', () => {
        // The first contamination: a local suite was already running when the 600 started, and cost
        // v2's entire latency arm.
        held('local');
        expect(() => assertClear('benchmark', opts())).toThrow(InterlockError);
        expect(() => assertClear('benchmark', opts())).toThrow(/a local job is running/);
    });

    it('CASUALTY: a local test/build refuses to start while a benchmark holds a lock', () => {
        // The second contamination: a suite started DURING the benchmark. A benchmark-only mutex would
        // have permitted this, which is why the interlock is bidirectional.
        held('benchmark');
        expect(() => assertClear('local', opts())).toThrow(/a benchmark job is running/);
    });

    it('CASUALTY: a benchmark refuses ANOTHER benchmark', () => {
        // Two concurrent benchmarks contaminate each other exactly as a suite does.
        held('benchmark');
        expect(() => assertClear('benchmark', opts())).toThrow(InterlockError);
    });

    it('local jobs may coexist with each other', () => {
        // Two suites on one host is a developer's own business; this must not become a global mutex.
        held('local');
        expect(() => assertClear('local', opts())).not.toThrow();
    });

    it('POSITIVE CONTROL: each side starts freely when nothing is held', () => {
        expect(assertClear('benchmark', opts()).state).toBe('clear');
        expect(assertClear('local', opts()).state).toBe('clear');
    });
});

describe('owner-specific locks — one job can never disarm another', () => {
    it('CASUALTY: releasing one local job does NOT remove another local job\'s lock', () => {
        // A single shared local.lock let one suite delete another's on exit, silently disarming the
        // interlock for a benchmark starting in between.
        held('local');
        const mine = acquire('local', opts());
        mine.release();
        expect(existsSync(mine.path)).toBe(false);
        expect(existsSync(lockPath(`local.${OTHER}`))).toBe(true);
        // and the surviving lock still blocks a benchmark
        expect(() => assertClear('benchmark', opts())).toThrow(InterlockError);
    });

    it('a held lock blocks for its WHOLE lifetime, not just at check time', () => {
        // `check` once and then run unlocked leaves a window: check clear -> suite runs -> benchmark
        // starts, sees nothing -> both overlap.
        const h = acquire('local', opts());
        expect(() => assertClear('benchmark', opts())).toThrow(InterlockError);
        h.release();
        expect(() => assertClear('benchmark', opts())).not.toThrow();
    });

    it('a benchmark is not blocked by its OWN lock on re-entry', () => {
        const h = acquire('benchmark', opts());
        expect(() => assertClear('benchmark', opts())).not.toThrow();
        h.release();
    });

    it('CASUALTY: holding `local` does not let the same process start a benchmark', () => {
        // Skipping any same-pid lock (rather than same-pid AND same-kind) would allow exactly this.
        const h = acquire('local', opts());
        expect(() => assertClear('benchmark', opts())).toThrow(InterlockError);
        h.release();
    });
});

describe('stale locks require verified PID and host ownership', () => {
    it('reclaims a lock whose PID is gone ON THIS HOST', () => {
        held('local');
        const r = assertClear('benchmark', { root, env: NOT_CI, isAlive: () => false });
        expect(r.state).toBe('clear');
        expect(existsSync(lockPath(`local.${OTHER}`))).toBe(false);
    });

    it('CASUALTY: a FOREIGN-HOST lock is never reclaimed automatically', () => {
        // `process.kill(pid, 0)` here says nothing about a process on another machine; treating "not
        // running locally" as stale would delete a live lock and re-enable contamination.
        writeLock('benchmark.999', { kind: 'benchmark', pid: 999, host: 'some-other-host', startedAt: 'now' });
        expect(() => assertClear('local', { root, env: NOT_CI, isAlive: () => false }))
            .toThrow(/held by host "some-other-host"/);
        expect(existsSync(lockPath('benchmark.999'))).toBe(true);
    });

    it('CASUALTY: an unreadable lock refuses rather than being treated as absent', () => {
        writeLock('benchmark.777', 'not json at all');
        expect(() => assertClear('local', opts())).toThrow(/cannot be proven stale/);
    });

    it('readLocks classifies every lock on disk', () => {
        writeLock('benchmark.111', { kind: 'benchmark', pid: 111, host: hostname(), startedAt: 'now' });
        writeLock('benchmark.222', { kind: 'benchmark', pid: 222, host: 'elsewhere', startedAt: 'now' });
        writeLock('benchmark.333', 'not json');
        const states = readLocks(root, 'benchmark', { isAlive: (p) => p === 111 }).map((l) => l.state).sort();
        expect(states).toEqual(['foreign_host', 'live', 'malformed']);
    });
});

describe('remote CI is exempt; an override is RECORDED, not invisible', () => {
    it('a PROVEN remote runner never enforces the interlock', () => {
        // CORRECTED: this asserted `CI: 'true'` exempts. It no longer does, and must not — this repo's
        // own `test:unit` sets `cross-env CI=true`, so keying the exemption on CI silently disabled the
        // interlock during exactly the local suites it exists to catch.
        held('benchmark');
        expect(() => assertClear('local', { root, env: { GITHUB_ACTIONS: 'true' }, ...LIVE })).not.toThrow();
        expect(interlockDisabled({ GITHUB_ACTIONS: 'true' })).toBe(true);
    });

    it('CASUALTY: a local CI=true does NOT exempt', () => {
        held('benchmark');
        expect(interlockDisabled({ CI: 'true' })).toBe(false);
        expect(() => assertClear('local', { root, env: { CI: 'true' }, ...LIVE })).toThrow(InterlockError);
    });

    it('CASUALTY: the interlock is ON by default — absence of CI must not disable it', () => {
        held('benchmark');
        expect(interlockDisabled({})).toBe(false);
        expect(() => assertClear('local', { root, env: {}, ...LIVE })).toThrow(InterlockError);
    });

    it('CASUALTY: an override is reported so timing can be marked INELIGIBLE', () => {
        // Bypassing must not silently produce normal-looking timing.
        expect(overrideActive({ SPEAKSHARP_INTERLOCK: 'off' })).toBe(true);
        expect(overrideActive({ CI: 'true' })).toBe(false);      // CI is an exemption, not an override
        expect(overrideActive({})).toBe(false);
        held('local');
        const r = acquire('benchmark', { root, env: { SPEAKSHARP_INTERLOCK: 'off' }, ...LIVE });
        expect(r.override).toBe(true);
    });
});

describe('acquire writes an ownable lock and releases it', () => {
    it('records kind, pid, host and start time, then removes the file on release', () => {
        const h = acquire('benchmark', { ...opts(), now: () => '2026-08-31T00:00:00Z' });
        const body = JSON.parse(readFileSync(h.path, 'utf8'));
        expect(body).toMatchObject({ kind: 'benchmark', pid: process.pid, host: hostname() });
        expect(body.startedAt).toBe('2026-08-31T00:00:00Z');
        h.release();
        expect(existsSync(h.path)).toBe(false);
    });

    it('release is idempotent', () => {
        const h = acquire('local', opts());
        h.release();
        expect(() => h.release()).not.toThrow();
    });

    it('CASUALTY: acquire REFUSES and takes NO lock when blocked', () => {
        held('local');
        expect(() => acquire('benchmark', opts())).toThrow(InterlockError);
        expect(existsSync(lockPath(`benchmark.${process.pid}`))).toBe(false);
    });

    it('an unknown kind is rejected', () => {
        expect(() => assertClear('nonsense', opts())).toThrow(/unknown interlock kind/);
    });
});

describe('two concurrent jobs each own their lock', () => {
    it('CASUALTY: a second local job does not OVERWRITE the first job\'s lock, and releasing one leaves the other', () => {
        // The single-shared-file design: job A acquires `local.lock`, job B acquires and OVERWRITES the
        // same path, then A exits and deletes it — leaving B running with no lock at all, so a benchmark
        // starting next sees a clear host. That is the exact disarm this must prevent.
        const a = acquire('local', { ...opts(), owner: 111 });
        const b = acquire('local', { ...opts(), owner: 222 });
        expect(a.path).not.toBe(b.path);
        expect(existsSync(a.path)).toBe(true);
        expect(existsSync(b.path)).toBe(true);

        a.release();
        expect(existsSync(a.path)).toBe(false);
        expect(existsSync(b.path)).toBe(true);
        // B is still running, so a benchmark must STILL be refused.
        expect(() => assertClear('benchmark', opts())).toThrow(InterlockError);

        b.release();
        expect(() => assertClear('benchmark', opts())).not.toThrow();
    });
});
