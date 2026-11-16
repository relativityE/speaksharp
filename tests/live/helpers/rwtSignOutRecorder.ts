/**
 * J1.d (#1864 GAP-04): what the backend gives, and what the page sends, around the product's sign-out. Two rows, judged apart
 * so a correct denial is never confused with a stale request (Sam, 2026-11-15):
 *
 * - `signout-no-unauthorized-read`: after sign-out completed, nothing protected was read with the signed-out session.
 *   (1) a successful (2xx) protected read, or data reaching the signed-out page, FAILs: a new old-session request answered 2xx,
 *   or an old-session request sent BEFORE sign-out completed whose 2xx answer arrived after it (its data reaches the signed-out
 *   page). (2) A 401/403 is a correct denial for that read only. PASS needs the NAMED protected probe of the exact run-owned take,
 *   observed after sign-out, with a terminal answer that denies it; an unrelated request's 403, an unanswered, unobserved or
 *   unbound probe, or no probe at all is HOLD, never PASS. An anonymous, well-formed 200 [] is a denial only with the paired
 *   control (Sam, 16 Nov): the owner read that exact take before sign-out and reopened it after signing back in; otherwise HOLD.
 * - `signout-no-stale-request`: (3) a NEW organic request carrying the signed-out session, sent after sign-out completed, FAILs
 *   whatever its answer. (4) A request sent before sign-out completed that finishes late is not a new stale request. The probe
 *   is never organic traffic, so it cannot trigger this row. Zero stale requests PASS only with a proven complete window.
 *
 * Missing observation (no recorder in time, unread headers, no logout, a short or unclosed window) is HOLD, never PASS.
 * Free of Playwright: the spec feeds the context's request events. The signed-out session is learned from the page's own
 * authenticated requests before the click (a bearer that is not the request's `apikey`), kept only as a digest in memory; what
 * leaves this module is booleans, counts, routes and statuses. No token and no response content.
 */
import { createHash } from 'node:crypto';
import type { Verdict } from './rwtAbandonTakeover';

export const SIGNOUT_UNAUTHORIZED_READ_ROW = 'signout-no-unauthorized-read';
export const SIGNOUT_STALE_REQUEST_ROW = 'signout-no-stale-request';
const LOGOUT_PATH = '/auth/v1/logout';
/** The least time after the logout completed that the page must be observed: a shorter window could miss a late request. */
export const SIGNOUT_MIN_OBSERVATION_MS = 5_000;

/** A recorded request as content-free facts, in event order. */
export interface SignOutRequestFact {
    sentSeq: number;
    /** When its answer (or transport failure) was observed; null: still unanswered. */
    answeredSeq: number | null;
    method: string;
    path: string;
    /** It carried the signed-out session (a bearer seen on an authenticated request before the click). */
    oldSession: boolean;
    status: number | null;
    failed: boolean;
}

/**
 * The named protected probe after sign-out, as the spec read it: its terminal status, the protected rows its answer made visible
 * (a count), whether the body was a well-formed JSON array, and whether it read the exact run-owned take (bound by id).
 */
export interface SignOutProbe { status: number | null; dataRows: number | null; wellFormed?: boolean | null; boundToTake?: boolean | null }
/** The probe as judged: what the spec read, plus what the recorder itself saw of the designated request. */
export interface SignOutProbeObservation {
    status: number | null; dataRows: number | null; wellFormed: boolean | null; boundToTake: boolean | null;
    /** The designated probe request was observed, sent after the logout completed and before the window end. */
    observed: boolean;
    /** Its headers carried no user session (no bearer, or only the anon key): null when unread or unobserved. */
    anonymous: boolean | null;
}
/**
 * The paired control (Sam, 16 Nov): the authenticated owner read the exact run-owned take before the sign-out click, and the same
 * owner reopened it after signing back in. It tells a denial (200 []) apart from a missing fixture. null: not observed.
 */
export interface SignOutPairedControl { ownerReadBefore: boolean | null; ownerReopenedAfter: boolean | null }

