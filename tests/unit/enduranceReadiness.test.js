// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { enduranceReadiness } from '../../scripts/lib/enduranceReadiness.mjs';

// Stress and Endurance run 42474354454 (Sam 1794138777 / 1794138818): browser-endurance readiness is READ-ONLY and checked before any
// account write; expired, missing, ambiguous or unreadable entitlement refuses with ZERO calls to any mutator. In-memory fake only —
// no network, no real account.

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString();
const EMAILS = ['soak-test45@test.com', 'soak-test46@test.com'];

function fakeAdmin({ users, profiles = {}, ledger = {}, listError = false, failRead = null, pages = null } = {}) {
    const calls = [];
    const mutations = [];
    const mutator = (name) => (...args) => { mutations.push(name); calls.push(name); return Promise.resolve({ data: null, error: null, args }); };
    const query = (table) => {
        const q = { table, filters: [] };
        const chain = {
            select: () => chain,
            eq: (col, val) => { q.filters.push([col, val]); return chain; },
            maybeSingle: async () => {
                calls.push(`read:${table}`);
                if (failRead === table) return { data: null, error: { message: 'read failed' } };
                const [, val] = q.filters[0];
                const src = table === 'user_profiles' ? profiles : table === 'trial_entitlements' ? ledger : {};
                return { data: src[val] ?? null, error: null };
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
        rpc: mutator('rpc'),
    };
    return { client, calls, mutations };
}

const active = (id, expiry = NOW + 20 * DAY) => ({ id, trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry), commercial_trial_granted_at: iso(expiry - 30 * DAY) });
const entitlement = (email, id, expiry = NOW + 20 * DAY) => ({ email, user_id: id, trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry) });
function world(over = {}) {
    const users = [{ id: 'u45', email: EMAILS[0] }, { id: 'u46', email: EMAILS[1] }];
    return {
        users,
        profiles: { u45: active('u45'), u46: active('u46') },
        ledger: { [EMAILS[0]]: entitlement(EMAILS[0], 'u45'), [EMAILS[1]]: entitlement(EMAILS[1], 'u46') },
        ...over,
    };
}
const run = async (w) => { const f = fakeAdmin(w); const r = await enduranceReadiness({ adminClient: f.client, emails: EMAILS, now: NOW }); return { ...r, ...f }; };
const stateOf = (r, email) => r.accounts.find((a) => a.email === email)?.state;

describe('browser-endurance readiness is read-only and fails closed', () => {
    it('two genuine active-trial accounts are ready, with reads only', async () => {
        const r = await run(world());
        expect(r.ready).toBe(true);
        expect(r.accounts.map((a) => a.state)).toEqual(['active', 'active']);
        expect(r.mutations).toEqual([]);
        expect(r.calls.every((c) => c.startsWith('read:'))).toBe(true);
    });

    it("run 42474354454's real shape: the recreated accounts kept the 2026-05-30 expiry -> expired, refused, zero writes", async () => {
        const exp = Date.parse('2026-05-30T16:00:15.186134Z');
        const w = world();
        w.profiles.u45 = { ...active('u45', exp), commercial_trial_granted_at: '2026-05-29T16:00:15.186134+00:00' };
        w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'u45', exp);
        const r = await run(w);
        expect(r.ready).toBe(false);
        expect(stateOf(r, EMAILS[0])).toBe('expired');
        expect(r.mutations).toEqual([]);
    });

    const refusals = {
        'missing auth owner': [world({ users: [{ id: 'u46', email: EMAILS[1] }] }), 'missing'],
        'two auth owners for one address': [world({ users: [{ id: 'u45', email: EMAILS[0] }, { id: 'x', email: ' SOAK-test45@test.com ' }, { id: 'u46', email: EMAILS[1] }] }), 'ambiguous'],
        'missing profile': [world({ profiles: { u46: active('u46') } }), 'missing'],
        'null commercial grant': [(() => { const w = world(); w.profiles.u45 = { ...active('u45'), commercial_trial_granted_at: null }; return w; })(), 'missing'],
        'missing trial entitlement': [(() => { const w = world(); delete w.ledger[EMAILS[0]]; return w; })(), 'missing'],
        'entitlement bound to another owner': [(() => { const w = world(); w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'someone-else'); return w; })(), 'ambiguous'],
        'profile and entitlement expiry differ': [(() => { const w = world(); w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'u45', NOW + 25 * DAY); return w; })(), 'ambiguous'],
        'malformed trial date': [(() => { const w = world(); w.profiles.u45 = { ...active('u45'), trial_expires_at: 'not-a-date' }; return w; })(), 'unreadable'],
        'profile read error': [world({ failRead: 'user_profiles' }), 'unreadable'],
        'entitlement read error': [world({ failRead: 'trial_entitlements' }), 'unreadable'],
        'auth inventory error': [world({ listError: true }), 'unreadable'],
        'expiry exactly now': [(() => { const w = world(); w.profiles.u45 = active('u45', NOW); w.ledger[EMAILS[0]] = entitlement(EMAILS[0], 'u45', NOW); return w; })(), 'expired'],
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
        const r = await enduranceReadiness({ adminClient: f.client, emails: EMAILS, now: NOW });
        expect(r.ready).toBe(false);
        expect(r.accounts.every((a) => a.state === 'unreadable')).toBe(true);
        expect(f.mutations).toEqual([]);
    });
});

describe('setup-test-users.mjs checks readiness before every write and never deletes or recreates endurance accounts', () => {
    const src = fs.readFileSync(path.resolve('scripts/setup-test-users.mjs'), 'utf8');
    const main = src.slice(src.indexOf('async function main()'));

    it('soak readiness and its refusal precede rename, password sync, provisioning and tier sync', () => {
        const gate = main.indexOf("const readiness = await enduranceReadiness(");
        const refuse = main.indexOf('process.exit(1);', gate);
        expect(gate).toBeGreaterThan(0);
        const writes = ['await renameOldUser(', 'await syncUserPasswords(', 'supabase.auth.admin.createUser(', 'await syncUserTiers('];
        expect(writes.filter((write) => !(main.indexOf(write) > refuse))).toEqual([]);
        expect(main.slice(gate - 200, gate)).toContain("if (MODE === 'soak')");
    });

    it('the delete/recreate path is gone: no account deletion and no endurance recreation remain', () => {
        expect(src).not.toMatch(/deleteUser\(/);
        expect(src).not.toMatch(/deleteAccountCascadeSafe|ensureActiveTrialEnduranceAccount|RESTRICT_USER_CHILD_TABLES/);
        expect(src).not.toMatch(/\.from\(['"](sessions|usage_checkpoints|user_profiles)['"]\)\s*\.delete\(/);
    });
});
