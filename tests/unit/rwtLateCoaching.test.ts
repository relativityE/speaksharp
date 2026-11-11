// @vitest-environment node
/**
 * PO Option 1, item 2 (2026-11-10), ordinary persistence: the interrupted take's coaching is saved to its own session (read
 * as the signed-in owner) and its reopened saved review — on its own route, rendering its own session — shows exactly that
 * pair. The row makes NO order claim (review RETURN on 4305f2b7); the after-B causal case is proved separately.
 */
import { describe, expect, it } from 'vitest';
import {
    LATE_COACHING_ROW, accessTokenFromAuthStorage, answerOrder, classifyTarget, latestAnsweredAt, lateCoachingSavedRow, nonblankParity,
    ownerNewerCompletedCounter, ownerSessionReader, sha256Hex, tokenSubject,
    type AnswerOrder, type LateCoachingDeps, type ReopenedReview, type TargetRow,
} from '../live/helpers/rwtLateCoaching';

const A = '0b9c5e2a-1111-4222-8333-444455556666';
const UID = '7f1c2d3e-aaaa-4bbb-8ccc-dddddddddddd';
const PAIR = { what_worked: 'You kept a steady pace.', what_to_try_next: 'Pause before the key point.' };
const A_DIGEST = sha256Hex('the interrupted take transcript');
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sink = () => {
    const rows: { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }[] = [];
    const forbidden: string[] = [];
    return { rows, forbidden, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, detail, evidence }); }, forbid: (...v: string[]) => { forbidden.push(...v); } };
};
const reopened = (over: Partial<ReopenedReview> = {}): ReopenedReview => ({ pathname: `/analytics/${A}`, renderedSessionId: A, transcriptDigest: A_DIGEST, pair: PAIR, coachingRequests: 0, ...over });
const CREATED = '2026-11-11T17:00:00.000Z';
/**
 * A cancellable fake deadline: fires on a later macrotask (after any already-settled call's microtasks) and moves the fake clock
 * to issue time + ms; a cancelled timer never fires, so a call that settled in time never advances the clock.
 */
const fakeTimer = (get: () => number, set: (v: number) => void) => (ms: number) => {
    let cancelled = false;
    const issued = get();
    const done = new Promise<void>((r) => setImmediate(() => { if (!cancelled) { set(Math.max(get(), issued + ms)); r(); } }));
    return { done, cancel: () => { cancelled = true; } };
};
const never = <T,>() => new Promise<T>(() => undefined);
/** A's row as the owner reads it (available, nonblank, with the pair), overridable per field. */
const rowOf = (over: Partial<TargetRow> = {}): TargetRow => ({ id: A, user_id: UID, status: 'completed', transcript_state: 'available',
    transcript: 'the interrupted take transcript', created_at: CREATED, ai_suggestions: PAIR, ...over });
/** A fake clock: each sleep advances time; reads return no pair until `savedAfter`; `rows` scripts per-read overrides. */
const deps = (o: { savedAfter?: number; saved?: unknown; readFails?: boolean; review?: ReopenedReview | 'throw'; rows?: Partial<TargetRow>[];
    newer?: (n: number) => number | null } = {}): LateCoachingDeps & { reads: () => number; probes: () => number } => {
    let t = 0, reads = 0, probes = 0;
    return {
        reads: () => reads, probes: () => probes,
        now: () => t,
        sleep: async (ms) => { t += ms; },
        timer: fakeTimer(() => t, (v) => { t = v; }),
        readSaved: async () => {
            reads += 1;
            if (o.readFails) return { ok: false };
            const scripted = o.rows?.[reads - 1] ?? {};
            return { ok: true, row: rowOf({ ai_suggestions: t >= (o.savedAfter ?? 0) ? (o.saved === undefined ? PAIR : o.saved) : null, ...scripted }) };
        },
        ...(o.newer ? { newerCompleted: async () => { probes += 1; return o.newer!(probes); } } : {}),
        openSavedReview: async () => { if (o.review === 'throw') throw new Error('page closed'); return o.review ?? reopened(); },
        same, expectedUid: UID,
    };
};
const verdictOf = async (d: LateCoachingDeps, id: string | null = A, order?: AnswerOrder) => {
    const s = sink();
    await lateCoachingSavedRow(s, id, d, { waitMs: 10_000, pollMs: 1_000, ...(order ? { order } : {}) });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].step).toBe(LATE_COACHING_ROW);
    return { ...s.rows[0], forbidden: s.forbidden };
};

