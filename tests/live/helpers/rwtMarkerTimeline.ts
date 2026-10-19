import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

export type MarkerStatus = 'pending' | 'partial' | 'covered' | 'missing';
export interface MarkerTimelineChange {
    point: number;
    from: MarkerStatus;
    to: MarkerStatus;
    /** Bounds relative to arming, on performance.now(). Callback time is not exact mutation time. */
    earliestMs: number;
    observedMs: number;
}
export interface RenderedTranscriptObservation {
    earliestMs: number;
    observedMs: number;
    visibleCharacters: number;
    interimCharacters: number;
    /** The DOM does not identify authoritative committed text for all token types. */
    committedCharacters: null;
}
export interface MarkerTimeline {
    token: string;
    armedWallMs: number;
    durationMs: number;
    initialStatuses: Array<MarkerStatus | null>;
    changes: MarkerTimelineChange[];
    rendered: RenderedTranscriptObservation[];
    /** Existing microphone instrumentation timestamps REQUESTS, not proven audio onset. */
    acquisitionRequestWallMs: number[];
    audioOnsetVerified: false;
    observationFailures: string[];
}

interface TimelineState {
    token: string;
    finish(): MarkerTimeline;
}
type TimelineWindow = Window & { __rwtMarkerTimeline__?: TimelineState; __rwtMicAcquisitions__?: number[] };

