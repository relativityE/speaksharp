// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
    type BindingPage, type BindingRequest, type FenceCaptures, type RecoveryDb, type RecoveryQuery,
    SessionCreateBinding, readAuthority, readBaselineRows, readRecording, readSessionRows, readSnapshot, recoveryFenceRow,
} from '../live/helpers/rwtRecoveryCapture';
import type { RecoveryRead, RecoveryRows, RecoverySession, RecoverySnapshot } from '../live/helpers/rwtRecoveryFence1593';

const U = '11111111-1111-4111-8111-111111111111';
const L1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const L2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ORIGIN = 'https://project.supabase.example';
const RPC = `${ORIGIN}/rest/v1/rpc/create_session_and_update_usage`;

type Result = { data: unknown; error: unknown; count?: number | null };
type Call = { table: string; columns?: string; count?: string; eq: [string, string][]; order: string[]; range?: [number, number] };

/** A query-builder double that answers each page from the request it was given (stubs answer the query). */
function fakeDb(answer: (call: Call, index: number) => Result | Error, single?: () => { data: unknown; error: unknown } | Error) {
    const calls: Call[] = [];
    const db: RecoveryDb = {
        from(table: string) {
            const call: Call = { table, eq: [], order: [] };
            const settle = () => {
                calls.push(call);
                const r = answer(call, calls.length - 1);
                return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
            };
            const q: RecoveryQuery = {
                select(columns, options) { call.columns = columns; call.count = options?.count; return q; },
                eq(column, value) { call.eq.push([column, value]); return q; },
                order(column) { call.order.push(column); return q; },
                range(from, to) { call.range = [from, to]; return q; },
                maybeSingle() {
                    calls.push(call);
                    const r = single?.() ?? { data: null, error: null };
                    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
                },
                then(ok, fail) { return settle().then(ok, fail); },
            };
            return q;
        },
    };
    return { db, calls };
}
const rowsOf = (ids: string[]) => ids.map((id) => ({ id, user_id: U }));
/** Serves `ids` page by page against the requested range, reporting `count` (default: the true total). */
const pagedFrom = (ids: string[], count: (i: number) => number | null = () => ids.length) =>
    (call: Call, i: number): Result => ({ data: rowsOf(ids.slice(call.range![0], call.range![1] + 1)), error: null, count: count(i) });
