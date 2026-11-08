// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { enduranceReadiness } from '../../scripts/lib/enduranceReadiness.mjs';

// Stress and Endurance run 42474354454 (Sam 1794138777 / 1794138818 / 1794141451 / 1794141486): browser-endurance readiness is
// READ-ONLY, decided by the shared read-only foundation verdict (verifyCanaryFoundation 'free_test', whose "active" is the canonical
// five-argument effective_subscription_tier RPC on the DATABASE clock), and checked before any account write; anything else refuses
// with ZERO calls to any mutator. In-memory fake only — no network, no real account.

const DB_NOW = Date.parse('2026-11-08T12:00:02Z');   // the database clock the fake tier RPC evaluates with
const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString();
const EMAILS = ['soak-test45@test.com', 'soak-test46@test.com'];

function fakeAdmin({ users, profiles = {}, ledger = {}, listError = false, failRead = null, rpcError = false, dbNow = DB_NOW, pages = null } = {}) {
    const calls = [];
    const mutations = [];
    const mutator = (name) => (...args) => { mutations.push(name); calls.push(name); return Promise.resolve({ data: null, error: null, args }); };
    const query = (table) => {
        const filters = [];
        const chain = {
            select: () => chain,
            eq: (col, val) => { filters.push([col, val]); return chain; },
            maybeSingle: async () => {
                calls.push(`read:${table}`);
                if (failRead === table) return { data: null, error: { message: 'read failed' } };
                const src = table === 'user_profiles' ? profiles : table === 'trial_entitlements' ? ledger : {};
                return { data: src[filters[0][1]] ?? null, error: null };
            },
            insert: mutator(`${table}.insert`), update: mutator(`${table}.update`), upsert: mutator(`${table}.upsert`), delete: mutator(`${table}.delete`),
        };
        return chain;
    };
    const client = {
        auth: { admin: {
            listUsers: async ({ page }) => {
                calls.push('read:listUsers');
                if (listError) return { data: null, error: { message: 'list failed' } };
                if (pages) return { data: { users: pages[page - 1] ?? [] }, error: null };
                return { data: { users: page === 1 ? users : [] }, error: null };
            },
            createUser: mutator('auth.createUser'), deleteUser: mutator('auth.deleteUser'), updateUserById: mutator('auth.updateUserById'),
            inviteUserByEmail: mutator('auth.inviteUserByEmail'), generateLink: mutator('auth.generateLink'),
        } },
        from: (table) => query(table),
        // The read-only server decision (its own now()). Any OTHER rpc would be an unknown, possibly mutating call.
        rpc: async (name, args) => {
            if (name !== 'effective_subscription_tier') { mutations.push(`rpc:${name}`); return { data: null, error: null }; }
            calls.push('read:rpc:effective_subscription_tier');
            if (rpcError) return { data: null, error: { message: 'rpc failed', status: 503 } };
            const active = !!args.p_commercial_trial_granted_at && Date.parse(args.p_trial_expires_at) > dbNow;
            return { data: active ? 'pro' : 'free', error: null };
        },
    };
    return { client, calls, mutations };
}

const profile = (id, expiry, over = {}) => ({ id, subscription_status: 'free', subscription_id: null, stripe_customer_id: null, stripe_subscription_id: null,
    trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry), commercial_trial_granted_at: iso(expiry - 30 * DAY), ...over });
const entitlement = (email, id, expiry, over = {}) => ({ email, user_id: id, trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry), ...over });
function world(over = {}, expiry = DB_NOW + 20 * DAY) {
    return {
        users: [{ id: 'u45', email: EMAILS[0] }, { id: 'u46', email: EMAILS[1] }],
        profiles: { u45: profile('u45', expiry), u46: profile('u46', expiry) },
        ledger: { [EMAILS[0]]: entitlement(EMAILS[0], 'u45', expiry), [EMAILS[1]]: entitlement(EMAILS[1], 'u46', expiry) },
        ...over,
    };
}
const with45 = (mutate, expiry = DB_NOW + 20 * DAY) => { const w = world({}, expiry); mutate(w); return w; };
const run = async (w) => { const f = fakeAdmin(w); const r = await enduranceReadiness({ adminClient: f.client, emails: EMAILS }); return { ...r, ...f }; };
const stateOf = (r, email) => r.accounts.find((a) => a.email === email)?.state;

