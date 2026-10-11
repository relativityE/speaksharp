// @vitest-environment node
/**
 * #1258 F3 (RWT run 38104864048): `readback journey binding` HOLD listed `share_feedback` and `session_pdf_export` as
 * missing although both actions succeeded in the UI, and the receipt could not say why — capture refusals and oracle
 * rejections all collapsed to `null`. Every miss now carries one closed, content-free reason: the capture's own refusal
 * (`no_capture/<outcome>`) or the oracle check that failed. Valid bindings are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { bindReadbackJourneys } from '../live/helpers/rwtOracles';
import { AnalyticsTap } from '../live/helpers/rwtJourney';
import type { ReadbackActionBinding, ReadbackActionStage } from '../live/helpers/rwtAcceptance';

const RELEASE = 'a'.repeat(40);
const RUN_ID = '38104864048';
const RUN_ATTEMPT = '1';
const ORIGIN = 'https://speaksharp.example';
const control = { event: 'telemetry_positive_control', at: 6, journeyId: 'journey-reloaded', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary' };
const backToList = { event: 'journey_step', at: 7, journeyId: 'journey-reloaded', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics' };
const action = (stage: ReadbackActionStage, overrides: Partial<ReadbackActionBinding> = {}): ReadbackActionBinding => ({
    stage, journeyId: 'journey-reloaded', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary',
    runId: RUN_ID, runAttempt: RUN_ATTEMPT, entry: 'route_change', capturedAt: 10, ...overrides,
});
const plan = (events: readonly object[], extra: Record<string, unknown>) => bindReadbackJourneys(events as never, {
    recording: [], feedback: true, pdfExport: true,
    expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT, ...extra,
});
/** The run-1 order: detail reload (boot 2, Analytics), Back to Dashboard (route), PDF, then feedback on the list. */
const reloadedTap = (events: readonly object[]) => {
    const tap = new AnalyticsTap();
    tap.noteDocument(`${ORIGIN}/analytics/s-1`, 5);
    tap.events.push(...(events as never[]));
    return tap;
};

describe('#1258 F3 — every missing readback binding says why (closed, content-free)', () => {
    it('valid feedback and PDF captures still bind, with no reasons emitted', () => {
        const tap = reloadedTap([control, backToList]);
        tap.captureActionBinding('session_pdf_export', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics`);
        tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics`);
        expect(tap.actionCaptures).toEqual([
            { stage: 'session_pdf_export', outcome: 'captured' }, { stage: 'share_feedback', outcome: 'captured' },
        ]);
        const result = plan(tap.events, { actionBindings: tap.actionBindings, actionCaptures: tap.actionCaptures });
        expect(result).toEqual({
            journeys: [{ journeyId: 'journey-reloaded', stages: ['share_feedback', 'session_pdf_export'] }],
            reportedJourneyIds: [], missingBindings: [],
        });
    });

    it.each([
        ['the reloaded boot\'s positive control was not yet sent', [], `${ORIGIN}/analytics`, 'no_current_boot_control'],
        ['the action ran off Analytics', [control, backToList], `${ORIGIN}/session`, 'not_analytics_page'],
        ['the boot\'s latest route left Analytics', [control, { ...backToList, toRoute: '/session' }], `${ORIGIN}/analytics`, 'route_not_analytics'],
    ])('a refused capture is reported as no_capture/<outcome>: %s', (_label, events, url, outcome) => {
        const tap = reloadedTap(events as object[]);
        expect(tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, url as string)).toBeNull();
        expect(tap.actionCaptures).toEqual([{ stage: 'share_feedback', outcome }]);
        const result = plan(tap.events, { pdfExport: false, actionBindings: tap.actionBindings, actionCaptures: tap.actionCaptures });
        expect(result.missingBindings).toEqual(['share_feedback']);
        expect(result.bindingReasons).toEqual({ share_feedback: `no_capture/${outcome}` });
    });

    it('wrong run, release or attempt identity is identity_mismatch (still fail-closed)', () => {
        for (const changed of [{ runId: '38104864047' }, { releaseSha: 'b'.repeat(40) }, { runAttempt: '2' }, { trafficType: 'user' }]) {
            const result = plan([control, backToList], { pdfExport: false, actionBindings: [action('share_feedback', changed)], actionCaptures: [] });
            expect(result.journeys).toEqual([]);
            expect(result.bindingReasons).toEqual({ share_feedback: 'identity_mismatch' });
        }
    });

    it('a stale boot is boot_not_latest; a moved route is route_not_latest; a foreign anchor is anchor_mismatch', () => {
        const newerBoot = { ...control, at: 8, bootId: 'boot-3', journeyId: 'journey-3' };
        expect(plan([control, backToList, newerBoot], { pdfExport: false, actionBindings: [action('share_feedback')] }).bindingReasons)
            .toEqual({ share_feedback: 'boot_not_latest' });
        const moved = { ...backToList, at: 8, journeyId: 'journey-moved' };
        expect(plan([control, backToList, moved], { pdfExport: false, actionBindings: [action('share_feedback')] }).bindingReasons)
            .toEqual({ share_feedback: 'route_not_latest' });
        const foreign = { event: 'feedback_submit', at: 11, journeyId: 'journey-x', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary' };
        expect(plan([control, backToList, foreign], { pdfExport: false, actionBindings: [action('share_feedback')] }).bindingReasons)
            .toEqual({ share_feedback: 'anchor_mismatch' });
    });

    it('no capture attempt at all is no_capture; two captures for one action are duplicate_capture', () => {
        expect(plan([control, backToList], { actionBindings: [action('share_feedback')], actionCaptures: [] }).bindingReasons)
            .toEqual({ session_pdf_export: 'no_capture' });
        expect(plan([control, backToList], { pdfExport: false, actionBindings: [action('share_feedback'), action('share_feedback')] }).bindingReasons)
            .toEqual({ share_feedback: 'duplicate_capture' });
    });

    it('Practice again never started: repeat recording stays absent (take_not_started), never borrowed', () => {
        const result = bindReadbackJourneys([control] as never, {
            recording: [], repeatRecording: ['session_during'], takes: { first: null, repeat: null }, feedback: false,
        });
        expect(result.journeys).toEqual([]);
        expect(result.missingBindings).toEqual(['repeat_recording']);
        expect(result.bindingReasons).toEqual({ repeat_recording: 'take_not_started' });
    });

    it('reasons are closed tokens: no ids, emails, routes or run numbers leak into them', () => {
        const tap = reloadedTap([]);
        tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics/s-1`);
        const result = plan(tap.events, { actionBindings: tap.actionBindings, actionCaptures: tap.actionCaptures });
        expect(JSON.stringify(result.bindingReasons)).not.toMatch(/journey-|boot-|s-1|38104864048|@|\/analytics/);
    });
});