/** A copy of `row` with `keys` ABSENT (not null) — a field the read never observed. */
const without = <T extends object>(row: T, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
const observedRows = (r: RecoveryRows<unknown>) => { if (r.state !== 'observed') throw new Error('unavailable'); return r; };

describe('#1593 case10 complete account-scoped reads', () => {
    it('pages the whole account with an exact count, owner scope and a deterministic (created_at, id) order', async () => {
        const ids = ['a', 'b', 'c', 'd', 'e'];
        const { db, calls } = fakeDb(pagedFrom(ids));
        const got = await readBaselineRows(db, U, 2);
        expect(observedRows(got.rows)).toEqual({ state: 'observed', complete: true, value: rowsOf(ids) });
        expect(got.duplicateIdentity).toBe(false);
        expect(calls.map((c) => c.range)).toEqual([[0, 1], [2, 3], [4, 5]]);
        for (const c of calls) {
            expect(c).toMatchObject({ table: 'sessions', count: 'exact', eq: [['user_id', U]], order: ['created_at', 'id'] });
        }
    });

    it('a first-page error, a missing count or a throw is unavailable — never an empty complete set', async () => {
        for (const first of [{ data: null, error: { message: 'x' } }, { data: [], error: null, count: null }, new Error('network')]) {
            const { db } = fakeDb(() => first);
            expect((await readSessionRows(db, U)).rows).toEqual({ state: 'unavailable' });
        }
    });

    it('a later-page error keeps what was read but is never complete', async () => {
        const { db } = fakeDb((call, i) => (i === 0 ? pagedFrom(['a', 'b', 'c'])(call, i) : { data: null, error: { message: 'x' } }));
        const got = observedRows((await readBaselineRows(db, U, 2)).rows);
        expect(got.complete).toBe(false);
        expect(got.value.map((r) => (r as { id: string }).id)).toEqual(['a', 'b']);
    });

    it('count drift between pages (the set changed while read) is incomplete', async () => {
        const { db } = fakeDb(pagedFrom(['a', 'b', 'c'], (i) => (i === 0 ? 3 : 4)));
        expect(observedRows((await readBaselineRows(db, U, 2)).rows).complete).toBe(false);
    });

    it('fewer rows than the exact count is incomplete (truncation)', async () => {
        const { db } = fakeDb((call) => ({ data: rowsOf(['a']).slice(call.range![0]), error: null, count: 2 }));
        expect(observedRows((await readBaselineRows(db, U, 5)).rows).complete).toBe(false);
    });

    it('flags an observed duplicate identity even when the same read is also incomplete', async () => {
        // page 2 repeats 'b' (an unstable order) and then fails: both facts survive, so the caller can FAIL first.
        const { db, calls } = fakeDb((call, i) => (i === 0 ? { data: rowsOf(['a', 'b']), error: null, count: 6 }
            : i === 1 ? { data: rowsOf(['b', 'c']), error: null, count: 6 } : { data: null, error: { message: 'x' } }));
        const got = await readBaselineRows(db, U, 2);
        expect(calls).toHaveLength(3);
        expect(got.duplicateIdentity).toBe(true);
        expect(observedRows(got.rows).complete).toBe(false);
    });

    it('a repeated row that fills the exact count is still incomplete (a row was skipped)', async () => {
        const { db } = fakeDb((_call, i) => ({ data: rowsOf(i === 0 ? ['a', 'b'] : ['b', 'c']), error: null, count: 4 }));
        const got = await readBaselineRows(db, U, 2);
        expect(got.duplicateIdentity).toBe(true);
        expect(observedRows(got.rows).complete).toBe(false);
    });

    it('maps the fence fields, keeping a PRESENT null as null', async () => {
        const raw = { id: 'a', user_id: U, status: 'active', lease_id: L1, recording_fenced_at: null, recording_fenced_reason: null, lease_released_at: null };
        const { db, calls } = fakeDb(() => ({ data: [raw], error: null, count: 1 }));
        const got = observedRows((await readSessionRows(db, U)).rows);
        expect(calls[0].columns).toBe('id,user_id,status,lease_id,recording_fenced_at,recording_fenced_reason,lease_released_at');
        expect(got).toEqual({ state: 'observed', complete: true, value: [raw] });
    });

    // Sam 1792434511 finding 1: an absent or malformed observation is never coerced into SQL NULL.
    const full = { id: 'a', user_id: U, status: 'active', lease_id: L1, recording_fenced_at: null, recording_fenced_reason: null, lease_released_at: null };
    it.each([
        ['absent fence stamp', without(full, 'recording_fenced_at')],
        ['absent release stamp', without(full, 'lease_released_at')],
        ['malformed fence reason', { ...full, recording_fenced_reason: 5 }],
        ['malformed status', { ...full, status: { s: 'active' } }],
        ['non-string id', { ...full, id: 7 }],
        ['null owner', { ...full, user_id: null }],
    ])('a row with an %s makes the whole read unavailable', async (_name, raw) => {
        const { db } = fakeDb(() => ({ data: [raw], error: null, count: 1 }));
        expect((await readSessionRows(db, U)).rows).toEqual({ state: 'unavailable' });
    });

    it('a baseline identity row with an absent or malformed identity is unavailable', async () => {
        for (const raw of [{ user_id: U }, { id: 'a', user_id: 9 }]) {
            const { db } = fakeDb(() => ({ data: [raw], error: null, count: 1 }));
            expect((await readBaselineRows(db, U)).rows).toEqual({ state: 'unavailable' });
        }
    });

    it('Sam 1792434511 finding 2: a returned page is scanned for duplicates BEFORE count drift is classified', async () => {
        const { db } = fakeDb((_call, i) => (i === 0 ? { data: rowsOf(['a', 'b']), error: null, count: 3 } : { data: rowsOf(['b', 'c']), error: null, count: 4 }));
        const got = await readBaselineRows(db, U, 2);
        expect(got.duplicateIdentity).toBe(true);
        expect(got.rows.state === 'observed' ? got.rows.complete : false).toBe(false);
    });

    it('a duplicate survives a malformed row in the same read (the caller FAILs it first)', async () => {
        const { db } = fakeDb(() => ({ data: [...rowsOf(['a', 'a']), { id: 'b' }], error: null, count: 3 }));
        const got = await readBaselineRows(db, U);
        expect(got.duplicateIdentity).toBe(true);
        expect(got.rows).toEqual({ state: 'unavailable' });
    });
});

describe('#1593 case10 lease authority read', () => {
    it('only a successful read with no row is absent; an error or throw is unavailable', async () => {
        const absent = fakeDb(() => ({ data: null, error: null }), () => ({ data: null, error: null }));
        expect(await readAuthority(absent.db, U)).toEqual({ state: 'observed', value: null });
        expect(absent.calls[0]).toMatchObject({ table: 'active_recording_lease', eq: [['user_id', U]] });
        const failed = fakeDb(() => ({ data: null, error: null }), () => ({ data: null, error: { message: 'x' } }));
        expect(await readAuthority(failed.db, U)).toEqual({ state: 'unavailable' });
        const thrown = fakeDb(() => ({ data: null, error: null }), () => new Error('network'));
        expect(await readAuthority(thrown.db, U)).toEqual({ state: 'unavailable' });
        const held = fakeDb(() => ({ data: null, error: null }), () => ({ data: { user_id: U, lease_id: L2, state: 'recording' }, error: null }));
        expect(await readAuthority(held.db, U)).toEqual({ state: 'observed', value: { user_id: U, lease_id: L2, state: 'recording' } });
    });

    it('a held lease with an absent or malformed field is unavailable, never an empty-string lease', async () => {
        for (const data of [{ user_id: U, state: 'recording' }, { user_id: U, lease_id: 7, state: 'recording' }, { user_id: U, lease_id: L2 }, 'row']) {
            const bad = fakeDb(() => ({ data: null, error: null }), () => ({ data, error: null }));
            expect(await readAuthority(bad.db, U)).toEqual({ state: 'unavailable' });
        }
    });
});

/** A controllable request: the response settles only when the test says so. */
function rpc(lease: string | null, opts: { url?: string; method?: string; unparsable?: boolean } = {}) {
    let settle!: (r: { ok(): boolean; json(): Promise<unknown> } | null) => void;
    let fail!: (e: unknown) => void;
    const pending = new Promise<{ ok(): boolean; json(): Promise<unknown> } | null>((res, rej) => { settle = res; fail = rej; });
    const request: BindingRequest = {
        url: () => opts.url ?? RPC,
        method: () => opts.method ?? 'POST',
        postDataJSON: () => { if (opts.unparsable) throw new Error('not JSON'); return { p_session_data: lease === null ? {} : { lease_id: lease } }; },
        response: () => pending,
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));
    return {
        request,
        created: async (session: Record<string, unknown> | null) => { settle({ ok: () => true, json: async () => ({ new_session: session }) }); await flush(); },
        refused: async () => { settle({ ok: () => false, json: async () => ({}) }); await flush(); },
        lost: async () => { fail(new Error('page closed')); await flush(); },
    };
}
function fakePage(): BindingPage & { emit(r: BindingRequest): void; closed: boolean } {
    const listeners = new Set<(r: BindingRequest) => void>();
    return {
        closed: false,
        on(_e, l) { listeners.add(l); return this; },
        off(_e, l) { if (this.closed) throw new Error('Target page, context or browser has been closed'); listeners.delete(l); return this; },
        emit(r) { for (const l of listeners) l(r); },
    };
}
const created = (id: string, lease: string, user = U) => ({ id, user_id: user, lease_id: lease });

