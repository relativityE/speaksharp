// @vitest-environment node
/**
 * #1258 F3 — ROOT CAUSE (run 38104864048, PostHog readback 6108757201). PostHog batches events for ~3 s. After the detail
 * reload, the reloaded boot's positive control (emitted 02:23:23.362) and its Back-to-Dashboard route (24.215) were sent
 * only at 02:23:26.307/.310 — AFTER the PDF click (~24.9) and the feedback submit (~25.7). The action-time capture
 * therefore saw no current-boot control and refused both (`no_current_boot_control`), so `share_feedback` and
 * `session_pdf_export` had no RECEIVED binding although the product sent all three anchors in the right journey.
 *
 * This replays that timing deterministically: the PostHog flush is delivered only after the action begins.
 */
import { describe, expect, it } from 'vitest';
import { bindReadbackJourneys, bindingSequence } from '../live/helpers/rwtOracles';
import { AnalyticsTap } from '../live/helpers/rwtJourney';

const RELEASE = 'c'.repeat(40);
const RUN_ID = '38104864048';
const RUN_ATTEMPT = '1';
const ORIGIN = 'https://speaksharp.example';
const BOOT = '8f99a3e0-de77-42d4-b6b0-11a96a357bca';
const JOURNEY = 'ccf00555-1644-44c6-ac66-4d22755ddf77';
const ev = (event: string, extra: Record<string, unknown> = {}) => ({
    event, at: Date.now(), journeyId: JOURNEY, bootId: BOOT, releaseSha: RELEASE, trafficType: 'canary', ...extra,
});

/** A tap on the reloaded Analytics document whose first PostHog flush is still queued in the page. */
function reloadedTapBeforeFirstFlush(): AnalyticsTap {
    const tap = new AnalyticsTap();
    tap.noteDocument(`${ORIGIN}/analytics/s-1`, Date.now() - 2_000);
    return tap;
}
/** The flush PostHog sends ~3 s after the reload: the control and the route arrive together, then the anchors. */
const deliverFlush = (tap: AnalyticsTap) => {
    tap.events.push(ev('telemetry_positive_control'));
    tap.events.push(ev('journey_step', { journeyStep: 'route_change', toRoute: '/analytics' }));
    tap.notePosthogRequest();
};

