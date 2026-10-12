/**
 * #1258 RWT-feedback-journey-preparation (PM 6110520212) — a MOCKED diagnostic boundary for the feedback journey.
 *
 * MOCKED EVIDENCE ONLY: this proves the visible product flow on the E2E build. It does not qualify Production, the real
 * Edge function or Gemini. It wraps the E2E Supabase double (`window.supabase`, assigned by setupE2EManifest's init script)
 * from a NEW init script, at the moment of assignment (a property setter, so the app never sees the unwrapped client). The
 * shared double is not edited. Queues and records live in this tab's sessionStorage, so they survive the fresh `/session`
 * load a second take needs.
 *   - auth: the session's user gets a stable `last_sign_in_at`. Supabase always sets it in Production; the double does not,
 *     and without it the feedback dialog has no "this login" and can link no session (an E2E-only gap, not a product one);
 *   - `create_session_and_update_usage` gets a real UUID session id (Production ids are UUIDs and the dialog links only a
 *     UUID; the double otherwise mints `session-…` ids);
 *   - `get-ai-suggestions` answers from a scripted queue: success, 503 unavailable, a transport failure, or a delayed
 *     success — and records each request's session id;
 *   - `user_issue_reports` inserts answer from a scripted queue: stored, a transport failure, a server rejection (row-level
 *     security, 42501, the shape PostgREST returns), or "stored but the reply was
 *     lost" (the retry then meets the idempotency index exactly as the database does) — recording each row's session id and
 *     idempotency key. Report prose is never recorded.
 */
import type { Page } from '@playwright/test';

export type CoachingAnswer = 'success' | 'unavailable' | 'network' | `delayed:${number}`;
export type StorageAnswer = 'stored' | 'failed' | 'rejected' | 'stored_reply_lost';

export interface BoundaryRecord {
    coachingRequests: Array<{ sessionId: string | null }>;
    reportInserts: Array<{ sessionId: string | null; idempotencyKey: string | null; outcome: 'stored' | 'failed' | 'rejected' | 'replayed' | 'stored_reply_lost' }>;
    /** Rows actually stored (one per idempotency key). */
    storedReports: Array<{ sessionId: string | null; idempotencyKey: string | null }>;
}

const STATE_KEY = '__FB_DIAG_STATE__';
const SUGGESTIONS = { version: 'gemini_coaching_v1', what_worked: 'You opened with the point.', what_to_try_next: 'Pause before the takeaway.' };

