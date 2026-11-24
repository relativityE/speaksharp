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

/** A per-account server whose abandon can be held per lease (a busy pass) and is reachable or not. */
function server2() {
    const obligations = new Map<string, string>();
    const held = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
    const state = { as: A as string | null, abandonDown: false, holdFor: new Set<string>() };
    const rpc: LeaseRpc = async (fn, args) => {
        const id = args.p_lease_id as string;
        if (fn === 'acquire_recording_lease') { obligations.set(id, state.as ?? ''); return { data: { acquired: true, took_over: false }, error: null }; }
        if (fn === 'abandon_recording_start_v1') {
            if (state.holdFor.has(id)) { state.holdFor.delete(id); await new Promise<void>((res, rej) => { held.set(id, { resolve: res, reject: rej }); }); }
            if (state.abandonDown) throw new TypeError('Failed to fetch');
            if (obligations.get(id) !== state.as) return { data: { abandoned: false, reason: 'unknown_identity' }, error: null };
            obligations.delete(id);
            return { data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null };
        }
        return { data: { released: true }, error: null };
    };
    const settle = (id: string, ok: boolean) => { const h = held.get(id); held.delete(id); if (ok) h?.resolve(); else h?.reject(new TypeError('Failed to fetch')); };
    return { rpc, state, obligations, settle };
}
const tick = async () => { await flush(); await new Promise((r) => setTimeout(r, 10)); await flush(); };

describe('J7.c review A (Jack on 6093a9ac): a pass requested while another is busy still runs', () => {
    it('online during Y\'s first attempt while X\'s pass is busy: Y settles once X\'s pass ends', async () => {
        const net = server2();
        await acquireTakeLease({ rpc: net.rpc });
        const x = currentTakeLeaseId()!;
        net.state.abandonDown = true;
        await releaseTakeLease({ rpc: net.rpc, startFailed: x });          // X remembered, unreached
        await acquireTakeLease({ rpc: net.rpc });                           // its pass fails fast (abandon down)
        const y = currentTakeLeaseId()!;
        net.state.abandonDown = false;
        net.state.holdFor = new Set([x, y]);
        const releasing = releaseTakeLease({ rpc: net.rpc, startFailed: y }); // starts X's pass (held), then Y's attempt (held)
        await flush();
        window.dispatchEvent(new Event('online'));                          // during Y's attempt, with X's pass busy
        await flush();
        net.settle(y, false); await releasing; await flush();               // Y's first attempt never reached the server
        net.settle(x, true); await tick(); await tick();                     // X's pass ends
        expect(net.obligations.has(y)).toBe(false);
        expect(__unreachedAbandonsForTests()).not.toContain(y);
    });
});

describe('J7.c review B (Sam 12:41, Jack): sign-out keeps only valid owner lease lists', () => {
    it('only the exact-prefix, well-formed lease list survives, byte-identical; auth, other keys and sessionStorage are gone', () => {
        const ids = JSON.stringify(['f0110000-0000-4000-8000-00000000000a']);
        window.localStorage.setItem(UNSETTLED_STARTS_KEY_PREFIX + A, ids);
        window.localStorage.setItem(UNSETTLED_STARTS_KEY_PREFIX + 'bbbbbbbb-0000-4000-8000-00000000000b', '{not json');
        window.localStorage.setItem(UNSETTLED_STARTS_KEY_PREFIX + 'cccccccc-0000-4000-8000-00000000000c', JSON.stringify([{ token: 'x' }]));
        window.localStorage.setItem('speaksharp.recordingLease.unsettledStarts.v2:' + A, ids); // look-alike prefix
        window.localStorage.setItem('sb-abcd-auth-token', '{"access_token":"x"}');
        window.localStorage.setItem('speaksharp.other', 'x');
        window.sessionStorage.setItem('session-key', 'x');
        (lease as unknown as { keepUnsettledStartsAcross: (clear: () => void) => void })
            .keepUnsettledStartsAcross(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
        const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
        expect(keys).toEqual([UNSETTLED_STARTS_KEY_PREFIX + A]);
        expect(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + A)).toBe(ids);
        expect(window.sessionStorage.length).toBe(0);
    });
});

describe('J7.c review D (Codex on 6093a9ac): a long unsettled list is never deleted on read', () => {
    it('1,001 stored valid lease ids are kept and a pass still runs (bounded to one batch)', async () => {
        const many = Array.from({ length: 1001 }, (_, i) => `f0110000-0000-4000-8000-${String(i).padStart(12, '0')}`);
        window.localStorage.setItem(UNSETTLED_STARTS_KEY_PREFIX + A, JSON.stringify(many));
        const calls: string[] = [];
        const rpc: LeaseRpc = async (fn, args) => { calls.push(fn); void args; throw new TypeError('Failed to fetch'); };
        await lease.retryUnreachedAbandons({ rpc });
        expect(calls.filter((c) => c === 'abandon_recording_start_v1').length).toBe(lease.MAX_ABANDONS_PER_PASS);
        expect(JSON.parse(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + A) ?? '[]')).toHaveLength(1001);
    });
});

