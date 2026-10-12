/**
 * #1258 (PM 6114590729) — the coaching generation exchange captured AT THE REQUEST BOUNDARY.
 *
 * Each `get-ai-suggestions` POST the page makes is recorded with the ids the page sent (`sessionId`, `product`,
 * `diagnostic_request_id`, `diagnostic_attempt_id`, `client_attempt`) and the Edge function's own answer (HTTP status,
 * its `diagnostics` object, and — on success — the suggestion pair). The request and its response are joined by the
 * request object itself, never by tap order. A request the browser could not complete is recorded with no response.
 *
 * Content handling: the suggestion pair and the response-only `session_binding_sha256` are held IN MEMORY for the
 * restricted synthetic evidence artifact only. Nothing here is written to a receipt, an attachment, a log or PostHog;
 * callers that publish must reduce to closed codes first.
 */
import type { Page, Request, Response } from '@playwright/test';

const ENDPOINT = '/functions/v1/get-ai-suggestions';

export interface CoachingSentRequest {
    sessionId: string | null;
    product: string | null;
    requestId: string | null;
    attemptId: string | null;
    clientAttempt: number | null;
    /** The served release the page named in its request (`client_release_id`). */
    clientReleaseId: string | null;
}

export interface CoachingSuggestionPair {
    version: 'gemini_coaching_v1' | 'gemini_coaching_focus_v1';
    what_worked: string;
    what_to_try_next: string;
}

export interface CoachingExchange {
    sent: CoachingSentRequest;
    /** Endpoint HTTP status; null when the browser never received an answer. */
    status: number | null;
    /** The Edge function's `diagnostics` object exactly as returned; null when absent or unreadable. */
    diagnostics: Record<string, unknown> | null;
    /** The returned suggestion pair (success only); null otherwise. */
    suggestions: CoachingSuggestionPair | null;
    /** Client-measured request duration (request sent → answer or failure), for a request the Edge never timed. */
    clientMs: number | null;
    at: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (Number.isInteger(v) ? Number(v) : null);

export function readSentRequest(request: Pick<Request, 'postDataJSON'>): CoachingSentRequest {
    let body: Record<string, unknown> | null = null;
    try {
        const parsed = request.postDataJSON() as unknown;
        body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { body = null; }
    return {
        sessionId: str(body?.sessionId),
        product: str(body?.product),
        requestId: str(body?.diagnostic_request_id),
        attemptId: str(body?.diagnostic_attempt_id),
        clientAttempt: int(body?.client_attempt),
        clientReleaseId: str(body?.client_release_id),
    };
}

export function readSuggestionPair(payload: unknown): CoachingSuggestionPair | null {
    const value = payload && typeof payload === 'object' ? (payload as { suggestions?: unknown }).suggestions : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const pair = value as Record<string, unknown>;
    const version = pair.version;
    if ((version !== 'gemini_coaching_v1' && version !== 'gemini_coaching_focus_v1')
        || typeof pair.what_worked !== 'string' || typeof pair.what_to_try_next !== 'string') return null;
    return { version, what_worked: pair.what_worked, what_to_try_next: pair.what_to_try_next };
}

export class CoachingGenerationTap {
    readonly exchanges: CoachingExchange[] = [];
    private readonly pending: Promise<void>[] = [];
    private readonly startedAt = new WeakMap<Request, number>();

    attach(page: Page): void {
        const isCoaching = (request: Request) => request.url().includes(ENDPOINT) && request.method() === 'POST';
        const elapsed = (request: Request) => {
            const start = this.startedAt.get(request);
            return start === undefined ? null : Math.max(0, Date.now() - start);
        };
        page.on('request', (request: Request) => { if (isCoaching(request)) this.startedAt.set(request, Date.now()); });
        page.on('response', (response: Response) => {
            const request = response.request();
            if (!isCoaching(request)) return;
            const sent = readSentRequest(request);
            const status = response.status();
            const clientMs = elapsed(request);
            this.pending.push(response.json().then((payload: unknown) => {
                const diagnostics = payload && typeof payload === 'object' ? (payload as { diagnostics?: unknown }).diagnostics : null;
                this.exchanges.push({
                    sent, status,
                    diagnostics: diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics) ? diagnostics as Record<string, unknown> : null,
                    suggestions: status >= 200 && status < 300 ? readSuggestionPair(payload) : null,
                    clientMs, at: Date.now(),
                });
            }, () => { this.exchanges.push({ sent, status, diagnostics: null, suggestions: null, clientMs, at: Date.now() }); }));
        });
        page.on('requestfailed', (request: Request) => {
            if (!isCoaching(request)) return;
            this.exchanges.push({ sent: readSentRequest(request), status: null, diagnostics: null, suggestions: null, clientMs: elapsed(request), at: Date.now() });
        });
    }

    /** Wait until every response body already seen has been read (bounded by the caller's own step timeout). */
    async settle(): Promise<void> { await Promise.allSettled(this.pending); }

    /** Exchanges the page sent for one saved session, in arrival order. */
    forSession(sessionId: string): CoachingExchange[] {
        return this.exchanges.filter((e) => e.sent.sessionId === sessionId);
    }
}
