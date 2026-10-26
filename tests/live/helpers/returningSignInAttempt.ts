import type { Page, Request, Response } from '@playwright/test';

/**
 * G18 (#1495 c6234022786 ← #1491 c5926297857 item 9): the returning user's sign-in, judged by THIS submit's own
 * password-token exchange instead of by a missing uid.
 *
 * A rejected shared credential is account repair, not a product failure. Setup, network and service faults are
 * inconclusive. Only a valid password token for this submit that then fails to establish its own session, or Practice,
 * is a product FAIL. Token values are read in memory only; rows carry outcome, status and timing.
 */

export type InconclusiveReason =
    | 'unreadable_body'
    | 'malformed_session'
    | 'unrecognized_error'
    | 'rate_limited'
    | 'server_error'
    | 'transport_failed'
    | 'timeout'
    | 'ambiguous_attempt'
    | 'context_closed'
    | 'preexisting_session'
    | 'session_unobservable';

export type SignInAttemptOutcome =
    | { kind: 'token_ok'; status: number; userId: string }
    | { kind: 'invalid_credentials'; status: number }
    | { kind: 'inconclusive'; status: number | null; reason: InconclusiveReason };

export type TokenResponseBody = { readable: true; value: unknown } | { readable: false };

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const inconclusive = (status: number | null, reason: InconclusiveReason): SignInAttemptOutcome =>
    ({ kind: 'inconclusive', status, reason });

// Pinned @supabase/auth-js 2.86.0, lib/helpers.js parseResponseAPIVersion and lib/fetch.js handleError.
const API_VERSION_REGEX = /^2[0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[0-1])$/i;
const API_VERSION_2024_01_01 = Date.parse('2024-01-01T00:00:00.0Z');

/** The error code exactly as the pinned client reads it: `code` from a 2024-01-01+ response, otherwise `error_code`. */
export const wireErrorCode = (apiVersion: string | undefined, body: unknown): string | undefined => {
    const data = record(body);
    if (!data) return undefined;
    const version = apiVersion && API_VERSION_REGEX.test(apiVersion) ? Date.parse(`${apiVersion}T00:00:00.0Z`) : NaN;
    if (version >= API_VERSION_2024_01_01 && typeof data.code === 'string') return data.code;
    return typeof data.error_code === 'string' ? data.error_code : undefined;
};

/** One `/auth/v1/token?grant_type=password` response, classified. A session needs the typed, non-empty fields. */
export function classifyTokenResponse(
    { status, apiVersion, body }: { status: number; apiVersion?: string; body: TokenResponseBody },
): SignInAttemptOutcome {
    if (status === 200) {
        if (!body.readable) return inconclusive(status, 'unreadable_body');
        const data = record(body.value);
        const user = record(data?.user);
        const session = data !== null && nonEmpty(data.access_token) && nonEmpty(data.refresh_token)
            && typeof data.expires_in === 'number' && data.expires_in > 0;
        if (!session || !user || !nonEmpty(user.id)) return inconclusive(status, 'malformed_session');
        return { kind: 'token_ok', status, userId: user.id };
    }
    if (status === 429) return inconclusive(status, 'rate_limited');
    if (status >= 500) return inconclusive(status, 'server_error');
    if (!body.readable) return inconclusive(status, 'unreadable_body');
    if (status === 400 && wireErrorCode(apiVersion, body.value) === 'invalid_credentials') return { kind: 'invalid_credentials', status };
    return inconclusive(status, 'unrecognized_error');
}

export interface AttemptRequest { method(): string; url(): string; frame(): unknown }
export interface AttemptResponse {
    request(): AttemptRequest;
    status(): number;
    headers(): Record<string, string>;
    json(): Promise<unknown>;
}
/** The page events the observer needs; each subscription returns its own unsubscribe. */
export interface SignInAttemptEvents {
    mainFrame: unknown;
    onRequest(listener: (request: AttemptRequest) => void): () => void;
    onResponse(listener: (response: AttemptResponse) => void): () => void;
    onRequestFailed(listener: (request: AttemptRequest) => void): () => void;
    onClose(listener: () => void): () => void;
}

export const pageAttemptEvents = (page: Page): SignInAttemptEvents => ({
    mainFrame: page.mainFrame(),
    onRequest: (listener) => {
        const handler = (request: Request) => listener(request);
        page.on('request', handler);
        return () => { page.off('request', handler); };
    },
    onResponse: (listener) => {
        const handler = (response: Response) => listener(response);
        page.on('response', handler);
        return () => { page.off('response', handler); };
    },
    onRequestFailed: (listener) => {
        const handler = (request: Request) => listener(request);
        page.on('requestfailed', handler);
        return () => { page.off('requestfailed', handler); };
    },
    onClose: (listener) => {
        const handler = () => listener();
        page.on('close', handler);
        return () => { page.off('close', handler); };
    },
});