export interface SignOutObservation {
    armedBeforeClick: boolean;
    priorSessions: number;
    clickSeq: number | null;
    logout: { requestSeq: number; completedSeq: number | null; status: number | null } | null;
    /** The window was closed (at the next sign-in or the end): it is complete only once closed. */
    windowClosed: boolean;
    /** Organic requests (the probe excluded), from before the click to the window end; the logout call excluded. */
    requests: SignOutRequestFact[];
    unreadHeaders: number;
    observedAfterLogoutMs: number | null;
    probe: SignOutProbeObservation | null;
    pairedControl: SignOutPairedControl;
}

interface Entry {
    seq: number; method: string; path: string; bearer: string | null; apikey: string | null;
    headersRead: boolean; status: number | null; failed: boolean; answeredSeq: number | null; probe: boolean;
}
type Headers = Record<string, string | undefined>;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The route only (`/rest/v1/<table>`, `/functions/v1/<name>`, `/auth/v1/<call>`): deeper segments can carry ids. */
export function routeOf(pathname: string): string {
    return '/' + pathname.split('/').filter(Boolean).slice(0, 3).join('/');
}

function bearerOf(headers: Headers): string | null {
    const auth = headers.authorization ?? headers.Authorization;
    const match = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
    return match ? digest(match[1]) : null;
}

/**
 * Records the page's backend requests (one origin) in event order. Arm it before the sign-in, or at least before the sign-out
 * click; `markClick()` immediately before the sign-out click; `designateProbe`/`recordProbe` for the named protected probe;
 * `observeAtLeast()` then `markWindowEnd()` immediately before the next sign-in submit (or at the end); `settled()` before
 * `snapshot()`.
 */
export class SignOutRecorder<R = unknown> {
    private seq = 0;
    private clickSeq: number | null = null;
    private endSeq: number | null = null;
    private readonly entries = new Map<R, Entry>();
    private readonly order: Entry[] = [];
    private readonly pending = new Set<Promise<void>>();
    private logoutCompletedSeq: number | null = null;
    private logoutCompletedAt: number | null = null;
    private endAt: number | null = null;
    private probe: SignOutProbe | null = null;
    private probeEntry: Entry | null = null;
    private ownerReadBefore: boolean | null = null;
    private ownerReopenedAfter: boolean | null = null;

    constructor(private readonly backendOrigin: string, private readonly now: () => number = Date.now) {}

    /**
     * The request's place in the order is taken NOW (synchronously, in event order). Its headers are given now or read later
     * through a promise (Playwright's `allHeaders()`: `headers()` may omit security headers).
     */
    onRequest(request: R, url: string, method: string, headers: Headers | Promise<Headers>): void {
        let parsed: URL;
        try { parsed = new URL(url); } catch { return; }
        if (!this.backendOrigin || parsed.origin !== this.backendOrigin) return;
        const entry: Entry = {
            seq: ++this.seq, method: method.toUpperCase(), path: routeOf(parsed.pathname),
            bearer: null, apikey: null, headersRead: false, status: null, failed: false, answeredSeq: null, probe: false,
        };
        this.entries.set(request, entry);
        this.order.push(entry);
        if (!(headers instanceof Promise)) { this.applyHeaders(entry, headers); return; }
        const read = headers.then((h) => this.applyHeaders(entry, h), () => undefined).finally(() => this.pending.delete(read));
        this.pending.add(read);
    }

    private applyHeaders(entry: Entry, headers: Headers): void {
        const apikeyRaw = headers.apikey;
        entry.bearer = bearerOf(headers);
        entry.apikey = typeof apikeyRaw === 'string' && apikeyRaw ? digest(apikeyRaw) : null;
        entry.headersRead = true;
    }

    /** Every header read started so far has resolved or failed (a failed read leaves that request unread: HOLD). */
    async settled(): Promise<void> { while (this.pending.size > 0) await Promise.allSettled([...this.pending]); }