describe('#1258 F3 — PostHog batching vs action-time capture (run 1 replay)', () => {
    it('REPRODUCES run 1: an immediate capture before the first flush is refused (no_current_boot_control)', () => {
        const tap = reloadedTapBeforeFirstFlush();
        expect(tap.captureActionBinding('session_pdf_export', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics`)).toBeNull();
        expect(tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics`)).toBeNull();
        deliverFlush(tap);
        tap.events.push(ev('session_pdf_downloaded'), ev('feedback_submit'));
        const result = bindReadbackJourneys(tap.events, {
            recording: [], feedback: true, pdfExport: true, actionBindings: tap.actionBindings, actionCaptures: tap.actionCaptures,
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result.missingBindings).toEqual(['share_feedback', 'session_pdf_export']);
        expect(result.bindingReasons).toEqual({
            share_feedback: 'no_capture/no_current_boot_control', session_pdf_export: 'no_capture/no_current_boot_control',
        });
    });

    it('FIX: the settled capture waits for the queued flush, then both actions bind to the reloaded journey', async () => {
        const tap = reloadedTapBeforeFirstFlush();
        let waited = 0;
        // The page: PostHog's queued flush lands ~3 s into the wait.
        const page = {
            url: () => `${ORIGIN}/analytics`,
            waitForTimeout: async (ms: number) => { waited += ms; if (waited >= 3_000 && tap.lastPosthogRequestAt === 0) deliverFlush(tap); },
        };
        const pdf = await tap.captureActionBindingSettled(page, 'session_pdf_export', RELEASE, RUN_ID, RUN_ATTEMPT);
        expect(pdf).toMatchObject({ journeyId: JOURNEY, bootId: BOOT, entry: 'route_change' });
        tap.events.push(ev('session_pdf_downloaded'));
        const feedback = await tap.captureActionBindingSettled(page, 'share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT);
        expect(feedback).toMatchObject({ journeyId: JOURNEY, bootId: BOOT });
        tap.events.push(ev('feedback_submit'));
        const result = bindReadbackJourneys(tap.events, {
            recording: [], feedback: true, pdfExport: true, actionBindings: tap.actionBindings, actionCaptures: tap.actionCaptures,
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result).toEqual({ journeys: [{ journeyId: JOURNEY, stages: ['share_feedback', 'session_pdf_export'] }], reportedJourneyIds: [], missingBindings: [] });
    });

    it('settles on the first EVENT flush after the action begins, with a grace for a sibling batch request', async () => {
        const tap = new AnalyticsTap();
        const waits: number[] = [];
        let clock = 1_000;
        const result = await tap.settleQueuedTelemetry(async (ms) => { waits.push(ms); clock += ms; if (clock >= 1_300) tap.notePosthogRequest(clock); }, { now: () => clock });
        expect(result).toBe('flushed');
        expect(waits.at(-1)).toBe(500);
    });

    it('with nothing queued (no flush comes), it proceeds after the quiet period instead of hanging', async () => {
        const tap = new AnalyticsTap();
        let clock = 0;
        const result = await tap.settleQueuedTelemetry(async (ms) => { clock += ms; }, { now: () => clock });
        expect(result).toBe('quiet');
        expect(clock).toBeGreaterThanOrEqual(5_000);
        expect(clock).toBeLessThan(5_200);
    });

    it('a flush that happened BEFORE the action began does not count (it cannot carry what was queued after it)', async () => {
        const tap = new AnalyticsTap();
        let clock = 10_000;
        tap.notePosthogRequest(9_000);
        expect(await tap.settleQueuedTelemetry(async (ms) => { clock += ms; }, { now: () => clock })).toBe('quiet');
    });
});

describe('#1258 F3 — content-free binding sequence in the receipt (PO 2026-10-11)', () => {
    it('orders events and capture attempts, relabels boots/journeys, and leaks no ids', () => {
        const events = [
            { event: 'telemetry_positive_control', at: 100, journeyId: 'j-aaaa', bootId: 'b-1111', trafficType: 'canary' },
            { event: 'journey_step', at: 200, journeyId: 'j-aaaa', bootId: 'b-1111', trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics/id' },
            { event: 'telemetry_positive_control', at: 3_400, journeyId: 'j-bbbb', bootId: 'b-2222', trafficType: 'canary' },
            { event: 'session_pdf_downloaded', at: 3_410, journeyId: 'j-bbbb', bootId: 'b-2222', trafficType: 'canary' },
            { event: 'telemetry_positive_control', at: 50, journeyId: 'j-pre', bootId: 'b-0000', trafficType: 'user' },
            { event: 'journey_step', at: 60, journeyId: 'j-pre', bootId: 'b-0000', trafficType: 'canary', journeyStep: 'click' },
        ];
        const sequence = bindingSequence(events, [{ stage: 'session_pdf_export', outcome: 'no_current_boot_control', at: 2_000 }]);
        expect(sequence).toBe([
            '+0 u:B1/J1 control',
            '+50 B2/J2 control',
            '+150 B2/J2 route>/analytics/id',
            '+1950 capture session_pdf_export=no_current_boot_control',
            '+3350 B3/J3 control',
            '+3360 B3/J3 pdf',
        ].join('; '));
        expect(sequence).not.toMatch(/j-|b-\d|@/);
    });

    it('a receipt with every binding present carries no sequence (valid runs stay unchanged)', () => {
        const result = bindReadbackJourneys([], { recording: [], feedback: false });
        expect(result).toEqual({ journeys: [], reportedJourneyIds: [], missingBindings: [] });
    });

    it('a missing binding carries the sequence beside its reason', () => {
        const result = bindReadbackJourneys([{ event: 'telemetry_positive_control', at: 5, journeyId: 'j', bootId: 'b', trafficType: 'canary', releaseSha: RELEASE }], {
            recording: [], feedback: true, actionBindings: [], actionCaptures: [{ stage: 'share_feedback', outcome: 'no_current_boot_control', at: 1 }],
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result.bindingReasons).toEqual({ share_feedback: 'no_capture/no_current_boot_control' });
        expect(result.bindingSequence).toBe('+0 capture share_feedback=no_current_boot_control; +4 B1/J1 control');
    });
});
