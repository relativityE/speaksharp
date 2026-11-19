import { describe, expect, it } from 'vitest';
import {
    routeOf, SIGNOUT_MIN_OBSERVATION_MS, SignOutRecorder, signOutStaleRequestVerdict, signOutUnauthorizedReadVerdict,
    type SignOutProbe,
} from '../live/helpers/rwtSignOutRecorder';

const ORIGIN = 'https://proj.supabase.co';
const ANON = 'anon-key';
const SESSION = 'session-token-A';
const NEXT_SESSION = 'session-token-B';
const headers = (bearer: string) => ({ apikey: ANON, authorization: `Bearer ${bearer}` });
const DENIED: SignOutProbe = { status: 403, dataRows: null };

/** A clock the tests move; the recorder reads it at logout completion and window end. */
let clock = 0;
const recorder = (origin = ORIGIN) => new SignOutRecorder<object>(origin, () => clock);

/** A numeric status answers the headers and finishes the body at once; 'headers' answers 200 with the body still downloading. */
function answer(rec: SignOutRecorder<object>, r: object, status: number | 'failed' | 'pending' | 'headers') {
    if (status === 'failed') rec.onFailed(r);
    else if (status === 'headers') rec.onResponse(r, 200);
    else if (status !== 'pending') { rec.onResponse(r, status); rec.onFinished(r); }
}
function send(rec: SignOutRecorder<object>, path: string, bearer: string, status: number | 'failed' | 'pending' | 'headers', method = 'GET') {
    const r = {};
    rec.onRequest(r, `${ORIGIN}${path}`, method, headers(bearer));
    answer(rec, r, status);
    return r;
}

/** Before the click: one authenticated read with SESSION, one anon request, and a request to another origin. */
function armed() {
    const rec = recorder();
    send(rec, '/rest/v1/sessions?select=id', SESSION, 200);
    send(rec, '/rest/v1/plans', ANON, 200);
    rec.onRequest({}, 'https://elsewhere.example/rest/v1/sessions', 'GET', headers(SESSION));
    rec.recordOwnerRead('before', true); // the paired control: the owner reads the exact take before the click
    return rec;
}

/** The click, then the product's logout call answered 204. */
function signedOut(rec: SignOutRecorder<object>) {
    rec.markClick();
    send(rec, '/auth/v1/logout?scope=global', SESSION, 204, 'POST');
    return rec;
}

/**
 * The probe (default: denied), sent from the page's anonymous state, designated and bound to the exact take unless the case says
 * otherwise; the minimum observation; the window closed at the next sign-in; the owner reopens the take (the paired control).
 */
function closed(rec: SignOutRecorder<object>, probe: SignOutProbe | null = DENIED,
    { bearer = ANON, send: sendIt = true, reopened = true as boolean | null } = {}) {
    if (probe) {
        if (sendIt && probe.status !== null) rec.designateProbe(send(rec, '/rest/v1/sessions?id=eq.take', bearer, probe.status));
        rec.recordProbe({ wellFormed: true, boundToTake: true, ...probe });
    }
    clock += SIGNOUT_MIN_OBSERVATION_MS;
    rec.markWindowEnd();
    if (reopened !== null) rec.recordOwnerRead('after', reopened);
    return rec;
}

const both = (rec: SignOutRecorder<object>) => {
    const o = rec.snapshot();
    return { read: signOutUnauthorizedReadVerdict(o).status, stale: signOutStaleRequestVerdict(o).status };
};

describe('J1.d sign-out rows: PASS needs the denied probe over a complete window', () => {
    it('a clean sign-out: the probe is denied and nothing is sent with the old session', () => {
        const rec = signedOut(armed());
        send(rec, '/rest/v1/plans', ANON, 200); // signed-out (anon) traffic is not the old session
        expect(both(closed(rec))).toEqual({ read: 'PASS', stale: 'PASS' });
    });
    it('a 401 probe is a denial too', () => {
        expect(both(closed(signedOut(armed()), { status: 401, dataRows: null }))).toEqual({ read: 'PASS', stale: 'PASS' });
    });
    it('the next session after the window end is not judged', () => {
        const rec = closed(signedOut(armed()));
        send(rec, '/rest/v1/sessions', SESSION, 200);
        send(rec, '/rest/v1/sessions', NEXT_SESSION, 200);
        expect(both(rec)).toEqual({ read: 'PASS', stale: 'PASS' });
    });
});

