// @vitest-environment node
/**
 * G18 (#1495 c6234022786 ← #1491 c5926297857 item 9; Sam 1793002286.835979): the returning user's sign-in row.
 * A rejected shared credential is account repair (HOLD), setup/network/service faults are inconclusive (HOLD), and only a
 * valid password token for this submit that fails to establish its own session or Practice is a product FAIL.
 */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    armPasswordSignInObserver,
    classifyTokenResponse,
    pageAttemptEvents,
    returningSignInVerdict,
    wireErrorCode,
    type AttemptRequest,
    type AttemptResponse,
    type SignInAttemptEvents,
    type SignInAttemptOutcome,
} from '../live/helpers/returningSignInAttempt';
import type { Page } from '@playwright/test';
import * as attempt from '../live/helpers/returningSignInAttempt';

const AUTH = 'https://project.supabase.example';
const PASSWORD_GRANT = `${AUTH}/auth/v1/token?grant_type=password`;
const SESSION = { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: 'u-1' } };
const readable = (value: unknown) => ({ readable: true as const, value });

describe('G18 the spec judges sign-in by the attempt, not by a missing uid', () => {
    const spec = readFileSync(path.join(__dirname, '../live/rwt-products-navigation.live.spec.ts'), 'utf8');
    const step = spec.slice(spec.indexOf("test.step('returning user signs in through the real form'"), spec.indexOf('// ── State verification'));

    /**
     * The spec's own `returning-user sign-in` row decision, executed for one scenario. While the spec still carries the
     * blanket rule (`signedIn && landed ? 'PASS' : 'FAIL'`), that literal rule is evaluated; otherwise the spec must route
     * the row through `returningSignInVerdict`.
     */
    const specVerdict = (outcome: SignInAttemptOutcome, after: { sessionUserMatches: boolean; landed: boolean }) => {
        const legacy = /receipt\.row\('returning-user sign-in', (\w+) && (\w+) \? '(\w+)' : '(\w+)'/.exec(step);
        if (legacy) {
            const signedIn = outcome.kind === 'token_ok' && after.sessionUserMatches;
            const landed = signedIn && after.landed;
            const value: Record<string, boolean> = { signedIn, landed };
            return value[legacy[1]] && value[legacy[2]] ? legacy[3] : legacy[4];
        }
        expect(step).toMatch(/const verdict = returningSignInVerdict\(outcome, after, 'Practice'\);/);
        expect(step).toMatch(/receipt\.row\('returning-user sign-in', verdict\.verdict, verdict\.detail,/);
        return returningSignInVerdict(outcome, after, 'Practice').verdict;
    };
    const none = { sessionUserMatches: false, landed: false };

    it('a refused shared credential is account repair (HOLD), not a product FAIL', () => {
        expect(specVerdict({ kind: 'invalid_credentials', status: 400 }, none)).toBe('HOLD');
    });

    it('a timed-out, rate-limited or failed attempt is inconclusive (HOLD), not a product FAIL', () => {
        for (const reason of ['timeout', 'rate_limited', 'server_error', 'transport_failed', 'context_closed'] as const) {
            expect(specVerdict({ kind: 'inconclusive', status: null, reason }, none)).toBe('HOLD');
        }
    });

    it('CONTROL: a valid token whose session never appears, or Practice missing, is still a product FAIL; both present PASS', () => {
        const ok = { kind: 'token_ok', status: 200, userId: 'u-1' } as const;
        expect(specVerdict(ok, none)).toBe('FAIL');
        expect(specVerdict(ok, { sessionUserMatches: true, landed: false })).toBe('FAIL');
        expect(specVerdict(ok, { sessionUserMatches: true, landed: true })).toBe('PASS');
    });

    it('the observer is armed before the submit, after a no-preexisting-session check, and only a PASS proceeds', () => {
        const arm = step.indexOf('armPasswordSignInObserver(');
        expect(arm).toBeGreaterThan(-1);
        expect(step.indexOf("if (await readUid(page))")).toBeGreaterThan(-1);
        expect(step.indexOf("if (await readUid(page))")).toBeLessThan(arm);
        expect(arm).toBeLessThan(step.indexOf("getByTestId('sign-in-submit').click()"));
        expect(step).toMatch(/if \(!verdict\.proceed\) throw new Error\(`\$\{verdict\.verdict\} returning-user sign-in: \$\{verdict\.detail\}`\);/);
        // The verdict reads the attempt only after the session/Practice wait, and observation is disposed in `finally`.
        const final = step.indexOf('outcome = attempt.final();');
        expect(final).toBeGreaterThan(step.indexOf("getByTestId('practice-root')"));
        expect(final).toBeLessThan(step.indexOf("const verdict = returningSignInVerdict(outcome, after, 'Practice');"));
        expect(step).toMatch(/\} finally \{\s*attempt\.dispose\(\);\s*\}/);
        // Content-free: the row carries the outcome class, status and timing, never the token user id.
        expect(step).not.toMatch(/userId[^;]*receipt\.row|receipt\.row[^;]*userId/);
    });
});

describe('G18 token responses, classified by the pinned client\'s wire shape (@supabase/auth-js 2.86.0)', () => {
    it('a 200 with the typed, non-empty session and user id is token_ok', () => {
        expect(classifyTokenResponse({ status: 200, body: readable(SESSION) })).toEqual({ kind: 'token_ok', status: 200, userId: 'u-1' });
    });

    it('a 200 with a malformed session envelope, or an unreadable body, is inconclusive', () => {
        const malformed = [
            { ...SESSION, refresh_token: '' },
            { ...SESSION, expires_in: '3600' },
            { ...SESSION, expires_in: 0 },
            { ...SESSION, user: { id: '' } },
            { ...SESSION, user: undefined },
            null,
            [SESSION],
        ];
        for (const value of malformed) {
            expect(classifyTokenResponse({ status: 200, body: readable(value) })).toMatchObject({ kind: 'inconclusive', reason: 'malformed_session' });
        }
        expect(classifyTokenResponse({ status: 200, body: { readable: false } })).toMatchObject({ reason: 'unreadable_body' });
    });

    it('invalid_credentials is read exactly as the client reads it: `code` from a 2024-01-01+ response, else `error_code`', () => {
        expect(wireErrorCode('2024-01-01', { code: 'invalid_credentials' })).toBe('invalid_credentials');
        expect(wireErrorCode(undefined, { code: 400, error_code: 'invalid_credentials' })).toBe('invalid_credentials');
        expect(wireErrorCode('2024-01-01', { code: 400, error_code: 'invalid_credentials' })).toBe('invalid_credentials');
        expect(wireErrorCode(undefined, { code: 'invalid_credentials' })).toBeUndefined(); // no version: `code` is not read
        expect(wireErrorCode('2023-12-31', { code: 'invalid_credentials' })).toBeUndefined();
        expect(classifyTokenResponse({ status: 400, apiVersion: '2024-01-01', body: readable({ code: 'invalid_credentials' }) }))
            .toEqual({ kind: 'invalid_credentials', status: 400 });
        expect(classifyTokenResponse({ status: 400, body: readable({ error_code: 'invalid_credentials' }) }))
            .toEqual({ kind: 'invalid_credentials', status: 400 });
    });

    it('CONTROL: an unknown shape, another error code or a non-400 status is inconclusive, never account repair', () => {
        expect(classifyTokenResponse({ status: 400, body: readable({ code: 'invalid_credentials' }) })).toMatchObject({ reason: 'unrecognized_error' });
        expect(classifyTokenResponse({ status: 400, body: readable({ error_code: 'email_not_confirmed' }) })).toMatchObject({ reason: 'unrecognized_error' });
        expect(classifyTokenResponse({ status: 400, body: readable({ msg: 'Invalid login credentials' }) })).toMatchObject({ reason: 'unrecognized_error' });
        expect(classifyTokenResponse({ status: 401, body: readable({ error_code: 'invalid_credentials' }) })).toMatchObject({ reason: 'unrecognized_error' });
        expect(classifyTokenResponse({ status: 400, body: { readable: false } })).toMatchObject({ reason: 'unreadable_body' });
        expect(classifyTokenResponse({ status: 429, body: readable({}) })).toMatchObject({ reason: 'rate_limited' });
        expect(classifyTokenResponse({ status: 503, body: { readable: false } })).toMatchObject({ reason: 'server_error' });
    });
});

/** A scripted page: requests, responses, failures and close, all delivered through the observer's own subscriptions. */
class FakePage implements SignInAttemptEvents {
    mainFrame = { frame: 'main' };
    readonly listeners = { request: new Set<(r: AttemptRequest) => void>(), response: new Set<(r: AttemptResponse) => void>(), failed: new Set<(r: AttemptRequest) => void>(), close: new Set<() => void>() };
    onRequest(listener: (r: AttemptRequest) => void) { this.listeners.request.add(listener); return () => { this.listeners.request.delete(listener); }; }
    onResponse(listener: (r: AttemptResponse) => void) { this.listeners.response.add(listener); return () => { this.listeners.response.delete(listener); }; }
    onRequestFailed(listener: (r: AttemptRequest) => void) { this.listeners.failed.add(listener); return () => { this.listeners.failed.delete(listener); }; }
    onClose(listener: () => void) { this.listeners.close.add(listener); return () => { this.listeners.close.delete(listener); }; }
    get subscriptions() { return Object.values(this.listeners).reduce((n, set) => n + set.size, 0); }
    request(url: string, { method = 'POST', frame = this.mainFrame as unknown } = {}): AttemptRequest {
        const request = { method: () => method, url: () => url, frame: () => frame };
        this.listeners.request.forEach((l) => l(request));
        return request;
    }
    respond(request: AttemptRequest, status: number, value: unknown, headers: Record<string, string> = {}) {
        const response = { request: () => request, status: () => status, headers: () => headers, json: () => Promise.resolve(value) };
        this.listeners.response.forEach((l) => l(response));
    }
    fail(request: AttemptRequest) { this.listeners.failed.forEach((l) => l(request)); }
    close() { this.listeners.close.forEach((l) => l()); }
}

describe('G18 the observer binds only this submit\'s own password-grant exchange', () => {
    const arm = (page: FakePage, timeoutMs = 50) => armPasswordSignInObserver(page, { authOrigin: AUTH, timeoutMs });

    it('NORMAL: the armed password grant and its own 200 session give token_ok; dispose releases every subscription', async () => {
        const page = new FakePage();
        const attempt = arm(page);
        page.respond(page.request(PASSWORD_GRANT), 200, SESSION);
        await expect(attempt.settle()).resolves.toEqual({ kind: 'token_ok', status: 200, userId: 'u-1' });
        expect(attempt.final()).toEqual({ kind: 'token_ok', status: 200, userId: 'u-1' });
        expect(page.subscriptions).toBeGreaterThan(0); // still observing through the session/Practice wait
        attempt.dispose();
        expect(page.subscriptions).toBe(0);
    });

    it('the shared credential refused on the wire gives invalid_credentials', async () => {
        const page = new FakePage();
        const attempt = arm(page);
        page.respond(page.request(PASSWORD_GRANT), 400, { code: 'invalid_credentials' }, { 'x-supabase-api-version': '2024-01-01' });
        await expect(attempt.settle()).resolves.toEqual({ kind: 'invalid_credentials', status: 400 });
    });

    it('a request issued before arming, a refresh grant, another origin, another frame or a GET is never bound', async () => {
        const page = new FakePage();
        const early = page.request(PASSWORD_GRANT); // before arming: the observer never saw it
        const attempt = arm(page);
        page.respond(early, 200, SESSION);
        page.respond(page.request(`${AUTH}/auth/v1/token?grant_type=refresh_token`), 200, SESSION);
        page.respond(page.request('https://other.example/auth/v1/token?grant_type=password'), 200, SESSION);
        page.respond(page.request(PASSWORD_GRANT, { frame: { frame: 'iframe' } }), 200, SESSION);
        page.respond(page.request(PASSWORD_GRANT, { method: 'GET' }), 200, SESSION);
        await expect(attempt.settle()).resolves.toMatchObject({ kind: 'inconclusive', reason: 'timeout' });
    });

    it('a second password grant before the outcome is ambiguous', async () => {
        const page = new FakePage();
        const attempt = arm(page);
        const first = page.request(PASSWORD_GRANT);
        page.request(PASSWORD_GRANT);
        page.respond(first, 200, SESSION);
        await expect(attempt.settle()).resolves.toMatchObject({ kind: 'inconclusive', reason: 'ambiguous_attempt' });
    });

    it('a response that arrives after the window closed does not change the outcome', async () => {
        const page = new FakePage();
        const attempt = arm(page, 10);
        const request = page.request(PASSWORD_GRANT);
        await expect(attempt.settle()).resolves.toMatchObject({ reason: 'timeout' });
        page.respond(request, 200, SESSION);
        await expect(attempt.settle()).resolves.toMatchObject({ reason: 'timeout' });
        expect(attempt.final()).toMatchObject({ reason: 'timeout' });
        attempt.dispose();
        expect(page.subscriptions).toBe(0);
    });

    it('a transport failure of the bound request, and a closed page, are inconclusive', async () => {
        const failed = new FakePage();
        const a = arm(failed);
        failed.fail(failed.request(PASSWORD_GRANT));
        await expect(a.settle()).resolves.toMatchObject({ kind: 'inconclusive', reason: 'transport_failed' });

        const closed = new FakePage();
        const b = arm(closed);
        closed.request(PASSWORD_GRANT);
        closed.close();
        await expect(b.settle()).resolves.toMatchObject({ kind: 'inconclusive', reason: 'context_closed' });
    });

    it('a second password grant AFTER the first token_ok, before the verdict, is still ambiguous (Sam RETURN 1793003212.501819)', async () => {
        const page = new FakePage();
        const attempt = arm(page) as ReturnType<typeof arm> & { final?: () => SignInAttemptOutcome; dispose?: () => void };
        page.respond(page.request(PASSWORD_GRANT), 200, SESSION);
        await expect(attempt.settle()).resolves.toMatchObject({ kind: 'token_ok' });
        // The spec now waits for session/Practice; a second submit in that window could supply the same user's session.
        page.respond(page.request(PASSWORD_GRANT), 200, SESSION);
        const verdictOutcome = typeof attempt.final === 'function' ? attempt.final() : await attempt.settle();
        expect(verdictOutcome).toMatchObject({ kind: 'inconclusive', reason: 'ambiguous_attempt' });
        expect(returningSignInVerdict(verdictOutcome, { sessionUserMatches: true, landed: true }, 'Practice').verdict).toBe('HOLD');
        attempt.dispose?.();
        expect(page.subscriptions).toBe(0);
    });

    it('CONTROL: with no second grant, final() keeps the first outcome; dispose() releases every subscription', async () => {
        const page = new FakePage();
        const attempt = arm(page) as ReturnType<typeof arm> & { final?: () => SignInAttemptOutcome; dispose?: () => void };
        page.respond(page.request(PASSWORD_GRANT), 200, SESSION);
        await attempt.settle();
        page.request(`${AUTH}/auth/v1/token?grant_type=refresh_token`); // a refresh is not a second sign-in
        expect(typeof attempt.final === 'function' ? attempt.final() : await attempt.settle()).toEqual({ kind: 'token_ok', status: 200, userId: 'u-1' });
        attempt.dispose?.();
        expect(page.subscriptions).toBe(0);
        page.request(PASSWORD_GRANT); // after disposal: no listener, no change
        expect(attempt.final?.() ?? await attempt.settle()).toMatchObject({ kind: 'token_ok' });
    });

    it('an unreadable 200 body for the bound request is inconclusive', async () => {
        const page = new FakePage();
        const attempt = arm(page);
        const request = page.request(PASSWORD_GRANT);
        page.listeners.response.forEach((l) => l({ request: () => request, status: () => 200, headers: () => ({}), json: () => Promise.reject(new SyntaxError('x')) }));
        await expect(attempt.settle()).resolves.toMatchObject({ kind: 'inconclusive', reason: 'unreadable_body' });
    });
});

/**
 * The live spec always arms through `pageAttemptEvents(page)`, so the adapter's event mapping, main-frame identity and
 * same-handler unsubscribe are part of the verdict path. A Node EventEmitter stands in for the Playwright Page (`on`,
 * `off`, `emit`, `listenerCount`); no browser. Adapter proof only, not live authentication proof.
 */
const PAGE_EVENTS = ['request', 'response', 'requestfailed', 'close'] as const;
class EmitterPage extends EventEmitter {
    readonly frame = { frame: 'main' };
    mainFrameCalls = 0;
    mainFrame() { this.mainFrameCalls += 1; return this.frame; }
    counts() { return Object.fromEntries(PAGE_EVENTS.map((name) => [name, this.listenerCount(name)])); }
}
type Adapter = (page: Page) => SignInAttemptEvents;

/** Every way `make` departs from the adapter contract; empty means the contract holds. */
function adapterViolations(make: Adapter): string[] {
    const violations: string[] = [];
    const page = new EmitterPage();
    const events = make(page as unknown as Page);
    if (events.mainFrame !== page.frame || page.mainFrameCalls !== 1) violations.push('mainFrame identity');
    const seen: string[] = [];
    const offs = {
        request: events.onRequest((r) => seen.push(`request:${r.url()}`)),
        response: events.onResponse((r) => seen.push(`response:${r.status()}`)),
        requestfailed: events.onRequestFailed((r) => seen.push(`requestfailed:${r.url()}`)),
        close: events.onClose(() => seen.push('close')),
    };
    const request = { method: () => 'POST', url: () => PASSWORD_GRANT, frame: () => page.frame };
    const payload = {
        request: [request],
        response: [{ request: () => request, status: () => 200, headers: () => ({}), json: () => Promise.resolve(SESSION) }],
        requestfailed: [request],
        close: [],
    };
    for (const name of PAGE_EVENTS) page.emit(name, ...payload[name]);
    const expected = [`request:${PASSWORD_GRANT}`, 'response:200', `requestfailed:${PASSWORD_GRANT}`, 'close'];
    if (JSON.stringify(seen) !== JSON.stringify(expected)) violations.push(`event mapping ${JSON.stringify(seen)}`);
    for (const name of PAGE_EVENTS) {
        if (page.listenerCount(name) !== 1) violations.push(`subscribe ${name}`);
        offs[name]();
        if (page.listenerCount(name) !== 0) violations.push(`unsubscribe ${name}`);
    }
    seen.length = 0;
    for (const name of PAGE_EVENTS) page.emit(name, ...payload[name]);
    if (seen.length) violations.push(`late events ${JSON.stringify(seen)}`);
    return violations;
}

describe('G18 pageAttemptEvents maps the Playwright page onto the observer and releases exactly its own handlers', () => {
    it('each event reaches only its own listener with its own payload; mainFrame is the page\'s; every off removes its handler', () => {
        expect(adapterViolations(pageAttemptEvents)).toEqual([]);
    });

    it('through the real observer: the armed grant settles token_ok and dispose leaves no page listener behind', async () => {
        const page = new EmitterPage();
        const attempt = armPasswordSignInObserver(pageAttemptEvents(page as unknown as Page), { authOrigin: AUTH, timeoutMs: 50 });
        expect(Object.values(page.counts()).every((n) => n > 0)).toBe(true);
        const request = { method: () => 'POST', url: () => PASSWORD_GRANT, frame: () => page.frame };
        page.emit('request', request);
        page.emit('response', { request: () => request, status: () => 200, headers: () => ({}), json: () => Promise.resolve(SESSION) });
        await expect(attempt.settle()).resolves.toEqual({ kind: 'token_ok', status: 200, userId: 'u-1' });
        attempt.dispose();
        expect(page.counts()).toEqual({ request: 0, response: 0, requestfailed: 0, close: 0 });
        page.emit('request', request); // late, after disposal: nothing listens and the outcome stands
        expect(attempt.final()).toEqual({ kind: 'token_ok', status: 200, userId: 'u-1' });
    });

    it('NEGATIVE CONTROLS: a swapped event name or a missing off is caught by the same contract', () => {
        const swapped: Adapter = (page) => {
            const real = pageAttemptEvents(page);
            return { ...real, onRequest: (listener) => { page.on('requestfailed', listener); return () => { page.off('requestfailed', listener); }; } };
        };
        const missingOff: Adapter = (page) => {
            const real = pageAttemptEvents(page);
            return { ...real, onResponse: (listener) => { real.onResponse(listener); return () => {}; } };
        };
        expect(adapterViolations(swapped).join(' | ')).toMatch(/event mapping/);
        expect(adapterViolations(missingOff)).toContain('unsubscribe response');
    });
});

/**
 * G04 (#1548 / #1718; Sam 1793005892.907769): a signed-out deep link returns, after sign-in, to its exact Progress session.
 * The legacy `/analytics/<id>?q#h` link redirects to `/progress/<id>?q#h`, the protected route hands it to sign-in as
 * `state.from`, and `resolveInAppPostAuthTarget` returns there. RWT-15 proves it on the verified returning account with
 * the same observed sign-in as G18. Routing only: the rendered detail is not claimed. Source, pure-logic and orchestration
 * evidence: `runDeepLinkReturn` runs against deterministic page fakes (Sam 1793006584.273009 / 1793006607.086479 controls
 * for closure, cleanup without a session, the new document's microphone, sanitized navigation failure and a preexisting
 * session). No browser, sign-in, lookup or live run happens here.
 */
describe('G04 deep-link return (moved verbatim from returningDeepLinkReturn1548.test.ts; one consumer per helper)', () => {

const ID = '11111111-2222-4333-8444-555555555555';
const EXPECTED = { pathname: `/progress/${ID}`, search: '?g04=1', hash: '#history' };
const OK = { kind: 'token_ok', status: 200, userId: 'u-verified' } as const;
const at = (rest: string) => new URL(`https://speaksharp.example${rest}`);

type DeepLinkReturnVerdict = (input: {
    outcome: SignInAttemptOutcome; verifiedUserId: string; sessionUserMatches: boolean;
    landing: { pathnameMatches: boolean; searchMatches: boolean; hashMatches: boolean };
}) => { verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string };
type DeepLinkLanding = (url: URL, expected: typeof EXPECTED) => { pathnameMatches: boolean; searchMatches: boolean; hashMatches: boolean };
const exports = attempt as unknown as { deepLinkReturnVerdict?: DeepLinkReturnVerdict; deepLinkLanding?: DeepLinkLanding };
const verdictFn = (): DeepLinkReturnVerdict => {
    expect(exports.deepLinkReturnVerdict).toBeTypeOf('function');
    return exports.deepLinkReturnVerdict!;
};
const landingFn = (): DeepLinkLanding => {
    expect(exports.deepLinkLanding).toBeTypeOf('function');
    return exports.deepLinkLanding!;
};
const exact = { pathnameMatches: true, searchMatches: true, hashMatches: true };

describe('G04 the sign-in verdict judges the landing it was told to expect (Practice is not assumed)', () => {
    it('a correct deep-link landing with its own session is a PASS, not "Practice did not load"', () => {
        const verdict = attempt.returningSignInVerdict(OK, { sessionUserMatches: true, landed: true, practiceVisible: false } as never, 'the deep-link destination' as never);
        expect(verdict).toMatchObject({ verdict: 'PASS', proceed: true });
        expect(verdict.detail).not.toMatch(/Practice/);
    });

    it('CONTROL: RWT-15\'s Practice landing keeps its exact rows', () => {
        const ok = attempt.returningSignInVerdict(OK, { sessionUserMatches: true, landed: true } as never, 'Practice' as never);
        expect(ok).toEqual({ verdict: 'PASS', detail: 'signed in with an existing credential and landed on Practice', proceed: true });
        const missing = attempt.returningSignInVerdict(OK, { sessionUserMatches: true, landed: false } as never, 'Practice' as never);
        expect(missing).toEqual({ verdict: 'FAIL', detail: 'signed in, but Practice did not load', proceed: false });
        expect(attempt.returningSignInVerdict(OK, { sessionUserMatches: false, landed: true } as never, 'Practice' as never).verdict).toBe('FAIL');
        expect(attempt.returningSignInVerdict({ kind: 'invalid_credentials', status: 400 }, { sessionUserMatches: false, landed: false } as never, 'Practice' as never).verdict).toBe('HOLD');
    });
});

describe('G04 the exact deep-link landing: pathname, query and hash, each exact', () => {
    it('only the expected session path with its exact query and hash matches', () => {
        const landing = landingFn();
        expect(landing(at(`/progress/${ID}?g04=1#history`), EXPECTED)).toEqual(exact);
        expect(landing(at(`/progress/99999999-2222-4333-8444-555555555555?g04=1#history`), EXPECTED)).toMatchObject({ pathnameMatches: false });
        expect(landing(at(`/analytics/${ID}?g04=1#history`), EXPECTED)).toMatchObject({ pathnameMatches: false });
        expect(landing(at(`/progress/${ID}/x?g04=1#history`), EXPECTED)).toMatchObject({ pathnameMatches: false });
        expect(landing(at('/practice?g04=1#history'), EXPECTED)).toMatchObject({ pathnameMatches: false });
        expect(landing(at(`/progress/${ID}#history`), EXPECTED)).toEqual({ ...exact, searchMatches: false });
        expect(landing(at(`/progress/${ID}?g04=1&x=2#history`), EXPECTED)).toEqual({ ...exact, searchMatches: false });
        expect(landing(at(`/progress/${ID}?g04=1`), EXPECTED)).toEqual({ ...exact, hashMatches: false });
        expect(landing(at(`/progress/${ID}?g04=1#other`), EXPECTED)).toEqual({ ...exact, hashMatches: false });
    });
});

describe('G04 deep-link return verdict', () => {
    const base = { outcome: OK as SignInAttemptOutcome, verifiedUserId: 'u-verified', sessionUserMatches: true, landing: exact };

    it('NORMAL: the verified account, its own session and the exact landing PASS (routing only)', () => {
        const v = verdictFn()(base);
        expect(v.verdict).toBe('PASS');
        expect(v.detail).toMatch(/routing only/);
    });

    it('a second sign-in that is not the verified account is HOLD, never PASS', () => {
        expect(verdictFn()({ ...base, outcome: { ...OK, userId: 'u-other' } }).verdict).toBe('HOLD');
    });

    it('a wrong id/path, query or hash is a product FAIL', () => {
        const v = verdictFn();
        expect(v({ ...base, landing: { ...exact, pathnameMatches: false } }).verdict).toBe('FAIL');
        expect(v({ ...base, landing: { ...exact, searchMatches: false } }).verdict).toBe('FAIL');
        expect(v({ ...base, landing: { ...exact, hashMatches: false } }).verdict).toBe('FAIL');
    });

    it('a refused or inconclusive sign-in is HOLD, and a token without its own session is FAIL', () => {
        const v = verdictFn();
        expect(v({ ...base, outcome: { kind: 'invalid_credentials', status: 400 } }).verdict).toBe('HOLD');
        for (const reason of ['timeout', 'server_error', 'context_closed', 'ambiguous_attempt'] as const) {
            expect(v({ ...base, outcome: { kind: 'inconclusive', status: null, reason } }).verdict).toBe('HOLD');
        }
        expect(v({ ...base, sessionUserMatches: false }).verdict).toBe('FAIL');
    });

    it('a second password submit after the first token response makes the deep-link attempt HOLD', async () => {
        const listeners = { request: new Set<(r: AttemptRequest) => void>(), response: new Set<(r: AttemptResponse) => void>() };
        const events: SignInAttemptEvents = {
            mainFrame: 'main',
            onRequest: (l) => { listeners.request.add(l); return () => { listeners.request.delete(l); }; },
            onResponse: (l) => { listeners.response.add(l); return () => { listeners.response.delete(l); }; },
            onRequestFailed: () => () => undefined,
            onClose: () => () => undefined,
        };
        const auth = 'https://project.supabase.example';
        const grant = (): AttemptRequest => {
            const request = { method: () => 'POST', url: () => `${auth}/auth/v1/token?grant_type=password`, frame: () => 'main' };
            listeners.request.forEach((l) => l(request));
            return request;
        };
        const observer = attempt.armPasswordSignInObserver(events, { authOrigin: auth, timeoutMs: 50 });
        const first = grant();
        const body = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u-verified' } };
        listeners.response.forEach((l) => l({ request: () => first, status: () => 200, headers: () => ({}), json: () => Promise.resolve(body) }));
        await expect(observer.settle()).resolves.toMatchObject({ kind: 'token_ok' });
        grant(); // a second submit while the deep-link landing is awaited
        const outcome = observer.final();
        observer.dispose();
        expect(verdictFn()({ ...base, outcome }).verdict).toBe('HOLD');
    });
});


describe('G04 the RWT-15 spec step is gated, hard-navigates the legacy link, and delegates to the runner', () => {
    const spec = readFileSync(path.join(__dirname, '../live/rwt-products-navigation.live.spec.ts'), 'utf8');
    const begin = spec.indexOf("test.step('a signed-out deep link returns to its exact Progress session after sign-in'");
    const step = begin >= 0 ? spec.slice(begin, spec.indexOf('// ── end G04', begin)) : '';

    it('runs only for the verified account after its first session was cleared, and keeps the id out of the receipt', () => {
        expect(begin).toBeGreaterThan(-1);
        expect(spec.indexOf("receipt.row('signed out after the journey'")).toBeLessThan(begin);
        expect(step).toMatch(/if \(!accountVerified \|\| !sessionCleared\)/);
        expect(step.indexOf('receipt.forbid(targetId)')).toBeGreaterThan(-1);
        expect(step.indexOf('receipt.forbid(targetId)')).toBeLessThan(step.indexOf('await page.goto(`/analytics/${targetId}?g04=1#history`)'));
    });

    it('the runner\'s adapters hard-navigate the legacy link and sign in on the auth form it produced (no auth-page goto)', () => {
        const run = step.indexOf('await runDeepLinkReturn({');
        const gotoLegacy = step.indexOf('await page.goto(`/analytics/${targetId}?g04=1#history`)');
        expect(run).toBeGreaterThan(step.indexOf('receipt.forbid(targetId)'));
        expect(step).toMatch(/target, verifiedUserId: uid, micBaseline: mic, micBaselineRead,/);
        expect(spec).toMatch(/const mic = \(await micAcquisitions\(page\)\)\.length;\n\s+\/\/ [^\n]*\n\s+const micBaselineRead = await readMicCounter\(page\);/);
        expect(step).toMatch(/micAcquisitions: \(\) => readMicCounter\(page\),/);
        expect(gotoLegacy).toBeGreaterThan(run);
        expect(step).toMatch(/armObserver: \(\) => armPasswordSignInObserver\(pageAttemptEvents\(page\)/);
        expect(step).toMatch(/getByTestId\('sign-in-submit'\)\.click\(\)/);
        expect(step).not.toMatch(/goto\(['`]\/auth/);
        expect(step).toMatch(/receipt\.row\('deep-link return writes nothing'/);
    });
});

type Row = { name: string; verdict: string; detail: string; evidence?: Record<string, unknown> };
const AUTH = 'https://project.supabase.example';
const TARGET = { pathname: `/progress/${ID}`, search: '?g04=1', hash: '#history' };
const LANDED = at(`/progress/${ID}?g04=1#history`);

/**
 * Deterministic page fakes for `runDeepLinkReturn`: a scripted auth exchange through a real observer, and a page whose
 * closure, session, URL and microphone counter each step decides. `log` records the order of the calls.
 */
function harness(script: {
    token?: 'ok' | 'refused' | 'none';
    closeAt?: 'landing' | 'after-url' | 'never';
    sessionAfterSignIn?: boolean;
    preexistingSession?: boolean;
    navigation?: 'ok' | 'fail';
    micInDeepLink?: number;
    micAfterSignOut?: number;
    reloadAfterSubmit?: boolean;
    submitThrows?: boolean;
    micBaseline?: number;
    micBaselineRead?: 'bound' | 'other-document' | 'count-mismatch' | 'missing';
    micDecrease?: 'none' | 'deep-link' | 'first-document';
    clearWait?: 'ok' | 'close' | 'unreadable' | 'reject' | 'stuck';
    signOutCloses?: boolean;
    recordWritesRejects?: boolean;
} = {}) {
    const s = {
        token: 'ok', closeAt: 'never', sessionAfterSignIn: true, preexistingSession: false, navigation: 'ok', micInDeepLink: 0,
        micAfterSignOut: 0, reloadAfterSubmit: false, submitThrows: false, micBaseline: 0, micBaselineRead: 'bound',
        micDecrease: 'none', clearWait: 'ok', signOutCloses: false, recordWritesRejects: false, ...script,
    };
    const rows: Row[] = [];
    const log: string[] = [];
    const listeners = {
        request: new Set<(r: AttemptRequest) => void>(), response: new Set<(r: AttemptResponse) => void>(), close: new Set<() => void>(),
    };
    const events: SignInAttemptEvents = {
        mainFrame: 'main',
        onRequest: (l) => { listeners.request.add(l); return () => { listeners.request.delete(l); }; },
        onResponse: (l) => { listeners.response.add(l); return () => { listeners.response.delete(l); }; },
        onRequestFailed: () => () => undefined,
        onClose: (l) => { listeners.close.add(l); return () => { listeners.close.delete(l); }; },
    };
    let closed = false;
    let unreadable = false;
    let session: string | null = null;
    let document = 1;
    // The journey's own mic row judged `micBaseline` in document 1; a first-document decrease starts below it.
    let mic = s.micDecrease === 'first-document' ? 0 : s.micBaseline + s.micAfterSignOut;
    const baselineRead = {
        bound: { count: s.micBaseline, document: 1 },
        'other-document': { count: s.micBaseline, document: 9 },
        'count-mismatch': { count: s.micBaseline + 1, document: 1 },
        missing: null,
    }[s.micBaselineRead];
    const close = () => { closed = true; listeners.close.forEach((l) => l()); };
    const ports = {
        target: TARGET, verifiedUserId: 'u-verified', micBaseline: s.micBaseline, micBaselineRead: baselineRead,
        openLegacyLink: async () => {
            log.push('goto');
            if (s.navigation === 'fail') {
                throw new Error(`page.goto: net::ERR_ABORTED at https://speaksharp.example/analytics/${ID}?g04=1#history`);
            }
            document = 2;
            mic = s.micDecrease === 'deep-link' ? 1 : 0;
            if (s.preexistingSession) session = 'u-verified';
        },
        armObserver: () => { log.push('arm'); return attempt.armPasswordSignInObserver(events, { authOrigin: AUTH, timeoutMs: 50 }); },
        submit: async () => {
            log.push('submit');
            if (s.submitThrows) throw new Error(`locator.click: Timeout 10000ms exceeded.\n  navigated to "https://speaksharp.example/progress/${ID}?g04=1#history"`);
            if (s.reloadAfterSubmit) { document = 3; mic = 0; }
            if (s.token === 'none') return;
            const request = { method: () => 'POST', url: () => `${AUTH}/auth/v1/token?grant_type=password`, frame: () => 'main' };
            listeners.request.forEach((l) => l(request));
            const ok = s.token === 'ok';
            const body = ok ? { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u-verified' } } : { error_code: 'invalid_credentials' };
            listeners.response.forEach((l) => l({ request: () => request, status: () => (ok ? 200 : 400), headers: () => ({}), json: () => Promise.resolve(body) }));
            if (ok && s.sessionAfterSignIn) session = 'u-verified';
            mic += s.micInDeepLink;
        },
        isClosed: () => closed,
        sessionUserId: async () => {
            if (closed) throw new Error('Target page, context or browser has been closed');
            if (unreadable) throw new Error('page.evaluate: SecurityError: localStorage is not available');
            return session;
        },
        awaitSessionUser: async (expected: string) => session === expected,
        awaitLanding: async () => {
            log.push('landing');
            if (s.micDecrease === 'deep-link') mic = 0;
            if (s.closeAt === 'landing') { close(); throw new Error('Target page, context or browser has been closed'); }
        },
        url: () => {
            if (closed) throw new Error('Target page, context or browser has been closed');
            const url = LANDED;
            if (s.closeAt === 'after-url') close();
            return url;
        },
        micAcquisitions: async () => (closed ? null : { count: mic, document }),
        signOut: async () => {
            log.push('sign-out');
            if (s.signOutCloses) { close(); throw new Error('locator.click: Target page, context or browser has been closed'); }
            if (closed || !session) throw new Error('locator.waitFor: Timeout 30000ms exceeded.');
            if (s.clearWait !== 'stuck') session = null;
            return 'direct' as const;
        },
        // Mirrors the Playwright adapter: a poll that cannot read the session times out as `false`.
        awaitSessionCleared: async () => {
            if (s.clearWait === 'close') { close(); return false; }
            if (s.clearWait === 'unreadable') { unreadable = true; return false; }
            if (s.clearWait === 'reject') throw new Error(`expect.poll: Timeout 30000ms exceeded at https://speaksharp.example/progress/${ID}`);
            return !closed && !unreadable && session === null;
        },
        recordWrites: async () => {
            log.push('writes');
            if (s.recordWritesRejects) throw new Error(`PostgrestError: count failed for /progress/${ID}`);
            rows.push({ name: 'deep-link return writes nothing', verdict: 'PASS', detail: 'no write' });
        },
        row: (name: string, verdict: string, detail: string, evidence?: Record<string, unknown>) => { rows.push({ name, verdict, detail, evidence }); },
    };
    const verdictOf = (name: string) => rows.find((r) => r.name === name)?.verdict;
    return { ports, rows, log, verdictOf };
}
type RunDeepLinkReturn = (ports: ReturnType<typeof harness>['ports']) => Promise<void>;
const runFn = (): RunDeepLinkReturn => {
    const run = (attempt as unknown as { runDeepLinkReturn?: RunDeepLinkReturn }).runDeepLinkReturn;
    expect(run).toBeTypeOf('function');
    return run!;
};

describe('G04 runDeepLinkReturn orchestration (deterministic page fakes; no browser, no live run)', () => {
    it('NORMAL: the verified account returns to the exact destination, then signs out and reads back', async () => {
        const h = harness();
        await runFn()(h.ports);
        expect(h.verdictOf('signed-in deep-link return')).toBe('PASS');
        expect(h.verdictOf('signed out after the deep-link return')).toBe('PASS');
        expect(h.verdictOf('deep-link return writes nothing')).toBe('PASS');
        expect(h.log).toEqual(['goto', 'arm', 'submit', 'landing', 'sign-out', 'writes']);
    });

    it('a token without a session of its own is a FAIL, and cleanup still runs', async () => {
        const h = harness({ sessionAfterSignIn: false });
        await runFn()(h.ports);
        expect(h.verdictOf('signed-in deep-link return')).toBe('FAIL');
        expect(h.log.slice(-1)).toEqual(['writes']);
    });
});

describe('G04 RETURN controls: closure, cleanup, microphone, navigation failure and preexisting session', () => {
    const run = async (h: ReturnType<typeof harness>) => runFn()(h.ports).then(() => null, (error: unknown) => error);
    const row = (h: ReturnType<typeof harness>, name: string) => h.rows.find((r) => r.name === name);

    it('a page closed during the landing wait, after the token settled, is context_closed HOLD, not a routing FAIL', async () => {
        const h = harness({ closeAt: 'landing' });
        await run(h);
        expect(row(h, 'signed-in deep-link return')).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'context_closed' } });
    });

    it('a page closed after the URL was read is context_closed HOLD, never a PASS from that earlier URL', async () => {
        const h = harness({ closeAt: 'after-url' });
        await run(h);
        expect(row(h, 'signed-in deep-link return')).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'context_closed' } });
    });

    it('in both closure orders, cleanup reports an unobservable session (HOLD), not a failed sign-out, and still reads back', async () => {
        for (const closeAt of ['landing', 'after-url'] as const) {
            const h = harness({ closeAt });
            await run(h);
            expect({ closeAt, verdict: h.verdictOf('signed out after the deep-link return') }).toEqual({ closeAt, verdict: 'HOLD' });
            expect(h.log).not.toContain('sign-out');
            expect(h.log.slice(-1)).toEqual(['writes']);
        }
    });

    it('a refused sign-in that created no session needs no sign-out: cleanup PASSes on the verified absent session', async () => {
        const h = harness({ token: 'refused' });
        await run(h);
        expect(h.verdictOf('signed-in deep-link return')).toBe('HOLD');
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'PASS', evidence: { sessionPresent: false } });
        expect(h.log).not.toContain('sign-out');
    });

    it('an inconclusive sign-in (no token response) with no session also needs no sign-out', async () => {
        const h = harness({ token: 'none' });
        await run(h);
        expect(h.verdictOf('signed-in deep-link return')).toBe('HOLD');
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'PASS', evidence: { sessionPresent: false } });
        expect(h.log).not.toContain('sign-out');
    });

    it('CONTROL: a session that exists is still signed out through the product, and a failed sign-out is still a FAIL', async () => {
        const ok = harness();
        await run(ok);
        expect(row(ok, 'signed out after the deep-link return')).toMatchObject({ verdict: 'PASS', evidence: { path: 'direct', sessionCleared: true } });
        const stuck = harness();
        stuck.ports.signOut = async () => { throw new Error('locator.waitFor: Timeout 30000ms exceeded.'); };
        await run(stuck);
        expect(stuck.verdictOf('signed out after the deep-link return')).toBe('FAIL');
    });

    it('the microphone is observed through the new deep-link document: zero PASSes, an acquisition there FAILs', async () => {
        const quiet = harness();
        await run(quiet);
        expect(row(quiet, 'no mic on the deep-link return')).toMatchObject({ verdict: 'PASS', evidence: { afterSignOut: 0, deepLinkDocument: 0 } });
        const opened = harness({ micInDeepLink: 1 });
        await run(opened);
        expect(row(opened, 'no mic on the deep-link return')).toMatchObject({ verdict: 'FAIL', evidence: { deepLinkDocument: 1 } });
    });

    it('an acquisition in the first document after the journey\'s own mic row (the sign-out) FAILs', async () => {
        const h = harness({ micAfterSignOut: 1 });
        await run(h);
        expect(row(h, 'no mic on the deep-link return')).toMatchObject({ verdict: 'FAIL', evidence: { afterSignOut: 1 } });
    });

    it('a counter reset by a further document load, or a closed page, is HOLD, never a zero', async () => {
        const reloaded = harness({ reloadAfterSubmit: true, micInDeepLink: 0 });
        await run(reloaded);
        expect(reloaded.verdictOf('no mic on the deep-link return')).toBe('HOLD');
        const closed = harness({ closeAt: 'landing' });
        await run(closed);
        expect(closed.verdictOf('no mic on the deep-link return')).toBe('HOLD');
    });

    it('a failed legacy navigation is a sanitized HOLD: no id or URL in the error, nothing armed, cleanup still runs', async () => {
        const h = harness({ navigation: 'fail' });
        const error = await run(h);
        expect(error).toBeInstanceOf(Error);
        const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
        expect(text).not.toContain(ID);
        expect((error as Error).message).not.toMatch(/analytics|progress|ERR_ABORTED|speaksharp\.example/);
        expect((error as Error).message).toBe('HOLD signed-in deep-link return: the legacy deep-link navigation failed (Error)');
        expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(h.verdictOf('signed-in deep-link return')).toBe('HOLD');
        expect(h.rows.map((r) => r.detail).join(' ')).not.toContain(ID);
        expect(h.log).not.toContain('arm');
        expect(h.verdictOf('no mic on the deep-link return')).toBe('HOLD');
        expect(h.log.slice(-1)).toEqual(['writes']);
    });

    it('a submit failure on an open page is the same sanitized HOLD, never the raw call log', async () => {
        const h = harness({ submitThrows: true });
        const error = await run(h);
        expect((error as Error).message).toBe('HOLD signed-in deep-link return: the sign-in submit failed (Error)');
        expect(`${(error as Error).message}${(error as Error).stack ?? ''}`).not.toContain(ID);
        expect(h.log.slice(-1)).toEqual(['writes']);
    });

    it('a session present on the deep-link page before arming is preexisting_session HOLD; the attempt is never armed', async () => {
        const h = harness({ preexistingSession: true });
        await run(h);
        expect(row(h, 'signed-in deep-link return')).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'preexisting_session' } });
        expect(h.log).not.toContain('arm');
        expect(h.log).not.toContain('submit');
        expect(h.verdictOf('signed out after the deep-link return')).toBe('PASS');
    });

    it('an unreadable session before arming is HOLD, not an armed attempt', async () => {
        const h = harness();
        const read = h.ports.sessionUserId;
        let reads = 0;
        h.ports.sessionUserId = async () => { reads += 1; if (reads === 1) throw new Error('page.evaluate: Execution context was destroyed'); return read(); };
        await run(h);
        expect(row(h, 'signed-in deep-link return')).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'session_unobservable' } });
        expect(h.log).not.toContain('arm');
    });
});