export interface PasswordSignInAttempt {
    /** The first outcome of this submit's own exchange (response, failure, closure or timeout). */
    settle(): Promise<SignInAttemptOutcome>;
    /**
     * The outcome the verdict uses, read AFTER the session/Practice wait: the settled one, unless another password grant
     * was seen before disposal — that grant could have supplied the session, so the attempt is ambiguous.
     */
    final(): SignInAttemptOutcome;
    /** Stops observing; idempotent. Call it once the verdict is computed (the spec does so in `finally`). */
    dispose(): void;
}

/**
 * Arm BEFORE the submit. Binds the first main-frame POST to `${authOrigin}/auth/v1/token?grant_type=password` and accepts
 * only that request's own response or failure. Requests issued before arming, refresh grants, other origins and frames
 * are ignored. Observation stays bound until `dispose()`: any further password grant, before or after the first outcome,
 * makes the attempt ambiguous. A late response for the bound request never changes a settled outcome.
 */
export function armPasswordSignInObserver(
    events: SignInAttemptEvents, { authOrigin, timeoutMs }: { authOrigin: string; timeoutMs: number },
): PasswordSignInAttempt {
    let bound: AttemptRequest | null = null;
    let settled: SignInAttemptOutcome | null = null;
    let secondGrant = false;
    let resolve!: (outcome: SignInAttemptOutcome) => void;
    const outcome = new Promise<SignInAttemptOutcome>((r) => { resolve = r; });
    const unsubscribers: Array<() => void> = [];
    // The callback runs only after this function returns, so `finish` is defined by then.
    const timer = setTimeout(() => finish(inconclusive(null, 'timeout')), timeoutMs);
    const finish = (result: SignInAttemptOutcome) => {
        if (settled) return;
        settled = result;
        clearTimeout(timer);
        resolve(result);
    };
    const isPasswordGrant = (request: AttemptRequest): boolean => {
        try {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.origin === authOrigin && url.pathname === '/auth/v1/token'
                && url.searchParams.get('grant_type') === 'password' && request.frame() === events.mainFrame;
        } catch {
            return false;
        }
    };
    unsubscribers.push(
        events.onRequest((request) => {
            if (!isPasswordGrant(request)) return;
            if (!bound && !settled) {
                bound = request;
                return;
            }
            secondGrant = true;
            finish(inconclusive(null, 'ambiguous_attempt'));
        }),
        events.onResponse((response) => {
            if (settled || !bound || response.request() !== bound) return;
            const status = response.status();
            const apiVersion = response.headers()['x-supabase-api-version'];
            void response.json().then(
                (value): TokenResponseBody => ({ readable: true, value }),
                (): TokenResponseBody => ({ readable: false }),
            ).then((body) => finish(classifyTokenResponse({ status, apiVersion, body })));
        }),
        events.onRequestFailed((request) => {
            if (bound && request === bound) finish(inconclusive(null, 'transport_failed'));
        }),
        events.onClose(() => finish(inconclusive(null, 'context_closed'))),
    );
    return {
        settle: () => outcome,
        final: () => (secondGrant ? inconclusive(null, 'ambiguous_attempt') : settled ?? inconclusive(null, 'timeout')),
        dispose: () => {
            finish(inconclusive(null, 'timeout'));
            unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
        },
    };
}

export interface SignInVerdict { verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string; proceed: boolean }

/**
 * The `returning-user sign-in` row, judged against the landing the CALLER expects (`landing` names it, e.g. 'Practice';
 * `after.landed` is whether that landing was reached). Anything but PASS stops the journey's branch.
 */
export function returningSignInVerdict(
    outcome: SignInAttemptOutcome, after: { sessionUserMatches: boolean; landed: boolean }, landing: string,
): SignInVerdict {
    if (outcome.kind === 'invalid_credentials') {
        return { verdict: 'HOLD', detail: 'the shared returning account was refused (invalid_credentials): account repair, not a product failure', proceed: false };
    }
    if (outcome.kind === 'inconclusive') {
        return { verdict: 'HOLD', detail: `the sign-in attempt is inconclusive (${outcome.reason}): not attributable to the product`, proceed: false };
    }
    if (!after.sessionUserMatches) {
        return { verdict: 'FAIL', detail: 'a valid password token for this submit did not establish its own session', proceed: false };
    }
    if (!after.landed) return { verdict: 'FAIL', detail: `signed in, but ${landing} did not load`, proceed: false };
    return { verdict: 'PASS', detail: `signed in with an existing credential and landed on ${landing}`, proceed: true };
}

