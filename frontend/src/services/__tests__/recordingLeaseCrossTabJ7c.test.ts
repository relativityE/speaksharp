/**
 * J7.c review F (Codex on #1968 at 260bfd5a): two tabs of one account updating the durable unsettled-start records at the
 * same moment must not lose either tab's lease. Each tab is a real, separate module instance sharing one localStorage. Tab 2
 * records Z between tab 1's read and tab 1's write (the cross-process interleaving), and then goes away before its own
 * attempt ends (closed or reloaded), so storage is Z's only record. A later page of that account must still settle Z.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LeaseRpc } from '../recordingLease';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const X = 'f0110000-0000-4000-8000-0000000000a1';
const W = 'f0110000-0000-4000-8000-0000000000a2';
const Z = 'f0110000-0000-4000-8000-0000000000b1';
const offline: LeaseRpc = async () => { throw new TypeError('Failed to fetch'); };
const gone: LeaseRpc = () => new Promise(() => {});                     // tab 2 never hears back: it is closed
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

/** A tab: a fresh module instance (a separate page) signed in as A, sharing this window's storage. */
async function openTab() {
    vi.resetModules();
    const { setCurrentLogin } = await import('../loginSessionLog');
    const lease = await import('../recordingLease');
    setCurrentLogin(A, 1_700_000_000_000);
    return lease;
}

let realSetItem: typeof Storage.prototype.setItem;
beforeEach(() => { window.localStorage.clear(); realSetItem = Storage.prototype.setItem; });
afterEach(() => { Storage.prototype.setItem = realSetItem; window.localStorage.clear(); });

it('a lease recorded by another tab between this tab\'s read and write survives, and a later page settles it', async () => {
    const tab1 = await openTab();
    await tab1.releaseTakeLease({ rpc: offline, startFailed: X });       // tab 1 already holds X
    const tab2 = await openTab();
    let armed = true;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (armed) {
            armed = false;
            void tab2.releaseTakeLease({ rpc: gone, startFailed: Z });    // tab 2's write lands between tab 1's read and write
        }
        return realSetItem.call(this, key, value);
    };
    const failed = tab1.releaseTakeLease({ rpc: offline, startFailed: W });
    Storage.prototype.setItem = realSetItem;
    await failed; await flush();
    // Tab 2 is gone; a new page of the same account replays what storage holds.
    const page = await openTab();
    const abandoned: string[] = [];
    const online: LeaseRpc = async (fn, args) => {
        if (fn === 'abandon_recording_start_v1') abandoned.push(args.p_lease_id as string);
        return { data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null };
    };
    await page.retryUnreachedAbandons({ rpc: online });
    expect(abandoned.sort()).toEqual([X, W, Z].sort());
    expect(page.__unreachedAbandonsForTests()).toEqual([]);
});

it('one tab removing its settled lease while another tab records a new one erases neither tab\'s other leases', async () => {
    const Q = 'f0110000-0000-4000-8000-0000000000b2';
    let reachX = false;                                                  // tab 1's connection: offline, then back for X only
    const tab1Rpc: LeaseRpc = async (fn, args) => {
        if (reachX && fn === 'abandon_recording_start_v1' && args.p_lease_id === X) return { data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null };
        throw new TypeError('Failed to fetch');
    };
    const tab1 = await openTab();
    await tab1.releaseTakeLease({ rpc: tab1Rpc, startFailed: X });       // tab 1 holds X
    const tab2 = await openTab();
    void tab2.releaseTakeLease({ rpc: gone, startFailed: Q });           // tab 2 holds Q (its attempt never ends)
    await flush();
    // Back online for X only: tab 1's pass settles X and removes its record; Q stays unreached.
    reachX = true;
    const realRemove = Storage.prototype.removeItem;
    let armed = true;
    Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (armed) {
            armed = false;
            void tab2.releaseTakeLease({ rpc: gone, startFailed: Z });    // tab 2 records Z between tab 1's read and its removal
        }
        return realRemove.call(this, key);
    };
    try { await tab1.retryUnreachedAbandons({ rpc: tab1Rpc }); await flush(); } finally { Storage.prototype.removeItem = realRemove; }
    expect(armed).toBe(false);                                           // the interleaving really happened at X's removal
    const page = await openTab();
    expect([...page.__storedUnsettledStartsForTests(A)].sort()).toEqual([Q, Z].sort()); // X gone; Q and Z both kept
});

it('sign-out cleanup in one tab never deletes a record another tab writes during that cleanup', async () => {
    const tab1 = await openTab();
    const tab2 = await openTab();
    window.localStorage.setItem('sb-abcd-auth-token', '{"access_token":"x"}');
    // Tab 2 records Z while tab 1's sign-out cleanup is under way: right after the cleanup first looks at storage.
    const realKey = Storage.prototype.key;
    let armed = true;
    Storage.prototype.key = function (this: Storage, index: number) {
        if (armed) { armed = false; void tab2.releaseTakeLease({ rpc: gone, startFailed: Z }); }
        return realKey.call(this, index);
    };
    try { tab1.clearLocalStorageExceptUnsettledStarts(); } finally { Storage.prototype.key = realKey; }
    await flush();
    expect(armed).toBe(false);
    expect(window.localStorage.getItem('sb-abcd-auth-token')).toBeNull();
    const page = await openTab();
    expect(page.__storedUnsettledStartsForTests(A)).toEqual([Z]);
});