describe('G04 finalization RETURN (Sam 1793008575.953559): tri-state clear wait, isolated stages, monotonic microphone', () => {
    const run = async (h: ReturnType<typeof harness>) => runFn()(h.ports).then(() => null, (error: unknown) => error);
    const row = (h: ReturnType<typeof harness>, name: string) => h.rows.find((r) => r.name === name);
    const sanitized = (error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        const e = error as Error & { cause?: unknown };
        expect(`${e.message}\n${e.stack ?? ''}`).not.toContain(ID);
        expect(e.message).toMatch(/^HOLD signed-in deep-link return: the [a-z -]+ failed \([A-Za-z]*Error\)$/);
        expect(e.cause).toBeUndefined();
    };

    it('a page closed during the clear wait after sign-out is HOLD (unobservable), not a product FAIL', async () => {
        const h = harness({ clearWait: 'close' });
        await run(h);
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'HOLD' });
        expect(h.log.slice(-1)).toEqual(['writes']);
    });

    it('session storage that becomes unreadable during the clear wait is HOLD, not a product FAIL', async () => {
        const h = harness({ clearWait: 'unreadable' });
        await run(h);
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'HOLD' });
    });

    it('a page that closes inside the sign-out control is HOLD, not "no product sign-out control"', async () => {
        const h = harness({ signOutCloses: true });
        await run(h);
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'HOLD' });
        expect(h.log.slice(-1)).toEqual(['writes']);
    });

    it('CONTROL: a readable session that is still present after sign-out stays a product FAIL', async () => {
        const h = harness({ clearWait: 'stuck' });
        await run(h);
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'FAIL' });
    });

    it('a rejected clear wait is a sanitized HOLD and the readback is still attempted', async () => {
        const h = harness({ clearWait: 'reject' });
        const error = await run(h);
        sanitized(error);
        expect(row(h, 'signed out after the deep-link return')).toMatchObject({ verdict: 'HOLD' });
        expect(h.log.slice(-1)).toEqual(['writes']);
    });

    it('a rejected readback is a sanitized HOLD row, never the raw error', async () => {
        const h = harness({ recordWritesRejects: true });
        const error = await run(h);
        sanitized(error);
        expect(row(h, 'deep-link return writes nothing')).toMatchObject({ verdict: 'HOLD' });
        expect(h.verdictOf('signed-in deep-link return')).toBe('PASS');
    });

    it('CONTROL: an unreadable microphone counter is HOLD and does not stop cleanup or readback', async () => {
        const h = harness();
        h.ports.micAcquisitions = async () => { throw new Error(`page.evaluate: Execution context was destroyed at /progress/${ID}`); };
        expect(await run(h)).toBeNull();
        expect(h.verdictOf('no mic on the deep-link return')).toBe('HOLD');
        expect(h.verdictOf('signed out after the deep-link return')).toBe('PASS');
        expect(h.log.slice(-1)).toEqual(['writes']);
    });

    it('a deep-link document count that falls (positive to zero) is HOLD, never a zero PASS', async () => {
        const h = harness({ micDecrease: 'deep-link' });
        await run(h);
        expect(h.verdictOf('no mic on the deep-link return')).toBe('HOLD');
    });

    it('a first-document count below the judged baseline is HOLD', async () => {
        const h = harness({ micBaseline: 1, micDecrease: 'first-document' });
        await run(h);
        expect(h.verdictOf('no mic on the deep-link return')).toBe('HOLD');
    });

    it('a baseline read from another document, with a mismatched count, or missing is HOLD: the baseline is bound to its document', async () => {
        for (const micBaselineRead of ['other-document', 'count-mismatch', 'missing'] as const) {
            const h = harness({ micBaselineRead });
            await run(h);
            expect({ micBaselineRead, verdict: h.verdictOf('no mic on the deep-link return') }).toEqual({ micBaselineRead, verdict: 'HOLD' });
        }
    });

    it('CONTROL: a bound baseline with no acquisition PASSes, and one acquisition after it FAILs', async () => {
        const quiet = harness({ micBaseline: 2 });
        await run(quiet);
        expect(row(quiet, 'no mic on the deep-link return')).toMatchObject({ verdict: 'PASS', evidence: { afterSignOut: 0 } });
        const opened = harness({ micBaseline: 2, micAfterSignOut: 1 });
        await run(opened);
        expect(row(opened, 'no mic on the deep-link return')).toMatchObject({ verdict: 'FAIL', evidence: { afterSignOut: 1 } });
    });
});
});
