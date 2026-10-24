/** CO006 successor: one started take, one deadline, owned response observation. No Playwright or network dependency. */
export interface StopRequest {
    url(): string;
    method(): string;
    postDataJSON(): unknown;
}
export interface StopResponse {
    url(): string;
    status(): number;
    request(): StopRequest;
    json(): Promise<unknown>;
}

export interface StopPage {
    on(event: 'request', listener: (request: StopRequest) => void): unknown;
    on(event: 'response', listener: (response: StopResponse) => void): unknown;
    off(event: 'request', listener: (request: StopRequest) => void): unknown;
    off(event: 'response', listener: (response: StopResponse) => void): unknown;
}

export interface StopControls {
    sessionId: string;
    ownerId: string | null;
    apiOrigin: string;
    remainingMs(): number;
    stop(): Promise<unknown>;
    waitForSettledTake(): Promise<unknown>;
    openSavedTake(): Promise<unknown>;
    reloadSavedTake(): Promise<unknown>;
}

type Phase = 'completion' | 'settlement' | 'arrival' | 'reload';
type Refusal = 'invalid_binding' | 'deadline' | 'save_http' | 'save_body' | 'save_not_completed'
    | 'readback_http' | 'readback_body' | 'row_missing' | 'row_duplicate' | 'wrong_owner'
    | 'row_not_completed' | 'row_schema' | 'no_words' | 'action_failed' | 'listener_cleanup_failed';
export type StopResult = Readonly<{ kind: 'saved'; readbacks: 2 } | { kind: 'refused'; phase: Phase; reason: Refusal }>;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function startOwnerId(newSession: unknown): string | null {
    return record(newSession) && nonempty(newSession.user_id) ? newSession.user_id : null;
}

/** Standalone/serializable Page predicate: the current take has settled, not merely committed its first save RPC. */
export function isOwnedStopSettledInPage(sessionId: string): boolean {
    const root = document.documentElement;
    return typeof sessionId === 'string' && sessionId.trim().length > 0
        && root.getAttribute('data-session-persisted') === 'true'
        && root.getAttribute('data-session-persisted-id') === sessionId
        && root.getAttribute('data-session-persist-status') === 'saved'
        && root.getAttribute('data-runtime-state') === 'READY';
}

/** Compare request identity BEFORE selecting a response; never select by an ID mentioned elsewhere in the URL. */
export function responseMatchesTake(response: StopResponse, phase: Phase, apiOrigin: string, sessionId: string): boolean {
    try {
        const url = new URL(response.url());
        const request = response.request();
        if (url.href !== new URL(request.url()).href) return false;
        return requestMatchesTake(request, phase, apiOrigin, sessionId);
    } catch { return false; }
}

function requestMatchesTake(request: StopRequest, phase: Phase, apiOrigin: string, sessionId: string): boolean {
    try {
        if (phase === 'settlement') return false;
        const url = new URL(request.url());
        if (url.origin !== apiOrigin) return false;
        if (phase === 'completion') {
            if (url.pathname !== '/rest/v1/rpc/complete_session_v2' || request.method() !== 'POST') return false;
            const body = request.postDataJSON();
            return record(body) && body.p_session_id === sessionId;
        }
        return url.pathname === '/rest/v1/sessions' && request.method() === 'GET'
            && url.searchParams.getAll('id').length === 1
            && url.searchParams.get('id') === `eq.${sessionId}`;
    } catch { return false; }
}

/** A list or single-row body must contain exactly one matching completed take, not merely a plausible first row. */
export function verifySavedReadback(sessionId: string, ownerId: string | null, body: unknown): Refusal | null {
    if (!nonempty(sessionId) || !nonempty(ownerId)) return 'invalid_binding';
    const rows = record(body) ? [body] : body;
    if (!Array.isArray(rows)) return 'readback_body';
    const matching = rows.filter((row) => record(row) && row.id === sessionId);
    if (matching.length === 0) return 'row_missing';
    if (matching.length !== 1) return 'row_duplicate';
    const row = matching[0] as Record<string, unknown>;
    if (row.user_id !== ownerId) return 'wrong_owner';
    if (row.status !== 'completed') return 'row_not_completed';
    if (!nonempty(row.engine) || !nonempty(row.created_at)
        || typeof row.duration !== 'number' || !Number.isFinite(row.duration) || row.duration < 0) return 'row_schema';
    if (typeof row.total_words !== 'number' || !Number.isFinite(row.total_words) || row.total_words <= 0) return 'no_words';
    return null;
}

/**
 * All predicates/body reads and actions share the existing stop phase's remaining budget. Reserve 100ms INSIDE that
 * ceiling for cleanup/verdict publication; no test/phase timeout is enlarged. A dialog, no-speech label or rejected wait
 * never supplies save evidence. The exact completion and TWO durable readbacks (arrival/reload) are required instead.
 * Only enums/counts leave; request/owner/content are never included in the result.
 */