export interface DeepLinkTarget { pathname: string; search: string; hash: string }
export interface DeepLinkLandingMatch { pathnameMatches: boolean; searchMatches: boolean; hashMatches: boolean }

/** G04: the landed URL against the deep link's exact pathname, query and hash, each compared whole. */
export const deepLinkLanding = (url: URL, expected: DeepLinkTarget): DeepLinkLandingMatch => ({
    pathnameMatches: url.pathname === expected.pathname,
    searchMatches: url.search === expected.search,
    hashMatches: url.hash === expected.hash,
});

/**
 * G04 (#1548 / #1718): the `signed-in deep-link return` row. Routing only — the rendered detail is not claimed. A refused,
 * inconclusive or ambiguous sign-in, or a second token for any account but the verified one, leaves the routing unproven
 * (HOLD). A valid token that established no session of its own, or a landing that misses the exact pathname, query or
 * hash, is a product FAIL.
 */
export function deepLinkReturnVerdict({ outcome, verifiedUserId, sessionUserMatches, landing }: {
    outcome: SignInAttemptOutcome; verifiedUserId: string; sessionUserMatches: boolean; landing: DeepLinkLandingMatch;
}): { verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string } {
    if (outcome.kind !== 'token_ok') {
        const signIn = returningSignInVerdict(outcome, { sessionUserMatches: false, landed: false }, 'the deep-link destination');
        return { verdict: signIn.verdict, detail: `routing unproven: ${signIn.detail}` };
    }
    if (outcome.userId !== verifiedUserId) {
        return { verdict: 'HOLD', detail: 'routing unproven: the second sign-in is not the verified returning account' };
    }
    if (!sessionUserMatches) {
        return { verdict: 'FAIL', detail: 'a valid password token for this submit did not establish its own session' };
    }
    if (!landing.pathnameMatches || !landing.searchMatches || !landing.hashMatches) {
        return { verdict: 'FAIL', detail: 'signed in, but did not return to the exact deep-link destination' };
    }
    return { verdict: 'PASS', detail: 'returned to the exact deep-link destination (routing only; the rendered detail is not claimed)' };
}

export type RowVerdict = 'PASS' | 'FAIL' | 'HOLD';
/** A microphone-acquisition read: the count in one document, and that document's identity (its time origin). */
export interface MicRead { count: number; document: number }

/** The page and receipt operations the G04 step needs, so its orchestration runs against deterministic fakes. */
export interface DeepLinkReturnPorts {
    target: DeepLinkTarget;
    verifiedUserId: string;
    /** Acquisitions the journey's own `no mic on navigation` row already judged, in the first document. */
    micBaseline: number;
    /** The counter read taken right after that judgement, binding the baseline to its document (null when unread). */
    micBaselineRead: MicRead | null;
    /** Hard-navigates the legacy link while signed out and waits for the auth form it produced. */
    openLegacyLink(): Promise<void>;
    armObserver(): PasswordSignInAttempt;
    submit(): Promise<void>;
    isClosed(): boolean;
    /** The signed-in user id in the page's auth storage, or null when there is none. Rejects when unreadable. */
    sessionUserId(): Promise<string | null>;
    awaitSessionUser(expected: string): Promise<boolean>;
    awaitLanding(): Promise<void>;
    url(): URL;
    /** The current document's microphone acquisitions, or null when the counter is unavailable. */
    micAcquisitions(): Promise<MicRead | null>;
    signOut(): Promise<'direct' | 'menu'>;
    awaitSessionCleared(): Promise<boolean>;
    /** Reads back the session count and writes the `deep-link return writes nothing` row; rejects when it cannot. */
    recordWrites(): Promise<void>;
    row(name: string, verdict: RowVerdict, detail: string, evidence?: Record<string, string | number | boolean | null>): void;
}

const DEEP_LINK_ROW = 'signed-in deep-link return';
type SessionState = 'absent' | 'present' | 'unobservable';

/** Only a closed error-class name leaves an error: a Playwright message or call log can carry the deep link's id. */
const errorClass = (error: unknown): string =>
    error instanceof Error && /^[A-Za-z]{1,40}Error$/.test(error.name) ? error.name : 'Error';

