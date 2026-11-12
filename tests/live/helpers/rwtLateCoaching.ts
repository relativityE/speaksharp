/**
 * AHT-01 Option 1 (PO decision, 2026-11-10, item 2) — THE INTERRUPTED TAKE'S COACHING IS SAVED TO IT AND SHOWN ON REOPEN.
 *
 * ORDINARY PERSISTENCE ONLY (review RETURN on 4305f2b7). This row claims nothing about ORDER: whether A's answer or write came
 * after B started recording is a separate causal requirement, proved by a deterministic controlled test, never inferred from
 * the natural journey (an A pair saved before B recorded must not pass as the after-B case). It proves:
 *   - A's own session row, read AS THE SIGNED-IN ACCOUNT (never the admin client), holds a complete coaching pair within a
 *     bounded wait; the row read is the expected session of the expected owner;
 *   - reopening A's saved review lands on A's route AND the saved-review card names A as the session its review was read from
 *     (`data-session-id`, set by the product only with positive proof), so a wrong route or a stale card with matching script
 *     and pair never passes; its transcript is A's saved transcript (content check); it shows exactly the saved pair; and the reopened page sends no coaching
 *     request (a browser-level check — it does not by itself prove zero provider/quota operations).
 * Unreadable evidence HOLDs (fail closed); not saved within the bound, malformed, wrong route, wrong rendered session, a
 * reopen coaching request, not shown, or a different pair FAIL. Closed codes only; text and digests stay in memory.
 *
 * Retention window (PO 2026-11-11: the take's coaching is kept only until a newer session completes). Each read of A is ONE
 * row, which is an atomic snapshot of A: retention expires the transcript (`expire_transcripts_newest_one`, effective forward
 * definition 20261013120000_retention_expiry_without_superuser_1258.sql: transcript=NULL + transcript_state='expired', with the
 * replica bypass removed so triggers fire) and `trg_sessions_purge_derived_on_expire` (20260810120000) nulls `ai_suggestions` in
 * the SAME transaction; 20261025021046_content_free_retention_evidence.sql keeps an expired row from regaining coaching. The
 * applied database version is separate from the frontend release. So the verdict rests on A's own row: `expired` HOLDs
 * (observed expiry, not its cause); `available` + nonblank + no pair at the end of the bound is the observed "no saved pair
 * while the take was retained" FAIL. A returned row of another id/owner is a contradiction (FAIL). The newer-completed count
 * is REPORTED only (an upper bound; it never sets a verdict and is never presented as the cause).
 *
 * Timing: every external read and probe is bounded (late results are ignored). Polling reads are bounded by the remaining
 * allowance, so none completes after the bound; no read starts after it except ONE fresh final observation (bounded), which
 * alone may decide `not-saved`. A diagnostic probe can therefore never age an old snapshot into a deciding observation; a
 * timed-out probe is null and cannot block indefinitely or decide the verdict (each awaited probe can delay reporting by up to
 * PROBE_MS); a missing final observation HOLDs. Each call is accepted only if it settled by its absolute deadline on the same
 * clock. Bounded here: waitMs + FINAL_READ_MS + 3 × PROBE_MS + POST_REOPEN_READ_MS. NOT bounded here: `openSavedReview()`
 * (awaited directly; its own Playwright timeouts apply), so the complete reopen/finalizer/cleanup-reserve bound remains an
 * explicit integration requirement. Cancelling a timer does not cancel the underlying GET; its late result is ignored.
 */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { classifySavedCoaching } from './coachingExternal';

export const LATE_COACHING_ROW = 'interrupted take coaching saved and shown in its saved review';

export interface LateCoachingSink {
    row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>): void;
    forbid(...values: string[]): void;
}