/** Registers the boundary; call BEFORE login/navigation so it wraps the double on every document load. */
export async function installFeedbackDiagnosticsBoundary(page: Page): Promise<void> {
    await page.addInitScript(({ suggestions, stateKey }) => {
        type State = { loginAt: string; coaching: string[]; storage: string[]; record: BoundaryRecord };
        type BoundaryRecord = {
            coachingRequests: Array<{ sessionId: string | null }>;
            reportInserts: Array<{ sessionId: string | null; idempotencyKey: string | null; outcome: string }>;
            storedReports: Array<{ sessionId: string | null; idempotencyKey: string | null }>;
        };
        const read = (): State => {
            const raw = sessionStorage.getItem(stateKey);
            if (raw) return JSON.parse(raw) as State;
            const fresh: State = { loginAt: new Date().toISOString(), coaching: [], storage: [], record: { coachingRequests: [], reportInserts: [], storedReports: [] } };
            sessionStorage.setItem(stateKey, JSON.stringify(fresh));
            return fresh;
        };
        const update = <T>(fn: (s: State) => T): T => { const s = read(); const out = fn(s); sessionStorage.setItem(stateKey, JSON.stringify(s)); return out; };
        read();

        type Session = { user?: { last_sign_in_at?: string } | null } | null;
        type Invoke = (name: string, options?: { body?: { sessionId?: string | null } }) => Promise<unknown>;
        type Client = {
            auth: {
                getSession: () => Promise<{ data: { session: Session } }>;
                onAuthStateChange: (cb: (event: string, session: Session) => void) => unknown;
            };
            rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
            functions: { invoke: Invoke };
            from: (table: string) => unknown;
        };
        const stamp = (session: Session): Session => {
            if (session?.user && !session.user.last_sign_in_at) session.user.last_sign_in_at = read().loginAt;
            return session;
        };
        const wrap = (client: Client): Client => {
            const getSession = client.auth.getSession.bind(client.auth);
            client.auth.getSession = async () => { const r = await getSession(); stamp(r.data.session); return r; };
            const onAuth = client.auth.onAuthStateChange.bind(client.auth);
            client.auth.onAuthStateChange = (cb) => onAuth((event, session) => cb(event, stamp(session)));

            const rpc = client.rpc.bind(client);
            client.rpc = (fn, args) => {
                if (fn !== 'create_session_and_update_usage') return rpc(fn, args);
                const data = { ...((args?.p_session_data as Record<string, unknown>) ?? {}) };
                if (!data.id) data.id = crypto.randomUUID();
                return rpc(fn, { ...args, p_session_data: data });
            };

            const invoke = client.functions.invoke.bind(client.functions);
            client.functions.invoke = async (name, options) => {
                if (name !== 'get-ai-suggestions') return invoke(name, options);
                const answer = update((s) => {
                    if (s.coaching.length === 0) return null;
                    s.record.coachingRequests.push({ sessionId: options?.body?.sessionId ?? null });
                    return s.coaching.shift() as string;
                });
                if (answer === null) return invoke(name, options);
                if (answer === 'unavailable') {
                    return { data: null, error: { name: 'FunctionsHttpError', message: 'provider unavailable', context: { status: 503 } } };
                }
                if (answer === 'network') throw Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' });
                if (answer.startsWith('delayed:')) await new Promise((r) => setTimeout(r, Number(answer.slice(8))));
                return { data: { suggestions }, error: null };
            };

            const from = client.from.bind(client);
            client.from = (table) => {
                if (table !== 'user_issue_reports') return from(table);
                return {
                    insert: async (row: { session_id?: string | null; idempotency_key?: string | null }) => {
                        const entry = { sessionId: row.session_id ?? null, idempotencyKey: row.idempotency_key ?? null };
                        const outcome = update((s) => {
                            if (entry.idempotencyKey && s.record.storedReports.some((r) => r.idempotencyKey === entry.idempotencyKey)) {
                                s.record.reportInserts.push({ ...entry, outcome: 'replayed' });
                                return 'replayed';
                            }
                            const answer = s.storage.length > 0 ? s.storage.shift() as string : 'stored';
                            if (answer === 'failed') { s.record.reportInserts.push({ ...entry, outcome: 'failed' }); return 'failed'; }
                            if (answer === 'rejected') { s.record.reportInserts.push({ ...entry, outcome: 'rejected' }); return 'rejected'; }
                            s.record.storedReports.push(entry);
                            s.record.reportInserts.push({ ...entry, outcome: answer === 'stored_reply_lost' ? 'stored_reply_lost' : 'stored' });
                            return answer;
                        });
                        if (outcome === 'replayed') {
                            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_issue_reports_idempotency_key_unique"', details: '' } };
                        }
                        if (outcome === 'rejected') {
                            return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "user_issue_reports"' } };
                        }
                        // A transport failure: the request never reached storage (or its reply was lost after storing).
                        if (outcome === 'failed' || outcome === 'stored_reply_lost') throw new TypeError('Failed to fetch');
                        return { data: null, error: null };
                    },
                };
            };
            return client;
        };
        let wrapped: Client | undefined;
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get: () => wrapped,
            set: (client: Client) => { wrapped = client ? wrap(client) : client; },
        });
    }, { suggestions: SUGGESTIONS, stateKey: STATE_KEY });
}

/** Queue the answers the next coaching requests / feedback inserts receive (consumed in order). */
export async function scriptBoundary(page: Page, script: { coaching?: CoachingAnswer[]; storage?: StorageAnswer[] }): Promise<void> {
    await page.evaluate(({ s, key }) => {
        const state = JSON.parse(sessionStorage.getItem(key) ?? '{}') as { coaching: string[]; storage: string[] };
        if (s.coaching) state.coaching.push(...s.coaching);
        if (s.storage) state.storage.push(...s.storage);
        sessionStorage.setItem(key, JSON.stringify(state));
    }, { s: script, key: STATE_KEY });
}

export async function boundaryRecord(page: Page): Promise<BoundaryRecord> {
    return page.evaluate((key) => (JSON.parse(sessionStorage.getItem(key) ?? '{}') as { record: BoundaryRecord }).record, STATE_KEY);
}
