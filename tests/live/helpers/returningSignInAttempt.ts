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
    | 'preexisting_session';

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

/**
 * Arm BEFORE the submit. Binds the first main-frame POST to `${authOrigin}/auth/v1/token?grant_type=password` and accepts
 * only that request's own response or failure. Requests issued before arming, refresh grants, other origins and frames
 * are ignored; a second password grant is ambiguous; anything after the outcome (including a late response) is ignored.
 */
export function armPasswordSignInObserver(
    events: SignInAttemptEvents, { authOrigin, timeoutMs }: { authOrigin: string; timeoutMs: number },
): { settle(): Promise<SignInAttemptOutcome> } {
    let bound: AttemptRequest | null = null;
    let done = false;
    let resolve!: (outcome: SignInAttemptOutcome) => void;
    const outcome = new Promise<SignInAttemptOutcome>((r) => { resolve = r; });
    const unsubscribers: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: SignInAttemptOutcome) => {
        if (done) return;
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
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
            if (done || !isPasswordGrant(request)) return;
            if (bound) finish(inconclusive(null, 'ambiguous_attempt'));
            else bound = request;
        }),
        events.onResponse((response) => {
            if (done || !bound || response.request() !== bound) return;
            const status = response.status();
            const apiVersion = response.headers()['x-supabase-api-version'];
            void response.json().then(
                (value): TokenResponseBody => ({ readable: true, value }),
                (): TokenResponseBody => ({ readable: false }),
            ).then((body) => finish(classifyTokenResponse({ status, apiVersion, body })));
        }),
        events.onRequestFailed((request) => {
            if (!done && bound && request === bound) finish(inconclusive(null, 'transport_failed'));
        }),
        events.onClose(() => finish(inconclusive(null, 'context_closed'))),
    );
    timer = setTimeout(() => finish(inconclusive(null, 'timeout')), timeoutMs);
    return { settle: () => outcome };
}

export interface SignInVerdict { verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string; proceed: boolean }

/** The `returning-user sign-in` row. Anything but PASS stops the journey's branch. */
export function returningSignInVerdict(
    outcome: SignInAttemptOutcome, after: { sessionUserMatches: boolean; practiceVisible: boolean },
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
    if (!after.practiceVisible) return { verdict: 'FAIL', detail: 'signed in, but Practice did not load', proceed: false };
    return { verdict: 'PASS', detail: 'signed in with an existing credential and landed on Practice', proceed: true };
}