/** A's own row as read by the owner (raw fields; classified by `classifyTarget`). */
export interface TargetRow { id: unknown; user_id: unknown; status: unknown; transcript_state: unknown; transcript: unknown; created_at: unknown; ai_suggestions: unknown }
export type SavedRead = { ok: true; row: TargetRow } | { ok: false };
export interface ReopenedReview {
    /** The reopened page's path, after navigation settled. */
    pathname: string;
    /**
     * The saved-review card's own `data-session-id`: the session its review was ACTUALLY read from (the product sets it only
     * with positive proof). Null when absent. This, not the URL or text, is the rendered identity.
     */
    renderedSessionId: string | null;
    /** sha256 of the rendered `session-detail-transcript` text (content verification); null when it was not rendered. */
    transcriptDigest: string | null;
    pair: { what_worked: string; what_to_try_next: string } | null;
    /** Coaching generation requests the reopened page sent. */
    coachingRequests: number;
}

export interface LateCoachingDeps {
    /** The interrupted take's own session row, read as the signed-in owner. `ok: false` = unreadable (no row, error, no token). */
    readSaved: () => Promise<SavedRead>;
    /** Reported only: completed rows of this owner with a transcript, ranked above A by (created_at, id); null = unread. */
    newerCompleted?: (anchor: { createdAt: string; id: string }) => Promise<number | null>;
    /** Reopen that take's saved review (Analytics detail) in a separate page. */
    openSavedReview: () => Promise<ReopenedReview>;
    same: (a: string, b: string) => boolean;
    /** The signed-in account the row must belong to (identity-contradiction otherwise). */
    expectedUid: string;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** A cancellable deadline timer (injectable so a fake clock can drive timeouts). */
    timer?: (ms: number) => { done: Promise<void>; cancel: () => void };
}

/** Provider budget (45 s) plus transport; the take's request started before the next take recorded. */
export const LATE_COACHING_WAIT_MS = 75_000;
/** Per-read bound while polling (also capped by the remaining allowance). */
export const READ_MS = 10_000;
/** The one fresh observation taken at the bound, and the post-reopen re-read. */
export const FINAL_READ_MS = 10_000;
export const POST_REOPEN_READ_MS = 10_000;
/** A reported-only newer-completed probe; a timeout is null. */
export const PROBE_MS = 5_000;

export const sha256Hex = (value: unknown): string => createHash('sha256').update(String(value ?? '')).digest('hex');

/**
 * PO 2026-11-11: the order is RECORDED, never judged here. Browser-observed: when the browser received A's coaching answer
 * versus when B was observed recording. The after-B causal case is proved by the separate controlled test; this evidence
 * only says which order this natural run happened to take.
 */
export type AnswerOrder = 'answer-after-successor-recording' | 'answer-before-successor-recording' | 'unknown';
export function answerOrder(answeredAt: number | null | undefined, successorRecordingAt: number | null | undefined): AnswerOrder {
    if (typeof answeredAt !== 'number' || typeof successorRecordingAt !== 'number' || !Number.isFinite(answeredAt) || !Number.isFinite(successorRecordingAt)) {
        return 'unknown';
    }
    // An equal-millisecond observation establishes no order (review on f0f6b943): unknown, never "before".
    if (answeredAt === successorRecordingAt) return 'unknown';
    return answeredAt > successorRecordingAt ? 'answer-after-successor-recording' : 'answer-before-successor-recording';
}

/**
 * When the browser received the take's SUCCESSFUL coaching answer (epoch ms): an answered exchange with HTTP 200 AND a
 * returned suggestion pair. An error status or an unreadable body is not a coaching answer (review on f0f6b943). Null when
 * there is none, or when more than one success makes "the" answer ambiguous.
 */
export function latestAnsweredAt(exchanges: ReadonlyArray<{ outcome?: string; at: number; status?: number | null; suggestions?: unknown }>): number | null {
    const times = exchanges
        .filter((e) => e.outcome === 'answered' && e.status === 200 && e.suggestions !== null && e.suggestions !== undefined && Number.isFinite(e.at))
        .map((e) => e.at);
    return times.length === 1 ? times[0] : null;
}

