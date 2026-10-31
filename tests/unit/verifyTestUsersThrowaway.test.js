import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyThrowaway } from '../../scripts/verify-test-users.mjs';

/**
 * Sam 2(b): the Cloud test live caller's fresh account facts come from this read-only verifier target. It reads one auth-user lookup and
 * one head-only completed-session count; the id goes only to a NEW private file, and nothing it returns or prints names the account.
 */
const EMAIL = 'throwaway.synthetic@example.invalid';
const USER = '11111111-1111-4111-8111-111111111111';
const dirs = [];
const tempFile = () => { const d = mkdtempSync(join(tmpdir(), 'verify-throwaway-')); dirs.push(d); return join(d, 'account-id'); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function stub({ count = 3, error = null } = {}) {
    const queries = [];
    const supabase = {
        from(table) {
            const q = { table, select: null, filters: [] };
            queries.push(q);
            const builder = {
                select(column, options) { q.select = { column, options }; return builder; },
                eq(key, value) { q.filters.push([key, value]); return builder; },
                then(resolveFn, rejectFn) { return Promise.resolve(error ? { count: null, error } : { count, error: null }).then(resolveFn, rejectFn); },
            };
            return builder;
        },
    };
    return { supabase, queries };
}
const users = async () => [{ id: 'other', email: 'someone@example.invalid' }, { id: USER, email: EMAIL.toUpperCase() }];

describe('verify-test-users throwaway target', () => {
    it('reports existence and the head-only count, writes the id only to a new private file, and returns no identifier', async () => {
        const { supabase, queries } = stub({ count: 0 });
        const file = tempFile();
        const result = await verifyThrowaway({ supabase, email: EMAIL, accountIdFile: file, listUsers: users });
        expect(result).toEqual({ target: 'throwaway', authUserExists: true, completedSessions: 0, accountIdWritten: true });
        expect(readFileSync(file, 'utf8')).toBe(`${USER}\n`);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(JSON.stringify(result)).not.toMatch(new RegExp(`${USER}|throwaway\\.synthetic|example\\.invalid`, 'i'));
        expect(queries).toHaveLength(1);
        expect(queries[0]).toEqual({ table: 'sessions', select: { column: 'id', options: { count: 'exact', head: true } },
            filters: [['user_id', USER], ['status', 'completed']] });
    });

    it('an absent account writes nothing and reports no count', async () => {
        const { supabase, queries } = stub();
        const file = tempFile();
        const result = await verifyThrowaway({ supabase, email: 'absent@example.invalid', accountIdFile: file, listUsers: users });
        expect(result).toEqual({ target: 'throwaway', authUserExists: false, completedSessions: null, accountIdWritten: false });
        expect(() => statSync(file)).toThrow();
        expect(queries).toHaveLength(0);
    });

    it('a failed count is null, never a 0 that reads as no history', async () => {
        const { supabase } = stub({ error: { message: 'denied' } });
        const result = await verifyThrowaway({ supabase, email: EMAIL, accountIdFile: tempFile(), listUsers: users });
        expect(result.completedSessions).toBeNull();
    });

    it('refuses to overwrite an existing id file, and refuses missing inputs', async () => {
        const file = tempFile();
        writeFileSync(file, 'stale\n');
        await expect(verifyThrowaway({ supabase: stub().supabase, email: EMAIL, accountIdFile: file, listUsers: users })).rejects.toThrow();
        expect(readFileSync(file, 'utf8')).toBe('stale\n');
        await expect(verifyThrowaway({ supabase: stub().supabase, email: '', accountIdFile: tempFile(), listUsers: users })).rejects.toThrow(/required/);
        await expect(verifyThrowaway({ supabase: stub().supabase, email: EMAIL, accountIdFile: '', listUsers: users })).rejects.toThrow(/required/);
    });
});
