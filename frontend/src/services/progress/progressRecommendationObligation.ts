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
 * ONE IMMUTABLE KEY PER GENERATION (PM 6156497917). Every write mints a fresh generation and stores it under its OWN key,
 * `ss_progress_recommendation_owed_v1|<owner>|<session>|<generation>`, which is written once and never rewritten.
 * localStorage has no compare-and-delete, so a read-check-remove of one shared key lets a late settlement delete a newer
 * generation another tab wrote in between. With a key per generation there is nothing to compare: a settlement removes
 * exactly the key it was started for, and a newer generation lives under a key no other settlement ever names. Several
 * generations for one take may coexist; each is settled on its own (the server's recommendation is unique per take, so
 * the second settlement is an idempotent readback).
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
const keyFor = (userId: string, sessionId: string, generation: string) =>
    `${RECOMMENDATION_OBLIGATION_PREFIX}${enc(userId)}|${enc(sessionId)}|${enc(generation)}`;

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

/** Write a NEW generation for this owner+session under its own key. `ok` only when readback returns exactly what was written. */
export function recordRecommendationObligation(
    userId: string,
    sessionId: string,
    nowIso: string,
): { ok: true; generation: string } | { ok: false } {
    if (typeof localStorage === 'undefined') return { ok: false };
    const generation = newGeneration();
    const key = keyFor(userId, sessionId, generation);
    const value = JSON.stringify({ userId, sessionId, generation, createdAtIso: nowIso } satisfies RecommendationObligation);
    try {
        localStorage.setItem(key, value);
        if (localStorage.getItem(key) !== value) return { ok: false };
        return { ok: true, generation };
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
            if (isObligation(parsed) && parsed.userId === userId && keyFor(parsed.userId, parsed.sessionId, parsed.generation) === k) entries.push(parsed);
            else logger.warn('[progress] malformed recommendation obligation skipped');
        }
        return { ok: true, entries };
    } catch (err) {
        logger.warn({ err }, '[progress] recommendation obligations unreadable');
        return { ok: false };
    }
}

/**
 * Retire exactly the generation the caller settled: its own immutable key, and nothing else. A newer generation for the
 * same take is a different key and cannot be touched. `true` only when that key is confirmed absent afterwards.
 */
export function clearRecommendationObligationIfMatches(userId: string, sessionId: string, generation: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    const key = keyFor(userId, sessionId, generation);
    try {
        localStorage.removeItem(key);
        return localStorage.getItem(key) === null;
    } catch (err) {
        logger.warn({ err }, '[progress] recommendation obligation could not be retired');
        return false;
    }
}