describe('(1) a successful protected read or data visible after sign-out FAILs', () => {
    it('CONTROL: a new organic 2xx read with the old session FAILs both rows', () => {
        const rec = signedOut(armed());
        send(rec, '/rest/v1/sessions', SESSION, 200);
        expect(both(closed(rec))).toEqual({ read: 'FAIL', stale: 'FAIL' });
        expect(signOutUnauthorizedReadVerdict(rec.snapshot()).detail).toContain('GET /rest/v1/sessions');
    });
    it('CONTROL: the probe answered 2xx with protected rows FAILs the read row', () => {
        expect(both(closed(signedOut(armed()), { status: 200, dataRows: 3 }))).toEqual({ read: 'FAIL', stale: 'PASS' });
    });
});

describe('(2) a 401/403 is a correct denial for that read only', () => {
    it('CONTROL: an organic 403 with the old session does not FAIL the read row, but the request is still stale', () => {
        const rec = signedOut(armed());
        send(rec, '/auth/v1/user', SESSION, 403);
        expect(both(closed(rec))).toEqual({ read: 'PASS', stale: 'FAIL' });
    });
    it('CONTROL: an unrelated 403 never stands in for the probe (HOLD, not PASS)', () => {
        const rec = signedOut(armed());
        send(rec, '/storage/v1/object/public/asset.png', ANON, 403);
        expect(both(closed(rec, null))).toEqual({ read: 'HOLD', stale: 'PASS' });
    });
});

describe('(3) a NEW old-session request after sign-out completed FAILs whatever its answer', () => {
    it.each([[401], [403], [500], ['failed' as const], ['pending' as const]])('CONTROL: answered %s', (status) => {
        const rec = signedOut(armed());
        send(rec, '/rest/v1/sessions', SESSION, status);
        expect(both(closed(rec)).stale).toBe('FAIL');
    });
});

describe('(4) a request sent before sign-out completed that finishes late is not a new stale request', () => {
    it('CONTROL: sent before the click, answered 2xx after the logout completed → its data reached the signed-out page: read FAIL', () => {
        const rec = armed();
        const inFlight = {};
        rec.onRequest(inFlight, `${ORIGIN}/rest/v1/sessions`, 'GET', headers(SESSION));
        signedOut(rec);
        answer(rec, inFlight, 200);
        expect(both(closed(rec))).toEqual({ read: 'FAIL', stale: 'PASS' });
        expect(signOutUnauthorizedReadVerdict(rec.snapshot()).detail).toContain('reached the page after sign-out');
    });
    it('CONTROL: sent after the click but before the logout answered, answered 2xx after it: read FAIL, not stale', () => {
        const rec = armed();
        rec.markClick();
        const logout = {};
        rec.onRequest(logout, `${ORIGIN}/auth/v1/logout`, 'POST', headers(SESSION));
        const inFlight = {};
        rec.onRequest(inFlight, `${ORIGIN}/rest/v1/sessions`, 'GET', headers(SESSION));
        rec.onResponse(logout, 204);
        rec.onResponse(inFlight, 200);
        expect(both(closed(rec))).toEqual({ read: 'FAIL', stale: 'PASS' });
    });
    it('a late pre-click request that was denied, or answered before the logout completed, is neither', () => {
        const rec = armed();
        const denied = {};
        rec.onRequest(denied, `${ORIGIN}/rest/v1/sessions`, 'GET', headers(SESSION));
        send(rec, '/rest/v1/sessions', SESSION, 200); // answered before the click
        signedOut(rec);
        answer(rec, denied, 403);
        expect(both(closed(rec))).toEqual({ read: 'PASS', stale: 'PASS' });
    });
});

