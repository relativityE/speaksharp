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
import { COACHING_SETTLE_BOUND_MS } from './rwtCoachingEvidence';

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
    /**
     * #1593 (Sam case-1 diagnosis) — when the browser SENT the request (epoch ms); null on hand-built fixtures. With `at`
     * and `clientMs` it is the exchange's content-free timing, so a browser record can be placed against the Edge's own
     * diagnostic time instead of inferred from order.
     */
    sentAt?: number | null;
    /**
     * #1474 — how the exchange ended, as observed: `answered` (status and body read), `failed` (the browser reported
     * the request failed), `unanswered` (no response by the settle bound) or `body_pending` (a status arrived but its
     * body was still unread at the bound). Only `answered` can carry diagnostics. Absent on hand-built test fixtures.
     */
    outcome?: 'answered' | 'failed' | 'unanswered' | 'body_pending';
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
    /** Coaching POSTs the BROWSER sent (including any still unanswered). Not a provider-invocation count. */
    sentCount = 0;
    private readonly startedAt = new WeakMap<Request, number>();
    /** #1593 (Sam, #1656 review) — what each request named, captured AT THE REQUEST EVENT, so one still in flight is identifiable. */
    private readonly sentInfo = new WeakMap<Request, CoachingSentRequest>();
    /**
     * #1474 (Sam 6242612760) — every SENT request until it reaches a terminal record. `settle()` used to wait only for
     * bodies of responses already seen, so a coaching exchange still in flight when the scenario ended was silently
     * missing (live RWT 39075833843 / 39076238188: 2 sent, 1 answered). Each entry resolves when its record is pushed.
     */
    private readonly outstanding = new Map<Request, { done: Promise<void>; resolve: () => void }>();
    /** Status seen for a request whose body is still being read — reported as `body_pending` if the bound expires. */
    private readonly statusSeen = new Map<Request, number>();
    /** Requests already recorded as unanswered/body_pending at a bound: a late event must not add a second record. */
    private readonly closedAtBound = new WeakSet<Request>();
    /** Wakes a waiting settle() whenever a request is sent or recorded, so a request arriving DURING settle is seen. */
    private readonly waiters = new Set<() => void>();
    private wake(): void { const all = [...this.waiters]; this.waiters.clear(); for (const w of all) w(); }
    private changed(): Promise<void> { return new Promise<void>((resolve) => { this.waiters.add(resolve); }); }

    private record(request: Request, exchange: CoachingExchange): void {
        if (this.closedAtBound.has(request)) return;
        this.exchanges.push({ ...exchange, sentAt: this.startedAt.get(request) ?? null });
        this.statusSeen.delete(request);
        const open = this.outstanding.get(request);
        this.outstanding.delete(request);
        open?.resolve();
        this.wake();
    }

    attach(page: Page): void {
        const isCoaching = (request: Request) => request.url().includes(ENDPOINT) && request.method() === 'POST';
        const elapsed = (request: Request) => {
            const start = this.startedAt.get(request);
            return start === undefined ? null : Math.max(0, Date.now() - start);
        };
        page.on('request', (request: Request) => {
            if (!isCoaching(request)) return;
            this.sentCount += 1;
            this.startedAt.set(request, Date.now());
            this.sentInfo.set(request, readSentRequest(request));
            let resolve: () => void = () => undefined;
            const done = new Promise<void>((r) => { resolve = r; });
            this.outstanding.set(request, { done, resolve });
            this.wake();
        });
        page.on('response', (response: Response) => {
            const request = response.request();
            if (!isCoaching(request)) return;
            const sent = readSentRequest(request);
            const status = response.status();
            const clientMs = elapsed(request);
            this.statusSeen.set(request, status);
            void response.json().then((payload: unknown) => {
                const diagnostics = payload && typeof payload === 'object' ? (payload as { diagnostics?: unknown }).diagnostics : null;
                this.record(request, {
                    sent, status,
                    diagnostics: diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics) ? diagnostics as Record<string, unknown> : null,
                    suggestions: status >= 200 && status < 300 ? readSuggestionPair(payload) : null,
                    clientMs, at: Date.now(), outcome: 'answered',
                });
            }, () => { this.record(request, { sent, status, diagnostics: null, suggestions: null, clientMs, at: Date.now(), outcome: 'answered' }); });
        });
        page.on('requestfailed', (request: Request) => {
            if (!isCoaching(request)) return;
            this.record(request, {
                sent: readSentRequest(request), status: this.statusSeen.get(request) ?? null, diagnostics: null, suggestions: null,
                clientMs: elapsed(request), at: Date.now(), outcome: 'failed',
            });
        });
        this.elapsedFor = elapsed;
    }

    private elapsedFor: (request: Request) => number | null = () => null;

    /**
     * #1474 (Sam 6242612760) — wait for EVERY SENT coaching exchange to reach a terminal record (answered or failed).
     * A request still unanswered when ITS OWN allowance (`boundMs` from when it was sent: the Edge's provider budget plus
     * a transport allowance) has run out is recorded honestly as `unanswered` (or `body_pending` when its status arrived but
     * its body did not) — never dropped, never a zero and never a pass — and later events for it are ignored.
     *
     * #1593 (Sam case-1 diagnosis, live run 39136771332): settle() used to wait on the requests open when it STARTED and
     * then close EVERY outstanding request — so a mid-scenario reader closed the next take's request at age ~1 ms and threw
     * away its later successful answer. Now each request is judged against its own allowance; a request sent DURING settle
     * is waited for (settle wakes on every send and record) until settle's explicit deadline, and one still inside its own
     * allowance at that deadline is left open and reported `inFlight` — not closed. Sends nothing and retries nothing.
     */
    async settle(boundMs: number = COACHING_SETTLE_BOUND_MS): Promise<{ unanswered: number; bodyPending: number; inFlight: number }> {
        const deadline = Date.now() + boundMs;
        const dueAt = (request: Request) => (this.startedAt.get(request) ?? Date.now()) + boundMs;
        let unanswered = 0;
        let bodyPending = 0;
        for (;;) {
            const now = Date.now();
            // Codex r4305107830: only requests still open count — one already recorded or closed never makes settle wait.
            for (const request of [...this.outstanding.keys()].filter((r) => now >= dueAt(r))) {
                const status = this.statusSeen.get(request) ?? null;
                const outcome = status === null ? 'unanswered' : 'body_pending';
                if (outcome === 'unanswered') unanswered += 1; else bodyPending += 1;
                this.record(request, {
                    sent: readSentRequest(request), status, diagnostics: null, suggestions: null,
                    clientMs: this.elapsedFor(request), at: now, outcome,
                });
                this.closedAtBound.add(request);
            }
            const open = [...this.outstanding.keys()];
            if (open.length === 0 || now >= deadline) break;
            const wakeAt = Math.min(deadline, ...open.map(dueAt));
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([this.changed(), new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, wakeAt - now)); })]);
            clearTimeout(timer);
        }
        return { unanswered, bodyPending, inFlight: this.outstanding.size };
    }

    /**
     * #1474 (Sam 6243698211) — THE way a receipt reader reads one take's exchanges: the bounded settle of every sent
     * request first, then the take's records. A reader that capped the settle (the old 5 s reason bound) read before a
     * legitimate answer inside the Edge budget arrived; routing every reader through here keeps that impossible.
     */
    async settledForSession(sessionId: string | null): Promise<CoachingExchange[]> {
        await this.settle();
        return sessionId ? this.forSession(sessionId) : [];
    }

    /**
     * #1593 (Sam, #1656 review) — a NONTERMINAL snapshot of the requests still open, in send order: what each named, when
     * it was sent, its age now and any status already seen. Separate from the terminal `exchanges`; it changes no count,
     * no cost uncertainty and no HOLD — it only makes an in-flight request identifiable instead of invisible.
     */
    inFlight(now: number = Date.now()): { sent: CoachingSentRequest; sentAt: number | null; ageMs: number | null; status: number | null }[] {
        return [...this.outstanding.keys()].map((request) => {
            const sentAt = this.startedAt.get(request) ?? null;
            return { sent: this.sentInfo.get(request) ?? readSentRequest(request), sentAt,
                ageMs: sentAt === null ? null : Math.max(0, now - sentAt), status: this.statusSeen.get(request) ?? null };
        });
    }

    /** Exchanges the page sent for one saved session, in arrival order. */
    forSession(sessionId: string): CoachingExchange[] {
        return this.exchanges.filter((e) => e.sent.sessionId === sessionId);
    }
}
