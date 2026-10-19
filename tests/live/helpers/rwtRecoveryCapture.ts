/**
 * #1593 case 10 — the receiving captures for CLI's accepted recovery-fence oracle (rwtRecoveryFence1593.ts, b6fab3a9), per
 * CLI's receiving proposal (#1593 comments 6272559858 + correction 6272635456, accepted by Sam). Content-free: only row and
 * lease identities, statuses and fence facts are read, and nothing here logs a request or response body.
 *
 * - Complete rows: every `sessions` row of the run-owned account, paged with an exact count, a deterministic order and a
 *   coverage check. An observed duplicate identity is a KNOWN contradiction and is reported as such BEFORE any
 *   incomplete/unavailable classification (the caller FAILs it); errors, truncation and count drift are unavailable and
 *   never become `complete: true`.
 * - Authority: the account's `active_recording_lease`; only a successful read returning no row means absent.
 * - Take identity: the session a Start created, bound passively from the page's own `create_session_and_update_usage`
 *   exchange, with the phase taken at REQUEST time (a late response cannot be borrowed by a later phase). Missing, failed,
 *   unsettled or ambiguous bindings are unavailable (HOLD); a response contradicting its own request is a contradiction.
 * - Recording: a strict page read of the published runtime state and live microphone tracks; unreadable is unavailable.
 */
import { recoveryFence1593Verdict, type RecoveryAuthority, type RecoveryFenceEvidence, type RecoveryRead, type RecoveryRowIdentity, type RecoveryRows,
    type RecoverySession, type RecoverySnapshot } from './rwtRecoveryFence1593';

/** The part of a Supabase query builder these reads use (a structural type, so tests can drive it). */
export interface RecoveryQuery extends PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
    select(columns: string, options?: { count?: 'exact' }): RecoveryQuery;
    eq(column: string, value: string): RecoveryQuery;
    order(column: string, options?: { ascending?: boolean }): RecoveryQuery;
    range(from: number, to: number): RecoveryQuery;
    maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface RecoveryDb { from(table: string): RecoveryQuery }

export type RowsCapture<T> = { rows: RecoveryRows<T>; duplicateIdentity: boolean };

const SESSION_FIELDS = 'id,user_id,status,lease_id,recording_fenced_at,recording_fenced_reason,lease_released_at';
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** A non-string identity stays unreadable ('' — the oracle HOLDs it); a nullable field keeps null distinct from absent. */
const identity = (r: Record<string, unknown>): RecoveryRowIdentity => ({ id: text(r.id) ?? '', user_id: text(r.user_id) ?? '' });
const session = (r: Record<string, unknown>): RecoverySession => ({
    ...identity(r),
    status: text(r.status), lease_id: text(r.lease_id), recording_fenced_at: text(r.recording_fenced_at),
    recording_fenced_reason: text(r.recording_fenced_reason), lease_released_at: text(r.lease_released_at),
});

async function readComplete<T extends RecoveryRowIdentity>(db: RecoveryDb, ownerId: string, columns: string,
    map: (r: Record<string, unknown>) => T, pageSize: number): Promise<RowsCapture<T>> {
    const out: T[] = [];
    const seen = new Set<string>();
    let duplicateIdentity = false;
    let total: number | null = null;
    let complete = true;
    for (let from = 0; ; from += pageSize) {
        let page: { data: unknown; error: unknown; count?: number | null };
        try {
            page = await db.from('sessions').select(columns, { count: 'exact' }).eq('user_id', ownerId)
                .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + pageSize - 1);
        } catch { complete = false; break; }
        if (page.error || !Array.isArray(page.data) || typeof page.count !== 'number') { complete = false; break; }
        if (total === null) total = page.count;
        else if (page.count !== total) { complete = false; break; } // the set changed while it was read
        for (const raw of page.data) {
            const row = map((raw ?? {}) as Record<string, unknown>);
            if (row.id !== '') {
                if (seen.has(row.id)) duplicateIdentity = true;
                seen.add(row.id);
            }
            out.push(row);
        }
        if (page.data.length < pageSize || out.length >= total) break;
    }
    if (total === null) return { rows: { state: 'unavailable' }, duplicateIdentity };
    // A repeated identity means the order moved under the pages: some row was skipped even if the count is filled.
    return { rows: { state: 'observed', complete: complete && !duplicateIdentity && out.length === total, value: out }, duplicateIdentity };
}

/** Identity-only baseline rows (before the first Start, before the successor Start). */
export const readBaselineRows = (db: RecoveryDb, ownerId: string, pageSize = 100) => readComplete(db, ownerId, 'id,user_id', identity, pageSize);
/** Every session row with the fence fields the oracle judges. */
export const readSessionRows = (db: RecoveryDb, ownerId: string, pageSize = 100) => readComplete(db, ownerId, SESSION_FIELDS, session, pageSize);

