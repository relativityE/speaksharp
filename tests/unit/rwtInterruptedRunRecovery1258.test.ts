// @vitest-environment node
/**
 * #1258 B1 (Browser PM 6097765962) — interrupted-run recovery: selection refuses fresh / non-owned / malformed / ambiguous
 * accounts, the listing is bounded and fails closed, no ack = detect-and-HOLD (nothing deleted), the ack is a distinct value on the existing rwt_writes_ack input, deletion goes only through
 * the existing fail-closed cleanup, a second run is a no-op, and the report never carries an id or email.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    MIN_AGE_MS, RECOVERY_DELETE_ACK, listAuthUsersBounded, recoverInterruptedRuns, recoveryReportLine, selectInterruptedRunAccounts,
    type AdminLike, type AuthUserLike,
} from '../live/helpers/rwtInterruptedRunRecovery';

const NOW = Date.parse('2026-10-10T13:00:00Z');
const old = new Date(NOW - MIN_AGE_MS - 60_000).toISOString();
const fresh = new Date(NOW - 10 * 60_000).toISOString();
const uuid = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`;
const user = (n: number, email: string, created_at: string): AuthUserLike => ({ id: uuid(n), email, created_at });

/** A fake admin whose users disappear when the injected cleanup "deletes" them (models the real proof). */
const fakeAdmin = (initial: AuthUserLike[], perPageLimit = Number.POSITIVE_INFINITY) => {
    const users = [...initial];
    const listUsers = vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => {
        const size = Math.min(perPage, perPageLimit);
        return { data: { users: users.slice((page - 1) * size, page * size) }, error: null };
    });
    const admin = { auth: { admin: { listUsers } } } as unknown as AdminLike;
    const cleanup = vi.fn(async ({ capturedUid }: { capturedUid: string }) => {
        const i = users.findIndex((u) => u.id === capturedUid);
        users.splice(i, 1);
        return capturedUid;
    });
    return { admin, cleanup, listUsers };
};

describe('selection', () => {
    it('only an old, well-formed, unambiguous run-owned account is eligible', () => {
        const { eligible, counts } = selectInterruptedRunAccounts([
            user(1, 'rwt-journey-abc@example.com', old),        // eligible
            user(2, 'rwt-journey-new@example.com', fresh),      // fresh
            user(3, 'person@example.com', old),                 // non-owned
            { id: 'not-a-uuid', email: 'rwt-journey-x@example.com', created_at: old },      // malformed id
            user(5, 'rwt-journey-bad@example.com', 'yesterday'),                           // malformed date
            user(6, 'rwt-journey-future@example.com', new Date(NOW + 60_000).toISOString()), // created in the future
            user(7, 'retention-proof-dup@example.com', old), user(8, 'retention-proof-dup@example.com', old), // ambiguous
        ], NOW);
        expect(eligible.map((c) => c.id)).toEqual([uuid(1)]);
        expect(eligible[0].prefix).toBe('rwt-journey-');
        expect(counts).toEqual({ scanned: 8, nonOwned: 1, runOwned: 7, fresh: 1, malformed: 3, ambiguous: 2, eligible: 1 });
    });
    it('the age floor is the gate-3 timeout plus a safety margin (75 min)', () => {
        expect(MIN_AGE_MS).toBe(75 * 60_000);
        const justYoung = new Date(NOW - MIN_AGE_MS + 1_000).toISOString();
        expect(selectInterruptedRunAccounts([user(1, 'rwt-journey-a@example.com', justYoung)], NOW).counts.fresh).toBe(1);
    });
});

describe('listing', () => {
    it('pages until a short page; an API error fails closed', async () => {
        const users = Array.from({ length: 5 }, (_, i) => user(i + 1, `x${i}@example.com`, old));
        const { admin, listUsers } = fakeAdmin(users, 2);
        expect((await listAuthUsersBounded(admin, 2, 10)).users).toHaveLength(5);
        expect(listUsers).toHaveBeenCalledTimes(3);
        const broken = { auth: { admin: { listUsers: async () => ({ data: null, error: { code: 'boom' } }) } } } as unknown as AdminLike;
        await expect(listAuthUsersBounded(broken)).rejects.toThrow(/fail closed/);
    });
    it('CASUALTY: hitting the page cap with a full page is INCOMPLETE → HOLD, nothing deleted', async () => {
        const users = Array.from({ length: 4 }, (_, i) => user(i + 1, `rwt-journey-${i}@example.com`, old));
        const { admin, cleanup } = fakeAdmin(users, 2);
        const r = await recoverInterruptedRuns({ admin, nowMs: NOW, ack: RECOVERY_DELETE_ACK, cleanup, perPage: 2, maxPages: 2 });
        expect([r.status, cleanup.mock.calls.length]).toEqual(['HOLD_INCOMPLETE_LISTING', 0]);
    });
});