/** SQL `transcript ~ '[^[:space:]]'` parity: both the ASCII POSIX class and JS \S must agree, else ambiguous. */
export function nonblankParity(text: unknown): 'nonblank' | 'blank' | 'ambiguous' {
    if (typeof text !== 'string') return 'blank';
    const posix = /[^ \t\n\v\f\r]/.test(text), js = /\S/.test(text);
    return posix && js ? 'nonblank' : !posix && !js ? 'blank' : 'ambiguous';
}

export type TargetClass =
    | { kind: 'identity-contradiction' } | { kind: 'inconsistent' } | { kind: 'expired' } | { kind: 'nonblank-ambiguous' }
    | { kind: 'available'; coaching: ReturnType<typeof classifySavedCoaching>; transcriptDigest: string; createdAt: string; id: string };

/** One atomic read of A, classified. Identity first: a row of another id/owner is a contradiction, never softened. */
export function classifyTarget(row: TargetRow, expected: { sessionId: string; uid: string }): TargetClass {
    if (row.id !== expected.sessionId || row.user_id !== expected.uid) return { kind: 'identity-contradiction' };
    if (row.status !== 'completed' || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) return { kind: 'inconsistent' };
    const text = nonblankParity(row.transcript);
    if (row.transcript_state === 'expired') return text === 'blank' && row.transcript === null ? { kind: 'expired' } : { kind: 'inconsistent' };
    if (row.transcript_state !== 'available') return { kind: 'inconsistent' };
    if (text === 'ambiguous') return { kind: 'nonblank-ambiguous' };
    if (text === 'blank') return { kind: 'inconsistent' };
    return { kind: 'available', coaching: classifySavedCoaching(row.ai_suggestions), transcriptDigest: sha256Hex(row.transcript), createdAt: row.created_at, id: row.id as string };
}

const TARGET_HOLD: Record<'inconsistent' | 'expired' | 'nonblank-ambiguous', [string, string]> = {
    inconsistent: ['target-inconsistent', 'the interrupted take\'s own row is not a completed take in a consistent retention state'],
    expired: ['target-expired', 'the interrupted take\'s transcript (and with it its coaching) had expired when read; expiry is observed, not its cause'],
    'nonblank-ambiguous': ['nonblank-ambiguous', 'whether the interrupted take\'s transcript is blank cannot be decided the way the database decides it'],
};