describe('the named protected probe: a terminal denial, judged apart from organic traffic', () => {
    it('CONTROL (Sam, #1865 sign-out oracle): synthetic empty traffic with no probe is HOLD, never PASS', () => {
        const rec = recorder();
        send(rec, '/rest/v1/sessions', SESSION, 200);
        expect(both(closed(signedOut(rec), null)).read).toBe('HOLD');
    });
    it('CONTROL: a probe with no terminal answer is HOLD', () => {
        expect(both(closed(signedOut(armed()), { status: null, dataRows: null })).read).toBe('HOLD');
    });
    it.each([[{ status: 200, dataRows: 0, wellFormed: false }], [{ status: 200, dataRows: null }], [{ status: 500, dataRows: null }], [{ status: 404, dataRows: null }]])(
        'CONTROL: a probe answered %o is neither a read nor a denial: HOLD', (probe) => {
            expect(both(closed(signedOut(armed()), probe)).read).toBe('HOLD');
        });
    it('a probe recorded before the logout completed probes nothing signed out: ignored, HOLD', () => {
        const rec = armed();
        rec.markClick();
        rec.recordProbe(DENIED);
        send(rec, '/auth/v1/logout', SESSION, 204, 'POST');
        expect(both(closed(rec, null)).read).toBe('HOLD');
    });
    it('the probe sent by the page with the old session never triggers the stale-request row', () => {
        const rec = signedOut(armed());
        const probe = send(rec, '/rest/v1/sessions', SESSION, 403);
        rec.designateProbe(probe);
        expect(both(closed(rec, DENIED, { send: false }))).toEqual({ read: 'PASS', stale: 'PASS' });
    });
    it('CONTROL: without the designation the same request IS stale', () => {
        const rec = signedOut(armed());
        send(rec, '/rest/v1/sessions', SESSION, 403);
        expect(both(closed(rec)).stale).toBe('FAIL');
    });
});

describe('an incomplete observer window is HOLD for both rows, never PASS', () => {
    const holdBoth = { read: 'HOLD', stale: 'HOLD' };
    it('no click marked', () => { expect(both(closed(armed()))).toEqual(holdBoth); });
    it('not armed before the click', () => { expect(both(closed(signedOut(recorder())))).toEqual(holdBoth); });
    it('only anon traffic before the click', () => {
        const rec = recorder();
        send(rec, '/rest/v1/plans', ANON, 200);
        expect(both(closed(signedOut(rec)))).toEqual(holdBoth);
    });
    it('no logout call after the click', () => {
        const rec = armed();
        rec.markClick();
        expect(both(closed(rec))).toEqual(holdBoth);
    });
    it('a logout call that never completed', () => {
        const rec = armed();
        rec.markClick();
        rec.onRequest({}, `${ORIGIN}/auth/v1/logout`, 'POST', headers(SESSION));
        expect(both(closed(rec))).toEqual(holdBoth);
    });
    it('a logout before the click does not start "after sign-out"', () => {
        const rec = armed();
        send(rec, '/auth/v1/logout', SESSION, 204, 'POST');
        rec.markClick();
        expect(both(closed(rec))).toEqual(holdBoth);
    });
    it('no backend origin configured records nothing', () => {
        const rec = recorder('');
        send(rec, '/rest/v1/sessions', SESSION, 200);
        expect(both(closed(signedOut(rec)))).toEqual(holdBoth);
    });
    it('CONTROL: a window never closed is not proven complete', () => {
        const rec = signedOut(armed());
        rec.recordProbe(DENIED);
        clock += SIGNOUT_MIN_OBSERVATION_MS;
        expect(both(rec)).toEqual(holdBoth);
    });
    it('CONTROL: a window closed before the minimum after logout', () => {
        const rec = signedOut(armed());
        rec.recordProbe(DENIED);
        clock += SIGNOUT_MIN_OBSERVATION_MS - 1;
        rec.markWindowEnd();
        expect(both(rec)).toEqual(holdBoth);
        expect(signOutStaleRequestVerdict(rec.snapshot()).detail).toContain('under the');
    });
});

