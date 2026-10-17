/**
 * RWT R1 (row 15) — the pure verdicts behind `rwt-save-retry-recovery`. Kept free of Playwright and the browser so each
 * rule is unit-tested against its own failing controls. Every input is content-free: states, counts and lengths.
 */
export const SAVE_RETRY_SUITE = 'save-retry-recovery';
export const SAVE_RETRY_VARIANTS = ['request-lost', 'response-lost'] as const;
export type SaveRetryVariant = (typeof SAVE_RETRY_VARIANTS)[number];

/** The banner's own copy (UnresolvedRecoveryBanner.tsx); a source guard keeps these in step with the component. */
export const RECOVERY_COPY = {
    full_save: 'Your last recording was not fully saved.',
    initial_save: 'Your last recording has not been saved yet.',
    words: 'Your words are still here.',
} as const;

export type Verdict = { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string };
export type SessionRowFacts = {
    id: string; status: string | null; hasIdempotencyKey: boolean; transcriptState: string | null; transcriptLength: number;
};
export type CompletionDrop = { completionPosts: number; droppedStatus: number | null; dropped: boolean };

/**
 * #1258 RWT round 2 C (run 38876571451) — ONE completion call's server answer, content-free. Three completion calls the
 * harness did not intercept left the session uncompleted, and nothing recorded what the server said. This keeps only the
 * HTTP status and the PostgREST error `code` when it is an allowlisted SQLSTATE or PGRST code — never the message,
 * details, hint, body or payload, which can quote the transcript. Anything else is named, not echoed.
 */
export type CompletionOutcome = { status: number; code: string | null };
const ALLOWED_ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
export function sanitizedCompletionOutcome(status: number, body: string | null): CompletionOutcome {
    if (status >= 200 && status < 300) return { status, code: null };
    if (body === null) return { status, code: 'unreadable' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { status, code: 'unparseable' };
    }
    const code = parsed !== null && typeof parsed === 'object' ? (parsed as { code?: unknown }).code : undefined;
    if (typeof code !== 'string') return { status, code: 'absent' };
    return { status, code: ALLOWED_ERROR_CODE.test(code) ? code : 'unrecognized' };
}

/** A completion call that got no HTTP response, by a fixed content-free class (never the browser's error text). */
export type TransportFailure = 'aborted' | 'timed_out' | 'connection' | 'other';
export function classifyTransportFailure(errorText: string | null | undefined): TransportFailure {
    const t = (errorText ?? '').toUpperCase();
    if (t.includes('ABORT')) return 'aborted';
    if (t.includes('TIMED_OUT') || t.includes('TIMEOUT')) return 'timed_out';
    if (/CONNECTION|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|REFUSED|RESET/.test(t)) return 'connection';
    return 'other';
}

/**
 * Sam 6216511222 / 6217065780 — the harness must not stand in the request path to learn the answer: non-dropped calls keep
 * `route.fallback()`, and this observer reads the browser's own `response` / `requestfailed` events, correlated to each
 * call by REQUEST IDENTITY (the object Playwright passes to the route and to both events) and numbered in CALL order at
 * routing time — so completion order can never be mistaken for call order. The one deliberately dropped request is
 * excluded; requests it never tracked are ignored.
 *
 * ONE RECORD PER REQUEST. Playwright can emit `response` (headers) and then `requestfailed` (the body transfer died), so
 * a received status is kept and the failure becomes `transfer_failed` — never a contradictory second "no response" entry.
 * The evidence is a SNAPSHOT of every tracked call: one still waiting for headers reads `pending`, one whose body is
 * still loading reads `<status>:body_pending`. Nothing tracked is silently omitted. Codex r4295679559: body reads are
 * given a BOUNDED grace (`graceMs`) and then the snapshot is taken regardless — a stalled body stays `body_pending`
 * instead of stalling the receipt until the test timeout.
 */
type CompletionRecord = {
    ordinal: number; status: number | null; code: string | null;
    failure: TransportFailure | 'transfer_failed' | null; bodyPending: boolean;
};
export class CompletionObserver<R extends object> {
    private readonly records = new Map<R, CompletionRecord>();
    private readonly dropped = new WeakSet<R>();
    private readonly pending: Promise<void>[] = [];