export async function readAuthority(db: RecoveryDb, ownerId: string): Promise<RecoveryRead<RecoveryAuthority | null>> {
    try {
        const { data, error } = await db.from('active_recording_lease').select('user_id,lease_id,state').eq('user_id', ownerId).maybeSingle();
        if (error) return { state: 'unavailable' };
        if (data === null) return { state: 'observed', value: null }; // a SUCCESSFUL read with no row: absent
        const r = (data ?? {}) as Record<string, unknown>;
        return { state: 'observed', value: { user_id: text(r.user_id) ?? '', lease_id: text(r.lease_id) ?? '', state: text(r.state) ?? '' } };
    } catch {
        return { state: 'unavailable' };
    }
}

/** One bound snapshot: complete rows plus the current authority. */
export async function readSnapshot(db: RecoveryDb, runId: string, ownerId: string): Promise<{ snapshot: RecoverySnapshot; duplicateIdentity: boolean }> {
    const rows = await readSessionRows(db, ownerId);
    const authority = await readAuthority(db, ownerId);
    return { snapshot: { runId, ownerId, rows: rows.rows, authority }, duplicateIdentity: rows.duplicateIdentity };
}

export type TakeBinding =
    | { state: 'observed'; sessionId: string; leaseId: string }
    | { state: 'unavailable'; reason: string }
    | { state: 'contradiction'; reason: string };

/** The parts of a Playwright request/response the binding reads (structural, for tests). */
export interface BindingRequest {
    url(): string;
    method(): string;
    postDataJSON(): unknown;
    response(): Promise<{ ok(): boolean; json(): Promise<unknown> } | null>;
}
export interface BindingPage { on(event: 'request', listener: (r: BindingRequest) => void): unknown; off(event: 'request', listener: (r: BindingRequest) => void): unknown }

const RPC_PATH = '/rest/v1/rpc/create_session_and_update_usage';

/**
 * Passive binding of the session each Start created. `arm(phase)` sets the phase every LATER request is bound to; each
 * matching POST records the phase current when it was SENT. Bodies are parsed for identity fields only and never kept.
 */
export class SessionCreateBinding {
    private phase: string | null = null;
    private readonly records = new Map<string, { sessionId: string; userId: string; leaseId: string; requestLease: string | null }[]>();
    private readonly pending = new Map<string, number>();
    private readonly failures = new Map<string, number>();
    private readonly attached: [BindingPage, (r: BindingRequest) => void][] = [];

    constructor(private readonly supabaseOrigin: string, private readonly ownerId: () => string) {}

    arm(phase: string | null): void { this.phase = phase; }

    attach(page: BindingPage): void {
        const listener = (request: BindingRequest) => this.onRequest(request);
        page.on('request', listener);
        this.attached.push([page, listener]);
    }

    detach(): void {
        for (const [page, listener] of this.attached.splice(0)) { try { page.off('request', listener); } catch { /* closed page */ } }
    }

    onRequest(request: BindingRequest): void {
        const phase = this.phase;
        if (phase === null) return;
        let url: URL;
        try { url = new URL(request.url()); } catch { return; }
        if (request.method() !== 'POST' || url.origin !== this.supabaseOrigin || url.pathname !== RPC_PATH) return;
        let requestLease: string | null = null;
        try {
            const body = request.postDataJSON() as { p_session_data?: { lease_id?: unknown } } | null;
            requestLease = text(body?.p_session_data?.lease_id);
        } catch { requestLease = null; }
        const bump = (m: Map<string, number>, by: number) => m.set(phase, (m.get(phase) ?? 0) + by);
        bump(this.pending, 1);
        void request.response().then(async (response) => {
            if (!response || !response.ok()) { bump(this.failures, 1); return; }
            const body = await response.json().catch(() => undefined) as { new_session?: Record<string, unknown> | null } | undefined;
            if (body === undefined) { bump(this.failures, 1); return; }
            const created = body.new_session;
            if (!created) return; // the server refused to create (e.g. lease not held): no take was created
            const list = this.records.get(phase) ?? [];
            list.push({ sessionId: text(created.id) ?? '', userId: text(created.user_id) ?? '', leaseId: text(created.lease_id) ?? '', requestLease });
            this.records.set(phase, list);
        }, () => { bump(this.failures, 1); }).finally(() => bump(this.pending, -1));
    }