/**
 * Microphone acquisitions from the journey's judged baseline through the end of the deep-link document, or null when
 * that span is not observed whole: the baseline must be bound to the first document, the hard navigation must load a
 * new document, every read must stay in its document, and no count may fall. A gap is never a zero.
 */
function micAcquisitionsSinceBaseline(
    baseline: { judged: number; read: MicRead | null },
    first: MicRead | null, deepLinkStart: MicRead | null, deepLinkEnd: MicRead | null,
): { sinceJourney: number; deepLinkDocument: number } | null {
    const { judged, read } = baseline;
    if (!read || read.count !== judged || !first || !deepLinkStart || !deepLinkEnd) return null;
    if (first.document !== read.document || first.count < read.count) return null;
    if (deepLinkStart.document === first.document) return null;
    if (deepLinkEnd.document !== deepLinkStart.document || deepLinkEnd.count < deepLinkStart.count) return null;
    return { sinceJourney: first.count - read.count, deepLinkDocument: deepLinkEnd.count };
}

/**
 * G04: the deep-link return and its cleanup, in order; cleanup always runs. Nothing raw is rethrown: a harness failure is
 * a HOLD row and, after every stage has run, one sanitized error naming the first failed phase and its error class.
 *
 * - The second attempt is armed only after a fresh read shows no session (preexisting or unobservable is HOLD).
 * - A page that closes after the token settled leaves the routing unproven (context_closed), whatever the URL read before.
 * - No microphone from the journey's judged baseline through the deep-link document (`micAcquisitionsSinceBaseline`).
 * - Finalization stages (microphone, session cleanup, write readback) are isolated: each failure is that stage's HOLD,
 *   and the later stages still run.
 * - Cleanup signs out only a session it observes, and judges the result tri-state again after the clear wait: absent is
 *   PASS, a readable session still present is FAIL, a closed or unreadable page is HOLD.
 */