/** Headers and JSON settle independently: the production binding, not a copied predicate, consumes both. */
function deferredExchange(lease: string) {
    const deferred = <T>() => {
        let resolve!: (value: T) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
        return { promise, resolve, reject };
    };
    const headers = deferred<{ ok(): boolean; json(): Promise<unknown> } | null>();
    const body = deferred<unknown>();
    let bodyReads = 0;
    let headerReads = 0;
    const request: BindingRequest = { url: () => RPC, method: () => 'POST',
        postDataJSON: () => ({ p_session_data: { lease_id: lease } }),
        response: () => { headerReads++; return headers.promise; } };
    return { request, body, headers, respond: () => headers.resolve({ ok: () => true, json: () => { bodyReads++; return body.promise; } }),
        bodyReads: () => bodyReads, headerReads: () => headerReads };
}
const flushExchange = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('#1704 established creation contradictions outrank unavailable exchanges', () => {
    const row = (binding: SessionCreateBinding) => recoveryFenceRow(binding, {}, {
        snapshot: { runId: 'precedence', ownerId: U, rows: { state: 'unavailable' }, authority: { state: 'unavailable' } },
        duplicateIdentity: false,
    }, { state: 'unavailable' }, 'precedence', U).status;
    const cases = (['owner', 'lease'] as const).flatMap(mismatch =>
        (['bad-json', 'missing-field', 'partial-record', 'unreadable-request', 'failed-header', 'pending'] as const)
            .map(fault => ({ mismatch, fault })));
    it.each(cases)('$mismatch contradiction survives $fault and terminal freeze', async ({ mismatch, fault }) => {
        const page = fakePage(); const binding = new SessionCreateBinding(ORIGIN, () => U); binding.attach(page); binding.arm('A');
        const first = rpc(L1); page.emit(first.request);
        await first.created(created('left', mismatch === 'lease' ? L2 : L1, mismatch === 'owner' ? 'foreign-owner' : U));
        const known = binding.binding('A');
        expect(known).toEqual({ state: 'contradiction', reason: `creation_${mismatch}_mismatch` });
        expect(row(binding)).toBe('FAIL');
        const extra = deferredExchange(L1);
        if (fault === 'unreadable-request') extra.request.postDataJSON = () => { throw new Error('unreadable request'); };
        page.emit(extra.request);
        if (fault === 'failed-header') extra.headers.resolve({ ok: () => false, json: async () => ({}) });
        else if (fault !== 'pending') {
            extra.respond();
            extra.body.resolve(fault === 'bad-json' ? null : fault === 'partial-record' ? { new_session: { id: 'partial' } } : {});
        }
        await flushExchange();
        // Assert both the passive capture and the final row: a HOLD must not
        // erase a contradiction merely because another capture is unavailable.
        expect(binding.binding('A')).toEqual(known); expect(row(binding)).toBe('FAIL');
        binding.detach(); const identities = binding.identities();
        extra.respond(); extra.body.resolve({ new_session: created('late', L1) }); await flushExchange();
        expect(binding.binding('A')).toEqual(known); expect(row(binding)).toBe('FAIL');
        expect(binding.identities()).toEqual(identities); expect(identities).not.toContain('late');
    });

    it('a proved same-session two-lease contradiction survives other session identities and pending work', async () => {
        const page = fakePage(); const binding = new SessionCreateBinding(ORIGIN, () => U); binding.attach(page); binding.arm('A');
        const first = rpc(L1); page.emit(first.request); await first.created(created('left', L1));
        const second = rpc(L2); page.emit(second.request); await second.created(created('left', L2));
        const known = { state: 'contradiction', reason: 'one_session_two_leases' };
        expect(binding.binding('A')).toEqual(known);
        const third = rpc(L1); page.emit(third.request); await third.created(created('other', L1));
        expect(binding.binding('A')).toEqual(known); expect(row(binding)).toBe('FAIL');
        const pending = deferredExchange(L1); page.emit(pending.request); await flushExchange();
        expect(binding.binding('A')).toEqual(known);
        binding.detach(); expect(binding.binding('A')).toEqual(known); expect(row(binding)).toBe('FAIL');
        pending.respond(); pending.body.resolve({ new_session: null }); await flushExchange();
        expect(binding.binding('A')).toEqual(known);
    });

    it.each([
        { id: 'partial', user_id: U }, { id: 'partial', lease_id: L1 }, { user_id: U, lease_id: L1 },
    ])('missing identity fields alone are unavailable, not fabricated contradiction: %j', async partial => {
        const page = fakePage(); const binding = new SessionCreateBinding(ORIGIN, () => U); binding.attach(page); binding.arm('A');
        const request = rpc(L1); page.emit(request.request); await request.created(partial);
        expect(binding.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_identity_unreadable' });
        expect(row(binding)).toBe('HOLD'); binding.detach(); expect(row(binding)).toBe('HOLD');
    });

    it('an unavailable expected owner is not evidence of a foreign-owner contradiction', async () => {
        const page = fakePage(); const binding = new SessionCreateBinding(ORIGIN, () => ''); binding.attach(page); binding.arm('A');
        expect(binding.binding('A')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
        const request = rpc(L1); page.emit(request.request); await request.created(created('left', L1));
        expect(binding.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_identity_unreadable' });
        binding.detach(); expect(row(binding)).toBe('HOLD');
    });

    it('two different sessions with distinct self-consistent leases remain ambiguous, not a fabricated two-lease contradiction', async () => {
        const page = fakePage(); const binding = new SessionCreateBinding(ORIGIN, () => U); binding.attach(page); binding.arm('A');
        const first = rpc(L1); page.emit(first.request); await first.created(created('left', L1));
        const second = rpc(L2); page.emit(second.request); await second.created(created('other', L2));
        expect(binding.binding('A')).toEqual({ state: 'unavailable', reason: 'ambiguous_creations' });
        expect(row(binding)).toBe('HOLD'); binding.detach(); expect(row(binding)).toBe('HOLD');
    });

    it('explicit own null and a foreign-origin creation cannot erase an established mismatch', async () => {
        const page = fakePage(); const binding = new SessionCreateBinding(ORIGIN, () => U); binding.attach(page); binding.arm('A');
        const first = rpc(L1); page.emit(first.request); await first.created(created('left', L2));
        const known = binding.binding('A');
        const refusal = rpc(L1); page.emit(refusal.request); await refusal.created(null);
        const foreign = rpc(L1, { url: 'https://foreign.example/rest/v1/rpc/create_session_and_update_usage' });
        page.emit(foreign.request); await foreign.created(created('foreign', L1));
        expect(binding.binding('A')).toEqual(known); expect(row(binding)).toBe('FAIL');
        binding.detach(); expect(row(binding)).toBe('FAIL'); expect(binding.identities()).not.toContain('foreign');
    });
});

describe('#1593 raw JSON exchange refusal', () => {
    it.each([
        ['missing', {}], ['undefined', { new_session: undefined }],
        ['inherited null', Object.create({ new_session: null }) as Record<string, unknown>],
    ] as const)('%s own new_session field is not a server refusal', async (_name, body) => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const exchange = deferredExchange(L1); page.emit(exchange.request); exchange.respond(); exchange.body.resolve(body);
        await flushExchange();
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_exchange_failed' });
        b.detach();
    });
    it.each([null, 7, 'not-an-envelope', [], true,
        { new_session: 7 }, { new_session: 'unreadable' }, { new_session: false }, { new_session: [] }]
        .map((body) => [body]))('raw JSON %j is an unavailable exchange', async (body) => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const exchange = deferredExchange(L1); page.emit(exchange.request); exchange.respond(); exchange.body.resolve(body);
        await flushExchange();
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_exchange_failed' });
        b.detach();
    });
    it('a malformed additional exchange cannot fall back to an earlier valid creation', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const good = rpc(L1); page.emit(good.request); await good.created(created('first', L1));
        const exchange = deferredExchange(L1); page.emit(exchange.request); exchange.respond(); exchange.body.resolve(null);
        await flushExchange();
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_exchange_failed' });
        b.detach();
    });
    it('a rejected body is unavailable while a wrapped server refusal remains no creation', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const exchange = deferredExchange(L1); page.emit(exchange.request); exchange.respond(); await flushExchange();
        expect(exchange.bodyReads()).toBe(1);
        exchange.body.reject(new Error('body unavailable')); await flushExchange();
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_exchange_failed' });
        b.arm('B'); const refused = rpc(L2); page.emit(refused.request); await refused.created(null);
        expect(b.binding('B')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
        b.detach();
    });
});

