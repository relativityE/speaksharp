/**
 * R10 account canary claim WRITE (PO approval 2026-11-05 ~23:5xZ: "set canary: true on both existing R10 test accounts,
 * preserving their other metadata").
 *
 * Writes ONLY when RWT_CANARY_CLAIM_ACK is exactly the one-time acknowledgement below (rc-gates input rwt_canary_claim_ack);
 * otherwise it is a read and changes nothing. For each R10 role it resolves exactly one account by its role-truth email
 * variable, reads the server-issued app_metadata, writes {...existing, canary: true} only if canary is not already true,
 * then reads the account back and requires canary === true AND every other app_metadata key byte-identical to before.
 * It prints only roles, booleans, classes and key COUNTS: never an id, an email or a metadata value.
 * Effective class follows frontend/src/services/telemetry/trafficType.ts (canary > internal_test > user).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const ACK = 'R10-CANARY-CLAIM-PO-20261105';
const ROLES = [
    { role: 'existing-disposable', emailVar: 'THROWAWAY_TEST_EMAIL' },
    { role: 'maintained-read-only', emailVar: 'FREE_TEST_EMAIL' },
] as const;

type Meta = Record<string, unknown>;
const klass = (m: Meta | null | undefined) => (m?.canary === true ? 'canary' : m?.internal_tester === true ? 'internal_test' : 'user');
const withoutCanary = (m: Meta) => JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'canary').sort(([a], [b]) => a.localeCompare(b))));

test('R10 accounts: set the server-issued canary claim, preserving every other app_metadata key', async () => {
    const write = process.env.RWT_CANARY_CLAIM_ACK === ACK;
    const url = process.env.SUPABASE_URL ?? '';
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    expect(url).toMatch(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
    expect(serviceRole.length > 0).toBe(true);
    const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const wanted = new Map<string, string>();
    for (const { role, emailVar } of ROLES) {
        const email = (process.env[emailVar] ?? '').trim().toLowerCase();
        expect(email.length > 0, `${emailVar} present`).toBe(true);
        wanted.set(email, role);
    }
    const ids = new Map<string, string[]>();
    for (let page = 1; page <= 200; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        expect(error?.message ?? null).toBeNull();
        const users = data?.users ?? [];
        for (const user of users) {
            const role = wanted.get((user.email ?? '').toLowerCase());
            if (role) ids.set(role, [...(ids.get(role) ?? []), user.id]);
        }
        if (users.length < 100) break;
    }
    for (const { role } of ROLES) expect(ids.get(role)?.length ?? 0, `${role} resolves to exactly one account`).toBe(1);

    const receipt = [];
    for (const { role } of ROLES) {
        const id = ids.get(role)![0];
        const before = await admin.auth.admin.getUserById(id);
        expect(before.error?.message ?? null).toBeNull();
        const meta = (before.data.user?.app_metadata ?? {}) as Meta;
        let wrote = false;
        if (write && meta.canary !== true) {
            const { error } = await admin.auth.admin.updateUserById(id, { app_metadata: { ...meta, canary: true } });
            expect(error?.message ?? null, `${role} update`).toBeNull();
            wrote = true;
        }
        const after = await admin.auth.admin.getUserById(id);
        expect(after.error?.message ?? null).toBeNull();
        const metaAfter = (after.data.user?.app_metadata ?? {}) as Meta;
        const row = {
            role, writeAuthorized: write, wrote,
            classBefore: klass(meta), classAfter: klass(metaAfter),
            canaryAfter: metaAfter.canary === true,
            otherKeysBefore: Object.keys(meta).filter(k => k !== 'canary').length,
            otherKeysAfter: Object.keys(metaAfter).filter(k => k !== 'canary').length,
            otherKeysIdentical: withoutCanary(meta) === withoutCanary(metaAfter),
        };
        receipt.push(row);
        expect(row.otherKeysIdentical, `${role}: every non-canary app_metadata key preserved`).toBe(true);
        if (write) expect(row.canaryAfter, `${role}: canary set`).toBe(true);
    }
    console.log(`R10_CANARY_CLAIM_RECEIPT ${JSON.stringify(receipt)}`);
});