    /** The phase's created take: exactly one settled, successful, self-consistent creation, else unavailable/contradiction. */
    binding(phase: string): TakeBinding {
        if ((this.pending.get(phase) ?? 0) > 0) return { state: 'unavailable', reason: 'creation_unsettled' };
        if ((this.failures.get(phase) ?? 0) > 0) return { state: 'unavailable', reason: 'creation_exchange_failed' };
        const list = this.records.get(phase) ?? [];
        if (list.some((r) => r.sessionId === '' || r.leaseId === '' || r.userId === '')) return { state: 'unavailable', reason: 'creation_identity_unreadable' };
        if (list.some((r) => r.userId !== this.ownerId())) return { state: 'contradiction', reason: 'creation_owner_mismatch' };
        if (list.some((r) => r.requestLease !== null && r.requestLease !== r.leaseId)) return { state: 'contradiction', reason: 'creation_lease_mismatch' };
        const ids = new Set(list.map((r) => r.sessionId));
        if (ids.size === 0) return { state: 'unavailable', reason: 'no_creation_observed' };
        if (ids.size > 1) return { state: 'unavailable', reason: 'ambiguous_creations' };
        const leases = new Set(list.map((r) => r.leaseId));
        if (leases.size > 1) return { state: 'contradiction', reason: 'one_session_two_leases' };
        return { state: 'observed', sessionId: list[0].sessionId, leaseId: list[0].leaseId };
    }

    /** Every identity observed, for `receipt.forbid` (never written to the receipt). */
    identities(): string[] {
        return [...this.records.values()].flat().flatMap((r) => [r.sessionId, r.leaseId, r.requestLease ?? '']).filter((v) => v !== '');
    }
}

/** A strict read: RECORDING published and a live microphone track — unreadable is unavailable, never `false`. */
export async function readRecording(page: { evaluate: <R>(fn: () => R) => Promise<R> }): Promise<RecoveryRead<boolean>> {
    try {
        const observed = await page.evaluate(() => {
            const streams = (window as unknown as { __rwtMicStreams__?: MediaStream[] }).__rwtMicStreams__;
            if (!streams) return null;
            const live = streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === 'live').length;
            return document.documentElement.getAttribute('data-runtime-state') === 'RECORDING' && live > 0;
        });
        return observed === null ? { state: 'unavailable' } : { state: 'observed', value: observed };
    } catch {
        return { state: 'unavailable' };
    }
}

/** The captures the journey takes at the baselines, A (first take recording) and B (successor recording). */
export type FenceCaptures = {
    beforeFirst?: RowsCapture<RecoveryRowIdentity>; beforeSuccessor?: RowsCapture<RecoveryRowIdentity>;
    first?: { recording: RecoveryRead<boolean>; snapshot: RecoverySnapshot; duplicate: boolean };
    successor?: { recording: RecoveryRead<boolean>; snapshot: RecoverySnapshot; duplicate: boolean };
};

/**
 * Case 10: assemble the oracle's evidence. Known contradictions — an observed duplicate row identity in ANY read, or a
 * creation exchange contradicting itself — FAIL before any incomplete/unavailable classification (correction 6272635456);
 * otherwise the accepted oracle decides. Only counts and states reach the receipt, never identities.
 */
export function recoveryFenceRow(creations: Pick<SessionCreateBinding, 'binding'>, recovery: FenceCaptures, afterSave: { snapshot: RecoverySnapshot; duplicateIdentity: boolean }, savedSessionId: RecoveryRead<string | null>, runId: string, ownerId: string):
    { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string; evidence: Record<string, string | number | boolean | null> } {
    const a = creations.binding('A');
    const b = creations.binding('B');
    const evidence = {
        bindingA: a.state, bindingB: b.state,
        duplicateObserved: Boolean(recovery.beforeFirst?.duplicateIdentity || recovery.beforeSuccessor?.duplicateIdentity
            || recovery.first?.duplicate || recovery.successor?.duplicate || afterSave.duplicateIdentity),
    };
    if (evidence.duplicateObserved) return { status: 'FAIL', detail: 'an account read observed a duplicate session identity', evidence };
    for (const bound of [a, b]) if (bound.state === 'contradiction') return { status: 'FAIL', detail: `a take's creation contradicted itself (${bound.reason})`, evidence };
    if (!recovery.beforeFirst || !recovery.beforeSuccessor || !recovery.first || !recovery.successor) {
        return { status: 'HOLD', detail: 'a required capture point was not reached', evidence };
    }
    const take = (bound: typeof a) => (bound.state === 'observed' ? { sessionId: bound.sessionId, leaseId: bound.leaseId } : { sessionId: null, leaseId: null });
    const verdict = recoveryFence1593Verdict({
        runId, ownerId,
        beforeFirst: { runId, ownerId, rows: recovery.beforeFirst.rows },
        beforeSuccessor: { runId, ownerId, rows: recovery.beforeSuccessor.rows },
        first: { ...take(a), recordingObserved: recovery.first.recording, snapshot: recovery.first.snapshot },
        successor: { ...take(b), recordingObserved: recovery.successor.recording, snapshot: recovery.successor.snapshot },
        afterSave: afterSave.snapshot, savedSessionId,
    } satisfies RecoveryFenceEvidence);
    return { ...verdict, evidence };
}