describe('#1593 terminal freeze of real binding and forbid snapshot', () => {
    it.each(['headers', 'body'] as const)('pending %s cannot add identities after detach and the forbid snapshot', async (stage) => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const exchange = deferredExchange(L1); page.emit(exchange.request);
        if (stage === 'body') { exchange.respond(); await flushExchange(); }
        const before = b.binding('A'); b.detach();
        const forbidden = new Set(b.identities());
        expect(before).toEqual({ state: 'unavailable', reason: 'creation_unsettled' });
        expect(forbidden.has(L1)).toBe(true); // request lease was already known even though no body settled
        exchange.respond(); exchange.body.resolve({ new_session: created('late-session', L1) }); await flushExchange();
        expect(b.binding('A')).toEqual(before);
        expect(new Set(b.identities())).toEqual(forbidden);
        expect(b.identities()).not.toContain('late-session');
    });
    it('a rejected JSON body after detach is consumed without changing terminal evidence', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const exchange = deferredExchange(L1); page.emit(exchange.request); exchange.respond(); await flushExchange();
        expect(exchange.bodyReads()).toBe(1);
        b.detach(); const before = b.binding('A'); const ids = b.identities();
        exchange.body.reject(new Error('late body')); await flushExchange();
        expect(b.binding('A')).toEqual(before); expect(b.identities()).toEqual(ids);
    });
    it('a late rejected response after detach cannot rewrite the frozen unavailable reason', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const exchange = deferredExchange(L1); page.emit(exchange.request); await flushExchange();
        expect(exchange.headerReads()).toBe(1);
        b.detach(); const before = b.binding('A');
        exchange.headers.reject(new Error('late headers')); await flushExchange();
        expect(b.binding('A')).toEqual(before);
    });
    it('settled terminal bindings are frozen, cannot rearm or attach, and survive closed-page detach twice', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const good = rpc(L1); page.emit(good.request); await good.created(created('first', L1));
        page.closed = true; b.detach(); b.detach(); const before = b.binding('A');
        expect(Object.isFrozen(before)).toBe(true);
        const replacement = fakePage(); b.arm('B'); b.attach(replacement);
        const late = deferredExchange(L2); replacement.emit(late.request); page.emit(late.request); await flushExchange();
        expect(late.headerReads()).toBe(0); expect(b.binding('A')).toEqual(before);
        expect(b.binding('B')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
    });
    it('reverse-order A/B bodies after detach cannot promote either pending take', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const a = deferredExchange(L1); page.emit(a.request); a.respond();
        b.arm('B'); const next = deferredExchange(L2); page.emit(next.request); next.respond(); await flushExchange();
        b.detach(); const frozenA = b.binding('A'); const frozenB = b.binding('B'); const forbidden = new Set(b.identities());
        next.body.resolve({ new_session: created('next', L2) }); a.body.resolve({ new_session: created('left', L1) }); await flushExchange();
        expect(b.binding('A')).toEqual(frozenA); expect(b.binding('B')).toEqual(frozenB);
        expect(new Set(b.identities())).toEqual(forbidden); expect(forbidden).toEqual(new Set([L1, L2]));
    });
});

