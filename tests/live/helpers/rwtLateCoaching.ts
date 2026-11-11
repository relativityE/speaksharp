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

export type SavedRead = { ok: true; value: unknown; transcriptDigest: string } | { ok: false };
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
    /** The interrupted take's own session row, read as the signed-in owner. `ok: false` = unreadable or not that row. */
    readSaved: () => Promise<SavedRead>;
    /** Reopen that take's saved review (Analytics detail) in a separate page. */
    openSavedReview: () => Promise<ReopenedReview>;
    same: (a: string, b: string) => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/** Provider budget (45 s) plus transport; the take's request started before the next take recorded. */
export const LATE_COACHING_WAIT_MS = 75_000;

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
    return answeredAt > successorRecordingAt ? 'answer-after-successor-recording' : 'answer-before-successor-recording';
}

/** When the browser received the take's last ANSWERED coaching exchange (epoch ms); null when none was answered. */
export function latestAnsweredAt(exchanges: ReadonlyArray<{ outcome?: string; at: number }>): number | null {
    const times = exchanges.filter((e) => e.outcome === 'answered' && Number.isFinite(e.at)).map((e) => e.at);
    return times.length ? Math.max(...times) : null;
}

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
    const startedAt = now();
    let saved: { well: string; next: string; transcriptDigest: string } | null = null;
    for (;;) {
        const read = await deps.readSaved().catch((): SavedRead => ({ ok: false }));
        if (!read.ok) {
            sink.row(LATE_COACHING_ROW, 'HOLD', 'the interrupted take\'s own session could not be read as its owner', { reason: 'owner-read-failed' });
            return;
        }
        const state = classifySavedCoaching(read.value);
        if (state.state === 'malformed') {
            sink.row(LATE_COACHING_ROW, 'FAIL', 'the interrupted take\'s session holds a malformed coaching value', { reason: 'malformed' });
            return;
        }
        if (state.state === 'pair') { saved = { well: state.well, next: state.next, transcriptDigest: read.transcriptDigest }; break; }
        if (now() - startedAt >= waitMs) {
            sink.row(LATE_COACHING_ROW, 'FAIL', `the interrupted take's coaching was not saved to its session within ${Math.round(waitMs / 1000)} s`,
                { reason: 'not-saved' });
            return;
        }
        await sleep(pollMs);
    }
    sink.forbid(saved.well, saved.next);
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

/**
 * readSaved as the SIGNED-IN OWNER: the page's own session token (verified to be `expectedUid`) with the public anon key, so
 * the read exercises the account's own row access. The row must be exactly `sessionId` of `expectedUid`; anything else, or a
 * missing token/key, is unreadable (HOLD), never a fallback to the admin client.
 */
export function ownerSessionReader(
    page: Pick<Page, 'evaluate'>,
    o: { url: string; anonKey: string; expectedUid: string; sessionId: string; fetch?: typeof fetch },
): () => Promise<SavedRead> {
    return async () => {
        if (!o.url || !o.anonKey) return { ok: false };
        const token = accessTokenFromAuthStorage(await page.evaluate(
            () => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
        ));
        if (!token || tokenSubject(token) !== o.expectedUid) return { ok: false };
        const owner = createClient(o.url, o.anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` }, ...(o.fetch ? { fetch: o.fetch } : {}) },
        });
        const { data, error } = await owner.from('sessions').select('id, user_id, transcript, ai_suggestions').eq('id', o.sessionId).maybeSingle();
        const row = data as { id?: unknown; user_id?: unknown; transcript?: unknown; ai_suggestions?: unknown } | null;
        if (error || !row || row.id !== o.sessionId || row.user_id !== o.expectedUid) return { ok: false };
        return { ok: true, value: row.ai_suggestions ?? null, transcriptDigest: sha256Hex(row.transcript) };
    };
}
