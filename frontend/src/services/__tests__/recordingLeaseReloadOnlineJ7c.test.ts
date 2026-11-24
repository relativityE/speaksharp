/**
 * J7.c review C (Codex on #1968 at 6093a9ac): after a reload, the browser coming back online ALONE (no acquire, release or
 * sign-in event) settles the signed-in account's stored unsettled Start: the reconnect listener is armed when the module
 * loads. The fresh module is a real re-import (a reload), and its default rpc is the app's own client (mocked here).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const X = 'f0110000-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const Y = 'f0110000-0000-4000-8000-00000000000b';
const calls: Array<{ fn: string; id: unknown }> = [];
const open = new Set<string>([X]);
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        rpc: async (fn: string, args: Record<string, unknown>) => {
            calls.push({ fn, id: args.p_lease_id });
            if (fn === 'abandon_recording_start_v1' && open.has(args.p_lease_id as string)) {
                open.delete(args.p_lease_id as string);
                return { data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null };
            }
            return { data: { abandoned: false, reason: 'unknown_identity' }, error: null };
        },
    }),
}));

/** Every module instance a test loads (each arms its own online listener at load): all reset after each test. */
const loaded: Array<{ __resetTakeLeaseForTests: () => void }> = [];
const loginLogs: Array<{ setCurrentLogin: (o: string | null, t: number | null) => void }> = [];
beforeEach(() => { vi.resetModules(); window.localStorage.clear(); calls.length = 0; open.clear(); open.add(X); });
afterEach(() => {
    for (const m of loaded.splice(0)) m.__resetTakeLeaseForTests();
    for (const l of loginLogs.splice(0)) l.setCurrentLogin(null, null);
    window.localStorage.clear();
});
async function importLease() { const m = await import('../recordingLease'); loaded.push(m); return m; }
async function importLoginLog() { const l = await import('../loginSessionLog'); loginLogs.push(l); return l; }

it('a reload, sign-in as the owner, then online alone settles only that owner\'s stored lease', async () => {
    const { unsettledStartKey } = await importLease();
    window.localStorage.setItem(unsettledStartKey(A, X), '1700000000000');
    window.localStorage.setItem(unsettledStartKey(B, Y), '1700000000000'); // another account's, on this device
    vi.resetModules();                                   // the reload: a fresh module, storage kept
    const { setCurrentLogin } = await importLoginLog();
    await importLease();
    setCurrentLogin(A, 1_700_000_000_000);
    window.dispatchEvent(new Event('online'));           // no Start, no Stop
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.fn === 'abandon_recording_start_v1').map((c) => c.id)).toEqual([X]);
    expect(open.has(X)).toBe(false);
    expect(window.localStorage.getItem(unsettledStartKey(A, X))).toBeNull();
    expect(window.localStorage.getItem(unsettledStartKey(B, Y))).toBe('1700000000000'); // untouched
});

it('a reconnect BEFORE authentication restores the owner: setting the owner runs one pass, for that account only', async () => {
    const { unsettledStartKey } = await importLease();
    window.localStorage.setItem(unsettledStartKey(A, X), '1700000000000');
    window.localStorage.setItem(unsettledStartKey(B, Y), '1700000000000'); // another account's, on this device
    vi.resetModules();                                   // the reload: a fresh module, storage kept
    const { setCurrentLogin } = await importLoginLog();
    const lease = await importLease();
    window.dispatchEvent(new Event('online'));           // reconnect while no account is known yet
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(calls).toEqual([]);                           // nothing to replay without an owner
    setCurrentLogin(A, 1_700_000_000_000);               // authentication restores the owner ...
    lease.resumeReconnectForSignedInOwner();             // ... and AuthProvider resumes (wiring pinned below)
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
    lease.resumeReconnectForSignedInOwner();             // bounded: once per reconnect, a second call does nothing
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.fn === 'abandon_recording_start_v1').map((c) => c.id)).toEqual([X]);
    expect(window.localStorage.getItem(unsettledStartKey(A, X))).toBeNull();
    expect(window.localStorage.getItem(unsettledStartKey(B, Y))).toBe('1700000000000'); // untouched
});

it('AuthProvider resumes right after it applies a signed-in owner, at both places it does so', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../contexts/AuthProvider.tsx'), 'utf8');
    expect(src).toMatch(/setCurrentLogin\(nextUserId, loginStartedAtOf\(nextSession\)\);\n\s*resumeReconnectForSignedInOwner\(\);/);
    expect(src).toMatch(/setCurrentLogin\(s\?\.user\?\.id \?\? null, loginStartedAtOf\(s\)\);\n\s*resumeReconnectForSignedInOwner\(\);/);
});
