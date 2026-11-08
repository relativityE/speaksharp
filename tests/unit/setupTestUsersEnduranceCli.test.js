// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Sam 1794140111: an EXECUTABLE regression of the real CLI (scripts/setup-test-users.mjs, MODE=soak) against a local fake Supabase
// (Auth admin + PostgREST over HTTP, as supabase-js calls them). The fake records every mutating request. No network, no real account.

const SERVER_DATE = 'Sun, 08 Nov 2026 12:00:00 GMT';      // the server clock the readiness decision must use
const NOW = Date.parse(SERVER_DATE);
const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString();
const E45 = 'soak-test45@test.com', E46 = 'soak-test46@test.com', G0 = 'soak-test0@test.com';
const U0 = '00000000-0000-4000-8000-000000000000', U45 = '00000000-0000-4000-8000-000000000045', U46 = '00000000-0000-4000-8000-000000000046';

function trialRow(id, expiry) {
    return { id, subscription_status: 'free', trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry), commercial_trial_granted_at: iso(expiry - 30 * DAY) };
}

/** inventories: the Auth user list returned by the 1st, 2nd, ... listUsers page-1 call (the last one repeats). */
function fakeSupabase({ inventories, expiry = NOW + 20 * DAY, serverDate = SERVER_DATE }) {
    const mutations = [];
    let listCalls = 0;
    const profiles = { [U0]: trialRow(U0, expiry), [U45]: trialRow(U45, expiry), [U46]: trialRow(U46, expiry) };
    const ledger = { [E45]: { email: E45, user_id: U45, trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry) },
                     [E46]: { email: E46, user_id: U46, trial_started_at: iso(expiry - 30 * DAY), trial_expires_at: iso(expiry) } };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fake');
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const send = (status, json) => {
                res.writeHead(status, { 'content-type': 'application/json', date: serverDate });
                res.end(json === undefined ? '' : JSON.stringify(json));
            };
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                mutations.push({ method: req.method, path: url.pathname, body });
                return send(200, url.pathname.startsWith('/auth/') ? { id: 'created', email: 'x@test.com' } : []);
            }
            if (url.pathname === '/rest/v1/' || url.pathname === '/rest/v1') return send(200, {});
            if (url.pathname === '/auth/v1/admin/users') {
                const page = Number(url.searchParams.get('page') || 1);
                const users = page === 1 ? inventories[Math.min(listCalls++, inventories.length - 1)] : [];
                return send(200, { users: users.map((email) => ({ id: { [G0]: U0, [E45]: U45, [E46]: U46 }[email], email, aud: 'authenticated' })), aud: 'authenticated' });
            }
            const table = url.pathname.replace('/rest/v1/', '');
            const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
            const rows = table === 'user_profiles' ? Object.values(profiles) : table === 'trial_entitlements' ? Object.values(ledger) : [];
            const match = (row) => filters.every(([k, v]) => {
                if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
                if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(row[k]));
                return false;
            });
            return send(200, rows.filter(match));
        });
    });
    return { server, mutations, listCalls: () => listCalls };
}

const servers = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

async function runCli(fake) {
    servers.push(fake.server);
    await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
    const { port } = fake.server.address();
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'unit-service-role-not-a-key',
                  SOAK_TEST_PASSWORD: 'unit-password-not-a-secret', MODE: 'soak', ACTION: 'setup', NUM_FREE_USERS: '1', NUM_PRO_USERS: '0' };
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.resolve('scripts/setup-test-users.mjs')], { cwd: path.resolve('.'), env });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        child.on('close', (code) => resolve({ code, out }));
    });
}
// on failure, the CLI transcript is the diagnostic
const touchesEndurance = (m) => [U45, U46, E45, E46].some((t) => (m.path + m.body).includes(t));

describe('setup-test-users.mjs (real CLI, fake Supabase): endurance identities are never mutated', () => {
    it("Sam's race: readiness PASS, then soak-test45 vanishes from the later inventory -> no reset of 46, no creation of 45, refusal", async () => {
        const fake = fakeSupabase({ inventories: [[G0, E45, E46], [G0, E46]] });
        const { code, out } = await runCli(fake);
        expect(code).toBe(1);
        expect(out).toContain('no longer genuine active-trial');
        expect(fake.mutations.filter(touchesEndurance)).toEqual([]);
        expect(fake.mutations.some((m) => m.method === 'POST' && m.path === '/auth/v1/admin/users')).toBe(false);
        expect(fake.mutations.some((m) => m.method === 'DELETE')).toBe(false);
    }, 30000);

    it('an expired endurance trial (by the SERVER clock) refuses before ANY write', async () => {
        const fake = fakeSupabase({ inventories: [[G0, E45, E46]], expiry: NOW - DAY });
        const { code, out } = await runCli(fake);
        expect(code).toBe(1);
        expect(out).toContain('refusing BEFORE any account write');
        expect(fake.mutations).toEqual([]);
    }, 30000);

    it('the SERVER clock decides: a trial the runner clock still calls active is refused when the server time is past its expiry', async () => {
        // expiry one year after the runner's real clock; the fake server reports a time two years ahead -> expired by the server
        const runnerNow = Date.now();
        const fake = fakeSupabase({ inventories: [[G0, E45, E46]], expiry: runnerNow + 365 * DAY, serverDate: new Date(runnerNow + 730 * DAY).toUTCString() });
        const { code, out } = await runCli(fake);
        expect(code).toBe(1);
        expect(out).toContain('refusing BEFORE any account write');
        expect(fake.mutations).toEqual([]);
    }, 30000);

    it('ready endurance accounts: the generic paths run for other users only; nothing touches 45/46', async () => {
        const fake = fakeSupabase({ inventories: [[G0, E45, E46]] });
        const { code } = await runCli(fake);
        expect(code).toBe(0);
        expect(fake.mutations.filter(touchesEndurance)).toEqual([]);
        expect(fake.mutations.some((m) => m.method === 'PUT' && m.path === `/auth/v1/admin/users/${U0}`)).toBe(true);   // generic password sync still runs
    }, 30000);
});
