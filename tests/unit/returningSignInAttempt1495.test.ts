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
    const specVerdict = (outcome: SignInAttemptOutcome, after: { sessionUserMatches: boolean; practiceVisible: boolean }) => {
        const legacy = /receipt\.row\('returning-user sign-in', (\w+) && (\w+) \? '(\w+)' : '(\w+)'/.exec(step);
        if (legacy) {
            const signedIn = outcome.kind === 'token_ok' && after.sessionUserMatches;
            const landed = signedIn && after.practiceVisible;
            const value: Record<string, boolean> = { signedIn, landed };
            return value[legacy[1]] && value[legacy[2]] ? legacy[3] : legacy[4];
        }
        expect(step).toMatch(/const verdict = returningSignInVerdict\(outcome, after\);/);
        expect(step).toMatch(/receipt\.row\('returning-user sign-in', verdict\.verdict, verdict\.detail,/);
        return returningSignInVerdict(outcome, after).verdict;
    };
    const none = { sessionUserMatches: false, practiceVisible: false };

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
        expect(specVerdict(ok, { sessionUserMatches: true, practiceVisible: false })).toBe('FAIL');
        expect(specVerdict(ok, { sessionUserMatches: true, practiceVisible: true })).toBe('PASS');
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
        expect(final).toBeLessThan(step.indexOf('const verdict = returningSignInVerdict(outcome, after);'));
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
        expect(returningSignInVerdict(verdictOutcome, { sessionUserMatches: true, practiceVisible: true }).verdict).toBe('HOLD');
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
