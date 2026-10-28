import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { completedSessionCount, statusLine } from '../../scripts/verify-test-users.mjs';

/**
 * #1593 case 15 needs a returning account with verified completed sessions before its live run; the read-only
 * verifier reports that count. The stub answers ONLY the exact read-only query (sessions, head-only exact count,
 * user_id = the account, status = completed); any other query shape gets a different count, so a dropped or
 * altered filter cannot pass.
 */
const USER = 'user-free-1';
const EXACT = 7;
const WRONG = 999;

function stubSupabase({ count = EXACT, error = null } = {}) {
    const calls = [];
    const client = {
        from(table) {
            const q = { table, select: null, filters: [] };
            calls.push(q);
            const builder = {
                select(column, options) { q.select = { column, options }; return builder; },
                eq(key, value) { q.filters.push([key, value]); return builder; },
                then(resolveFn, rejectFn) {
                    const exact = q.table === 'sessions'
                        && q.select?.column === 'id'
                        && q.select?.options?.count === 'exact'
                        && q.select?.options?.head === true
                        && q.filters.length === 2
                        && q.filters.some(([k, v]) => k === 'user_id' && v === USER)
                        && q.filters.some(([k, v]) => k === 'status' && v === 'completed');
                    return Promise.resolve(error ? { count: null, error } : { count: exact ? count : WRONG, error: null })
                        .then(resolveFn, rejectFn);
                },
            };
            return builder;
        },
    };
    return { client, calls };
}

describe('verify-test-users: read-only completed-session count (#1593 case 15)', () => {
    it('counts only the account\'s completed sessions with a head-only exact count', async () => {
        const { client, calls } = stubSupabase();
        expect(await completedSessionCount(client, USER)).toBe(EXACT);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
            table: 'sessions',
            select: { column: 'id', options: { count: 'exact', head: true } },
            filters: [['user_id', USER], ['status', 'completed']],
        });
    });

    it('a real zero stays zero (no history), distinct from unverified', async () => {
        const { client } = stubSupabase({ count: 0 });
        expect(await completedSessionCount(client, USER)).toBe(0);
    });

    it('an unverifiable count is null, never a 0 that reads as "no history"', async () => {
        expect(await completedSessionCount(stubSupabase({ error: { code: '42501' } }).client, USER)).toBeNull();
        expect(await completedSessionCount(stubSupabase({ count: null }).client, USER)).toBeNull();
        expect(await completedSessionCount(stubSupabase({ count: -1 }).client, USER)).toBeNull();
        expect(await completedSessionCount(stubSupabase({ count: 2.5 }).client, USER)).toBeNull();
    });

    it('the status line reports the count, "unverified" when unknown, and nothing when there is no auth user', () => {
        const base = { label: 'free reviewer', authUserExists: true, profileRowExists: true, subscriptionStatus: 'free', expectedTier: 'free' };
        expect(statusLine('PASS', { ...base, completedSessions: 3 }))
            .toBe('PASS free reviewer: auth user exists, profile row exists, status=free, completed sessions=3');
        expect(statusLine('PASS', { ...base, completedSessions: null }))
            .toBe('PASS free reviewer: auth user exists, profile row exists, status=free, completed sessions=unverified');
        expect(statusLine('FAIL', { ...base, authUserExists: false, profileRowExists: false, subscriptionStatus: null, completedSessions: null }))
            .toBe('FAIL free reviewer: auth user missing, profile row missing');
    });

    it('each found account\'s result carries the count; the PASS rule is unchanged', () => {
        const src = readFileSync(resolve(process.cwd(), 'scripts/verify-test-users.mjs'), 'utf8');
        expect(src).toContain('completedSessions: authUser ? await completedSessionCount(supabase, authUser.id) : null,');
        expect(src).toContain('const pass = Boolean(authUser && profile && subscriptionStatus === candidate.expectedTier);');
    });

    it('importing the verifier runs nothing: main() is behind the entrypoint guard', () => {
        const src = readFileSync(resolve(process.cwd(), 'scripts/verify-test-users.mjs'), 'utf8');
        expect(src).toMatch(/if \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href\) \{\n {2}main\(\)/);
    });
});
