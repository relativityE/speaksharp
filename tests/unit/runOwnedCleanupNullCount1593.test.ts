// @vitest-environment node
/**
 * #1593 (CLI Dev 2026-10-18 cross-check): the shared run-owned cleanup read every residue count as `count ?? 0`, so a
 * `{ count: null, error: null }` readback on all 23 checks still emitted `RUN_OWNED_CLEANUP cleanup_verified residue=0`.
 * The campaign admits the next case on that numeric line, so an unknown read must never produce it. These controls drive
 * the REAL helper with a fake admin client: nothing reaches Supabase.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupRunOwnedAccount, requireZeroResidue } from '../live/helpers/runOwnedCleanup';

const EMAIL = 'rwt-journey-fixture@example.test';
const UID = '00000000-0000-4000-8000-000000000001';

/** A fake admin whose residue readbacks all return `count`; the auth user resolves, deletes, then is not found. */
function adminReturning(count: number | null) {
    let deleted = false;
    const reads: string[] = [];
    const admin = {
        auth: {
            admin: {
                listUsers: async () => ({ data: { users: [] }, error: null }),
                getUserById: async () => (deleted
                    ? { data: null, error: { status: 404, code: 'user_not_found', message: 'User not found' } }
                    : { data: { user: { email: EMAIL } }, error: null }),
                deleteUser: async () => { deleted = true; return { error: null }; },
            },
        },
        from: (table: string) => ({
            delete: () => ({ eq: async () => ({ error: null }) }),
            select: () => ({ eq: async () => { reads.push(table); return { count, error: null }; } }),
        }),
    };
    return { admin, reads };
}

const verdictLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => String(c[0])).filter((line) => line.startsWith('RUN_OWNED_CLEANUP'));

afterEach(() => { vi.restoreAllMocks(); });

describe('run-owned cleanup residue counts are counted zeros, never unknowns (#1593)', () => {
    it('NEGATIVE: a null count on every readback throws at the first read and emits NO residue=0 line', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const { admin, reads } = adminReturning(null);
        await expect(cleanupRunOwnedAccount({ admin: admin as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: 'rwt-journey-' }))
            .rejects.toThrow(/not a counted integer — residue UNPROVEN/);
        expect(reads).toHaveLength(1);
        expect(verdictLines(log)).toEqual([]);
    });

    it('CONTROL: counted zeros on every readback emit exactly one cleanup_verified residue=0 line', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const { admin, reads } = adminReturning(0);
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: 'rwt-journey-' });
        expect(reads.length).toBeGreaterThan(20);
        expect(reads.at(-1)).toBe('trial_entitlements');
        expect(verdictLines(log)).toEqual([`RUN_OWNED_CLEANUP cleanup_verified residue=0 tables_verified=${reads.length}`]);
    });

    it('CONTROL: a positive count is residue and throws at the first read', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const { admin, reads } = adminReturning(1);
        await expect(cleanupRunOwnedAccount({ admin: admin as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: 'rwt-journey-' }))
            .rejects.toThrow(/found run-owned residue/);
        expect(reads).toHaveLength(1);
        expect(verdictLines(log)).toEqual([]);
    });

    it.each([[null], [undefined], ['0'], [-1], [0.5], [Number.NaN], [Number.MAX_SAFE_INTEGER + 1]])(
        'requireZeroResidue rejects the non-counted value %p',
        (value) => { expect(() => requireZeroResidue(value, 'sessions')).toThrow(/fail closed/); },
    );

    it('requireZeroResidue accepts only a counted 0', () => {
        expect(() => requireZeroResidue(0, 'sessions')).not.toThrow();
        expect(() => requireZeroResidue(2, 'sessions')).toThrow(/residue in sessions/);
    });

    it('the helper source no longer substitutes zero for an unknown count', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('tests/live/helpers/runOwnedCleanup.ts', 'utf8');
        expect(src).not.toMatch(/[cC]ount \?\? 0\s*[,)]/);
    });
});