describe('#1593 case10 passive take-identity binding', () => {
    it('binds the one settled, self-consistent creation of each phase', async () => {
        const page = fakePage();
        const b = new SessionCreateBinding(ORIGIN, () => U);
        b.attach(page);
        b.arm('A');
        const a = rpc(L1); page.emit(a.request); await a.created(created('left', L1));
        b.arm('B');
        const n = rpc(L2); page.emit(n.request); await n.created(created('next', L2));
        expect(b.binding('A')).toEqual({ state: 'observed', sessionId: 'left', leaseId: L1 });
        expect(b.binding('B')).toEqual({ state: 'observed', sessionId: 'next', leaseId: L2 });
        expect(new Set(b.identities())).toEqual(new Set(['left', L1, 'next', L2]));
    });

    it('takes the phase at REQUEST time: a late A response cannot be borrowed by B', async () => {
        const page = fakePage();
        const b = new SessionCreateBinding(ORIGIN, () => U);
        b.attach(page);
        b.arm('A');
        const a = rpc(L1); page.emit(a.request);
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_unsettled' });
        b.arm('B');
        await a.created(created('left', L1));
        expect(b.binding('A')).toMatchObject({ state: 'observed', sessionId: 'left' });
        expect(b.binding('B')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
    });

    it('a creation sent before arming (a cold auto-start) or while disarmed is never attributed to a take', async () => {
        const page = fakePage();
        const b = new SessionCreateBinding(ORIGIN, () => U);
        b.attach(page);
        const cold = rpc(L1); page.emit(cold.request);
        b.arm('A');
        await cold.created(created('left', L1));
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
        b.arm(null);
        const idle = rpc(L2); page.emit(idle.request); await idle.created(created('next', L2));
        expect(b.binding('A').state).toBe('unavailable');
        expect(b.identities()).toEqual([]);
    });

    it('ignores other origins, paths and methods', async () => {
        const page = fakePage();
        const b = new SessionCreateBinding(ORIGIN, () => U);
        b.attach(page);
        b.arm('A');
        for (const opts of [{ url: 'https://other.example/rest/v1/rpc/create_session_and_update_usage' },
            { url: `${ORIGIN}/rest/v1/rpc/save_session` }, { method: 'GET' }, { url: 'not a url' }]) {
            const r = rpc(L1, opts); page.emit(r.request); await r.created(created('left', L1));
        }
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
    });

    it('a failed, lost or unreadable exchange is unavailable; a refused creation creates no take', async () => {
        for (const [outcome, reason] of [['refused', 'creation_exchange_failed'], ['lost', 'creation_exchange_failed']] as const) {
            const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
            const r = rpc(L1); page.emit(r.request); await r[outcome]();
            expect(b.binding('A')).toEqual({ state: 'unavailable', reason });
        }
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const none = rpc(L1); page.emit(none.request); await none.created(null);
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'no_creation_observed' });
        const partial = rpc(L1); page.emit(partial.request); await partial.created({ id: 'left', user_id: U });
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_identity_unreadable' });
    });

    it('two different created sessions in one phase are ambiguous, never a pick', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const one = rpc(L1); page.emit(one.request); await one.created(created('left', L1));
        const two = rpc(L1); page.emit(two.request); await two.created(created('other', L1));
        expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'ambiguous_creations' });
    });

    it('a response contradicting its own request or owner is a contradiction', async () => {
        const cases: [string | null, Record<string, unknown>, string][] = [
            [L1, created('left', L2), 'creation_lease_mismatch'],
            [L1, created('left', L1, 'someone-else'), 'creation_owner_mismatch'],
        ];
        for (const [lease, session, reason] of cases) {
            const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
            const r = rpc(lease); page.emit(r.request); await r.created(session);
            expect(b.binding('A')).toEqual({ state: 'contradiction', reason });
        }
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const one = rpc(L1); page.emit(one.request); await one.created(created('left', L1));
        const two = rpc(L2); page.emit(two.request); await two.created(created('left', L2));
        expect(b.binding('A')).toEqual({ state: 'contradiction', reason: 'one_session_two_leases' });
    });

    // Sam 1792434538: the request's own lease is required — response-only identity is never substituted.
    it.each([['no lease_id in p_session_data', {}], ['an unparsable request body', { unparsable: true }]] as const)(
        'a successful creation from a request with %s is unavailable (HOLD), never observed', async (_name, opts) => {
            const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
            const r = rpc(null, opts); page.emit(r.request); await r.created(created('left', L1));
            expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_request_lease_unreadable' });
        });

    it('binds across a replaced/returned page and detaches every page, including a closed one, without throwing', async () => {
        const first = fakePage(); const returned = fakePage();
        const b = new SessionCreateBinding(ORIGIN, () => U);
        b.attach(first); b.arm('A');
        const a = rpc(L1); first.emit(a.request); await a.created(created('left', L1));
        first.closed = true;
        b.attach(returned); b.arm('B');
        const n = rpc(L2); returned.emit(n.request); await n.created(created('next', L2));
        expect(b.binding('B')).toMatchObject({ state: 'observed', sessionId: 'next' });
        expect(() => b.detach()).not.toThrow();
        const late = rpc(L2); returned.emit(late.request); await late.created(created('late', L2));
        expect(b.binding('B')).toMatchObject({ state: 'observed', sessionId: 'next' });
    });
});