export async function runDeepLinkReturn(ports: DeepLinkReturnPorts): Promise<void> {
    const { target } = ports;
    const run: { failure: string | null; navigated: boolean; deepLinkDocument: MicRead | null } = { failure: null, navigated: false, deepLinkDocument: null };
    /** Records the first sanitized failure; returns the closed error class for the row. */
    const note = (phase: string, error: unknown): string => {
        const name = errorClass(error);
        run.failure ??= `HOLD ${DEEP_LINK_ROW}: the ${phase} failed (${name})`;
        return name;
    };
    const halt = (phase: string, error: unknown) => {
        ports.row(DEEP_LINK_ROW, 'HOLD', `routing unproven: the ${phase} failed (${note(phase, error)})`);
    };
    const sessionState = async (): Promise<SessionState> => (ports.isClosed()
        ? 'unobservable'
        : ports.sessionUserId().then((id): SessionState => (id ? 'present' : 'absent'), (): SessionState => 'unobservable'));
    const readMic = (): Promise<MicRead | null> => (ports.isClosed() ? Promise.resolve(null) : ports.micAcquisitions().catch(() => null));

    // The first document's counter, read before the hard navigation, covers the journey's sign-out.
    const firstDocument = await readMic();
    const attemptReturn = async (): Promise<void> => {
        // A hard navigation to the legacy link while signed out, then the auth form it produced. Opening the auth page
        // directly would discard the return state.
        try {
            await ports.openLegacyLink();
            run.navigated = true;
        } catch (error) {
            halt('legacy deep-link navigation', error);
            return;
        }
        run.deepLinkDocument = await readMic();
        const before = await sessionState();
        if (before !== 'absent') {
            const reason: InconclusiveReason = before === 'present' ? 'preexisting_session' : 'session_unobservable';
            const outcome = inconclusive(null, reason);
            const verdict = deepLinkReturnVerdict({ outcome, verifiedUserId: ports.verifiedUserId, sessionUserMatches: false, landing: { pathnameMatches: false, searchMatches: false, hashMatches: false } });
            ports.row(DEEP_LINK_ROW, verdict.verdict, verdict.detail, { outcome: outcome.kind, reason });
            return;
        }
        let sessionUserMatches = false;
        let landedUrl: URL | null = null;
        const observer = ports.armObserver();
        try {
            try {
                await ports.submit();
            } catch (error) {
                if (!ports.isClosed()) {
                    halt('sign-in submit', error);
                    return;
                }
            }
            const first = await observer.settle();
            if (first.kind === 'token_ok') {
                sessionUserMatches = await ports.awaitSessionUser(first.userId);
                await ports.awaitLanding().catch(() => undefined);
                landedUrl = ports.isClosed() ? null : ports.url();
            }
            // Read AFTER the landing wait: another password grant in that window makes the attempt ambiguous, and a page
            // closed at any point since the token settled leaves the landing unproven, whatever URL was read before.
            let outcome = observer.final();
            if (outcome.kind === 'token_ok' && ports.isClosed()) outcome = inconclusive(null, 'context_closed');
            const landing = landedUrl ? deepLinkLanding(landedUrl, target) : { pathnameMatches: false, searchMatches: false, hashMatches: false };
            const verdict = deepLinkReturnVerdict({ outcome, verifiedUserId: ports.verifiedUserId, sessionUserMatches, landing });
            ports.row(DEEP_LINK_ROW, verdict.verdict, verdict.detail,
                { outcome: outcome.kind, reason: outcome.kind === 'inconclusive' ? outcome.reason : null, ...landing });
        } finally {
            observer.dispose();
        }
    };
    try {
        await attemptReturn();
    } catch (error) {
        halt('deep-link return', error);
    } finally {
        const { navigated, deepLinkDocument } = run;
        const MIC_ROW = 'no mic on the deep-link return';
        const CLEANUP_ROW = 'signed out after the deep-link return';
        const WRITES_ROW = 'deep-link return writes nothing';

        // Microphone: read in the deep-link document before the sign-out can leave it.
        try {
            const lastRead = navigated ? await readMic() : null;
            const span = micAcquisitionsSinceBaseline({ judged: ports.micBaseline, read: ports.micBaselineRead }, firstDocument, deepLinkDocument, lastRead);
            if (!span) {
                ports.row(MIC_ROW, 'HOLD', 'the microphone counter was not observed whole from the journey\'s baseline through the deep-link document',
                    { navigated, counterRead: lastRead !== null });
            } else {
                const acquisitions = span.sinceJourney + span.deepLinkDocument;
                ports.row(MIC_ROW, acquisitions === 0 ? 'PASS' : 'FAIL',
                    acquisitions === 0 ? 'nothing opened the microphone from the sign-out through the deep-link return'
                        : 'the microphone was opened between the sign-out and the end of the deep-link return',
                    { afterSignOut: span.sinceJourney, deepLinkDocument: span.deepLinkDocument });
            }
        } catch (error) {
            ports.row(MIC_ROW, 'HOLD', `the microphone check failed (${note('microphone check', error)})`);
        }

        // Sign out only a session that exists, then judge the result tri-state again: a closed or unreadable page after
        // the sign-out is unobservable, not a product failure.
        try {
            const before = await sessionState();
            if (before === 'absent') {
                ports.row(CLEANUP_ROW, 'PASS', 'no second session exists to clear', { path: 'none', sessionCleared: true, sessionPresent: false });
            } else if (before === 'unobservable') {
                ports.row(CLEANUP_ROW, 'HOLD', 'the second session state could not be observed', { path: 'none', sessionCleared: null, sessionPresent: null });
            } else {
                let returnSignOut: 'direct' | 'menu' | null = null;
                try { returnSignOut = await ports.signOut(); } catch { returnSignOut = null; }
                const cleared = returnSignOut !== null && await ports.awaitSessionCleared();
                const after: SessionState = cleared ? 'absent' : await sessionState();
                const path = returnSignOut ?? 'none';
                if (after === 'absent') {
                    ports.row(CLEANUP_ROW, 'PASS', 'the product sign-out cleared the second session', { path, sessionCleared: true, sessionPresent: true });
                } else if (after === 'unobservable') {
                    ports.row(CLEANUP_ROW, 'HOLD', 'the second session state could not be observed after the sign-out', { path, sessionCleared: null, sessionPresent: true });
                } else {
                    ports.row(CLEANUP_ROW, 'FAIL',
                        returnSignOut === null ? 'no product sign-out control could be used' : 'the second session was not cleared',
                        { path, sessionCleared: false, sessionPresent: true });
                }
            }
        } catch (error) {
            ports.row(CLEANUP_ROW, 'HOLD', `the session cleanup failed (${note('session cleanup', error)})`, { sessionCleared: null });
        }

        try {
            await ports.recordWrites();
        } catch (error) {
            ports.row(WRITES_ROW, 'HOLD', `the session count could not be read back (${note('write readback', error)})`);
        }
    }
    if (run.failure) throw new Error(run.failure);
}