describe('interrupted take coaching saved and shown in its saved review (ordinary persistence)', () => {
    it('PASS: saved (after polling) to the take, reopened on its own route rendering its own session, exactly that pair', async () => {
        const d = deps({ savedAfter: 4_000 });
        const r = await verdictOf(d);
        expect(r.verdict).toBe('PASS');
        expect(d.reads()).toBe(6);   // 5 polls + the post-reopen binding read
        expect(r.evidence).toEqual({ reason: 'saved-and-shown', answerOrder: 'unknown' });
        expect(r.forbidden).toEqual(expect.arrayContaining([PAIR.what_worked, PAIR.what_to_try_next]));
    });
    it('RETURN (timing): an answer already saved before B recorded is an ordinary PASS that makes NO order claim', async () => {
        const r = await verdictOf(deps({ savedAfter: 0 }));
        expect(r.verdict).toBe('PASS');
        expect(Object.keys(r.evidence ?? {}).sort()).toEqual(['answerOrder', 'reason']);   // no savedAfterMs; order is recorded, not judged
        expect(r.detail).not.toMatch(/after|late|record/i);
    });
    it('PO 11-11: the observed order is RECORDED on every verdict and never changes it', async () => {
        for (const order of ['answer-after-successor-recording', 'answer-before-successor-recording', 'unknown'] as const) {
            const pass = await verdictOf(deps(), A, order);
            expect(pass.verdict).toBe('PASS');
            expect(pass.evidence?.answerOrder).toBe(order);
            const fail = await verdictOf(deps({ review: reopened({ renderedSessionId: 'session-B' }) }), A, order);
            expect(fail.verdict).toBe('FAIL');
            expect(fail.evidence?.answerOrder).toBe(order);
        }
        expect(answerOrder(2_000, 1_000)).toBe('answer-after-successor-recording');
        expect(answerOrder(1_000, 1_000)).toBe('unknown');            // equal millisecond: no order established
        expect(answerOrder(999, 1_000)).toBe('answer-before-successor-recording');
        expect(answerOrder(null, 1_000)).toBe('unknown');
        expect(answerOrder(1_000, null)).toBe('unknown');
        expect(answerOrder(Number.NaN, 1_000)).toBe('unknown');
        const ok = { outcome: 'answered', status: 200, suggestions: { what_worked: 'w', what_to_try_next: 'n' } };
        expect(latestAnsweredAt([{ ...ok, at: 7 }, { outcome: 'failed', at: 9 }])).toBe(7);
        // an HTTP error or a body-parse failure is "answered" but is not a coaching answer
        expect(latestAnsweredAt([{ outcome: 'answered', status: 503, suggestions: null, at: 7 }])).toBeNull();
        expect(latestAnsweredAt([{ outcome: 'answered', status: 200, suggestions: null, at: 7 }])).toBeNull();
        // two successes: which one is "the" answer is ambiguous → unknown, never the later one by assumption
        expect(latestAnsweredAt([{ ...ok, at: 5 }, { ...ok, at: 7 }])).toBeNull();
        expect(latestAnsweredAt([{ outcome: 'failed', at: 9 }])).toBeNull();
    });
    it('RETURN on 9f5f8711: the app\'s own /progress/<A> route is A\'s route; any other id or route still FAILs', async () => {
        expect((await verdictOf(deps({ review: reopened({ pathname: `/progress/${A}` }) }))).verdict).toBe('PASS');
        expect((await verdictOf(deps({ review: reopened({ pathname: `/progress/${A}/` }) }))).verdict).toBe('PASS');
        expect((await verdictOf(deps({ review: reopened({ pathname: '/progress/someone-else' }) }))).evidence?.reason).toBe('wrong-route');
        expect((await verdictOf(deps({ review: reopened({ pathname: `/session` }) }))).evidence?.reason).toBe('wrong-route');
    });
    it('CASUALTY: never saved within the bound, or malformed, FAILs', async () => {
        expect((await verdictOf(deps({ savedAfter: 60_000 }))).evidence?.reason).toBe('not-saved');
        expect((await verdictOf(deps({ saved: { what_worked: '', what_to_try_next: 'x' } }))).verdict).toBe('FAIL');
    });
    it('RETURN (reopened identity): a wrong route, or a stale card of another session with MATCHING text, FAILs', async () => {
        const wrongRoute = await verdictOf(deps({ review: reopened({ pathname: '/analytics/someone-else' }) }));
        expect(wrongRoute.verdict).toBe('FAIL');
        expect(wrongRoute.evidence?.reason).toBe('wrong-route');
        // RETURN on 7a4d8f4e: a DISTINCT take B with the SAME script and SAME pair on A's URL — only positive identity catches it
        const sameScriptB = await verdictOf(deps({ review: reopened({ renderedSessionId: 'session-B' }) }));
        expect(sameScriptB.verdict).toBe('FAIL');
        expect(sameScriptB.evidence?.reason).toBe('wrong-session-rendered');
        // no identity on the card → HOLD (never inferred from URL or text), even when everything else matches
        const noIdentity = await verdictOf(deps({ review: reopened({ renderedSessionId: null }) }));
        expect(noIdentity.verdict).toBe('HOLD');
        expect(noIdentity.evidence?.reason).toBe('identity-unread');
        // content verification stays: A's identity but another transcript FAILs; an unrendered transcript HOLDs
        expect((await verdictOf(deps({ review: reopened({ transcriptDigest: sha256Hex('another take') }) }))).evidence?.reason).toBe('transcript-differs');
        expect((await verdictOf(deps({ review: reopened({ transcriptDigest: null }) }))).verdict).toBe('HOLD');
    });
    it('CASUALTY: a reopen coaching request, nothing shown, or a different pair FAIL', async () => {
        expect((await verdictOf(deps({ review: reopened({ coachingRequests: 1 }) }))).evidence?.reason).toBe('reopen-requested-coaching');
        expect((await verdictOf(deps({ review: reopened({ pair: null }) }))).evidence?.reason).toBe('not-shown');
        expect((await verdictOf(deps({ review: reopened({ pair: { ...PAIR, what_to_try_next: 'Something else entirely.' } }) }))).evidence?.reason).toBe('shown-differs');
    });
    it('design r2: an expired, inconsistent or ambiguous row HOLDs; a row of another id/owner is a contradiction FAIL', async () => {
        expect((await verdictOf(deps({ rows: [{ transcript_state: 'expired', transcript: null, ai_suggestions: null }] }))).evidence?.reason).toBe('target-expired');
        for (const bad of [{ status: 'active' }, { created_at: 'not-a-date' }, { created_at: null }, { transcript: null }, { transcript: ' \n\t' },
            { transcript_state: 'expired' }, { transcript_state: 'weird' }] as Partial<TargetRow>[]) {
            const r = await verdictOf(deps({ rows: [bad] }));
            expect({ bad, verdict: r.verdict, reason: r.evidence?.reason }).toEqual({ bad, verdict: 'HOLD', reason: 'target-inconsistent' });
        }
        expect((await verdictOf(deps({ rows: [{ transcript: '\u00a0\u00a0' }] }))).evidence?.reason).toBe('nonblank-ambiguous');
        for (const wrong of [{ id: 'other-session' }, { user_id: 'other-owner' }] as Partial<TargetRow>[]) {
            const r = await verdictOf(deps({ rows: [wrong] }));
            expect([r.verdict, r.evidence?.reason]).toEqual(['FAIL', 'identity-contradiction']);
        }
    });
    it('design r2: not-saved FAILs only while the take is still retained; expiry at the bound HOLDs instead', async () => {
        const kept = await verdictOf(deps({ savedAfter: 60_000 }));
        expect([kept.verdict, kept.evidence?.reason]).toEqual(['FAIL', 'not-saved']);
        expect(kept.detail).toMatch(/still retained/);
        // the 11th read (t = 10 s, the bound) sees the take expired → HOLD, never a not-saved FAIL
        const rows = Array.from({ length: 11 }, (_, i) => (i === 10 ? { transcript_state: 'expired', transcript: null } : {})) as Partial<TargetRow>[];
        const expiredAtBound = await verdictOf(deps({ savedAfter: 60_000, rows }));
        expect([expiredAtBound.verdict, expiredAtBound.evidence?.reason]).toEqual(['HOLD', 'target-expired']);
    });
    it('design r2: post-reopen binding — expired during the reopen HOLDs, a changed pair or transcript FAILs, wrong row FAILs', async () => {
        const second = (row: Partial<TargetRow>) => [{}, row];
        expect((await verdictOf(deps({ rows: second({ transcript_state: 'expired', transcript: null, ai_suggestions: null }) }))).evidence?.reason).toBe('window-changed');
        expect((await verdictOf(deps({ rows: second({ ai_suggestions: { ...PAIR, what_worked: 'Different.' } }) }))).evidence?.reason).toBe('pair-changed');
        expect((await verdictOf(deps({ rows: second({ transcript: 'another transcript' }) }))).evidence?.reason).toBe('pair-changed');
        expect((await verdictOf(deps({ rows: second({ user_id: 'other-owner' }) }))).evidence?.reason).toBe('identity-contradiction');
        const unread = await verdictOf({ ...deps(), readSaved: (() => { let n = 0; return async () => (++n === 1 ? { ok: true as const, row: rowOf() } : { ok: false as const }); })() });
        expect([unread.verdict, unread.evidence?.reason]).toEqual(['HOLD', 'owner-read-failed-after-reopen']);
    });
    it('design r2: the newer-completed count is REPORTED (first / final / after reopen) and never changes a verdict', async () => {
        for (const n of [0, 2, null]) {
            const pass = await verdictOf(deps({ newer: () => n }));
            expect(pass.verdict).toBe('PASS');
            expect(pass.evidence).toMatchObject({ newerCompletedFirst: n, newerCompletedFinal: n, newerCompletedAfterReopen: n });
            const notSaved = await verdictOf(deps({ savedAfter: 60_000, newer: () => n }));
            expect([notSaved.verdict, notSaved.evidence?.reason, notSaved.evidence?.newerCompletedFinal]).toEqual(['FAIL', 'not-saved', n]);
        }
        // a window change between probes is recorded as observed, not resolved: first 0, final 1
        expect((await verdictOf(deps({ savedAfter: 60_000, newer: (i) => (i === 1 ? 0 : 1) }))).evidence).toMatchObject({ newerCompletedFirst: 0, newerCompletedFinal: 1 });
        // a throwing or malformed probe is null, never 0
        expect((await verdictOf({ ...deps(), newerCompleted: async () => { throw new Error('x'); } })).evidence?.newerCompletedFirst).toBeNull();
        expect((await verdictOf(deps({ newer: () => -1 }))).evidence?.newerCompletedFirst).toBeNull();
        // without a probe, no newer* keys appear
        expect(Object.keys((await verdictOf(deps())).evidence ?? {}).filter((k) => k.startsWith('newer'))).toEqual([]);
    });
    it('timing: a hung owner read never decides — it times out per poll and, with no fresh final observation, HOLDs (never not-saved)', async () => {
        const d = deps();
        const r = await verdictOf({ ...d, readSaved: () => never<never>() });
        expect([r.verdict, r.evidence?.reason]).toEqual(['HOLD', 'final-read-unavailable']);
    });
    it('timing: a pair-less snapshot followed by a hung final read HOLDs — an old snapshot cannot become not-saved', async () => {
        const d = deps({ savedAfter: 60_000 });
        let n = 0;
        // every polling read answers (pair-less); the final read at the bound never settles
        const r = await verdictOf({ ...d, readSaved: () => (d.now!() >= 10_000 && ++n >= 1 ? never<never>() : d.readSaved()) });
        expect([r.verdict, r.evidence?.reason]).toEqual(['HOLD', 'final-read-unavailable']);
    });
    it('timing: a probe that consumes the whole allowance after a pair-less snapshot cannot age it into a FAIL; the fresh final read decides', async () => {
        const d = deps({ savedAfter: 60_000 });
        // the first probe hangs (times out at PROBE_MS = 5 s of fake time); the bound is 10 s; the final read is fresh
        const slow = await verdictOf({ ...d, newerCompleted: () => never<number>() });
        expect([slow.verdict, slow.evidence?.reason, slow.evidence?.newerCompletedFirst, slow.evidence?.newerCompletedFinal]).toEqual(['FAIL', 'not-saved', null, null]);
        // ...and if the pair lands before that fresh final read, it is a late pair: HOLD, never not-saved
        const late = await verdictOf({ ...deps({ savedAfter: 10_000 }), newerCompleted: () => never<number>() });
        expect([late.verdict, late.evidence?.reason]).toEqual(['HOLD', 'pair-after-bound']);
    });
    it('timing: hung first / final / post-reopen probes are null and never hold up the verdict', async () => {
        const pass = await verdictOf({ ...deps(), newerCompleted: () => never<number>() });
        expect(pass.verdict).toBe('PASS');
        expect(pass.evidence).toMatchObject({ newerCompletedFirst: null, newerCompletedFinal: null, newerCompletedAfterReopen: null });
    });
    it('timing: a hung post-reopen read HOLDs; no read starts after the bound except the one final observation', async () => {
        const d = deps();
        let n = 0;
        const hungAfterReopen = await verdictOf({ ...d, readSaved: () => (++n === 1 ? d.readSaved() : never<never>()) });
        expect([hungAfterReopen.verdict, hungAfterReopen.evidence?.reason]).toEqual(['HOLD', 'owner-read-failed-after-reopen']);
        const counted = deps({ savedAfter: 60_000 });
        await verdictOf(counted);
        expect(counted.reads()).toBe(10 + 1);   // 10 polls inside the 10 s bound (t = 0..9 s, 1 s apart) + the one fresh final read
    });
    it('timing: a result that settles AFTER its absolute deadline (timer callback running late) is not accepted', async () => {
        // Each read advances the clock past its own allowance before settling, while the fake timer has not fired yet.
        const d = deps();
        const late = await verdictOf({ ...d, readSaved: async () => { const r = await d.readSaved(); d.sleep!(60_000); return r; } });
        // no polling read is ever in time and the one final read is late too → no observation → HOLD (never PASS on a late pair)
        expect([late.verdict, late.evidence?.reason]).toEqual(['HOLD', 'final-read-unavailable']);
    });
    it('timing: the equality boundary — a result observed exactly at its deadline is in time', async () => {
        const d = deps();
        // the first read settles exactly READ_MS (10 s, = the whole bound) after it started: accepted, the pair is in-window
        let first = true;
        const r = await verdictOf({ ...d, readSaved: async () => { const v = await d.readSaved(); if (first) { first = false; d.sleep!(10_000); } return v; } });
        expect(r.verdict).toBe('PASS');
    });
    it('nonblank parity with SQL [^[:space:]]: ASCII whitespace is blank, Unicode-only whitespace is ambiguous', () => {
        expect([nonblankParity('x'), nonblankParity(' \t\n\v\f\r'), nonblankParity('\u00a0'), nonblankParity(null)]).toEqual(['nonblank', 'blank', 'ambiguous', 'blank']);
        expect(classifyTarget(rowOf({ transcript: '\u2003 ' }), { sessionId: A, uid: UID }).kind).toBe('nonblank-ambiguous');
    });
    it('unreadable owner evidence, an unopenable review or no session HOLD — never PASS, never a false FAIL', async () => {
        expect((await verdictOf(deps({ readFails: true }))).verdict).toBe('HOLD');
        expect((await verdictOf({ ...deps(), readSaved: async () => { throw new Error('network'); } })).verdict).toBe('HOLD');
        expect((await verdictOf(deps({ review: 'throw' }))).verdict).toBe('HOLD');
        expect((await verdictOf(deps(), null)).verdict).toBe('HOLD');
    });
});