export function collectCanaryStopSave(page: StopPage, controls: StopControls): Promise<StopResult> {
    let budget: number;
    try {
        const origin = new URL(controls.apiOrigin);
        budget = controls.remainingMs();
        if (!nonempty(controls.sessionId) || !nonempty(controls.ownerId)
            || origin.origin !== controls.apiOrigin || !['http:', 'https:'].includes(origin.protocol)
            || origin.username || origin.password || !Number.isFinite(budget) || budget <= 100) {
            return Promise.resolve(Object.freeze({ kind: 'refused', phase: 'completion', reason: 'invalid_binding' }));
        }
    } catch { return Promise.resolve(Object.freeze({ kind: 'refused', phase: 'completion', reason: 'invalid_binding' })); }

    const deadline = performance.now() + Math.floor(budget) - 100;
    return new Promise((resolve) => {
        let phase: Phase = 'completion';
        let closed = false;
        let bodyPending = false;
        let evidenceReady = false;
        let actionReady = false;
        let requestListenerAdded = false;
        let responseListenerAdded = false;
        const requestedInPhase = new WeakMap<StopRequest, Phase>();

        const finish = (result: StopResult) => {
            if (closed) return;
            // Timer delivery can lag behind promise continuations; publication must independently enforce the ceiling.
            if (result.kind === 'saved' && performance.now() >= deadline) result = { kind: 'refused', phase, reason: 'deadline' };
            closed = true; // freeze BEFORE cleanup or any queued body/action callback can publish
            clearTimeout(timer);
            let cleanupFailed = false;
            try { if (requestListenerAdded) page.off('request', onRequest); } catch { cleanupFailed = true; }
            try { if (responseListenerAdded) page.off('response', onResponse); } catch { cleanupFailed = true; }
            if (cleanupFailed) result = { kind: 'refused', phase, reason: 'listener_cleanup_failed' };
            resolve(Object.freeze(result));
        };
        const refuse = (reason: Refusal) => finish({ kind: 'refused', phase, reason });
        const isOpen = () => {
            if (closed) return false;
            if (performance.now() >= deadline) { refuse('deadline'); return false; }
            return true;
        };
        const act = (action: () => Promise<unknown>) => {
            void Promise.resolve().then(() => { if (isOpen()) return action(); }).then(() => {
                if (!isOpen()) return;
                actionReady = true;
                advance();
            }, () => { if (isOpen()) refuse('action_failed'); });
        };
        const advance = () => {
            if (!isOpen() || !actionReady || !evidenceReady) return;
            if (phase === 'reload') { finish({ kind: 'saved', readbacks: 2 }); return; }
            phase = phase === 'completion' ? 'settlement' : phase === 'settlement' ? 'arrival' : 'reload';
            evidenceReady = phase === 'settlement';
            actionReady = false;
            bodyPending = false;
            // Stage/predicate already armed before the action can synchronously emit its response.
            act(phase === 'settlement' ? controls.waitForSettledTake
                : phase === 'arrival' ? controls.openSavedTake : controls.reloadSavedTake);
        };
        const onRequest = (request: StopRequest) => {
            if (isOpen() && requestMatchesTake(request, phase, controls.apiOrigin, controls.sessionId)) requestedInPhase.set(request, phase);
        };
        const onResponse = (response: StopResponse) => {
            if (!isOpen() || bodyPending || evidenceReady || !responseMatchesTake(response, phase, controls.apiOrigin, controls.sessionId)) return;
            if (requestedInPhase.get(response.request()) !== phase) return;
            const capturedPhase = phase;
            bodyPending = true;
            let status: number;
            try { status = response.status(); } catch { refuse(phase === 'completion' ? 'save_http' : 'readback_http'); return; }
            if (status !== 200) { refuse(phase === 'completion' ? 'save_http' : 'readback_http'); return; }
            // The body may never resolve or may resolve after the deadline; it never owns the verdict.
            void Promise.resolve().then(() => { if (isOpen()) return response.json(); }).then((body) => {
                if (!isOpen() || phase !== capturedPhase) return;
                if (capturedPhase === 'completion') {
                    if (!record(body) || body.success !== true || body.session_saved !== true || body.final_status !== 'completed') {
                        refuse('save_not_completed'); return;
                    }
                    try {
                        const request = response.request().postDataJSON();
                        if (!record(request) || request.p_status !== 'completed') { refuse('save_not_completed'); return; }
                    } catch { refuse('save_not_completed'); return; }
                } else {
                    const refusal = verifySavedReadback(controls.sessionId, controls.ownerId, body);
                    if (refusal) { refuse(refusal); return; }
                }
                evidenceReady = true;
                advance();
            }, () => { if (isOpen()) refuse(capturedPhase === 'completion' ? 'save_body' : 'readback_body'); });
        };

        const timer = setTimeout(() => refuse('deadline'), Math.floor(budget) - 100);
        try {
            requestListenerAdded = true;
            page.on('request', onRequest);
            responseListenerAdded = true;
            page.on('response', onResponse);
        } catch { refuse('action_failed'); return; }
        act(controls.stop);
    });
}