describe('#1593 case10 strict recording read', () => {
    afterEach(() => {
        delete (window as unknown as { __rwtMicStreams__?: unknown }).__rwtMicStreams__;
        document.documentElement.removeAttribute('data-runtime-state');
    });
    const local = { evaluate: async <R>(fn: () => R) => fn() };
    const tracks = (...states: string[]) => [{ getAudioTracks: () => states.map((readyState) => ({ readyState })) }];

    it('RECORDING with a live track is true; a stopped track or another state is false', async () => {
        const w = window as unknown as { __rwtMicStreams__?: unknown };
        w.__rwtMicStreams__ = tracks('ended', 'live');
        document.documentElement.setAttribute('data-runtime-state', 'RECORDING');
        expect(await readRecording(local)).toEqual({ state: 'observed', value: true });
        w.__rwtMicStreams__ = tracks('ended');
        expect(await readRecording(local)).toEqual({ state: 'observed', value: false });
        w.__rwtMicStreams__ = tracks('live');
        document.documentElement.setAttribute('data-runtime-state', 'STOPPING');
        expect(await readRecording(local)).toEqual({ state: 'observed', value: false });
    });

    it('an uninstalled counter or a closed page is unavailable, never false', async () => {
        document.documentElement.setAttribute('data-runtime-state', 'RECORDING');
        expect(await readRecording(local)).toEqual({ state: 'unavailable' });
        expect(await readRecording({ evaluate: async () => { throw new Error('Target closed'); } })).toEqual({ state: 'unavailable' });
    });
});

