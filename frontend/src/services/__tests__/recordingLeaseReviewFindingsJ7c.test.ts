/**
 * J7.c, Codex review of #1968 (two P2 findings), each reproduced against the real module:
 *  1. Sign-out cleared ALL localStorage (AuthProvider.signOut), wiping the per-account unsettled-start records, so after a
 *     reload the original owner could no longer settle the lease (the server's admitted obligation stays open).
 *  2. A failed Start was remembered only AFTER its first abandon attempt failed or timed out, so an `online` event during
 *     that in-flight attempt could not retry it; the lease then waited for another acquire, release or reconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as lease from '../recordingLease';
import { setCurrentLogin } from '../loginSessionLog';

const { UNSETTLED_STARTS_KEY_PREFIX, acquireTakeLease, currentTakeLeaseId, releaseTakeLease, __resetTakeLeaseForTests, __unreachedAbandonsForTests } = lease;
type LeaseRpc = lease.LeaseRpc;
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const stored = (owner: string): unknown => JSON.parse(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + owner) ?? '[]');

/** A per-account server whose abandon can be held open (an in-flight first attempt) and then fail or answer. */
function server() {
    const obligations = new Map<string, string>();
    let hold: { resolve: () => void; reject: (e: unknown) => void } | null = null;
    const state = { as: A as string | null, holdNextAbandon: false, online: true };
    const rpc: LeaseRpc = async (fn, args) => {
        const id = args.p_lease_id as string;
        if (fn === 'acquire_recording_lease') { obligations.set(id, state.as ?? ''); return { data: { acquired: true, took_over: false }, error: null }; }
        if (fn === 'abandon_recording_start_v1') {
            if (state.holdNextAbandon) {
                state.holdNextAbandon = false;
                await new Promise<void>((res, rej) => { hold = { resolve: res, reject: rej }; });
            }
            if (!state.online) throw new TypeError('Failed to fetch');
            if (obligations.get(id) !== state.as) return { data: { abandoned: false, reason: 'unknown_identity' }, error: null };
            obligations.delete(id);
            return { data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null };
        }
        if (!state.online) throw new TypeError('Failed to fetch');
        return { data: { released: true }, error: null };
    };
    return { rpc, state, obligations, failHeld: () => { const h = hold; hold = null; h?.reject(new TypeError('Failed to fetch')); } };
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

beforeEach(() => { window.localStorage.clear(); setCurrentLogin(A, 1_700_000_000_000); __resetTakeLeaseForTests(); });
afterEach(() => { __resetTakeLeaseForTests(); setCurrentLogin(null, null); window.localStorage.clear(); vi.useRealTimers(); });

describe('J7.c review finding 2: a failed Start is remembered before its first abandon attempt', () => {
    it('while the first attempt is still in flight, the lease is already remembered and stored', async () => {
        const net = server();
        await acquireTakeLease({ rpc: net.rpc });
        const id = currentTakeLeaseId()!;
        net.state.holdNextAbandon = true;
        const releasing = releaseTakeLease({ rpc: net.rpc, startFailed: id });
        await flush();
        expect(__unreachedAbandonsForTests()).toContain(id);
        expect(stored(A)).toEqual([id]);
        net.failHeld(); await releasing;
    });
    it('the browser coming back online DURING that attempt still settles the lease once the attempt fails', async () => {
        const net = server();
        await acquireTakeLease({ rpc: net.rpc });
        const id = currentTakeLeaseId()!;
        net.state.holdNextAbandon = true;
        const releasing = releaseTakeLease({ rpc: net.rpc, startFailed: id });
        await flush();
        window.dispatchEvent(new Event('online')); // reconnect while the first attempt is still pending
        await flush();
        net.failHeld();                             // that attempt never reached the server
        await releasing; await flush(); await new Promise((r) => setTimeout(r, 20)); await flush();
        expect(net.obligations.has(id)).toBe(false); // settled by the follow-up pass, with no further Start or Stop
        expect(__unreachedAbandonsForTests()).not.toContain(id);
        expect(stored(A)).toEqual([]);
    });
});

describe('J7.c review finding 1: sign-out keeps the unsettled-start records', () => {
    it('keepUnsettledStartsAcross clears everything else but keeps the records, so the owner settles after a reload', async () => {
        const net = server();
        await acquireTakeLease({ rpc: net.rpc });
        const id = currentTakeLeaseId()!;
        net.state.online = false;
        await releaseTakeLease({ rpc: net.rpc, startFailed: id });
        net.state.online = true;
        window.localStorage.setItem('unrelated-app-key', 'x');
        (lease as unknown as { keepUnsettledStartsAcross: (clear: () => void) => void }).keepUnsettledStartsAcross(() => window.localStorage.clear());
        expect(window.localStorage.getItem('unrelated-app-key')).toBe(null);
        expect(stored(A)).toEqual([id]);
        __resetTakeLeaseForTests(); setCurrentLogin(A, 1_700_000_000_001); // reload, sign back in
        await acquireTakeLease({ rpc: net.rpc });
        expect(net.obligations.has(id)).toBe(false);
    });
    it('AuthProvider.signOut clears storage through keepUnsettledStartsAcross, never a bare localStorage.clear()', () => {
        const src = readFileSync(resolve(__dirname, '../../contexts/AuthProvider.tsx'), 'utf8');
        const signOut = src.slice(src.indexOf('const signOut = useCallback'), src.indexOf('}, [supabase, queryClient]);'));
        expect(signOut).toContain('keepUnsettledStartsAcross(() => window.localStorage.clear());');
        expect(signOut).not.toMatch(/^\s*window\.localStorage\.clear\(\);/m);
    });
});
