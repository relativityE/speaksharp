/**
 * J7.c, Elon's DB repro (1795530380) and Sam's bar (1795530421): acquiring a lease writes an admitted save obligation that
 * only the abandon (or a saved take) settles. A lease the client stops remembering leaves that obligation open with no
 * take, which blocks run-owned cleanup and account deletion: the original J7.c stuck state. So an uncertain lease is
 * never dropped, it survives a reload (kept per account in localStorage), and only its own account ever settles it.
 *
 * Controls asked for: the ninth failure and a reload each still let the original owner settle the first lease; an
 * account switch never replays, releases or forgets another owner's leases.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_ABANDONS_PER_PASS,
    UNSETTLED_STARTS_KEY_PREFIX,
    acquireTakeLease,
    currentTakeLeaseId,
    releaseTakeLease,
    retryUnreachedAbandons,
    __resetTakeLeaseForTests,
    __unreachedAbandonsForTests,
    type LeaseRpc,
} from '../recordingLease';
import { setCurrentLogin } from '../loginSessionLog';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const stored = (owner: string): unknown => JSON.parse(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + owner) ?? '[]');

/** A server that settles obligations per account: abandon succeeds only for the account that acquired the lease. */
function server() {
    // `settleDown`: the abandon and the release cannot reach the server (acquire still can).
    const state = { online: true, settleDown: false, as: null as string | null };
    const obligations = new Map<string, string>(); // lease -> owner, admitted and unsettled
    const calls: { fn: string; lease: unknown; as: string | null }[] = [];
    const rpc: LeaseRpc = async (fn, args) => {
        const id = args.p_lease_id as string;
        calls.push({ fn, lease: id, as: state.as });
        if (!state.online || (state.settleDown && fn !== 'acquire_recording_lease')) throw new TypeError('Failed to fetch');
        if (fn === 'acquire_recording_lease') { obligations.set(id, state.as ?? ''); return { data: { acquired: true, took_over: false }, error: null }; }
        if (fn === 'abandon_recording_start_v1') {
            if (state.as === null) return { data: { abandoned: false, reason: 'unauthenticated' }, error: null };
            if (obligations.get(id) !== state.as) return { data: { abandoned: false, reason: 'unknown_identity' }, error: null };
            obligations.delete(id);
            return { data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null };
        }
        return { data: { released: true }, error: null }; // a release never settles the obligation (Elon's repro)
    };
    return { rpc, state, obligations, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

function signIn(net: ReturnType<typeof server>, owner: string | null) {
    setCurrentLogin(owner, owner ? 1_700_000_000_000 : null);
    net.state.as = owner;
}

/** A Start that acquired, then failed while offline: its abandon never reached the server. */
async function failedOfflineStart(net: ReturnType<typeof server>): Promise<string> {
    net.state.online = true;
    await acquireTakeLease({ rpc: net.rpc });
    const id = currentTakeLeaseId()!;
    net.state.online = false;
    await releaseTakeLease({ rpc: net.rpc, startFailed: id });
    net.state.online = true;
    return id;
}

const lastIndex = <T,>(xs: T[], f: (x: T) => boolean): number => { for (let i = xs.length - 1; i >= 0; i -= 1) if (f(xs[i])) return i; return -1; };

/** A page reload: module memory is gone, localStorage is not. */
const reload = () => __resetTakeLeaseForTests();

beforeEach(() => { window.localStorage.clear(); setCurrentLogin(null, null); __resetTakeLeaseForTests(); });
afterEach(() => { __resetTakeLeaseForTests(); setCurrentLogin(null, null); window.localStorage.clear(); });

describe('J7.c: an uncertain lease is never dropped, survives a reload, and is only settled by its own account', () => {
    it('the ninth failed Start still lets the original owner settle the FIRST lease (no orphan left on the server)', async () => {
        const net = server(); signIn(net, A);
        // Settling stays unreachable the whole time, so every retry is unreached too.
        const leases: string[] = [];
        net.state.settleDown = true;
        for (let i = 0; i < MAX_ABANDONS_PER_PASS + 1; i += 1) leases.push(await failedOfflineStart(net));
        net.state.settleDown = false;
        expect(__unreachedAbandonsForTests()).toEqual(leases);
        expect(stored(A)).toEqual(leases);
        // Back online: the next acquire settles the oldest pass, the next release the rest.
        await acquireTakeLease({ rpc: net.rpc });
        await releaseTakeLease({ rpc: net.rpc });
        await retryUnreachedAbandons({ rpc: net.rpc });
        for (const id of leases) expect(net.obligations.has(id), `obligation ${id} settled`).toBe(false);
        expect(__unreachedAbandonsForTests()).toEqual([]);
        expect(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + A)).toBeNull();
    });

    it('a reload before reconnect still settles the lease, on the next acquire (exactly that lease, then the new take)', async () => {
        const net = server(); signIn(net, A);
        const cold = await failedOfflineStart(net);
        reload();
        expect(__unreachedAbandonsForTests()).toEqual([]); // memory gone...
        expect(stored(A)).toEqual([cold]);                 // ...but the account's list survives
        signIn(net, A);
        await acquireTakeLease({ rpc: net.rpc });
        expect(net.obligations.has(cold)).toBe(false);
        const settledAt = lastIndex(net.calls, (c) => c.fn === 'abandon_recording_start_v1' && c.lease === cold && c.as === A);
        const acquiredAt = lastIndex(net.calls, (c) => c.fn === 'acquire_recording_lease');
        expect(settledAt).toBeLessThan(acquiredAt); // the old Start is settled first, then the new take acquires
        expect(net.calls[acquiredAt].lease).toBe(currentTakeLeaseId());
        expect(stored(A)).toEqual([]);
    });

    it('a reload, then the browser coming back online, also settles it (no Start needed)', async () => {
        const net = server(); signIn(net, A);
        const cold = await failedOfflineStart(net);
        reload(); signIn(net, A);
        await releaseTakeLease({ rpc: net.rpc }); // any release (e.g. an unmount) resumes the account's list
        await retryUnreachedAbandons({ rpc: net.rpc });
        expect(net.obligations.has(cold)).toBe(false);
    });

    it('an account switch never replays, releases or forgets the previous account\'s leases', async () => {
        const net = server(); signIn(net, A);
        const coldA = await failedOfflineStart(net);
        signIn(net, B);
        await acquireTakeLease({ rpc: net.rpc });
        await releaseTakeLease({ rpc: net.rpc });
        await retryUnreachedAbandons({ rpc: net.rpc });
        expect(net.calls.filter((c) => c.lease === coldA && c.as === B)).toEqual([]);
        expect(net.obligations.get(coldA)).toBe(A);       // still A's to settle
        expect(stored(A)).toEqual([coldA]);
        expect(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + B)).toBeNull();
        // A signs back in (even after a reload): A's own lease settles.
        reload(); signIn(net, A);
        await acquireTakeLease({ rpc: net.rpc });
        expect(net.obligations.has(coldA)).toBe(false);
        expect(stored(A)).toEqual([]);
    });

    it('a refusal heard after the account changed mid-call is not trusted: the lease is kept for its own account', async () => {
        const net = server(); signIn(net, A);
        const coldA = await failedOfflineStart(net);
        // The retry is sent as A, but B is signed in before the answer is acted on.
        const inner = net.rpc;
        const racing: LeaseRpc = async (fn, args) => {
            const r = await inner(fn, args);
            if (fn === 'abandon_recording_start_v1') signIn(net, B);
            return fn === 'abandon_recording_start_v1' ? { data: { abandoned: false, reason: 'unknown_identity' }, error: null } : r;
        };
        reload(); signIn(net, A); // resumed from storage, so the pass uses the rpc it is given
        await retryUnreachedAbandons({ rpc: racing });
        expect(__unreachedAbandonsForTests()).toEqual([coldA]);
        expect(stored(A)).toEqual([coldA]);
        expect(net.of('release_recording_lease').filter((c) => c.lease === coldA && c.as === B)).toEqual([]);
    });

    it('a Start acquired as A that fails after B signed in is kept for A: never stored, retried or forgotten as B\'s', async () => {
        const net = server(); signIn(net, A);
        await acquireTakeLease({ rpc: net.rpc });
        const coldA = currentTakeLeaseId()!;
        signIn(net, B); // B's session: the abandon goes out as B, and the server refuses it (not B's lease)
        await releaseTakeLease({ rpc: net.rpc, startFailed: coldA });
        expect(net.obligations.get(coldA)).toBe(A);
        expect(stored(A)).toEqual([coldA]);
        expect(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + B)).toBeNull();
        await retryUnreachedAbandons({ rpc: net.rpc });
        expect(net.calls.filter((c) => c.fn === 'abandon_recording_start_v1' && c.lease === coldA && c.as === B)).toHaveLength(1);
        reload(); signIn(net, A);
        await acquireTakeLease({ rpc: net.rpc });
        expect(net.obligations.has(coldA)).toBe(false);
    });

    it('a refusal of the failed Start\'s OWN abandon heard after the account changed mid-call is not trusted either', async () => {
        const net = server(); signIn(net, A);
        await acquireTakeLease({ rpc: net.rpc });
        const coldA = currentTakeLeaseId()!;
        const racing: LeaseRpc = async (fn, args) => {
            if (fn !== 'abandon_recording_start_v1') return net.rpc(fn, args);
            signIn(net, B);
            return { data: { abandoned: false, reason: 'unknown_identity' }, error: null };
        };
        await releaseTakeLease({ rpc: racing, startFailed: coldA });
        expect(stored(A)).toEqual([coldA]);
        expect(net.obligations.get(coldA)).toBe(A);
    });

    it('signed out: a pass never calls the server for a signed-in account\'s leases', async () => {
        const net = server(); signIn(net, A);
        const coldA = await failedOfflineStart(net);
        signIn(net, null);
        const before = net.calls.length;
        await retryUnreachedAbandons({ rpc: net.rpc });
        expect(net.calls.slice(before)).toEqual([]);
        expect(stored(A)).toEqual([coldA]);
    });

    it('two tabs: one tab\'s change never overwrites the other tab\'s stored leases', async () => {
        const net = server(); signIn(net, A);
        net.state.settleDown = true;
        const first = await failedOfflineStart(net);
        await acquireTakeLease({ rpc: net.rpc });
        const second = currentTakeLeaseId()!;
        // Another tab stores its own unsettled lease while this tab's failed Start is settling.
        const otherTab: LeaseRpc = async (fn, args) => {
            if (fn === 'abandon_recording_start_v1' && args.p_lease_id === second) {
                window.localStorage.setItem(UNSETTLED_STARTS_KEY_PREFIX + A, JSON.stringify([first, 'other-tab-lease']));
            }
            return net.rpc(fn, args);
        };
        await releaseTakeLease({ rpc: otherTab, startFailed: second });
        expect(stored(A)).toEqual([first, 'other-tab-lease', second]);
    });

    it('a corrupted stored list is discarded, never thrown on', async () => {
        const net = server(); signIn(net, A);
        window.localStorage.setItem(UNSETTLED_STARTS_KEY_PREFIX + A, '{not json');
        await expect(acquireTakeLease({ rpc: net.rpc })).resolves.toMatchObject({ action: 'start' });
        expect(window.localStorage.getItem(UNSETTLED_STARTS_KEY_PREFIX + A)).toBeNull();
    });
});