describe('browser-endurance readiness: the shared read-only foundation verdict, the database clock, zero writes', () => {
    it('two genuine active-trial accounts are ready, decided by the tier RPC, with reads only', async () => {
        const r = await run(world());
        expect(r.ready).toBe(true);
        expect(r.accounts.map((a) => a.state)).toEqual(['active', 'active']);
        expect(r.calls.filter((c) => c === 'read:rpc:effective_subscription_tier')).toHaveLength(2);
        expect(r.mutations).toEqual([]);
        expect(r.calls.every((c) => c.startsWith('read:'))).toBe(true);
    });

    it("run 42474354454's real shape (expiry 2026-05-30) -> expired by the database decision, zero writes", async () => {
        const exp = Date.parse('2026-05-30T16:00:15.186134Z');
        const r = await run(with45((w) => { w.profiles.u45 = profile('u45', exp); w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'u45', exp); }));
        expect(r.ready).toBe(false);
        expect(stateOf(r, EMAILS[0])).toBe('expired');
        expect(r.mutations).toEqual([]);
    });

    it("Sam's boundary: expiry 12:00:01 is past the DATABASE time 12:00:02 even if another clock says 12:00:00 -> expired", async () => {
        const exp = Date.parse('2026-11-08T12:00:01Z');
        const r = await run(with45((w) => { w.profiles.u45 = profile('u45', exp); w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'u45', exp); }));
        expect(stateOf(r, EMAILS[0])).toBe('expired');
        expect(r.calls).toContain('read:rpc:effective_subscription_tier');
        expect(r.mutations).toEqual([]);
    });

    const refusals = {
        'missing profile trial start': [with45((w) => { w.profiles.u45.trial_started_at = null; }), 'ineligible'],
        'inverted trial window': [with45((w) => { const p = w.profiles.u45; [p.trial_started_at, p.trial_expires_at] = [p.trial_expires_at, p.trial_started_at]; }), 'ineligible'],
        'inverted ledger window (profile consistent)': [with45((w) => { const l = w.ledger[EMAILS[0]]; [l.trial_started_at, l.trial_expires_at] = [l.trial_expires_at, l.trial_started_at]; }), 'ambiguous'],
        'synthetic paid billing (sub_test_)': [with45((w) => { w.profiles.u45.stripe_subscription_id = 'sub_test_soak_test45'; }), 'ineligible'],
        'stored paid state': [with45((w) => { w.profiles.u45.subscription_status = 'pro'; }), 'ineligible'],
        'window not 30 days': [with45((w) => { w.profiles.u45.trial_started_at = iso(Date.parse(w.profiles.u45.trial_expires_at) - 40 * DAY); }), 'ineligible'],
        'null commercial grant': [with45((w) => { w.profiles.u45.commercial_trial_granted_at = null; }), 'ineligible'],
        'missing auth owner': [world({ users: [{ id: 'u46', email: EMAILS[1] }] }), 'missing'],
        'two auth owners for one address': [world({ users: [{ id: 'u45', email: EMAILS[0] }, { id: 'x', email: ' SOAK-test45@test.com ' }, { id: 'u46', email: EMAILS[1] }] }), 'ambiguous'],
        'missing profile': [with45((w) => { delete w.profiles.u45; }), 'missing'],
        'missing trial entitlement': [with45((w) => { delete w.ledger[EMAILS[0]]; }), 'missing'],
        'entitlement bound to another owner': [with45((w) => { w.ledger[EMAILS[0]].user_id = 'someone-else'; }), 'ambiguous'],
        'profile and entitlement expiry differ': [with45((w) => { w.ledger[EMAILS[0]].trial_expires_at = iso(DB_NOW + 25 * DAY); }), 'ambiguous'],
        'tier RPC failed (503)': [{ ...world(), rpcError: true }, 'unreadable'],
        'profile read error': [{ ...world(), failRead: 'user_profiles' }, 'unreadable'],
        'entitlement read error': [{ ...world(), failRead: 'trial_entitlements' }, 'unreadable'],
        'auth inventory error': [{ ...world(), listError: true }, 'unreadable'],
        'expiry exactly at the database time': [with45((w) => { w.profiles.u45 = profile('u45', DB_NOW); w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'u45', DB_NOW); }), 'expired'],
    };
    for (const [name, [w, state]] of Object.entries(refusals)) {
        it(`${name} -> ${state}, not ready, zero mutator calls`, async () => {
            const r = await run(w);
            expect(r.ready).toBe(false);
            expect(stateOf(r, EMAILS[0])).toBe(state);
            expect(r.mutations).toEqual([]);
        });
    }

    it('a truncated Auth inventory (every page full) is unreadable, never "missing"', async () => {
        const full = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, email: `filler${i}@test.com` }));
        const f = fakeAdmin({ ...world(), pages: new Proxy([], { get: (t, k) => (k === 'length' ? 1e9 : /^\d+$/.test(String(k)) ? full : t[k]) }) });
        const r = await enduranceReadiness({ adminClient: f.client, emails: EMAILS });
        expect(r.ready).toBe(false);
        expect(r.accounts.every((a) => a.state === 'unreadable')).toBe(true);
        expect(f.mutations).toEqual([]);
    });
});

describe('setup-test-users.mjs checks readiness before every write and never deletes or recreates endurance accounts', () => {
    const src = fs.readFileSync(path.resolve('scripts/setup-test-users.mjs'), 'utf8');
    const main = src.slice(src.indexOf('async function main()'));

    it('soak readiness and its refusal precede rename, password sync, provisioning and tier sync', () => {
        const gate = main.indexOf('const readiness = await enduranceReadiness(');
        const refuse = main.indexOf('process.exit(1);', gate);
        expect(gate).toBeGreaterThan(0);
        const writes = ['await renameOldUser(', 'await syncUserPasswords(', 'supabase.auth.admin.createUser(', 'await syncUserTiers('];
        expect(writes.filter((write) => !(main.indexOf(write) > refuse))).toEqual([]);
        expect(main.slice(gate - 200, gate)).toContain("if (MODE === 'soak')");
    });

    it('the delete/recreate path is gone and no runner or HTTP clock decides readiness', () => {
        expect(src).not.toMatch(/deleteUser\(/);
        expect(src).not.toMatch(/deleteAccountCascadeSafe|ensureActiveTrialEnduranceAccount|RESTRICT_USER_CHILD_TABLES|serverNow/);
        expect(src).not.toMatch(/\.from\(['"](sessions|usage_checkpoints|user_profiles)['"]\)\s*\.delete\(/);
        const lib = fs.readFileSync(path.resolve('scripts/lib/enduranceReadiness.mjs'), 'utf8');
        expect(lib).not.toMatch(/Date\.now\(|new Date\(\)|['"]date['"]/);
        expect(lib).toMatch(/verifyCanaryFoundation\(adminClient, id, ENDURANCE_PURPOSE\)/);
    });
});