/** A JWT-shaped token whose payload names `sub` (unsigned: the reader only routes it to PostgREST, which verifies it). */
const jwt = (sub: string) => ['e30', Buffer.from(JSON.stringify({ sub })).toString('base64url'), 'sig'].join('.');
const pageWith = (token: string | null) => ({
    evaluate: async () => (token === null ? [] : [{ key: 'sb-abcdefghijklmnopqrst-auth-token', value: JSON.stringify({ access_token: token }) }]),
}) as never;
const postgrest = (row: Record<string, unknown> | null, seen: { auth?: string; apikey?: string; table?: string }) => (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.auth = headers.get('authorization') ?? undefined;
    seen.apikey = headers.get('apikey') ?? undefined;
    seen.table = new URL(String(input)).pathname;
    return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const reader = (o: { token?: string | null; row?: Record<string, unknown> | null; anonKey?: string }, seen = {}) => ownerSessionReader(pageWith(o.token === undefined ? jwt(UID) : o.token), {
    url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: o.anonKey ?? 'anon-public', expectedUid: UID, sessionId: A,
    fetch: postgrest(o.row === undefined ? { ...rowOf() } : o.row, seen),
});

describe('ownerSessionReader — the account\'s OWN read, never admin (RETURN: owner-read gap)', () => {
    it('reads the exact session as the signed-in owner: owner token + public anon key, identity-checked', async () => {
        const seen: { auth?: string; apikey?: string; table?: string } = {};
        expect(await reader({}, seen)()).toEqual({ ok: true, row: rowOf() });
        expect(classifyTarget(rowOf(), { sessionId: A, uid: UID })).toMatchObject({ kind: 'available', transcriptDigest: A_DIGEST });
        expect(seen.auth).toBe(`Bearer ${jwt(UID)}`);
        expect(seen.apikey).toBe('anon-public');
        expect(seen.table).toBe('/rest/v1/sessions');
    });
    it('CASUALTY: another account\'s token, no token, no anon key or no row is unreadable (HOLD); a returned row of another owner/session is handed on and FAILs as a contradiction', async () => {
        expect(await reader({ token: jwt('someone-else') })()).toEqual({ ok: false });
        expect(await reader({ token: null })()).toEqual({ ok: false });
        expect(await reader({ anonKey: '' })()).toEqual({ ok: false });
        expect(await reader({ row: null })()).toEqual({ ok: false });
        for (const row of [{ ...rowOf(), user_id: 'other-owner' }, { ...rowOf(), id: 'other-session' }]) {
            const read = await reader({ row })();
            expect(read.ok).toBe(true);
            expect(read.ok && classifyTarget(read.row, { sessionId: A, uid: UID }).kind).toBe('identity-contradiction');
        }
    });
    it('ownerNewerCompletedCounter: an exact owner count ranked by (created_at, id); a bad anchor or failure is null, never 0', async () => {
        const seen: { url?: string; prefer?: string } = {};
        const counter = (status: number, range: string | null) => ownerNewerCompletedCounter(pageWith(jwt(UID)), {
            url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: 'anon-public', expectedUid: UID,
            fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
                seen.url = decodeURIComponent(String(input)); seen.prefer = new Headers(init?.headers).get('prefer') ?? undefined;
                return new Response(status === 200 ? null : '{}', { status, headers: range ? { 'content-range': range } : {} });
            }) as typeof fetch,
        });
        expect(await counter(200, '*/2')({ createdAt: CREATED, id: A })).toBe(2);
        expect(seen.prefer).toMatch(/count=exact/);
        expect(seen.url).toContain(`user_id=eq.${UID}`);
        expect(seen.url).toContain('status=eq.completed');
        expect(seen.url).toContain('transcript=not.is.null');
        expect(seen.url).toContain(`or=(created_at.gt."${CREATED}",and(created_at.eq."${CREATED}",id.gt.${A}))`);
        expect(await counter(200, '*/0')({ createdAt: CREATED, id: A })).toBe(0);
        expect(await counter(500, null)({ createdAt: CREATED, id: A })).toBeNull();
        expect(await counter(200, '*/1')({ createdAt: 'nope', id: A })).toBeNull();
        expect(await counter(200, '*/1')({ createdAt: CREATED, id: 'not-a-uuid' })).toBeNull();
        expect(await counter(200, '*/1')({ createdAt: `${CREATED}",id.gt.x`, id: A })).toBeNull();
    });
    it('token helpers: only a JWT-shaped sb-*-auth-token is used, and its subject is decoded', () => {
        expect(accessTokenFromAuthStorage([{ key: 'other', value: JSON.stringify({ access_token: jwt(UID) }) }])).toBeNull();
        expect(accessTokenFromAuthStorage([{ key: 'sb-x-auth-token', value: JSON.stringify({ access_token: 'not-a-jwt' }) }])).toBeNull();
        expect(accessTokenFromAuthStorage([{ key: 'sb-x-auth-token', value: JSON.stringify({ currentSession: { access_token: jwt(UID) } }) }])).toBe(jwt(UID));
        expect(tokenSubject(jwt(UID))).toBe(UID);
        expect(tokenSubject('garbage')).toBeNull();
    });
});
