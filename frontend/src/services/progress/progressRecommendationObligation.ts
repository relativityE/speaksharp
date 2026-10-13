/**
 * #1258 RH-13 (PM 6155702425) — the recommendation a durable evaluation still owes, as its OWN durable obligation.
 *
 * A successful save unlocks Start on durable evaluation alone; the recommendation is created afterwards. Between the two
 * the only record that it is still owed lives here, so a closed tab, a crash or a navigation cannot lose it: the next
 * authenticated load finishes it (`reconcileProgressEvaluations`).
 *
 * WHY NOT THE RECONCILE QUEUE. Shipped clients own that queue: their load round clears and tombstones its entries BEFORE
 * dispatching the recommendation, and their merge rebuilds an entry from the fields they know, dropping any new one. A
 * marker on a queue entry can therefore be retired by an older tab that never created the recommendation. This
 * namespace (`ss_progress_recommendation_owed_v1|<owner>|<session>`) is one no shipped client enumerates, rewrites or
 * removes — and it never blocks Start, so an older client's gate is unaffected by it as well.
 *
 * GENERATIONS. Every write carries a fresh generation. A late result may retire only the generation it was started for,
 * so it can never retire a newer obligation for the same owner+session.
 *
 * Every write is confirmed by readback; a write that cannot be confirmed is reported, never assumed.
 */
import logger from '@/lib/logger';

export const RECOMMENDATION_OBLIGATION_PREFIX = 'ss_progress_recommendation_owed_v1|';

export interface RecommendationObligation {
    userId: string;
    sessionId: string;
    generation: string;
    createdAtIso: string;
}

const enc = (s: string) => encodeURIComponent(s);
const keyFor = (userId: string, sessionId: string) => `${RECOMMENDATION_OBLIGATION_PREFIX}${enc(userId)}|${enc(sessionId)}`;

const isObligation = (v: unknown): v is RecommendationObligation =>
    !!v && typeof v === 'object'
    && typeof (v as RecommendationObligation).userId === 'string' && (v as RecommendationObligation).userId !== ''
    && typeof (v as RecommendationObligation).sessionId === 'string' && (v as RecommendationObligation).sessionId !== ''
    && typeof (v as RecommendationObligation).generation === 'string' && (v as RecommendationObligation).generation !== ''
    && typeof (v as RecommendationObligation).createdAtIso === 'string';

function newGeneration(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return typeof c?.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Write (or supersede) the obligation for this owner+session. `ok` only when readback returns exactly what was written. */
export function recordRecommendationObligation(
    userId: string,
    sessionId: string,
    nowIso: string,
): { ok: true; generation: string } | { ok: false } {
    if (typeof localStorage === 'undefined') return { ok: false };
    const value = JSON.stringify({ userId, sessionId, generation: newGeneration(), createdAtIso: nowIso } satisfies RecommendationObligation);
    try {
        localStorage.setItem(keyFor(userId, sessionId), value);
        if (localStorage.getItem(keyFor(userId, sessionId)) !== value) return { ok: false };
        return { ok: true, generation: (JSON.parse(value) as RecommendationObligation).generation };
    } catch (err) {
        logger.warn({ err }, '[progress] recommendation obligation could not be written');
        return { ok: false };
    }
}

/** This owner's obligations. An unreadable store is `ok: false`, never an empty list. Malformed values are skipped. */
export function listRecommendationObligations(userId: string): { ok: true; entries: RecommendationObligation[] } | { ok: false } {
    if (typeof localStorage === 'undefined') return { ok: false };
    try {
        const prefix = `${RECOMMENDATION_OBLIGATION_PREFIX}${enc(userId)}|`;
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k !== null && k.startsWith(prefix)) keys.push(k);
        }
        const entries: RecommendationObligation[] = [];
        for (const k of keys) {
            const raw = localStorage.getItem(k);
            if (raw === null) continue;
            let parsed: unknown;
            try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
            if (isObligation(parsed) && parsed.userId === userId && keyFor(parsed.userId, parsed.sessionId) === k) entries.push(parsed);
            else logger.warn('[progress] malformed recommendation obligation skipped');
        }
        return { ok: true, entries };
    } catch (err) {
        logger.warn({ err }, '[progress] recommendation obligations unreadable');
        return { ok: false };
    }
}

/**
 * Retire the obligation ONLY if it is still the generation the caller settled. A newer generation, or one already
 * gone, is left alone. `true` only when the matching obligation is confirmed absent afterwards.
 */
export function clearRecommendationObligationIfMatches(userId: string, sessionId: string, generation: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    const key = keyFor(userId, sessionId);
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return true;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
        if (!isObligation(parsed) || parsed.generation !== generation) return false;
        localStorage.removeItem(key);
        return localStorage.getItem(key) === null;
    } catch (err) {
        logger.warn({ err }, '[progress] recommendation obligation could not be retired');
        return false;
    }
}
