import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
    resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260607040000_active_recording_lease.sql'),
    'utf8',
);

/**
 * ACCOUNT-REC-LEASE contract: the account-wide single-recording mutex must be SERVER-ENFORCED
 * (so a credential-sharer can't bypass it from the client) and scoped per user with heartbeat/expiry.
 */
describe('active_recording_lease migration contract', () => {
    it('keys the lease per user with a heartbeat column', () => {
        expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.active_recording_lease/);
        expect(migration).toMatch(/user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\)/);
        expect(migration).toMatch(/heartbeat_at timestamptz/);
    });

    it('enables RLS scoped to the owner', () => {
        expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
        expect(migration).toMatch(/\(select auth\.uid\(\)\) = user_id/);
    });

    it('exposes atomic acquire/heartbeat/release RPCs, server-enforced (SECURITY DEFINER + auth.uid)', () => {
        for (const fn of ['acquire_recording_lease', 'heartbeat_recording_lease', 'release_recording_lease']) {
            expect(migration).toMatch(new RegExp(`FUNCTION public\\.${fn}`));
        }
        expect(migration).toMatch(/SECURITY DEFINER/);
        expect(migration).toMatch(/auth\.uid\(\)/);
        // acquire must take the row lock so concurrent devices can't both win.
        expect(migration).toMatch(/FOR UPDATE/);
        // a live OTHER holder blocks unless explicitly forced (take-over).
        expect(migration).toMatch(/held_by_other/);
        expect(migration).toMatch(/p_force/);
        // stale (crashed) leases free automatically.
        expect(migration).toMatch(/interval '15 seconds'/);
    });

    it('grants execute only to authenticated users', () => {
        for (const fn of ['acquire_recording_lease', 'heartbeat_recording_lease', 'release_recording_lease']) {
            expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*TO authenticated`));
        }
    });
});