describe('headers read later (Playwright allHeaders)', () => {
    it('order is taken at the request event; settled() awaits the headers', async () => {
        const rec = recorder();
        let resolveEarly: (h: Record<string, string>) => void = () => undefined;
        rec.onRequest({}, `${ORIGIN}/rest/v1/sessions`, 'GET', new Promise((r) => { resolveEarly = r; }));
        signedOut(rec);
        const late = {};
        rec.onRequest(late, `${ORIGIN}/rest/v1/sessions`, 'GET', Promise.resolve(headers(SESSION)));
        rec.onResponse(late, 200);
        closed(rec);
        expect(rec.snapshot().unreadHeaders).toBe(2);
        expect(both(rec)).toEqual({ read: 'HOLD', stale: 'HOLD' });
        resolveEarly(headers(SESSION));
        await rec.settled();
        expect(both(rec)).toEqual({ read: 'FAIL', stale: 'FAIL' });
    });
    it('CONTROL: a failed header read leaves that request unread: HOLD, never PASS', async () => {
        const rec = signedOut(armed());
        rec.onRequest({}, `${ORIGIN}/rest/v1/sessions`, 'GET', Promise.reject(new Error('target closed')));
        await rec.settled();
        expect(both(closed(rec))).toEqual({ read: 'HOLD', stale: 'HOLD' });
    });
});

describe('observeAtLeast and content-free evidence', () => {
    it('waits only the remainder, and not at all without a completed logout', async () => {
        const idle = new SignOutRecorder<object>(ORIGIN);
        const started = Date.now();
        await idle.observeAtLeast(50);
        expect(Date.now() - started).toBeLessThan(40);
        const rec = new SignOutRecorder<object>(ORIGIN);
        rec.onRequest({}, `${ORIGIN}/rest/v1/sessions`, 'GET', headers(SESSION));
        signedOut(rec);
        const t0 = Date.now();
        await rec.observeAtLeast(60);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
    });
    it('keeps no token, query string or deep path segment', () => {
        const rec = signedOut(armed());
        send(rec, '/storage/v1/object/user-123/take.webm', SESSION, 403);
        closed(rec, { status: 403, dataRows: null });
        const text = JSON.stringify([rec.snapshot(), signOutUnauthorizedReadVerdict(rec.snapshot()), signOutStaleRequestVerdict(rec.snapshot())]);
        for (const secret of [SESSION, ANON, 'user-123', 'take.webm', 'scope=global', 'select=id']) expect(text).not.toContain(secret);
        expect(routeOf('/rest/v1/sessions/extra/id')).toBe('/rest/v1/sessions');
    });
});