describe('#1593 case10 evidence assembly before the oracle', () => {
    const FENCE = '2026-10-19T10:00:00.000Z';
    const observed = <T>(value: T): RecoveryRead<T> => ({ state: 'observed', value });
    const complete = <T>(value: readonly T[]): RecoveryRows<T> => ({ state: 'observed', complete: true, value });
    const row = (id: string, lease: string, extra: Partial<RecoverySession> = {}): RecoverySession => ({
        id, user_id: U, status: 'active', lease_id: lease, recording_fenced_at: null,
        recording_fenced_reason: null, lease_released_at: null, ...extra,
    });
    const snap = (value: readonly RecoverySession[], lease: string | null): RecoverySnapshot => ({
        runId: 'run', ownerId: U, rows: complete(value),
        authority: observed(lease === null ? null : { user_id: U, lease_id: lease, state: 'recording' }),
    });
    const fenced = row('left', L1, { recording_fenced_at: FENCE, recording_fenced_reason: 'displaced' });
    const captures = (): FenceCaptures => ({
        beforeFirst: { rows: complete([]), duplicateIdentity: false },
        beforeSuccessor: { rows: complete([{ id: 'left', user_id: U }]), duplicateIdentity: false },
        first: { recording: observed(true), snapshot: snap([row('left', L1)], L1), duplicate: false },
        successor: { recording: observed(true), snapshot: snap([fenced, row('next', L2)], L2), duplicate: false },
    });
    const afterSave = () => ({ snapshot: snap([fenced, row('next', L2, { status: 'completed' })], null), duplicateIdentity: false });
    const bound = (a: ReturnType<SessionCreateBinding['binding']>, b: ReturnType<SessionCreateBinding['binding']>) => ({ binding: (p: string) => (p === 'A' ? a : b) });
    const A = { state: 'observed', sessionId: 'left', leaseId: L1 } as const;
    const B = { state: 'observed', sessionId: 'next', leaseId: L2 } as const;
    const run = (c = captures(), creations = bound(A, B), after = afterSave()) => recoveryFenceRow(creations, c, after, observed('next'), 'run', U);

    it('passes the bound permanently displaced take through the accepted oracle', () => {
        expect(run()).toMatchObject({ status: 'PASS', evidence: { bindingA: 'observed', bindingB: 'observed', duplicateObserved: false } });
    });

    it('composes actual settled binding with the permanent-fence oracle without changing its requirements', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const a = rpc(L1); page.emit(a.request); await a.created(created('left', L1));
        b.arm('B'); const n = rpc(L2); page.emit(n.request); await n.created(created('next', L2));
        b.detach(); expect(run(captures(), b).status).toBe('PASS');
        const noFence = afterSave();
        if (noFence.snapshot.rows.state !== 'observed') throw new Error('fixture unavailable');
        noFence.snapshot.rows = { ...noFence.snapshot.rows,
            value: noFence.snapshot.rows.value.map((r, i) => i === 0 ? { ...r, recording_fenced_at: null } : r) };
        expect(run(captures(), b, noFence).status).toBe('FAIL');
    });
    it.each([['missing', {}], ['undefined', { new_session: undefined }]] as const)(
        'a prior valid creation plus %s field remains oracle HOLD', async (_name, body) => {
            const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
            const a = rpc(L1); page.emit(a.request); await a.created(created('left', L1));
            b.arm('B'); const n = rpc(L2); page.emit(n.request); await n.created(created('next', L2));
            b.arm('A'); const extra = deferredExchange(L1); page.emit(extra.request); extra.respond(); extra.body.resolve(body);
            await flushExchange(); b.detach();
            expect(run(captures(), b).status).toBe('HOLD');
            expect(b.binding('A')).toEqual({ state: 'unavailable', reason: 'creation_exchange_failed' });
        });
    it('an explicit own null refusal after a valid creation preserves the actual oracle PASS', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const a = rpc(L1); page.emit(a.request); await a.created(created('left', L1));
        const refusal = rpc(L1); page.emit(refusal.request); await refusal.created(null);
        b.arm('B'); const n = rpc(L2); page.emit(n.request); await n.created(created('next', L2)); b.detach();
        expect(b.binding('A')).toEqual({ state: 'observed', sessionId: 'left', leaseId: L1 });
        expect(run(captures(), b).status).toBe('PASS');
    });
    it('actual pending binding stays HOLD after terminal late completion; an observed contradiction still FAILs', async () => {
        const page = fakePage(); const b = new SessionCreateBinding(ORIGIN, () => U); b.attach(page); b.arm('A');
        const a = deferredExchange(L1); page.emit(a.request); a.respond();
        b.arm('B'); const n = rpc(L2); page.emit(n.request); await n.created(created('next', L2));
        expect(run(captures(), b).status).toBe('HOLD'); b.detach();
        a.body.resolve({ new_session: created('left', L1) }); await flushExchange();
        expect(run(captures(), b).status).toBe('HOLD');
        const other = fakePage(); const bad = new SessionCreateBinding(ORIGIN, () => U); bad.attach(other); bad.arm('A');
        const wrong = rpc(L1); other.emit(wrong.request); await wrong.created(created('left', L2)); bad.detach();
        const missing = captures(); delete missing.first;
        expect(run(missing, bad).status).toBe('FAIL');
    });

    it('an observed duplicate FAILs before an incomplete read or an unavailable binding can HOLD', () => {
        const c = captures();
        c.successor!.duplicate = true;
        c.successor!.snapshot.rows = { state: 'observed', complete: false, value: [] };
        expect(run(c, bound({ state: 'unavailable', reason: 'creation_unsettled' }, B)).status).toBe('FAIL');
        const after = afterSave(); after.duplicateIdentity = true;
        expect(run(captures(), bound(A, B), after).status).toBe('FAIL');
        const base = captures(); base.beforeFirst!.duplicateIdentity = true; delete base.successor;
        expect(run(base).status).toBe('FAIL');
    });

    it('a self-contradicting creation FAILs before a missing capture can HOLD', () => {
        const c = captures(); delete c.first;
        expect(run(c, bound(A, { state: 'contradiction', reason: 'creation_lease_mismatch' }))).toMatchObject({ status: 'FAIL' });
    });

    it('an unreached capture point or an unavailable binding HOLDs; nothing passes without both bound takes', () => {
        const c = captures(); delete c.beforeSuccessor;
        expect(run(c).status).toBe('HOLD');
        expect(run(captures(), bound({ state: 'unavailable', reason: 'no_creation_observed' }, B)).status).toBe('HOLD');
    });

    it('Sam 1792434511 reproducer: C\'s displaced row with its fence fields REMOVED, through the real reader and oracle, HOLDs — never PASS', async () => {
        const stripped = without(fenced, 'recording_fenced_at', 'recording_fenced_reason');
        const next = row('next', L2, { status: 'completed' });
        const { db } = fakeDb(() => ({ data: [stripped, next], error: null, count: 2 }), () => ({ data: null, error: null }));
        const after = await readSnapshot(db, 'run', U);
        expect(after.snapshot.rows).toEqual({ state: 'unavailable' });
        expect(run(captures(), bound(A, B), after).status).toBe('HOLD');
        // the same reader with the fields PRESENT passes, so the HOLD is the missing observation, not the fixture
        const { db: whole } = fakeDb(() => ({ data: [fenced, next], error: null, count: 2 }), () => ({ data: null, error: null }));
        expect(run(captures(), bound(A, B), await readSnapshot(whole, 'run', U)).status).toBe('PASS');
    });

    it('carries only states and counts to the receipt, never an identity', () => {
        const text = JSON.stringify(run().evidence);
        for (const id of ['left', 'next', L1, L2, U]) expect(text).not.toContain(id);
    });
});
