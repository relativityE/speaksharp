// @vitest-environment node
/**
 * PO Option 1, item 2 (2026-11-10), ordinary persistence: the interrupted take's coaching is saved to its own session (read
 * as the signed-in owner) and its reopened saved review — on its own route, rendering its own session — shows exactly that
 * pair. The row makes NO order claim (review RETURN on 4305f2b7); the after-B causal case is proved separately.
 */
import { describe, expect, it } from 'vitest';
import {
    LATE_COACHING_ROW, accessTokenFromAuthStorage, lateCoachingSavedRow, ownerSessionReader, sha256Hex, tokenSubject,
    type LateCoachingDeps, type ReopenedReview,
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
const reopened = (over: Partial<ReopenedReview> = {}): ReopenedReview => ({ pathname: `/analytics/${A}`, transcriptDigest: A_DIGEST, pair: PAIR, coachingRequests: 0, ...over });
/** A fake clock: each sleep advances time; reads return absent until `savedAfter`. */
const deps = (o: { savedAfter?: number; saved?: unknown; readFails?: boolean; review?: ReopenedReview | 'throw' } = {}): LateCoachingDeps & { reads: () => number } => {
    let t = 0, reads = 0;
    return {
        reads: () => reads,
        now: () => t,
        sleep: async (ms) => { t += ms; },
        readSaved: async () => { reads += 1; if (o.readFails) return { ok: false }; return { ok: true, value: t >= (o.savedAfter ?? 0) ? (o.saved === undefined ? PAIR : o.saved) : null, transcriptDigest: A_DIGEST }; },
        openSavedReview: async () => { if (o.review === 'throw') throw new Error('page closed'); return o.review ?? reopened(); },
        same,
    };
};
const verdictOf = async (d: LateCoachingDeps, id: string | null = A) => {
    const s = sink();
    await lateCoachingSavedRow(s, id, d, { waitMs: 10_000, pollMs: 1_000 });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].step).toBe(LATE_COACHING_ROW);
    return { ...s.rows[0], forbidden: s.forbidden };
};

describe('interrupted take coaching saved and shown in its saved review (ordinary persistence)', () => {
    it('PASS: saved (after polling) to the take, reopened on its own route rendering its own session, exactly that pair', async () => {
        const d = deps({ savedAfter: 4_000 });
        const r = await verdictOf(d);
        expect(r.verdict).toBe('PASS');
        expect(d.reads()).toBe(5);
        expect(r.evidence).toEqual({ reason: 'saved-and-shown' });
        expect(r.forbidden).toEqual(expect.arrayContaining([PAIR.what_worked, PAIR.what_to_try_next]));
    });
    it('RETURN (timing): an answer already saved before B recorded is an ordinary PASS that makes NO order claim', async () => {
        const r = await verdictOf(deps({ savedAfter: 0 }));
        expect(r.verdict).toBe('PASS');
        expect(Object.keys(r.evidence ?? {})).toEqual(['reason']);         // no savedAfterMs / order field
        expect(r.detail).not.toMatch(/after|late|record/i);
    });
    it('CASUALTY: never saved within the bound, or malformed, FAILs', async () => {
        expect((await verdictOf(deps({ savedAfter: 60_000 }))).evidence?.reason).toBe('not-saved');
        expect((await verdictOf(deps({ saved: { what_worked: '', what_to_try_next: 'x' } }))).verdict).toBe('FAIL');
    });
    it('RETURN (reopened identity): a wrong route, or a stale card of another session with MATCHING text, FAILs', async () => {
        const wrongRoute = await verdictOf(deps({ review: reopened({ pathname: '/analytics/someone-else' }) }));
        expect(wrongRoute.verdict).toBe('FAIL');
        expect(wrongRoute.evidence?.reason).toBe('wrong-route');
        const staleCard = await verdictOf(deps({ review: reopened({ transcriptDigest: sha256Hex('another take') }) }));
        expect(staleCard.verdict).toBe('FAIL');
        expect(staleCard.evidence?.reason).toBe('wrong-session-rendered');
        expect((await verdictOf(deps({ review: reopened({ transcriptDigest: null }) }))).verdict).toBe('HOLD');
    });
    it('CASUALTY: a reopen coaching request, nothing shown, or a different pair FAIL', async () => {
        expect((await verdictOf(deps({ review: reopened({ coachingRequests: 1 }) }))).evidence?.reason).toBe('reopen-requested-coaching');
        expect((await verdictOf(deps({ review: reopened({ pair: null }) }))).evidence?.reason).toBe('not-shown');
        expect((await verdictOf(deps({ review: reopened({ pair: { ...PAIR, what_to_try_next: 'Something else entirely.' } }) }))).evidence?.reason).toBe('shown-differs');
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
    fetch: postgrest(o.row === undefined ? { id: A, user_id: UID, transcript: 'the interrupted take transcript', ai_suggestions: PAIR } : o.row, seen),
});

describe('ownerSessionReader — the account\'s OWN read, never admin (RETURN: owner-read gap)', () => {
    it('reads the exact session as the signed-in owner: owner token + public anon key, identity-checked', async () => {
        const seen: { auth?: string; apikey?: string; table?: string } = {};
        expect(await reader({}, seen)()).toEqual({ ok: true, value: PAIR, transcriptDigest: A_DIGEST });
        expect(seen.auth).toBe(`Bearer ${jwt(UID)}`);
        expect(seen.apikey).toBe('anon-public');
        expect(seen.table).toBe('/rest/v1/sessions');
    });
    it('CASUALTY: another account\'s token, no token, no anon key, or a row of another owner/session is unreadable (HOLD)', async () => {
        expect(await reader({ token: jwt('someone-else') })()).toEqual({ ok: false });
        expect(await reader({ token: null })()).toEqual({ ok: false });
        expect(await reader({ anonKey: '' })()).toEqual({ ok: false });
        expect(await reader({ row: { id: A, user_id: 'other-owner', transcript: 't', ai_suggestions: PAIR } })()).toEqual({ ok: false });
        expect(await reader({ row: { id: 'other-session', user_id: UID, transcript: 't', ai_suggestions: PAIR } })()).toEqual({ ok: false });
        expect(await reader({ row: null })()).toEqual({ ok: false });
    });
    it('token helpers: only a JWT-shaped sb-*-auth-token is used, and its subject is decoded', () => {
        expect(accessTokenFromAuthStorage([{ key: 'other', value: JSON.stringify({ access_token: jwt(UID) }) }])).toBeNull();
        expect(accessTokenFromAuthStorage([{ key: 'sb-x-auth-token', value: JSON.stringify({ access_token: 'not-a-jwt' }) }])).toBeNull();
        expect(accessTokenFromAuthStorage([{ key: 'sb-x-auth-token', value: JSON.stringify({ currentSession: { access_token: jwt(UID) } }) }])).toBe(jwt(UID));
        expect(tokenSubject(jwt(UID))).toBe(UID);
        expect(tokenSubject('garbage')).toBeNull();
    });
});