describe('Sam 2b (16 Nov): an anonymous, well-formed 200 [] is a denial only with the paired control', () => {
    const EMPTY: SignOutProbe = { status: 200, dataRows: 0 };
    const read = (rec: SignOutRecorder<object>) => signOutUnauthorizedReadVerdict(rec.snapshot());
    it('PASS: anonymous 200 [] on the exact take, the owner read it before and reopened it after', () => {
        const v = read(closed(signedOut(armed()), EMPTY));
        expect(v.status).toBe('PASS');
        expect(v.evidence).toMatchObject({ probeAnonymous: 1, ownerReadBefore: 1, ownerReopenedAfter: 1 });
    });
    it('CONTROL: any returned record FAILs, anonymous or not', () => {
        expect(read(closed(signedOut(armed()), { status: 200, dataRows: 1 })).status).toBe('FAIL');
        expect(read(closed(signedOut(armed()), { status: 200, dataRows: 1, boundToTake: null }, { send: false })).status).toBe('FAIL');
    });
    it('CONTROL: 200 [] carrying the old session is not confirmed anonymous: HOLD', () => {
        expect(read(closed(signedOut(armed()), EMPTY, { bearer: SESSION })).status).toBe('HOLD');
    });
    it('CONTROL: the owner could not read the exact take before sign-out (missing fixture): HOLD', () => {
        const rec = recorder();
        send(rec, '/rest/v1/sessions?select=id', SESSION, 200);
        rec.recordOwnerRead('before', false);
        const v = read(closed(signedOut(rec), EMPTY));
        expect(v.status).toBe('HOLD');
        expect(v.detail).toContain('missing fixture');
    });
    it('CONTROL: no owner read before sign-out: HOLD', () => {
        const rec = recorder();
        send(rec, '/rest/v1/sessions?select=id', SESSION, 200);
        expect(read(closed(signedOut(rec), EMPTY)).status).toBe('HOLD');
    });
    it.each([[false], [null]])('CONTROL: the owner reopen after signing back in is %s: HOLD', (reopened) => {
        expect(read(closed(signedOut(armed()), EMPTY, { reopened })).status).toBe('HOLD');
    });
    it('CONTROL: a malformed 200 [] is HOLD', () => {
        expect(read(closed(signedOut(armed()), { ...EMPTY, wellFormed: false })).status).toBe('HOLD');
        expect(read(closed(signedOut(armed()), { ...EMPTY, wellFormed: null })).status).toBe('HOLD');
    });
    it.each([[EMPTY], [DENIED]])('CONTROL: a probe not bound to the exact take (%o) is HOLD', (probe) => {
        expect(read(closed(signedOut(armed()), { ...probe, boundToTake: false })).status).toBe('HOLD');
    });
    it.each([[EMPTY], [DENIED]])('CONTROL: an undesignated (unobserved) probe (%o) is HOLD', (probe) => {
        expect(read(closed(signedOut(armed()), probe, { send: false })).status).toBe('HOLD');
    });
    it('CONTROL: a probe request sent before the logout completed is not observed after sign-out: HOLD', () => {
        const rec = armed();
        rec.markClick();
        const early = send(rec, '/rest/v1/sessions?id=eq.take', ANON, 200);
        rec.designateProbe(early);
        send(rec, '/auth/v1/logout', SESSION, 204, 'POST');
        expect(read(closed(rec, EMPTY, { send: false })).status).toBe('HOLD');
    });
    it('owner reads count only in their phase: before after the click, or after before the window end, are ignored', () => {
        const rec = recorder();
        send(rec, '/rest/v1/sessions?select=id', SESSION, 200);
        signedOut(rec);
        rec.recordOwnerRead('before', true);
        rec.recordOwnerRead('after', true);
        expect(rec.snapshot().pairedControl).toEqual({ ownerReadBefore: null, ownerReopenedAfter: null });
    });
    it('the paired control stays independent of the stale-request row', () => {
        const rec = signedOut(armed());
        send(rec, '/rest/v1/sessions', SESSION, 403);
        expect(both(closed(rec, EMPTY))).toEqual({ read: 'PASS', stale: 'FAIL' });
    });
});

describe('Codex #1883: late data is judged by body completion, not the header event', () => {
    const read = (rec: SignOutRecorder<object>) => signOutUnauthorizedReadVerdict(rec.snapshot()).status;
    it('CONTROL: headers before the logout, body finished after it: data reached the signed-out page (FAIL)', () => {
        const rec = armed();
        const r = send(rec, '/rest/v1/sessions', SESSION, 'headers');
        signedOut(rec);
        rec.onFinished(r);
        expect(read(closed(rec))).toBe('FAIL');
        expect(signOutUnauthorizedReadVerdict(rec.snapshot()).detail).toContain('reached the page after sign-out');
    });
    it('headers before the logout, body failed after it: no data reached the page', () => {
        const rec = armed();
        const r = send(rec, '/rest/v1/sessions', SESSION, 'headers');
        signedOut(rec);
        rec.onFailed(r);
        expect(read(closed(rec))).toBe('PASS');
    });
    it('CONTROL: headers before the logout, body never finished in the window: delivery unknown (HOLD)', () => {
        const rec = armed();
        send(rec, '/rest/v1/sessions', SESSION, 'headers');
        signedOut(rec);
        expect(read(closed(rec))).toBe('HOLD');
    });
    it('headers and body both before the logout: not late', () => {
        const rec = armed();
        const r = send(rec, '/rest/v1/sessions', SESSION, 'headers');
        rec.onFinished(r);
        expect(read(closed(signedOut(rec)))).toBe('PASS');
    });
    it('the stale-request row is unaffected by body timing', () => {
        const rec = armed();
        const r = send(rec, '/rest/v1/sessions', SESSION, 'headers');
        signedOut(rec);
        rec.onFinished(r);
        expect(signOutStaleRequestVerdict(closed(rec).snapshot()).status).toBe('PASS');
    });
});