    track(request: R, ordinal: number): void {
        this.records.set(request, { ordinal, status: null, code: null, failure: null, bodyPending: false });
    }
    markDropped(request: R): void { this.dropped.add(request); }
    isObserved(request: R): boolean { return this.records.has(request) && !this.dropped.has(request); }

    /** Headers arrived: keep the status; the allowlisted code follows from the body (`null` / a rejected read → unreadable). */
    onResponse(request: R, status: number, body: Promise<string | null> | string | null): void {
        if (!this.isObserved(request)) return;
        const rec = this.records.get(request)!;
        rec.status = status;
        rec.bodyPending = true;
        this.pending.push(Promise.resolve(body).catch(() => null).then((text) => {
            rec.bodyPending = false;
            if (rec.failure === null) rec.code = sanitizedCompletionOutcome(status, text).code;
        }));
    }

    /** No HTTP answer (a fixed class, never the browser's error text) — or, after headers, a failed body transfer. */
    onFailed(request: R, errorText: string | null | undefined): void {
        if (!this.isObserved(request)) return;
        const rec = this.records.get(request)!;
        rec.failure = rec.status !== null ? 'transfer_failed' : classifyTransportFailure(errorText);
        rec.bodyPending = false;
    }

    /** Flat receipt evidence, one entry per tracked call in CALL order, e.g. `2=403:42501,3=no_response:connection,4=pending`. */
    async evidence(graceMs = 5_000): Promise<string> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            Promise.all([...this.pending]),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, graceMs); }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        const entries = [...this.records.entries()].filter(([request]) => !this.dropped.has(request)).map(([, rec]) => rec);
        return entries.sort((a, b) => a.ordinal - b.ordinal).map((rec) => {
            if (rec.status === null) return `${rec.ordinal}=${rec.failure ? `no_response:${rec.failure}` : 'pending'}`;
            if (rec.failure === 'transfer_failed') return `${rec.ordinal}=${rec.status}:transfer_failed`;
            if (rec.bodyPending) return `${rec.ordinal}=${rec.status}:body_pending`;
            return `${rec.ordinal}=${rec.status}:${rec.code ?? 'ok'}`;
        }).join(',');
    }
}

/**
 * Was the intended fault actually exercised? HOLD, never PASS or FAIL, when it was not: the later rows then describe a
 * different situation than the one the variant names.
 */
export function completionDropDisposition(variant: SaveRetryVariant, drop: CompletionDrop, rowsBeforeRetry: readonly SessionRowFacts[]): Verdict {
    if (!drop.dropped) return { status: 'HOLD', detail: 'no completion request was observed, so the fault was not exercised' };
    const completed = rowsBeforeRetry.filter((r) => r.status === 'completed').length;
    if (variant === 'request-lost') {
        return completed === 0
            ? { status: 'PASS', detail: 'the first completion request was stopped in the browser and the server saved nothing' }
            : { status: 'HOLD', detail: 'a completed session exists although the completion request was stopped, so the lost-request case was not isolated' };
    }
    const committed = drop.droppedStatus !== null && drop.droppedStatus >= 200 && drop.droppedStatus < 300;
    return committed && completed === 1
        ? { status: 'PASS', detail: 'the server saved the take and only its answer was lost' }
        : { status: 'HOLD', detail: 'the server did not save the take before the answer was dropped, so the lost-response case was not exercised' };
}

/**
 * The recovery banner must say what is true: the take is unsaved, and Retry Save is offered. #1258 C (Sam 6218045990) —
 * the WORDS claim is CONDITIONAL by contract (SessionPage passes `hasTranscriptText` from the page's own text; a failed
 * Stop deliberately purges live text while the retry payload keeps it): "Your words are still here" must appear exactly
 * when words are on the page, and must NOT appear when none are. Whether the spoken words survive for Retry Save is
 * proven by the retry's own completion and readback rows, not by this copy.
 */
