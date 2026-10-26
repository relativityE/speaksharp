// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectCanaryStopSave, isOwnedStopSettledInPage, responseMatchesTake, startOwnerId, verifySavedReadback,
    type StopControls, type StopPage, type StopRequest, type StopResponse } from '../canary/canaryStopSaveOracle';
import { isProgressRoutePathname } from '../e2e/canaryLanding';

const TAKE = 'take-1';
const OWNER = 'owner-1';
const API = 'https://api.example';
const row = (changes: Record<string, unknown> = {}) => ({ id: TAKE, user_id: OWNER, total_words: 42,
    duration: 5, created_at: '2026-10-24T00:00:00Z', engine: 'private', status: 'completed', ...changes });
const saved = { success: true, session_saved: true, final_status: 'completed' };
function response(path: string, method: string, body: unknown, requestBody: unknown = null, status = 200): StopResponse {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const request = { url: () => url, method: () => method, postDataJSON: () => requestBody };
    return { url: () => url, status: () => status, request: () => request, json: vi.fn(async () => body) };
}
const completion = () => response('/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: TAKE, p_status: 'completed' });
const readback = (body: unknown) => response(`/rest/v1/sessions?id=eq.${TAKE}`, 'GET', body);
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
};

type Scenario = { rows?: unknown; completion?: StopResponse | null; reviewRoute?: boolean; dialog?: boolean; noSpeech?: boolean };
class FakePage implements StopPage {
    listeners = new Set<(response: StopResponse) => void>();
    requestListeners = new Set<(request: StopRequest) => void>();
    events: string[] = [];
    throwOnRegistration = false;
    settlementAttributes: Record<string, string | null> = { 'data-session-persisted': 'true', 'data-session-persisted-id': TAKE,
        'data-session-persist-status': 'saved', 'data-runtime-state': 'READY' };
    currentUrl = 'https://app.example/session';
    scenario: Scenario;
    constructor(scenario: Scenario = {}) { this.scenario = scenario; }
    on(event: 'request', listener: (request: StopRequest) => void): void;
    on(event: 'response', listener: (response: StopResponse) => void): void;
    on(event: 'request' | 'response', listener: ((request: StopRequest) => void) | ((response: StopResponse) => void)) {
        if (event === 'request') this.requestListeners.add(listener as (request: StopRequest) => void);
        else this.listeners.add(listener as (response: StopResponse) => void);
        this.events.push(`arm-${event}`);
        if (this.throwOnRegistration) throw new Error('registration failed');
    }
    off(event: 'request', listener: (request: StopRequest) => void): void;
    off(event: 'response', listener: (response: StopResponse) => void): void;
    off(event: 'request' | 'response', listener: ((request: StopRequest) => void) | ((response: StopResponse) => void)) {
        if (event === 'request') this.requestListeners.delete(listener as (request: StopRequest) => void);
        else this.listeners.delete(listener as (response: StopResponse) => void);
        this.events.push(`off-${event}`);
    }
    emitRequest(request: StopRequest) { for (const listener of [...this.requestListeners]) listener(request); }
    emit(r: StopResponse, startRequest = true) {
        if (startRequest) this.emitRequest(r.request());
        for (const listener of [...this.listeners]) listener(r);
    }
    async stop() {
        this.events.push('stop');
        if (this.scenario.reviewRoute) this.currentUrl = 'https://app.example/progress';
        if (this.scenario.completion !== null) this.emit(this.scenario.completion ?? completion());
    }
    async openSavedTake() { this.events.push('open'); this.emit(readback(this.scenario.rows === undefined ? [row()] : this.scenario.rows)); }
    async reload() { this.events.push('reload'); this.emit(readback(this.scenario.rows === undefined ? [row()] : this.scenario.rows)); }
    async waitForFunction(predicate: (sessionId: string) => boolean, sessionId: string) {
        vi.stubGlobal('document', { documentElement: { getAttribute: (name: string) => this.settlementAttributes[name] ?? null } });
        if (!predicate(sessionId)) throw new Error('current take has not settled');
        this.events.push('settled');
    }
    url() { return this.currentUrl; }
    async waitForURL(predicate: (url: URL) => boolean) {
        if (!predicate(new URL(this.currentUrl))) throw new Error('simulated locator timeout');
    }
    waitForResponse(predicate: (response: StopResponse) => boolean): Promise<StopResponse> {
        return new Promise((resolve) => {
            const listener = (r: StopResponse) => {
                if (!predicate(r)) return;
                this.off('response', listener);
                resolve(r);
            };
            this.on('response', listener);
        });
    }
    locator() { return { waitFor: async () => { if (!this.scenario.dialog) throw new Error('simulated locator timeout'); }, isVisible: async () => Boolean(this.scenario.dialog) }; }
    getByText() { return { waitFor: async () => { if (!this.scenario.noSpeech) throw new Error('simulated locator timeout'); } }; }
    getByRole() { return { isVisible: async () => true, click: async () => undefined }; }
}

