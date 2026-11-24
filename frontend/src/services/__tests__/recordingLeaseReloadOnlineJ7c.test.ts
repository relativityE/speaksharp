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

beforeEach(() => { vi.resetModules(); window.localStorage.clear(); calls.length = 0; open.clear(); open.add(X); });
afterEach(() => { window.localStorage.clear(); });

it('a reload, sign-in as the owner, then online alone settles only that owner\'s stored lease', async () => {
    const { unsettledStartKey } = await import('../recordingLease');
    window.localStorage.setItem(unsettledStartKey(A, X), '1700000000000');
    window.localStorage.setItem(unsettledStartKey(B, Y), '1700000000000'); // another account's, on this device
    vi.resetModules();                                   // the reload: a fresh module, storage kept
    const { setCurrentLogin } = await import('../loginSessionLog');
    await import('../recordingLease');
    setCurrentLogin(A, 1_700_000_000_000);
    window.dispatchEvent(new Event('online'));           // no Start, no Stop
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.fn === 'abandon_recording_start_v1').map((c) => c.id)).toEqual([X]);
    expect(open.has(X)).toBe(false);
    expect(window.localStorage.getItem(unsettledStartKey(A, X))).toBeNull();
    expect(window.localStorage.getItem(unsettledStartKey(B, Y))).toBe('1700000000000'); // untouched
});