    onResponse(request: R, status: number): void {
        const entry = this.entries.get(request);
        if (!entry || entry.answeredSeq !== null) return;
        entry.status = status;
        this.answered(entry);
    }

    onFailed(request: R): void {
        const entry = this.entries.get(request);
        if (!entry || entry.answeredSeq !== null) return;
        entry.failed = true;
        this.answered(entry);
    }

    private answered(entry: Entry): void {
        entry.answeredSeq = ++this.seq;
        if (this.isLogout(entry) && this.logoutCompletedSeq === null && this.clickSeq !== null && entry.seq > this.clickSeq
            && (this.endSeq === null || entry.seq < this.endSeq)) {
            this.logoutCompletedSeq = entry.answeredSeq;
            this.logoutCompletedAt = this.now();
        }
    }

    /** Immediately before the sign-out click. */
    markClick(): void { if (this.clickSeq === null) this.clickSeq = ++this.seq; }

    /** A page request the spec sent as the named protected probe: judged as the probe, never as organic traffic. */
    designateProbe(request: R): void {
        const entry = this.entries.get(request);
        if (entry) { entry.probe = true; this.probeEntry = entry; }
    }

    /**
     * The paired control's two owner reads of the exact run-owned take: 'before' counts only before the sign-out click, 'after'
     * only after the window end (the owner signed back in). Each is recorded once; a later call does not overwrite it.
     */
    recordOwnerRead(phase: 'before' | 'after', foundExactTake: boolean): void {
        if (phase === 'before' && this.clickSeq === null && this.ownerReadBefore === null) this.ownerReadBefore = foundExactTake;
        if (phase === 'after' && this.endSeq !== null && this.ownerReopenedAfter === null) this.ownerReopenedAfter = foundExactTake;
    }

    /**
     * The named protected probe's outcome, sent after the logout completed: its terminal status (null when it got none) and the
     * number of protected rows its answer made visible (null when unread). Counts only, never content.
     */
    recordProbe(result: SignOutProbe): void {
        if (this.logoutCompletedSeq === null) return; // a probe before sign-out completed probes nothing signed out
        this.probe = { status: result.status, dataRows: result.dataRows, wellFormed: result.wellFormed ?? null, boundToTake: result.boundToTake ?? null };
    }

    /** Immediately before the next sign-in submit, or when the recording ends. */
    markWindowEnd(): void {
        if (this.endSeq === null && this.clickSeq !== null) { this.endSeq = ++this.seq; this.endAt = this.now(); }
    }

    /**
     * Before the window may end: once the logout has completed, wait (bounded) until the page has been observed for `ms` after
     * it. Resolves at once when the logout has not completed (the rows then HOLD) or the window already ended.
     */
    async observeAtLeast(ms: number = SIGNOUT_MIN_OBSERVATION_MS): Promise<void> {
        if (this.logoutCompletedAt === null || this.endSeq !== null) return;
        const remaining = this.logoutCompletedAt + ms - this.now();
        if (remaining > 0) await new Promise<void>((resolve) => { setTimeout(resolve, Math.min(remaining, ms)); });
    }

    private isLogout(entry: Entry): boolean { return entry.method === 'POST' && entry.path === LOGOUT_PATH; }