describe('recovery', () => {
    const accounts = () => [user(1, 'rwt-journey-a@example.com', old), user(2, 'private-proof-b@example.com', old), user(3, 'rwt-journey-c@example.com', fresh)];

    it('no ack (or a wrong ack) detects and HOLDs: the cleanup is never called', async () => {
        for (const ack of ['', 'RWT-DISPOSABLE-ACCOUNT-WRITES']) {
            const { admin, cleanup } = fakeAdmin(accounts());
            const r = await recoverInterruptedRuns({ admin, nowMs: NOW, ack, cleanup });
            expect([r.status, r.eligible, r.deleted, cleanup.mock.calls.length]).toEqual(['HOLD_NO_ACK', 2, 0, 0]);
        }
    });
    it('with the exact ack, each eligible account goes through the cleanup proof with its own prefix; a second run is a no-op', async () => {
        const { admin, cleanup } = fakeAdmin(accounts());
        const first = await recoverInterruptedRuns({ admin, nowMs: NOW, ack: RECOVERY_DELETE_ACK, cleanup });
        expect([first.status, first.deleted]).toEqual(['RECOVERED', 2]);
        expect(cleanup.mock.calls.map(([p]) => p.runOwnedPrefix)).toEqual(['rwt-journey-', 'private-proof-']);
        const second = await recoverInterruptedRuns({ admin, nowMs: NOW, ack: RECOVERY_DELETE_ACK, cleanup });
        expect([second.status, second.deleted, cleanup.mock.calls.length]).toEqual(['NOTHING_TO_RECOVER', 0, 2]);
    });
    it('CASUALTY: a cleanup that cannot prove deletion stops the run (fail closed) and reports what was proven', async () => {
        const { admin } = fakeAdmin(accounts());
        const cleanup = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('residue in sessions'));
        const r = await recoverInterruptedRuns({ admin, nowMs: NOW, ack: RECOVERY_DELETE_ACK, cleanup });
        expect([r.status, r.deleted, cleanup.mock.calls.length]).toEqual(['FAILED', 1, 2]);
    });
    it('the report line is content-safe (no id, no email)', async () => {
        const { admin, cleanup } = fakeAdmin(accounts());
        const line = recoveryReportLine(await recoverInterruptedRuns({ admin, nowMs: NOW, ack: '', cleanup }));
        expect(line).toMatch(/^RWT_INTERRUPTED_RUN_RECOVERY status=HOLD_NO_ACK /);
        expect(line).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });
    it('deletion uses the existing fail-closed cleanup by default, and the ack rides the existing rwt_writes_ack input as a distinct value', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtInterruptedRunRecovery.ts'), 'utf8');
        expect(helper).toMatch(/const cleanup = params\.cleanup \?\? cleanupRunOwnedAccount;/);
        const wf = readFileSync(resolve(__dirname, '../../.github/workflows/rc-gates.yml'), 'utf8');
        // No new dispatch input (rc-gates is capped at 10); the existing input documents both values and the refusal.
        expect(wf).not.toMatch(/rwt_recovery_ack|RWT_RECOVERY_ACK/);
        expect(wf).toMatch(/rwt_writes_ack:\n\s+description: "[^"]*RWT-INTERRUPTED-RUN-RECOVERY-DELETE[^"]*The journeys refuse that value/);
        const spec = readFileSync(resolve(__dirname, '../live/interrupted-run-recovery.live.spec.ts'), 'utf8');
        expect(spec).toContain("const ACK = process.env.RWT_WRITES_ACK ?? '';");
        // CASUALTY: the journeys' exact-match gate can never accept the recovery value, so one dispatch never authorizes both.
        const journey = readFileSync(resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        expect(journey).toMatch(/process\.env\.RWT_WRITES_ACK !== RWT_WRITES_ACK_VALUE/);
        expect(journey.match(/RWT_WRITES_ACK_VALUE = '([^']+)'/)?.[1]).not.toBe(RECOVERY_DELETE_ACK);
    });
    it('the recovery spec is not an rwt-* journey spec (no RWT fixture, identity or per-journey telemetry readback)', () => {
        expect(existsSync(resolve(__dirname, '../live/rwt-interrupted-run-recovery.live.spec.ts'))).toBe(false);
        expect(existsSync(resolve(__dirname, '../live/interrupted-run-recovery.live.spec.ts'))).toBe(true);
    });
});
