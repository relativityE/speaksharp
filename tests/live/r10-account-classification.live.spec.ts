/**
 * R10 account traffic-class READ (PO-authorized read-only production lookup, 2026-11-05).
 *
 * Run 42094874240 stopped in the prerequisite preflight with `analytics-classification`. This spec reads, with the
 * service role, the server-issued `app_metadata` traffic claims of the two accounts the R10 15-case request selects
 * and reports each role's EFFECTIVE class by the product's own precedence (frontend/src/services/telemetry/trafficType.ts:
 * canary > internal_test > user; claims honoured only when strictly `true`).
 *
 * READ ONLY. It calls auth.admin.listUsers and nothing else: no update, no sign-in, no session, no product request.
 * It prints only role names, booleans and the derived class: never an account id, an email or any other metadata.
 * Role -> account follows the R10 request's own role truth (init_run_inputs.ROLE_CREDENTIALS):
 *   existing-disposable  = vars.THROWAWAY_TEST_EMAIL  (AHT-01..14)
 *   maintained-read-only = vars.FREE_TEST_EMAIL       (AHT-15; the shared reusable Free fixture)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const ROLES = [
    { role: 'existing-disposable', emailVar: 'THROWAWAY_TEST_EMAIL' },
    { role: 'maintained-read-only', emailVar: 'FREE_TEST_EMAIL' },
] as const;

type Claims = Record<string, unknown> | null | undefined;
export function effectiveClass(appMetadata: Claims): 'canary' | 'internal_test' | 'user' {
    if (appMetadata?.canary === true) return 'canary';
    if (appMetadata?.internal_tester === true) return 'internal_test';
    return 'user';
}

test('R10 account classification: read-only effective traffic class per role', async () => {
    const url = process.env.SUPABASE_URL ?? '';
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    expect(url, 'SUPABASE_URL').toMatch(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
    expect(serviceRole.length > 0, 'SUPABASE_SERVICE_ROLE_KEY present').toBe(true);
    const wanted = new Map<string, string>();
    for (const { role, emailVar } of ROLES) {
        const email = (process.env[emailVar] ?? '').trim().toLowerCase();
        expect(email.length > 0, `${emailVar} present`).toBe(true);
        wanted.set(email, role);
    }
    const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const found = new Map<string, Claims[]>();
    for (let page = 1; page <= 200; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        expect(error?.message ?? null, 'listUsers').toBeNull();
        const users = data?.users ?? [];
        for (const user of users) {
            const role = wanted.get((user.email ?? '').toLowerCase());
            if (role) found.set(role, [...(found.get(role) ?? []), user.app_metadata as Claims]);
        }
        if (users.length < 100) break;
    }
    const report = ROLES.map(({ role }) => {
        const matches = found.get(role) ?? [];
        const claims = matches[0];
        return {
            role,
            accountsMatched: matches.length,
            canaryClaim: claims?.canary === true,
            internalTesterClaim: claims?.internal_tester === true,
            canaryClaimPresentButNotTrue: claims !== undefined && claims !== null && 'canary' in claims && claims.canary !== true,
            internalTesterClaimPresentButNotTrue: claims !== undefined && claims !== null && 'internal_tester' in claims && claims.internal_tester !== true,
            effectiveClass: matches.length === 1 ? effectiveClass(claims) : 'unresolved',
        };
    });
    // The one line the operator reads: content-free (roles, counts, booleans, classes).
    console.log(`R10_ACCOUNT_CLASSIFICATION ${JSON.stringify(report)}`);
    for (const row of report) expect(row.accountsMatched, `${row.role} resolves to exactly one account`).toBe(1);
});