    snapshot(): SignOutObservation {
        const click = this.clickSeq;
        const before = click === null ? [] : this.order.filter((e) => e.seq < click);
        const sessions = new Set(before.filter((e) => e.bearer !== null && e.bearer !== e.apikey).map((e) => e.bearer as string));
        const end = this.endSeq ?? Number.POSITIVE_INFINITY;
        const judged = click === null ? [] : this.order.filter((e) => e.seq < end);
        const logoutEntry = judged.find((e) => click !== null && e.seq > click && this.isLogout(e)) ?? null;
        return {
            armedBeforeClick: before.length > 0,
            priorSessions: sessions.size,
            clickSeq: click,
            logout: logoutEntry ? { requestSeq: logoutEntry.seq, completedSeq: this.logoutCompletedSeq, status: logoutEntry.status } : null,
            windowClosed: this.endSeq !== null,
            requests: judged.filter((e) => e !== logoutEntry && !e.probe).map((e) => ({
                sentSeq: e.seq, answeredSeq: e.answeredSeq, method: e.method, path: e.path,
                oldSession: e.bearer !== null && e.bearer !== e.apikey && sessions.has(e.bearer),
                status: e.status, failed: e.failed,
            })),
            unreadHeaders: judged.filter((e) => !e.headersRead).length,
            observedAfterLogoutMs: this.logoutCompletedAt === null ? null : (this.endAt ?? this.now()) - this.logoutCompletedAt,
            probe: this.probeObservation(),
            pairedControl: { ownerReadBefore: this.ownerReadBefore, ownerReopenedAfter: this.ownerReopenedAfter },
        };
    }

    private probeObservation(): SignOutProbeObservation | null {
        if (this.probe === null) return null;
        const e = this.probeEntry;
        const done = this.logoutCompletedSeq;
        const observed = e !== null && done !== null && e.seq > done && (this.endSeq === null || e.seq < this.endSeq);
        const anonymous = !observed || !e.headersRead ? null : e.bearer === null || e.bearer === e.apikey;
        return {
            status: this.probe.status, dataRows: this.probe.dataRows, wellFormed: this.probe.wellFormed ?? null,
            boundToTake: this.probe.boundToTake ?? null, observed, anonymous,
        };
    }
}

/** Why the observation cannot judge either row (an incomplete observer window), or null when it can. */
function unobservable(o: SignOutObservation): string | null {
    if (o.clickSeq === null) return 'the sign-out click was not marked, so nothing after it can be judged';
    if (!o.armedBeforeClick) return 'no request was recorded before the sign-out click, so the signed-out session is unknown';
    if (o.priorSessions === 0) return 'no authenticated request was seen before the sign-out click, so the signed-out session is unknown';
    if (o.logout === null) return 'the product\'s logout call was not observed after the click';
    if (o.logout.completedSeq === null) return 'the logout call never completed, so "after sign-out" has no start';
    if (o.unreadHeaders > 0) return `${o.unreadHeaders} request(s) had unread headers, so their session is unknown`;
    if (!o.windowClosed) return 'the observer window was never closed, so it is not proven complete';
    if (o.observedAfterLogoutMs === null || o.observedAfterLogoutMs < SIGNOUT_MIN_OBSERVATION_MS) {
        return `the page was observed for ${o.observedAfterLogoutMs ?? 0} ms after the logout, under the ${SIGNOUT_MIN_OBSERVATION_MS} ms minimum`;
    }
    return null;
}

const is2xx = (status: number | null): boolean => status !== null && status >= 200 && status < 300;
const routes = (rows: readonly SignOutRequestFact[]): string => [...new Set(rows.map((r) => `${r.method} ${r.path}`))].sort().join(', ');

/** (3) New organic requests with the signed-out session, SENT after the logout completed. */
function newStale(o: SignOutObservation): SignOutRequestFact[] {
    const done = o.logout?.completedSeq ?? Number.POSITIVE_INFINITY;
    return o.requests.filter((r) => r.oldSession && r.sentSeq > done);
}

/** (4) Old-session requests sent BEFORE the logout completed whose 2xx answer arrived after it: data reaching the signed-out page. */
function lateData(o: SignOutObservation): SignOutRequestFact[] {
    const done = o.logout?.completedSeq ?? Number.POSITIVE_INFINITY;
    return o.requests.filter((r) => r.oldSession && r.sentSeq < done && r.answeredSeq !== null && r.answeredSeq > done && is2xx(r.status));
}

type RowVerdict = Verdict & { evidence: Record<string, number | null> };