export async function lateCoachingSavedRow(
    sink: LateCoachingSink,
    sessionId: string | null,
    deps: LateCoachingDeps,
    o: { waitMs?: number; pollMs?: number; order?: AnswerOrder } = {},
): Promise<void> {
    const order = o.order ?? 'unknown';
    const inner = sink;
    sink = { forbid: (...v) => inner.forbid(...v), row: (step, verdict, detail, evidence) => inner.row(step, verdict, detail, { ...evidence, answerOrder: order }) };
    if (!sessionId) {
        sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take has no saved session to check', { reason: 'no-session' });
        return;
    }
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const waitMs = o.waitMs ?? LATE_COACHING_WAIT_MS;
    const pollMs = o.pollMs ?? 2_000;
    const timer = deps.timer ?? ((ms: number) => {
        let handle: ReturnType<typeof setTimeout> | undefined;
        const done = new Promise<void>((r) => { handle = setTimeout(r, Math.max(0, ms)); });
        return { done, cancel: () => clearTimeout(handle) };
    });
    /**
     * The call's value if it settles within `ms` by the SAME clock (`now`); otherwise not done. The absolute per-call deadline is
     * checked when accepting the result, so a timer callback that runs late cannot let a late settlement through. Boundary: a
     * result observed at exactly `due` is in time; one observed after `due` is late. Late results are ignored, not aborted.
     */
    const bounded = async <T,>(call: () => Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> => {
        const due = now() + Math.max(0, ms);
        const t = timer(ms);
        const work = call().then((value) => ({ done: true as const, value }));
        try {
            const r = await Promise.race([work, t.done.then(() => ({ done: false as const }))]);
            if (!r.done) { work.catch(() => undefined); return r; }
            return now() <= due ? r : { done: false };
        } finally { t.cancel(); }
    };
    const readOnce = (ms: number) => bounded(() => deps.readSaved().catch((): SavedRead => ({ ok: false })), ms);
    const startedAt = now();
    const deadline = startedAt + waitMs;
    const probe = async (anchor: { createdAt: string; id: string }): Promise<number | null | undefined> => {
        if (!deps.newerCompleted) return undefined;
        const r = await bounded(() => deps.newerCompleted!(anchor).catch(() => null), PROBE_MS);
        return r.done && Number.isInteger(r.value) && (r.value as number) >= 0 ? r.value : null;
    };
    const newer: Record<string, number | null> = {};
    const record = (key: string, n: number | null | undefined) => { if (n !== undefined) newer[key] = n; };
    const hold = (reason: string, detail: string) => sink.row(LATE_COACHING_ROW, 'HOLD', detail, { reason, ...newer });
    const fail = (reason: string, detail: string) => sink.row(LATE_COACHING_ROW, 'FAIL', detail, { reason, ...newer });
    /** One classified observation, or the terminal row it decided (true = a row was written). */
    const observe = (read: SavedRead): TargetClass | true => {
        if (!read.ok) { hold('owner-read-failed', 'the interrupted take\'s own session could not be read as its owner'); return true; }
        const c = classifyTarget(read.row, { sessionId, uid: deps.expectedUid });
        if (c.kind === 'identity-contradiction') { fail('identity-contradiction', 'the owner read returned a row that is not the interrupted take of this account'); return true; }
        if (c.kind !== 'available') { const [reason, detail] = TARGET_HOLD[c.kind]; hold(reason, detail); return true; }
        if (c.coaching.state === 'malformed') { fail('malformed', 'the interrupted take\'s session holds a malformed coaching value'); return true; }
        return c;
    };
    let saved: { well: string; next: string; transcriptDigest: string } | null = null;
    let anchor: { createdAt: string; id: string } | null = null;
    // Polling: every read is bounded by the remaining allowance, so none completes after the bound.
    while (deadline - now() > 0) {
        const r = await readOnce(Math.min(READ_MS, deadline - now()));
        // The polling deadline is re-checked before anything is accepted as observed in-window (boundary: at `deadline` is in).
        if (r.done && now() <= deadline) {
            const c = observe(r.value);
            if (c === true) return;
            if (c.kind === 'available') {
                if (!anchor) { anchor = { createdAt: c.createdAt, id: c.id }; record('newerCompletedFirst', await probe(anchor)); }
                if (c.coaching.state === 'pair') { saved = { well: c.coaching.well, next: c.coaching.next, transcriptDigest: c.transcriptDigest }; break; }
            }
        }
        const left = deadline - now();
        if (left > 0) await sleep(Math.min(pollMs, left));
    }
    if (!saved) {
        // The ONE fresh, bounded observation at the bound decides; nothing older can.
        const r = await readOnce(FINAL_READ_MS);
        if (!r.done) { hold('final-read-unavailable', 'no fresh observation of the interrupted take could be made at the bound'); return; }
        const c = observe(r.value);
        if (c === true) return;
        if (c.kind !== 'available') return;
        if (!anchor) anchor = { createdAt: c.createdAt, id: c.id };
        record('newerCompletedFinal', await probe(anchor));
        if (c.coaching.state === 'pair') { hold('pair-after-bound', 'the interrupted take\'s coaching was first observed only after the bound'); return; }
        fail('not-saved', `no coaching was saved to the interrupted take within ${Math.round(waitMs / 1000)} s while its transcript was still retained`);
        return;
    }
    if (anchor) record('newerCompletedFinal', await probe(anchor));
    sink.forbid(saved.well, saved.next);
    { const inner2 = sink; sink = { forbid: (...v) => inner2.forbid(...v), row: (st, vd, dt, ev) => inner2.row(st, vd, dt, { ...ev, ...newer }) }; }
    let reopened: ReopenedReview;
    try {
        reopened = await deps.openSavedReview();
    } catch {
        sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take\'s saved review could not be opened', { reason: 'review-unopened' });
        return;
    }
    if (reopened.pair) sink.forbid(reopened.pair.what_worked, reopened.pair.what_to_try_next);
    // The saved session's detail lives at /analytics/<id>, which the app may present as /progress/<id> (review on 9f5f8711).
    const path = reopened.pathname.replace(/\/$/, '');
    if (path !== `/analytics/${sessionId}` && path !== `/progress/${sessionId}`) {
        sink.row(LATE_COACHING_ROW, 'FAIL', 'reopening the interrupted take\'s review landed on another route', { reason: 'wrong-route' });
        return;
    }
    // Positive identity (review RETURN on 7a4d8f4e): the card names the session its review was read from.
    if (reopened.renderedSessionId === null) {
        sink.row(LATE_COACHING_ROW, 'HOLD', 'the reopened saved review names no session, so whose review it shows is unproven', { reason: 'identity-unread' });
        return;
    }
    if (reopened.renderedSessionId !== sessionId) {
        sink.row(LATE_COACHING_ROW, 'FAIL', 'the reopened saved review is another session\'s', { reason: 'wrong-session-rendered' });
        return;
    }
    // Content verification (not identity): the rendered transcript is the take's saved transcript.
    if (reopened.transcriptDigest === null) {
        sink.row(LATE_COACHING_ROW, 'HOLD', 'the reopened review rendered no session transcript to verify', { reason: 'transcript-unread' });
        return;
    }
    if (reopened.transcriptDigest !== saved.transcriptDigest) {
        sink.row(LATE_COACHING_ROW, 'FAIL', 'the reopened review shows a transcript other than the take\'s saved one', { reason: 'transcript-differs' });
        return;
    }
    if (reopened.coachingRequests !== 0) {
        sink.row(LATE_COACHING_ROW, 'FAIL', 'reopening the saved review sent a coaching request', { reason: 'reopen-requested-coaching', coachingRequests: reopened.coachingRequests });
        return;
    }
    if (!reopened.pair) {
        sink.row(LATE_COACHING_ROW, 'FAIL', 'the interrupted take\'s saved review does not show its saved coaching', { reason: 'not-shown' });
        return;
    }
    const equal = deps.same(reopened.pair.what_worked, saved.well) && deps.same(reopened.pair.what_to_try_next, saved.next);
    if (equal) {
        // Post-reopen binding: one more atomic read of A — the same take, still retained, the same saved pair.
        const again = await readOnce(POST_REOPEN_READ_MS);
        if (!again.done || !again.value.ok) { sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take could not be re-read after the reopen', { reason: 'owner-read-failed-after-reopen' }); return; }
        const c = classifyTarget(again.value.row, { sessionId, uid: deps.expectedUid });
        if (anchor) record('newerCompletedAfterReopen', await probe(anchor));
        if (c.kind === 'identity-contradiction') { sink.row(LATE_COACHING_ROW, 'FAIL', 'the owner re-read returned a row that is not the interrupted take of this account', { reason: 'identity-contradiction' }); return; }
        if (c.kind !== 'available') { sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take left its retained state during the reopen', { reason: 'window-changed' }); return; }
        if (c.coaching.state !== 'pair' || c.coaching.well !== saved.well || c.coaching.next !== saved.next || c.transcriptDigest !== saved.transcriptDigest) {
            sink.row(LATE_COACHING_ROW, 'FAIL', 'the interrupted take\'s saved coaching or transcript changed during the reopen', { reason: 'pair-changed' });
            return;
        }
    }
    sink.row(LATE_COACHING_ROW, equal ? 'PASS' : 'FAIL',
        equal ? 'the interrupted take\'s coaching is saved to its own session and its reopened saved review (its own route and session) shows exactly that pair'
            : 'the interrupted take\'s saved review shows coaching that differs from its saved pair',
        { reason: equal ? 'saved-and-shown' : 'shown-differs' });
}

/** The access token in the page's Supabase auth storage, or null. Never logged or returned to a receipt. */
export function accessTokenFromAuthStorage(entries: ReadonlyArray<{ key: string; value: string }>): string | null {
    for (const { key, value } of entries) {
        if (!/^sb-.*-auth-token$/.test(key)) continue;
        try {
            const p = JSON.parse(value) as { access_token?: unknown; currentSession?: { access_token?: unknown } };
            const token = p?.access_token ?? p?.currentSession?.access_token;
            if (typeof token === 'string' && token.split('.').length === 3) return token;
        } catch { /* not this entry */ }
    }
    return null;
}

/** The `sub` claim of a JWT, or null. Used only to verify the token belongs to the expected account. */
export function tokenSubject(token: string): string | null {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { sub?: unknown };
        return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
        return null;
    }
}

type OwnerOpts = { url: string; anonKey: string; expectedUid: string; fetch?: typeof fetch };
/** The signed-in owner's own client (page token verified to be `expectedUid` + public anon key), or null. Never admin. */
async function ownerClient(page: Pick<Page, 'evaluate'>, o: OwnerOpts) {
    if (!o.url || !o.anonKey) return null;
    const token = accessTokenFromAuthStorage(await page.evaluate(
        () => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
    ));
    if (!token || tokenSubject(token) !== o.expectedUid) return null;
    return createClient(o.url, o.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` }, ...(o.fetch ? { fetch: o.fetch } : {}) },
    });
}

/**
 * readSaved as the SIGNED-IN OWNER: one single-row read of `sessionId` (an atomic snapshot of that row). A missing token/key,
 * an error or no row is unreadable (HOLD); a returned row is handed to `classifyTarget`, which FAILs a row of another id/owner.
 */
export function ownerSessionReader(page: Pick<Page, 'evaluate'>, o: OwnerOpts & { sessionId: string }): () => Promise<SavedRead> {
    return async () => {
        const owner = await ownerClient(page, o);
        if (!owner) return { ok: false };
        const { data, error } = await owner.from('sessions')
            .select('id, user_id, status, transcript_state, transcript, created_at, ai_suggestions').eq('id', o.sessionId).maybeSingle();
        if (error || !data) return { ok: false };
        const r = data as Partial<TargetRow>;
        return { ok: true, row: { id: r.id, user_id: r.user_id, status: r.status, transcript_state: r.transcript_state, transcript: r.transcript, created_at: r.created_at, ai_suggestions: r.ai_suggestions ?? null } };
    };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * REPORTED ONLY: an exact count (no pagination, so no partial page can become 0) of this owner's completed sessions with a
 * transcript, ranked above A by (created_at, id): `created_at > A` or (`created_at = A` and `id > A`), the order
 * `transcript_sessions_to_expire` ranks by. An upper bound: a whitespace-only transcript is counted here though SQL would not
 * rank it. Any failure, or an anchor that is not a parseable timestamp and UUID, is null — never 0.
 */
export function ownerNewerCompletedCounter(page: Pick<Page, 'evaluate'>, o: OwnerOpts): (anchor: { createdAt: string; id: string }) => Promise<number | null> {
    return async (anchor) => {
        if (!Number.isFinite(Date.parse(anchor.createdAt)) || !UUID.test(anchor.id) || /["\\,()]/.test(anchor.createdAt)) return null;
        const owner = await ownerClient(page, o);
        if (!owner) return null;
        const ts = `"${anchor.createdAt}"`;
        const { count, error } = await owner.from('sessions').select('id', { count: 'exact', head: true })
            .eq('user_id', o.expectedUid).eq('status', 'completed').not('transcript', 'is', null)
            .or(`created_at.gt.${ts},and(created_at.eq.${ts},id.gt.${anchor.id})`);
        return !error && Number.isInteger(count) && (count as number) >= 0 ? count as number : null;
    };
}
