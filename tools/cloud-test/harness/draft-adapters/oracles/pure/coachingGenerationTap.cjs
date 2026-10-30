// Exact main70e source-derived port; transformations in port-pure.cjs. Offline only.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoachingGenerationTap = void 0;
exports.readSentRequest = readSentRequest;
exports.readSuggestionPair = readSuggestionPair;
const rwtCoachingEvidence_cjs_1 = require("./rwtCoachingEvidence.cjs");
const ENDPOINT = '/functions/v1/get-ai-suggestions';
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v) => (Number.isInteger(v) ? Number(v) : null);
function readSentRequest(request) {
    let body = null;
    try {
        const parsed = request.postDataJSON();
        body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        body = null;
    }
    return {
        sessionId: str(body?.sessionId),
        product: str(body?.product),
        requestId: str(body?.diagnostic_request_id),
        attemptId: str(body?.diagnostic_attempt_id),
        clientAttempt: int(body?.client_attempt),
        clientReleaseId: str(body?.client_release_id),
    };
}
function readSuggestionPair(payload) {
    const value = payload && typeof payload === 'object' ? payload.suggestions : null;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const pair = value;
    const version = pair.version;
    if ((version !== 'gemini_coaching_v1' && version !== 'gemini_coaching_focus_v1')
        || typeof pair.what_worked !== 'string' || typeof pair.what_to_try_next !== 'string')
        return null;
    return { version, what_worked: pair.what_worked, what_to_try_next: pair.what_to_try_next };
}
class CoachingGenerationTap {
    exchanges = [];
    /** Coaching POSTs the BROWSER sent (including any still unanswered). Not a provider-invocation count. */
    sentCount = 0;
    startedAt = new WeakMap();
    /** #1593 (Sam, #1656 review) — what each request named, captured AT THE REQUEST EVENT, so one still in flight is identifiable. */
    sentInfo = new WeakMap();
    /**
     * #1474 (Sam 6242612760) — every SENT request until it reaches a terminal record. `settle()` used to wait only for
     * bodies of responses already seen, so a coaching exchange still in flight when the scenario ended was silently
     * missing (live RWT 39075833843 / 39076238188: 2 sent, 1 answered). Each entry resolves when its record is pushed.
     */
    outstanding = new Map();
    /** Status seen for a request whose body is still being read — reported as `body_pending` if the bound expires. */
    statusSeen = new Map();
    /** Requests already recorded as unanswered/body_pending at a bound: a late event must not add a second record. */
    closedAtBound = new WeakSet();
    /** Wakes a waiting settle() whenever a request is sent or recorded, so a request arriving DURING settle is seen. */
    waiters = new Set();
    wake() { const all = [...this.waiters]; this.waiters.clear(); for (const w of all)
        w(); }
    changed() { return new Promise((resolve) => { this.waiters.add(resolve); }); }
    record(request, exchange) {
        if (this.closedAtBound.has(request))
            return;
        this.exchanges.push({ ...exchange, sentAt: this.startedAt.get(request) ?? null });
        this.statusSeen.delete(request);
        const open = this.outstanding.get(request);
        this.outstanding.delete(request);
        open?.resolve();
        this.wake();
    }
    attach(page) {
        const isCoaching = (request) => request.url().includes(ENDPOINT) && request.method() === 'POST';
        const elapsed = (request) => {
            const start = this.startedAt.get(request);
            return start === undefined ? null : Math.max(0, Date.now() - start);
        };
        page.on('request', (request) => {
            if (!isCoaching(request))
                return;
            this.sentCount += 1;
            this.startedAt.set(request, Date.now());
            this.sentInfo.set(request, readSentRequest(request));
            let resolve = () => undefined;
            const done = new Promise((r) => { resolve = r; });
            this.outstanding.set(request, { done, resolve });
            this.wake();
        });
        page.on('response', (response) => {
            const request = response.request();
            if (!isCoaching(request))
                return;
            const sent = readSentRequest(request);
            const status = response.status();
            const clientMs = elapsed(request);
            this.statusSeen.set(request, status);
            void response.json().then((payload) => {
                const diagnostics = payload && typeof payload === 'object' ? payload.diagnostics : null;
                this.record(request, {
                    sent, status,
                    diagnostics: diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics) ? diagnostics : null,
                    suggestions: status >= 200 && status < 300 ? readSuggestionPair(payload) : null,
                    clientMs, at: Date.now(), outcome: 'answered',
                });
            }, () => { this.record(request, { sent, status, diagnostics: null, suggestions: null, clientMs, at: Date.now(), outcome: 'answered' }); });
        });
        page.on('requestfailed', (request) => {
            if (!isCoaching(request))
                return;
            this.record(request, {
                sent: readSentRequest(request), status: this.statusSeen.get(request) ?? null, diagnostics: null, suggestions: null,
                clientMs: elapsed(request), at: Date.now(), outcome: 'failed',
            });
        });
        this.elapsedFor = elapsed;
    }
    elapsedFor = () => null;
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
    async settle(boundMs = rwtCoachingEvidence_cjs_1.COACHING_SETTLE_BOUND_MS) {
        const deadline = Date.now() + boundMs;
        const dueAt = (request) => (this.startedAt.get(request) ?? Date.now()) + boundMs;
        let unanswered = 0;
        let bodyPending = 0;
        for (;;) {
            const now = Date.now();
            // Codex r4305107830: only requests still open count — one already recorded or closed never makes settle wait.
            for (const request of [...this.outstanding.keys()].filter((r) => now >= dueAt(r))) {
                const status = this.statusSeen.get(request) ?? null;
                const outcome = status === null ? 'unanswered' : 'body_pending';
                if (outcome === 'unanswered')
                    unanswered += 1;
                else
                    bodyPending += 1;
                this.record(request, {
                    sent: readSentRequest(request), status, diagnostics: null, suggestions: null,
                    clientMs: this.elapsedFor(request), at: now, outcome,
                });
                this.closedAtBound.add(request);
            }
            const open = [...this.outstanding.keys()];
            if (open.length === 0 || now >= deadline)
                break;
            const wakeAt = Math.min(deadline, ...open.map(dueAt));
            let timer;
            await Promise.race([this.changed(), new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, wakeAt - now)); })]);
            clearTimeout(timer);
        }
        return { unanswered, bodyPending, inFlight: this.outstanding.size };
    }
    /**
     * #1474 (Sam 6243698211) — THE way a receipt reader reads one take's exchanges: the bounded settle of every sent
     * request first, then the take's records. A reader that capped the settle (the old 5 s reason bound) read before a
     * legitimate answer inside the Edge budget arrived; routing every reader through here keeps that impossible.
     */
    async settledForSession(sessionId) {
        await this.settle();
        return sessionId ? this.forSession(sessionId) : [];
    }
    /**
     * #1593 (Sam, #1656 review) — a NONTERMINAL snapshot of the requests still open, in send order: what each named, when
     * it was sent, its age now and any status already seen. Separate from the terminal `exchanges`; it changes no count,
     * no cost uncertainty and no HOLD — it only makes an in-flight request identifiable instead of invisible.
     */
    inFlight(now = Date.now()) {
        return [...this.outstanding.keys()].map((request) => {
            const sentAt = this.startedAt.get(request) ?? null;
            return { sent: this.sentInfo.get(request) ?? readSentRequest(request), sentAt,
                ageMs: sentAt === null ? null : Math.max(0, now - sentAt), status: this.statusSeen.get(request) ?? null };
        });
    }
    /** Exchanges the page sent for one saved session, in arrival order. */
    forSession(sessionId) {
        return this.exchanges.filter((e) => e.sent.sessionId === sessionId);
    }
}
exports.CoachingGenerationTap = CoachingGenerationTap;