function controls(page: FakePage, changes: Partial<StopControls> = {}): StopControls {
    return { sessionId: TAKE, ownerId: OWNER, apiOrigin: API, remainingMs: () => 1000,
        stop: () => page.stop(), waitForSettledTake: () => page.waitForFunction(isOwnedStopSettledInPage, TAKE),
        openSavedTake: () => page.openSavedTake(), reloadSavedTake: () => page.reload(), ...changes };
}
async function settle<T>(promise: Promise<T>) {
    await vi.advanceTimersByTimeAsync(1000);
    return promise;
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('actual serializable Stop settlement predicate', () => {
    const settled = { 'data-session-persisted': 'true', 'data-session-persisted-id': TAKE,
        'data-session-persist-status': 'saved', 'data-runtime-state': 'READY' };
    it.each([
        ['complete owned settlement', {}, true],
        ['old take', { 'data-session-persisted-id': 'older-take' }, false],
        ['missing take', { 'data-session-persisted-id': null }, false],
        ['not persisted', { 'data-session-persisted': null }, false],
        ['attribution pending', { 'data-session-persist-status': 'saved-attribution-pending' }, false],
        ['missing status', { 'data-session-persist-status': null }, false],
        ['Stop tail unfinished', { 'data-runtime-state': 'STOPPING' }, false],
    ] as const)('%s', (_label, changes, expected) => {
        const attributes: Record<string, unknown> = { ...settled, ...changes };
        vi.stubGlobal('document', { documentElement: { getAttribute: (name: string) => attributes[name] ?? null } });
        expect(isOwnedStopSettledInPage(TAKE)).toBe(expected);
        expect(isOwnedStopSettledInPage('')).toBe(false);
    });
});

describe('current-take response selection uses the real predicate', () => {
    it('selects only the exact completion origin/path/method/request ID', () => {
        expect(responseMatchesTake(completion(), 'completion', API, TAKE)).toBe(true);
        for (const r of [
            response('https://foreign.example/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: TAKE }),
            response('/other?next=/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: TAKE }),
            response('/rest/v1/rpc/complete_session_v2-extra', 'POST', saved, { p_session_id: TAKE }),
            response('/rest/v1/rpc/complete_session_v2', 'GET', saved, { p_session_id: TAKE }),
            response('/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: `${TAKE}-other` }),
            response('/rest/v1/rpc/complete_session_v2', 'POST', saved, 'unreadable'),
        ]) expect(responseMatchesTake(r, 'completion', API, TAKE)).toBe(false);
    });
    it('selects only a GET with one exact id filter; not an ID in another query parameter', () => {
        expect(responseMatchesTake(readback([row()]), 'arrival', API, TAKE)).toBe(true);
        for (const path of [`/rest/v1/sessions?other=${TAKE}`, `/rest/v1/sessions?id=eq.${TAKE}-extra`,
            `/rest/v1/sessions?id=eq.${TAKE}&id=eq.${TAKE}`, `/rest/v1/sessions_archive?id=eq.${TAKE}`,
            `/other?next=/rest/v1/sessions&id=eq.${TAKE}`, `https://foreign.example/rest/v1/sessions?id=eq.${TAKE}`]) {
            expect(responseMatchesTake(response(path, 'GET', [row()]), 'arrival', API, TAKE)).toBe(false);
        }
        expect(responseMatchesTake(response(`/rest/v1/sessions?id=eq.${TAKE}`, 'POST', [row()]), 'reload', API, TAKE)).toBe(false);
    });
});

describe('exact durable readback', () => {
    it('accepts one exact matching row even when it is second, or a single-object detail response', () => {
        expect(verifySavedReadback(TAKE, OWNER, [row({ id: 'other' }), row()])).toBeNull();
        expect(verifySavedReadback(TAKE, OWNER, row())).toBeNull();
    });
    it.each([
        ['empty', [], 'row_missing'], ['malformed', 'text', 'readback_body'], ['null', null, 'readback_body'],
        ['old', [row({ id: 'old' })], 'row_missing'], ['duplicate', [row(), row()], 'row_duplicate'],
        ['wrong owner', [row({ user_id: 'other' })], 'wrong_owner'],
        ['missing status', [row({ status: undefined })], 'row_not_completed'], ['active', [row({ status: 'active' })], 'row_not_completed'],
        ['zero words', [row({ total_words: 0 })], 'no_words'], ['string words', [row({ total_words: '42' })], 'no_words'],
        ['infinite words', [row({ total_words: Infinity })], 'no_words'], ['NaN words', [row({ total_words: NaN })], 'no_words'],
        ['null engine', [row({ engine: null })], 'row_schema'], ['missing date', [row({ created_at: undefined })], 'row_schema'],
        ['null duration', [row({ duration: null })], 'row_schema'], ['infinite duration', [row({ duration: Infinity })], 'row_schema'],
    ])('refuses %s', (_label, body, reason) => { expect(verifySavedReadback(TAKE, OWNER, body)).toBe(reason); });
    it('requires the nonempty owner captured from the authoritative start', () => {
        expect(startOwnerId({ user_id: OWNER })).toBe(OWNER);
        for (const value of [null, {}, { user_id: '' }, { user_id: 4 }]) expect(startOwnerId(value)).toBeNull();
        expect(verifySavedReadback(TAKE, null, [row()])).toBe('invalid_binding');
    });
});

describe('actual collector, fake Page/Response composition', () => {
    it.each(['/progress', '/analytics'])('arms before Stop and requires arrival plus reload on %s', async (route) => {
        vi.useFakeTimers();
        const page = new FakePage();
        const run = collectCanaryStopSave(page, controls(page, { openSavedTake: async () => {
            page.currentUrl = `https://app.example${route}/${TAKE}`;
            await page.openSavedTake();
        } }));
        const result = await settle(run);
        expect(result).toEqual({ kind: 'saved', readbacks: 2 });
        expect(JSON.stringify(result)).not.toMatch(/take-1|owner-1|https|transcript|email/);
        expect(page.events).toEqual(['arm-request', 'arm-response', 'stop', 'settled', 'open', 'reload', 'off-request', 'off-response']);
        expect(page.listeners.size).toBe(0);
        expect(page.requestListeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('ignores a foreign/wrong take first, without reading its body, then accepts the correct response', async () => {
        vi.useFakeTimers();
        const page = new FakePage();
        const wrong = response('/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: 'other', p_status: 'completed' });
        const run = collectCanaryStopSave(page, controls(page, { stop: async () => { page.emit(wrong); await page.stop(); } }));
        expect(await settle(run)).toEqual({ kind: 'saved', readbacks: 2 });
        expect(wrong.json).not.toHaveBeenCalled();
    });
    it.each([
        ['HTTP failure', response('/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: TAKE }, 503), 'save_http'],
        ['malformed', response('/rest/v1/rpc/complete_session_v2', 'POST', null, { p_session_id: TAKE }), 'save_not_completed'],
        ['not saved', response('/rest/v1/rpc/complete_session_v2', 'POST', { ...saved, session_saved: false }, { p_session_id: TAKE }), 'save_not_completed'],
        ['wrong request status', response('/rest/v1/rpc/complete_session_v2', 'POST', saved, { p_session_id: TAKE, p_status: 'failed' }), 'save_not_completed'],
    ])('refuses %s without opening another take', async (_label, r, reason) => {
        vi.useFakeTimers(); const page = new FakePage({ completion: r as StopResponse });
        expect(await settle(collectCanaryStopSave(page, controls(page)))).toMatchObject({ kind: 'refused', reason });
        expect(page.events).not.toContain('open'); expect(page.listeners.size).toBe(0);
    });
    it('freezes on deadline and removes the listener even while the completion body is hung', async () => {
        vi.useFakeTimers(); const body = deferred<unknown>(); const r = completion(); r.json = () => body.promise;
        const page = new FakePage({ completion: r });
        const result = await settle(collectCanaryStopSave(page, controls(page)));
        expect(result).toEqual({ kind: 'refused', phase: 'completion', reason: 'deadline' });
        expect(page.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
        body.resolve(saved); await vi.advanceTimersByTimeAsync(1);
        expect(result.kind).toBe('refused'); expect(page.events).not.toContain('open');
    });
    it('freezes late readback bodies and never starts a reload afterwards', async () => {
        vi.useFakeTimers(); const body = deferred<unknown>(); const page = new FakePage(); const r = readback([row()]); r.json = () => body.promise;
        const result = await settle(collectCanaryStopSave(page, controls(page, { openSavedTake: async () => { page.emit(r); } })));
        expect(result).toEqual({ kind: 'refused', phase: 'arrival', reason: 'deadline' });
        body.resolve([row()]); await vi.advanceTimersByTimeAsync(1);
        expect(page.events).not.toContain('reload'); expect(page.listeners.size).toBe(0);
    });
    it('late Stop action completion cannot reopen a deadline-frozen collector', async () => {
        vi.useFakeTimers(); const late = deferred<void>(); const page = new FakePage();
        const result = await settle(collectCanaryStopSave(page, controls(page, { stop: async () => { page.emit(completion()); await late.promise; } })));
        expect(result.kind).toBe('refused'); late.resolve(); await vi.advanceTimersByTimeAsync(1);
        expect(page.events).not.toContain('open'); expect(page.listeners.size).toBe(0);
    });
    it('a response to a request from the previous phase cannot prove reload', async () => {
        vi.useFakeTimers(); const page = new FakePage(); const stale = readback([row()]);
        const run = collectCanaryStopSave(page, controls(page, {
            openSavedTake: async () => { page.emitRequest(stale.request()); await page.openSavedTake(); },
            reloadSavedTake: async () => { page.emit(stale, false); },
        }));
        expect(await settle(run)).toEqual({ kind: 'refused', phase: 'reload', reason: 'deadline' });
        expect(stale.json).not.toHaveBeenCalled();
        expect(page.listeners.size).toBe(0); expect(page.requestListeners.size).toBe(0);
    });
    it('does not navigate while the committed take is still settling', async () => {
        vi.useFakeTimers(); const page = new FakePage(); const late = deferred<void>();
        const run = collectCanaryStopSave(page, controls(page, { waitForSettledTake: () => late.promise }));
        await vi.advanceTimersByTimeAsync(200);
        expect(page.events).not.toContain('open');
        late.resolve();
        expect(await settle(run)).toEqual({ kind: 'saved', readbacks: 2 });
    });
    it.each([
        ['data-session-persisted-id', 'other-take'],
        ['data-session-persist-status', 'saved-attribution-pending'],
        ['data-runtime-state', 'STOPPING'],
    ])('actual collector/DOM predicate refuses %s=%s before navigation', async (key, value) => {
        vi.useFakeTimers(); const page = new FakePage(); page.settlementAttributes[key] = value;
        expect(await settle(collectCanaryStopSave(page, controls(page)))).toMatchObject({ kind: 'refused', phase: 'settlement' });
        expect(page.events).not.toContain('open');
    });
    it('a settlement finishing after deadline cannot trigger navigation or change the verdict', async () => {
        vi.useFakeTimers(); const page = new FakePage(); const late = deferred<void>();
        const result = await settle(collectCanaryStopSave(page, controls(page, { waitForSettledTake: () => late.promise })));
        expect(result).toEqual({ kind: 'refused', phase: 'settlement', reason: 'deadline' });
        late.resolve(); await vi.advanceTimersByTimeAsync(1);
        expect(page.events).not.toContain('open'); expect(page.listeners.size).toBe(0); expect(page.requestListeners.size).toBe(0);
    });
    it.each(['stop', 'waitForSettledTake', 'openSavedTake', 'reloadSavedTake'] as const)('refuses %s action rejection and cleans up', async (action) => {
        vi.useFakeTimers(); const page = new FakePage();
        expect(await settle(collectCanaryStopSave(page, controls(page, { [action]: async () => { throw new Error('opaque'); } }))))
            .toMatchObject({ kind: 'refused', reason: 'action_failed' });
        expect(page.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    });
    it('refuses a missing owner without registering listeners or clicking', async () => {
        const page = new FakePage();
        expect(await collectCanaryStopSave(page, controls(page, { ownerId: null }))).toMatchObject({ kind: 'refused', reason: 'invalid_binding' });
        expect(page.events).toEqual([]);
    });
    it('removes an owned registration even if registration throws after adding it', async () => {
        vi.useFakeTimers(); const page = new FakePage(); page.throwOnRegistration = true;
        expect(await settle(collectCanaryStopSave(page, controls(page)))).toMatchObject({ kind: 'refused', reason: 'action_failed' });
        expect(page.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
        expect(page.requestListeners.size).toBe(0);
    });
    it('never publishes saved if owned-listener cleanup throws', async () => {
        vi.useFakeTimers(); const page = new FakePage();
        page.off = () => { throw new Error('cleanup failed'); };
        expect(await settle(collectCanaryStopSave(page, controls(page)))).toMatchObject({ kind: 'refused', reason: 'listener_cleanup_failed' });
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('absolute deadline without timer delivery', () => {
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    it.each(['before-stop', 'completion-body', 'stop-action', 'settlement-action', 'arrival-body', 'reload-body', 'reload-action'] as const)(
        'refuses overdue %s without delivering the scheduled timer', async (point) => {
            vi.useFakeTimers();
            let clock = 0;
            vi.spyOn(performance, 'now').mockImplementation(() => clock);
            const page = new FakePage();
            const late = deferred<unknown>();
            const changes: Partial<StopControls> = {};
            if (point === 'completion-body') {
                const r = completion(); r.json = () => late.promise;
                changes.stop = async () => page.emit(r);
            } else if (point === 'stop-action') changes.stop = async () => { page.emit(completion()); await late.promise; };
            else if (point === 'settlement-action') changes.waitForSettledTake = () => late.promise;
            else if (point === 'arrival-body' || point === 'reload-body') {
                const r = readback([row()]); r.json = () => late.promise;
                changes[point === 'arrival-body' ? 'openSavedTake' : 'reloadSavedTake'] = async () => { page.emit(r); };
            } else if (point === 'reload-action') changes.reloadSavedTake = async () => { await page.reload(); await late.promise; };
            let observed: unknown;
            const run = collectCanaryStopSave(page, controls(page, changes));
            void run.then((result) => { observed = result; });
            if (point !== 'before-stop') await flush();
            expect(vi.getTimerCount()).toBe(1);
            expect(observed).toBeUndefined();
            clock = 900; // exact absolute deadline, including the unchanged 100ms reserve; DO NOT advance timers
            late.resolve(point === 'completion-body' ? saved : [row()]);
            await flush();
            const phase = point.startsWith('reload') ? 'reload' : point === 'arrival-body' ? 'arrival'
                : point === 'settlement-action' ? 'settlement' : 'completion';
            expect(observed).toEqual({ kind: 'refused', phase, reason: 'deadline' });
            expect(page.listeners.size).toBe(0); expect(page.requestListeners.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
            const forbidden = point === 'before-stop' ? ['stop', 'open', 'reload']
                : phase === 'completion' || phase === 'settlement' ? ['open', 'reload'] : phase === 'arrival' ? ['reload'] : [];
            expect(page.events.filter((event) => forbidden.includes(event))).toEqual([]);
        });
});

/** Frozen old d326 Stop block, with only fake-Page parameter typing and final success mapping added. Predicates execute. */
async function oldStopFlow(page: FakePage) {
    const dialogLocator = page.locator();
    const emptyStateLocator = page.getByText();
    const analyticsUrl = page.waitForURL(url => isProgressRoutePathname(url.pathname)).catch(() => null);
    await Promise.race([dialogLocator.waitFor().catch(() => null), emptyStateLocator.waitFor().catch(() => null), analyticsUrl]);
    if (isProgressRoutePathname(new URL(page.url()).pathname)) {
        const observed = page.waitForResponse(res => res.url().includes('/rest/v1/sessions') && res.status() === 200);
        await page.reload();
        const sessions = await (await observed).json();
        if (Array.isArray(sessions) && sessions.length > 0) {
            for (const field of ['id', 'user_id', 'total_words', 'duration', 'created_at', 'engine']) expect(sessions[0][field]).toBeDefined();
        }
    }
    if (await dialogLocator.isVisible().catch(() => false)) {
        const stay = page.getByRole(); if (await stay.isVisible()) await stay.click();
    }
    return 'passed';
}

describe('old-flow false-PASS causal controls', () => {
    it.each([
        ['all waits time out', { completion: null }],
        ['unrelated dialog', { completion: null, dialog: true }],
        ['no speech', { completion: null, noSpeech: true }],
        ['only old row', { reviewRoute: true, rows: [row({ id: 'old-take' })] }],
        ['empty readback', { reviewRoute: true, rows: [] }],
        ['malformed readback', { reviewRoute: true, rows: null }],
        ['missing status', { reviewRoute: true, rows: [row({ status: undefined })] }],
        ['wrong owner', { reviewRoute: true, rows: [row({ user_id: 'wrong-owner' })] }],
    ] as [string, Scenario][])('%s: old reaches PASS, corrected collector refuses', async (_label, scenario) => {
        vi.useFakeTimers();
        const old = new FakePage(scenario); await old.stop();
        expect(await oldStopFlow(old)).toBe('passed');
        const current = new FakePage(scenario);
        const result = await settle(collectCanaryStopSave(current, controls(current)));
        expect(result.kind).toBe('refused');
        expect(current.listeners.size).toBe(0);
    });
});