/** Self-contained: Playwright serializes this function into the page. It changes no product behavior. */
export function armMarkerTimelineInPage(config: { token: string; points: number }): void {
    const w = window as TimelineWindow;
    if (w.__rwtMarkerTimeline__) throw new Error('marker timeline already armed');
    if (!config.token || !Number.isInteger(config.points) || config.points < 1 || config.points > 100) {
        throw new Error('invalid marker timeline configuration');
    }
    const rail = document.querySelector('[data-testid="focus-points-rail"]');
    if (!rail) throw new Error('cannot arm marker timeline without the Focus rail');
    const startMono = performance.now();
    const startWall = Date.now();
    const failures = new Set<string>();
    const changes: MarkerTimelineChange[] = [];
    const rendered: RenderedTranscriptObservation[] = [];
    const statuses = new Set(['pending', 'partial', 'covered', 'missing']);
    const rows = Array.from({ length: config.points }, (_, i) => rail.querySelector(`[data-testid="focus-point-${i}"]`));
    const initialStatuses = rows.map((row) => {
        const value = row?.getAttribute('data-status') ?? null;
        return statuses.has(value ?? '') ? value as MarkerStatus : null;
    });
    if (initialStatuses.some((status) => status !== 'pending')) failures.add('rail_not_neutral_at_arm');
    if (document.querySelector('[data-testid="recorder-stop"]')) failures.add('armed_after_recording_started');
    const lastConfirmed = initialStatuses.map(() => 0);
    const currentStatuses = initialStatuses.slice();
    const microphoneMarks = w.__rwtMicAcquisitions__;
    const initialAcquisitions = Array.isArray(microphoneMarks) ? microphoneMarks.slice() : null;
    if (!initialAcquisitions) failures.add('microphone_observer_unavailable');
    let transcriptConfirmedAt = 0;
    let finished = false;
    let cached: MarkerTimeline | null = null;
    let recordCount = 0;
    const now = (): number => {
        const elapsed = performance.now() - startMono;
        if (Math.abs(Date.now() - startWall - elapsed) > 50) failures.add('wall_clock_changed');
        return elapsed;
    };
    const transcriptStats = () => {
        const root = document.querySelector('[data-testid="live-transcript"]');
        return {
            visibleCharacters: root?.textContent?.length ?? 0,
            interimCharacters: Array.from(root?.querySelectorAll('[data-testid="live-interim"]') ?? [])
                .reduce((sum, element) => sum + (element.textContent?.length ?? 0), 0),
            committedCharacters: null,
        };
    };
    const collect = (records: MutationRecord[]): void => {
        if (finished) return;
        const at = now();
        if (!rail.isConnected || document.querySelector('[data-testid="focus-points-rail"]') !== rail) {
            failures.add('rail_replaced_or_removed');
        }
        if (document.querySelectorAll('[data-testid="focus-points-rail"]').length !== 1) failures.add('rail_identity_ambiguous');
        let transcriptChanged = false;
        for (let i = 0; i < records.length; i += 1) {
            const record = records[i];
            // Bound memory even for a broken/repeatedly mutating page; truncation must never qualify.
            recordCount += 1;
            if (recordCount > 20_000) { failures.add('observation_limit_exceeded'); break; }
            if (record.type === 'attributes' && record.attributeName === 'data-status') {
                const point = rows.indexOf(record.target as Element);
                if (point >= 0) {
                    const later = records.slice(i + 1).find((r) => r.target === record.target && r.attributeName === 'data-status');
                    const next = later ? later.oldValue : (record.target as Element).getAttribute('data-status');
                    if (!statuses.has(record.oldValue ?? '') || !statuses.has(next ?? '')) {
                        failures.add('marker_status_unreadable');
                    } else if (record.oldValue !== next) {
                        if (currentStatuses[point] !== record.oldValue) failures.add('marker_transition_gap');
                        changes.push({ point, from: record.oldValue as MarkerStatus, to: next as MarkerStatus,
                            earliestMs: lastConfirmed[point], observedMs: at });
                        currentStatuses[point] = next as MarkerStatus;
                    }
                }
            }
            const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : record.target.parentElement;
            if (element?.closest('[data-testid="live-transcript"]')
                || (record.type === 'childList' && Array.from(record.addedNodes).some((node) => node.nodeType === Node.ELEMENT_NODE
                    && ((node as Element).matches('[data-testid="live-transcript"]')
                        || (node as Element).querySelector('[data-testid="live-transcript"]'))))) transcriptChanged = true;
        }
        if (transcriptChanged && rendered.length < 20_000) {
            rendered.push({ earliestMs: transcriptConfirmedAt, observedMs: at, ...transcriptStats() });
        }
        rows.forEach((row, point) => {
            if (!row?.isConnected || rail.querySelector(`[data-testid="focus-point-${point}"]`) !== row) failures.add('point_replaced_or_removed');
            if (rail.querySelectorAll(`[data-testid="focus-point-${point}"]`).length !== 1) failures.add('point_identity_ambiguous');
            if (row?.getAttribute('data-status') !== currentStatuses[point]) failures.add('marker_transition_gap');
            lastConfirmed[point] = at;
        });
        transcriptConfirmedAt = at;
    };
    const observer = new MutationObserver(collect);
    observer.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['data-status', 'data-testid'], attributeOldValue: true,
    });
    // Advance lower bounds only after synchronously draining pending mutations. A stalled event loop
    // therefore widens intervals instead of making a late callback an exact publication timestamp.
    const heartbeat = setInterval(() => collect(observer.takeRecords()), 50);
    const lost = () => { failures.add('document_observation_lost'); };
    window.addEventListener('pagehide', lost);
    window.addEventListener('beforeunload', lost);
    w.__rwtMarkerTimeline__ = {
        token: config.token,
        finish: () => {
            if (cached) return cached;
            collect(observer.takeRecords());
            const durationMs = now();
            observer.disconnect();
            clearInterval(heartbeat);
            window.removeEventListener('pagehide', lost);
            window.removeEventListener('beforeunload', lost);
            finished = true;
            const finalMarks = w.__rwtMicAcquisitions__;
            let acquired: number[] = [];
            if (!initialAcquisitions || finalMarks !== microphoneMarks || !Array.isArray(finalMarks)
                || finalMarks.length < initialAcquisitions.length
                || initialAcquisitions.some((mark, i) => finalMarks[i] !== mark)) {
                failures.add('microphone_observation_lost');
            } else {
                acquired = finalMarks.slice(initialAcquisitions.length);
                if (acquired.some((mark) => !Number.isFinite(mark) || mark < startWall || mark > Date.now())) {
                    failures.add('acquisition_clock_invalid');
                }
                if (acquired.length !== 1) failures.add('take_acquisition_not_unique');
            }
            cached = { token: config.token, armedWallMs: startWall, durationMs, initialStatuses, changes, rendered,
                acquisitionRequestWallMs: acquired, audioOnsetVerified: false, observationFailures: [...failures] };
            return cached;
        },
    };
}

/** A same-URL replacement has no token in its realm; it cannot borrow the old document's evidence. */
export function closeMarkerTimelineInPage(token: string): MarkerTimeline | null {
    const w = window as TimelineWindow;
    const state = w.__rwtMarkerTimeline__;
    if (!state || state.token !== token) return null;
    const result = state.finish();
    delete w.__rwtMarkerTimeline__;
    return result;
}

export async function armMarkerTimeline(page: Page, points: number): Promise<string> {
    const token = randomUUID();
    await page.evaluate(armMarkerTimelineInPage, { token, points });
    return token;
}

export async function closeMarkerTimeline(page: Page, token: string): Promise<MarkerTimeline | null> {
    return page.evaluate(closeMarkerTimelineInPage, token).catch(() => null);
}
