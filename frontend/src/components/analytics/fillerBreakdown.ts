/**
 * #1258 D6 — the Progress filler-count model: COUNTS for the two newest measured sessions, never per-minute rates.
 *
 * Measured vs not measured (#1472): only OBSERVED filler evidence is measured. An empty `{}` over saved words is
 * unobservable, and absent/null/invalid is unavailable; both are skipped (never shown as 0, never picked as latest/previous). The headline is `getSessionAnalysisMetrics(...)
 * .fillerCount` — the counting tier the session page shows (PO 2026-10-07 "true fillers only"; discourse markers only
 * when the reader opted in) — and the rows come from `countedFillerMap` with the same options, so the table always
 * adds up to the headline.
 */
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import { countedFillerMap } from '@/utils/fillerTiers';
import logger from '@/lib/logger';
import type { PracticeSession } from '@/types/session';

/** The 13 approved persisted keys (`contracts/fillerCounts.ts`). Every key has an explicit label; an unknown key is not rendered. */
export const FILLER_LABEL: Readonly<Record<string, string>> = {
    um: 'Um', uh: 'Uh', ah: 'Ah', oh: 'Oh', like: 'Like', so: 'So',
    actually: 'Actually', basically: 'Basically', literally: 'Literally',
    you_know: 'You know', i_mean: 'I mean', kind_of: 'Kind of', sort_of: 'Sort of',
};

let loggedUnknownKey = false;
const human = (key: string): string | null => {
    const label = FILLER_LABEL[key] ?? null;
    if (label === null && !loggedUnknownKey) {
        loggedUnknownKey = true;
        logger.warn('[FillerWordsBreakdown] dropped a filler key with no label'); // never echo the key
    }
    return label;
};

interface MeasuredSession { id: string; createdAt: string; count: number; perWord: Record<string, number> }
export interface FillerBreakdownRow { key: string; label: string; latest: number; previous: number }
export interface FillerBreakdownModel { latest: MeasuredSession | null; previous: MeasuredSession | null; rows: FillerBreakdownRow[] }

/** `sessions` newest first. */
export function fillerBreakdownModel(
    sessions: PracticeSession[],
    { includeDiscourseMarkers = false }: { includeDiscourseMarkers?: boolean } = {},
): FillerBreakdownModel {
    const measured: MeasuredSession[] = [];
    for (const session of sessions) {
        if (measured.length === 2) break;
        const metrics = getSessionAnalysisMetrics(session, { includeDiscourseMarkers });
        if (metrics.fillerCount === null || metrics.fillerData === null) continue;
        const counted = countedFillerMap(metrics.fillerData, { includeDiscourseMarkers }) ?? {};
        const perWord: Record<string, number> = {};
        for (const [key, value] of Object.entries(counted)) perWord[key] = (value as { count: number }).count;
        measured.push({ id: session.id, createdAt: session.created_at, count: metrics.fillerCount, perWord });
    }
    const [latest = null, previous = null] = measured;
    const keys = new Set([...Object.keys(latest?.perWord ?? {}), ...Object.keys(previous?.perWord ?? {})]);
    const rows: FillerBreakdownRow[] = [];
    for (const key of keys) {
        const label = human(key);
        // Both sessions were measured, so a key missing from one map is a real 0 for that session.
        const row = { key, label: label ?? '', latest: latest?.perWord[key] ?? 0, previous: previous?.perWord[key] ?? 0 };
        if (label !== null && (row.latest > 0 || row.previous > 0)) rows.push(row);
    }
    rows.sort((a, b) => b.latest - a.latest || b.previous - a.previous);
    return { latest, previous, rows };
}

/** The collapsed Trends row's value. Empty when no session has measured fillers yet. */
export function fillerSummary({ latest }: FillerBreakdownModel): string {
    if (!latest) return '';
    return latest.count > 0 ? `${latest.count} in your latest session` : 'No filler words detected';
}
