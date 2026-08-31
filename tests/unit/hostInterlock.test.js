import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    InterlockError, LOCK_DIR, acquire, assertClear, classifyLock, interlockDisabled,
} from '../../scripts/lib/hostInterlock.mjs';

let root;
const NOT_CI = { CI: undefined };
const lockFile = (kind) => join(root, LOCK_DIR, `${kind}.lock`);
const writeLock = (kind, body) => {
    mkdirSync(join(root, LOCK_DIR), { recursive: true });
    writeFileSync(lockFile(kind), typeof body === 'string' ? body : JSON.stringify(body));
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'interlock-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('BOTH directions refuse — the whole point of an interlock', () => {
    it('CASUALTY: a benchmark refuses to start while a local test/build holds the lock', () => {
        // This is the contamination that actually happened: a local suite was already running when the
        // 600 started, and cost v2's entire latency arm.
        writeLock('local', { kind: 'local', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(() => assertClear('benchmark', { root, env: NOT_CI })).toThrow(InterlockError);
        expect(() => assertClear('benchmark', { root, env: NOT_CI })).toThrow(/a local job is running/);
    });

    it('CASUALTY: a local test/build refuses to start while a benchmark holds the lock', () => {
        // The second contamination: a suite started DURING the benchmark. One-way locking would have
        // permitted this, which is why the interlock is bidirectional rather than a benchmark mutex.
        writeLock('benchmark', { kind: 'benchmark', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(() => assertClear('local', { root, env: NOT_CI })).toThrow(/a benchmark job is running/);
    });

    it('POSITIVE CONTROL: each side starts freely when the other is not held', () => {
        expect(assertClear('benchmark', { root, env: NOT_CI }).state).toBe('absent');
        expect(assertClear('local', { root, env: NOT_CI }).state).toBe('absent');
    });

    it('POSITIVE CONTROL: holding a lock does not block the SAME kind', () => {
        // Two benchmark shards on one host is a different decision; the interlock governs cross-kind
        // contamination and must not silently become a global mutex.
        writeLock('benchmark', { kind: 'benchmark', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(() => assertClear('benchmark', { root, env: NOT_CI })).not.toThrow();
    });
});

describe('stale locks require verified PID and host ownership', () => {
    it('reclaims a lock whose PID is gone ON THIS HOST', () => {
        writeLock('local', { kind: 'local', pid: 2, host: hostname(), startedAt: 'old' });
        const r = assertClear('benchmark', { root, env: NOT_CI, isAlive: () => false });
        expect(r.reclaimed).toBe(true);
        expect(existsSync(lockFile('local'))).toBe(false);
    });

    it('CASUALTY: a FOREIGN-HOST lock is never reclaimed automatically', () => {
        // `process.kill(pid, 0)` on this machine says nothing about a process on another machine.
        // Treating "not running here" as "stale" would delete a live lock and re-enable contamination.
        writeLock('benchmark', { kind: 'benchmark', pid: 999999, host: 'some-other-host', startedAt: 'now' });
        expect(() => assertClear('local', { root, env: NOT_CI, isAlive: () => false }))
            .toThrow(/held by host "some-other-host"/);
        expect(existsSync(lockFile('benchmark'))).toBe(true);
    });

    it('CASUALTY: an unreadable lock refuses rather than being treated as absent', () => {
        writeLock('benchmark', 'not json at all');
        expect(() => assertClear('local', { root, env: NOT_CI })).toThrow(/cannot be proven stale/);
    });

    it('classifyLock distinguishes the four states', () => {
        const here = hostname();
        expect(classifyLock(null)).toBe('absent');
        expect(classifyLock({ malformed: true })).toBe('malformed');
        expect(classifyLock({ pid: 1, host: 'elsewhere' }, { host: here })).toBe('foreign_host');
        expect(classifyLock({ pid: 1, host: here }, { host: here, isAlive: () => true })).toBe('live');
        expect(classifyLock({ pid: 1, host: here }, { host: here, isAlive: () => false })).toBe('stale_same_host');
    });
});

describe('remote CI is exempt, and the exemption is explicit', () => {
    it('CI runners never enforce the interlock', () => {
        // Separate hosts, so enforcing would only ever produce false refusals.
        writeLock('benchmark', { kind: 'benchmark', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(() => assertClear('local', { root, env: { CI: 'true' } })).not.toThrow();
        expect(interlockDisabled({ CI: 'true' })).toBe(true);
    });

    it('the local escape hatch is explicit and accepts contaminated timing', () => {
        writeLock('benchmark', { kind: 'benchmark', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(() => assertClear('local', { root, env: { SPEAKSHARP_INTERLOCK: 'off' } })).not.toThrow();
    });

    it('CASUALTY: the interlock is ON by default — absence of CI must not disable it', () => {
        writeLock('benchmark', { kind: 'benchmark', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(interlockDisabled({})).toBe(false);
        expect(() => assertClear('local', { root, env: {} })).toThrow(InterlockError);
    });
});

describe('acquire writes an ownable lock and releases it', () => {
    it('records pid, host and start time, then removes the file on release', () => {
        const held = acquire('benchmark', { root, env: NOT_CI, now: () => '2026-08-31T00:00:00Z' });
        const body = JSON.parse(readFileSync(lockFile('benchmark'), 'utf8'));
        expect(body).toMatchObject({ kind: 'benchmark', pid: process.pid, host: hostname() });
        expect(body.startedAt).toBe('2026-08-31T00:00:00Z');
        // While held, the opposite side refuses.
        expect(() => assertClear('local', { root, env: NOT_CI })).toThrow(InterlockError);
        held.release();
        expect(existsSync(lockFile('benchmark'))).toBe(false);
        expect(() => assertClear('local', { root, env: NOT_CI })).not.toThrow();
    });

    it('release is idempotent', () => {
        const held = acquire('local', { root, env: NOT_CI });
        held.release();
        expect(() => held.release()).not.toThrow();
    });

    it('CASUALTY: acquire REFUSES when the opposite lock is live', () => {
        writeLock('local', { kind: 'local', pid: process.pid, host: hostname(), startedAt: 'now' });
        expect(() => acquire('benchmark', { root, env: NOT_CI })).toThrow(InterlockError);
        expect(existsSync(lockFile('benchmark'))).toBe(false);   // and takes no lock
    });

    it('an unknown kind is rejected', () => {
        expect(() => assertClear('nonsense', { root, env: NOT_CI })).toThrow(/unknown interlock kind/);
    });
});