export function recoveryBannerVerdict(o: {
    bannerShown: boolean; resolution: string | null; message: string; retryOffered: boolean; wordsOnPage: number;
}): Verdict {
    if (!o.bannerShown) return { status: 'FAIL', detail: 'no recovery banner appeared after the save failed' };
    if (o.resolution !== 'full_save' && o.resolution !== 'initial_save') {
        return { status: 'FAIL', detail: `the banner named the wrong unresolved state (${o.resolution ?? 'none'})` };
    }
    if (!o.retryOffered) return { status: 'FAIL', detail: 'the banner offered no Retry Save' };
    if (!o.message.startsWith(RECOVERY_COPY[o.resolution])) {
        return { status: 'FAIL', detail: 'the banner copy does not match its unresolved state' };
    }
    const claimsWords = o.message.includes(RECOVERY_COPY.words);
    if (claimsWords && o.wordsOnPage === 0) return { status: 'FAIL', detail: 'the banner says the words are still here, but none are on the page' };
    if (!claimsWords && o.wordsOnPage > 0) return { status: 'FAIL', detail: 'words are on the page, but the banner does not say they are still here' };
    return claimsWords
        ? { status: 'PASS', detail: 'the banner says the take is not saved, the words are on the page, and Retry Save is offered' }
        : { status: 'PASS', detail: 'the banner says the take is not saved and offers Retry Save, and truthfully makes no words claim for a page with none' };
}

/** After Retry Save: exactly one saved session for the take, the one the page bound, with its transcript retained. */
export function savedTakeReadbackVerdict(rows: readonly SessionRowFacts[], savedId: string | null): Verdict {
    if (savedId === null) return { status: 'FAIL', detail: 'the page did not bind a saved session after Retry Save' };
    if (rows.length !== 1) return { status: 'FAIL', detail: `${rows.length} session rows exist for one take` };
    const [row] = rows;
    if (row.id !== savedId) return { status: 'FAIL', detail: 'the saved row is not the session the page bound' };
    if (row.status !== 'completed') return { status: 'FAIL', detail: `the take's row is ${row.status ?? 'unreadable'}, not completed` };
    if (!row.hasIdempotencyKey) return { status: 'FAIL', detail: 'the saved row carries no idempotency key' };
    if (row.transcriptState !== 'available' || row.transcriptLength === 0) {
        return { status: 'FAIL', detail: `the newest take's transcript is ${row.transcriptState ?? 'unreadable'}, not available` };
    }
    return { status: 'PASS', detail: 'one completed session for the take, bound by the page, with its transcript kept' };
}

/**
 * #1258 — the next take's saved identity has ARRIVED: a non-null id that is not the previous take's.
 *
 * `data-session-persisted-id` is CLEARED when the next recording starts (signal contract), so waiting for it merely to
 * differ from the previous id passes at once on `null` — before the next take's completion is even sent. Live run
 * 39032621328 read the rows that early and reported "did not save a new session" with no completion POST yet made.
 */
export function nextTakeIdArrived(currentId: string | null, savedId: string | null): boolean {
    return currentId !== null && currentId !== savedId;
}

/** The next take saves only itself, and newest-one retention moves the transcript to it. */
export function nextTakeRetentionVerdict(rows: readonly SessionRowFacts[], savedId: string | null, nextId: string | null): Verdict {
    if (nextId === null || nextId === savedId) return { status: 'FAIL', detail: 'the next take did not save a new session' };
    if (rows.length !== 2) return { status: 'FAIL', detail: `${rows.length} session rows exist after two takes` };
    const older = rows.find((r) => r.id === savedId);
    const newer = rows.find((r) => r.id === nextId);
    if (!older || !newer) return { status: 'FAIL', detail: 'the two rows are not the two takes the page bound' };
    if (older.status !== 'completed' || newer.status !== 'completed') return { status: 'FAIL', detail: 'a take is not completed' };
    if (newer.transcriptState !== 'available' || newer.transcriptLength === 0) {
        return { status: 'FAIL', detail: 'the newest take does not keep its transcript' };
    }
    if (older.transcriptState !== 'expired' || older.transcriptLength !== 0) {
        return { status: 'FAIL', detail: 'the older take still keeps its transcript (newest-one retention)' };
    }
    return { status: 'PASS', detail: 'the next take saved one new session; only the newest keeps its transcript' };
}