/** `signout-no-unauthorized-read`: see the module comment, rules (1) and (2). */
export function signOutUnauthorizedReadVerdict(o: SignOutObservation): RowVerdict {
    const why = unobservable(o);
    const stale = why ? [] : newStale(o);
    const late = why ? [] : lateData(o);
    const read = stale.filter((r) => is2xx(r.status));
    const evidence = {
        logoutStatus: o.logout?.status ?? null, observedAfterLogoutMs: o.observedAfterLogoutMs,
        probeStatus: o.probe?.status ?? null, probeDataRows: o.probe?.dataRows ?? null,
        probeAnonymous: o.probe?.anonymous == null ? null : Number(o.probe.anonymous),
        ownerReadBefore: o.pairedControl.ownerReadBefore == null ? null : Number(o.pairedControl.ownerReadBefore),
        ownerReopenedAfter: o.pairedControl.ownerReopenedAfter == null ? null : Number(o.pairedControl.ownerReopenedAfter),
        readAfterSignOut: read.length, lateDataAfterSignOut: late.length,
    };
    if (why) return { status: 'HOLD', detail: why, evidence };
    if (read.length > 0) return { status: 'FAIL', detail: `a protected read with the signed-out session succeeded after sign-out (${routes(read)})`, evidence };
    if (late.length > 0) return { status: 'FAIL', detail: `data from the signed-in session reached the page after sign-out completed (${routes(late)})`, evidence };
    const p = o.probe;
    if (p === null) return { status: 'HOLD', detail: 'no named protected probe was exercised after sign-out, so the denial is unproven', evidence };
    if (p.status === null) return { status: 'HOLD', detail: 'the protected probe got no terminal answer', evidence };
    if (is2xx(p.status) && (p.dataRows ?? 0) > 0) return { status: 'FAIL', detail: 'the protected probe read data with the signed-out session', evidence };
    if (!p.observed) return { status: 'HOLD', detail: 'the probe request was not observed between the completed logout and the window end', evidence };
    if (p.boundToTake !== true) return { status: 'HOLD', detail: 'the probe was not bound to the exact run-owned take', evidence };
    if (p.status === 401 || p.status === 403) return { status: 'PASS', detail: 'the protected probe was denied (401/403) and nothing protected was read after sign-out', evidence };
    if (p.status === 200 && p.dataRows === 0 && p.wellFormed === true) {
        // Sam (16 Nov): an anonymous 200 [] is a denial only with the paired control, which rules out a missing fixture.
        if (p.anonymous !== true) return { status: 'HOLD', detail: 'the probe answered 200 [] but was not confirmed anonymous', evidence };
        const c = o.pairedControl;
        if (c.ownerReadBefore === false) return { status: 'HOLD', detail: 'the owner could not read the exact take before sign-out: a missing fixture, not a denial', evidence };
        if (c.ownerReadBefore !== true) return { status: 'HOLD', detail: 'the owner\'s read of the exact take before sign-out was not observed', evidence };
        if (c.ownerReopenedAfter !== true) return { status: 'HOLD', detail: 'the owner did not reopen the exact take after signing back in', evidence };
        return { status: 'PASS', detail: 'the anonymous read of the exact take returned no record, and the owner read it before sign-out and reopened it after', evidence };
    }
    return { status: 'HOLD', detail: `the protected probe was answered ${p.status} with no well-formed empty result: neither a read nor a denial`, evidence };
}

/** `signout-no-stale-request`: see the module comment, rules (3) and (4). */
export function signOutStaleRequestVerdict(o: SignOutObservation): RowVerdict {
    const why = unobservable(o);
    const stale = why ? [] : newStale(o);
    const evidence = { logoutStatus: o.logout?.status ?? null, observedAfterLogoutMs: o.observedAfterLogoutMs, staleRequests: stale.length,
        organicRequests: o.requests.length };
    if (why) return { status: 'HOLD', detail: why, evidence };
    if (stale.length > 0) return { status: 'FAIL', detail: `the page sent ${stale.length} new request(s) with the signed-out session after sign-out (${routes(stale)})`, evidence };
    return { status: 'PASS', detail: 'the page sent no new request with the signed-out session after sign-out completed, over a complete window', evidence };
}
