// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bindReadbackJourneys } from '../live/helpers/rwtOracles';
import { AnalyticsTap } from '../live/helpers/rwtJourney';
import type { ReadbackActionBinding, ReadbackActionStage } from '../live/helpers/rwtAcceptance';

const RELEASE = 'a'.repeat(40);
const RUN_ID = '37658306531';
const RUN_ATTEMPT = '2';
const ORIGIN = 'https://speaksharp.example';
const BASE = [
    { event: 'telemetry_positive_control', at: 1, journeyId: 'journey-pre-product', bootId: 'boot-current', releaseSha: RELEASE, trafficType: 'canary' },
    { event: 'journey_step', at: 2, journeyId: 'journey-current', bootId: 'boot-current', releaseSha: RELEASE, trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics/id' },
];
const action = (stage: ReadbackActionStage, overrides: Partial<ReadbackActionBinding> = {}): ReadbackActionBinding => ({
    stage, journeyId: 'journey-current', bootId: 'boot-current', releaseSha: RELEASE,
    trafficType: 'canary', runId: RUN_ID, runAttempt: RUN_ATTEMPT, entry: 'route_change', capturedAt: 10, ...overrides,
});
const plan = (actionBindings: readonly ReadbackActionBinding[]) => bindReadbackJourneys(BASE, {
    recording: [], feedback: true, pdfExport: true, actionBindings,
    expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
});

describe('#1570 P1 — action-time readback bindings survive blind anchor beacons', () => {
    it('binds both declared stages from their pre-action route snapshots when both anchor beacons are hidden', () => {
        const result = plan([action('share_feedback'), action('session_pdf_export')]);
        expect(result).toEqual({
            journeys: [{ journeyId: 'journey-current', stages: ['share_feedback', 'session_pdf_export'] }],
            reportedJourneyIds: ['journey-pre-product'], missingBindings: [],
        });
        expect(JSON.stringify(result)).not.toMatch(/boot-current|37658306531|session_id|transcript|email/i);
    });

    it('requires an independent binding even when an anchor happened to be decoded', () => {
        const events = [...BASE, { event: 'feedback_submit', at: 3, journeyId: 'journey-current', bootId: 'boot-current', releaseSha: RELEASE, trafficType: 'canary' }];
        const result = bindReadbackJourneys(events, {
            recording: [], feedback: true, actionBindings: [], expectedReleaseSha: RELEASE,
            expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result.journeys).toEqual([]);
        expect(result.missingBindings).toEqual(['share_feedback']);
    });

    it.each([
        ['wrong run', { runId: '37658306530' }],
        ['wrong boot', { bootId: 'boot-from-another-page' }],
        ['wrong release', { releaseSha: 'b'.repeat(40) }],
        ['wrong traffic class', { trafficType: 'user' }],
    ])('fails closed for %s action identity', (_label, changed) => {
        const result = bindReadbackJourneys(BASE, {
            recording: [], feedback: true, actionBindings: [action('share_feedback', changed)],
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result.journeys).toEqual([]);
        expect(result.missingBindings).toEqual(['share_feedback']);
    });

    it('rejects mixed action and decoded-anchor journeys instead of borrowing either identity', () => {
        const events = [...BASE, { event: 'feedback_submit', at: 3, journeyId: 'journey-other', bootId: 'boot-other', releaseSha: RELEASE, trafficType: 'canary' }];
        const result = bindReadbackJourneys(events, {
            recording: [], feedback: true, actionBindings: [action('share_feedback')],
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result.journeys).toEqual([]);
        expect(result.missingBindings).toEqual(['share_feedback']);
    });

    it('rejects duplicate bindings for one action and a route without a same-boot positive control', () => {
        expect(plan([action('share_feedback'), action('share_feedback'), action('session_pdf_export')]).missingBindings)
            .toEqual(['share_feedback']);
        const noBoot = [{ ...BASE[1], bootId: 'unobserved-boot' }];
        const result = bindReadbackJourneys(noBoot, {
            recording: [], feedback: true, actionBindings: [action('share_feedback')],
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });
        expect(result.missingBindings).toEqual(['share_feedback']);
    });

    it('accepts the boot-scoped positive control from the pre-product journey', () => {
        expect(plan([action('share_feedback'), action('session_pdf_export')]).missingBindings).toEqual([]);
    });

    it('does not accept a positive control from another boot or traffic class', () => {
        for (const control of [
            { ...BASE[0], bootId: 'boot-other' },
            { ...BASE[0], trafficType: 'user' },
        ]) {
            const result = bindReadbackJourneys([control, BASE[1]], {
                recording: [], feedback: true, actionBindings: [action('share_feedback')],
                expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
            });
            expect(result.missingBindings).toEqual(['share_feedback']);
        }
    });

    it('AnalyticsTap snapshots the last decoded Analytics route identity before the action anchor exists', () => {
        const tap = new AnalyticsTap();
        tap.events.push(...BASE);
        const captured = tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics/s-1`);
        expect(captured).toEqual(action('share_feedback', { capturedAt: expect.any(Number) }));
        expect(tap.actionBindings).toEqual([captured]);
        expect(tap.events.some((event) => event.event === 'feedback_submit')).toBe(false);
        expect(tap.captureActionBinding('session_pdf_export', 'b'.repeat(40), RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics`)).toBeNull();
        expect(tap.captureActionBinding('session_pdf_export', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/session`)).toBeNull();
        expect(tap.actionBindings).toHaveLength(1);
    });

    describe('Codex P1 r4212726964 — a hard reload binds the post-reload boot, never the pre-reload route', () => {
        // The Focus journey: Analytics detail reached by route_change (boot 1), hard reload (boot 2: its first render emits no
        // route_change), then Share Feedback. The Node tap still holds boot 1's route.
        const preReload = [
            { event: 'telemetry_positive_control', at: 1, journeyId: 'journey-home', bootId: 'boot-1', releaseSha: RELEASE, trafficType: 'canary' },
            { event: 'journey_step', at: 2, journeyId: 'journey-stale', bootId: 'boot-1', releaseSha: RELEASE, trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics/id' },
        ];
        const postReload = { event: 'telemetry_positive_control', at: 6, journeyId: 'journey-reloaded', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary' };
        const reloadedTap = (events: readonly (typeof preReload)[number][]) => {
            const tap = new AnalyticsTap();
            tap.events.push(...preReload);
            tap.noteDocument(`${ORIGIN}/analytics/s-1`, 5);
            tap.events.push(...events);
            return tap;
        };
        const bindFeedback = (events: readonly object[], bindings: readonly ReadbackActionBinding[]) => bindReadbackJourneys(events as never, {
            recording: [], feedback: true, actionBindings: bindings,
            expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
        });

        it('captures the reloaded boot and binds feedback to it when the feedback beacon is blind', () => {
            const tap = reloadedTap([postReload]);
            const captured = tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics/s-1`);
            expect(captured).toMatchObject({ journeyId: 'journey-reloaded', bootId: 'boot-2', entry: 'boot_load' });
            const result = bindFeedback(tap.events, tap.actionBindings);
            expect(result.journeys).toEqual([{ journeyId: 'journey-reloaded', stages: ['share_feedback'] }]);
            expect(result.missingBindings).toEqual([]);
        });

        it('binds the reloaded boot when its feedback_submit was decoded too (no anchor/binding mismatch)', () => {
            const tap = reloadedTap([postReload]);
            tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics/s-1`);
            const submit = { event: 'feedback_submit', at: 8, journeyId: 'journey-reloaded', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary' };
            const result = bindFeedback([...tap.events, submit], tap.actionBindings);
            expect(result.journeys).toEqual([{ journeyId: 'journey-reloaded', stages: ['share_feedback'] }]);
            expect(result.missingBindings).toEqual([]);
        });

        it('refuses to capture before the reloaded boot\'s positive control is seen (never falls back to boot 1)', () => {
            const tap = reloadedTap([]);
            expect(tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics/s-1`)).toBeNull();
            expect(tap.actionBindings).toEqual([]);
        });

        it('the oracle rejects a pre-reload route binding once a newer boot\'s control preceded the action', () => {
            const stale = action('share_feedback', { journeyId: 'journey-stale', bootId: 'boot-1', capturedAt: 7 });
            const result = bindFeedback([...preReload, postReload], [stale]);
            expect(result.journeys).toEqual([]);
            expect(result.missingBindings).toEqual(['share_feedback']);
        });

        it('the oracle rejects a boot_load binding when that boot routed before the action', () => {
            const routed = { event: 'journey_step', at: 7, journeyId: 'journey-later', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics' };
            const bootLoad = action('share_feedback', { journeyId: 'journey-reloaded', bootId: 'boot-2', entry: 'boot_load', capturedAt: 9 });
            expect(bindFeedback([...preReload, postReload, routed], [bootLoad]).missingBindings).toEqual(['share_feedback']);
        });

        it('after the reload, a later in-boot route to the Analytics list (the PDF path) binds by that route', () => {
            const back = { event: 'journey_step', at: 7, journeyId: 'journey-reloaded', bootId: 'boot-2', releaseSha: RELEASE, trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics' };
            const tap = reloadedTap([postReload, back]);
            const captured = tap.captureActionBinding('session_pdf_export', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics`);
            expect(captured).toMatchObject({ journeyId: 'journey-reloaded', bootId: 'boot-2', entry: 'route_change' });
            const result = bindReadbackJourneys(tap.events, {
                recording: [], pdfExport: true, actionBindings: tap.actionBindings,
                expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT,
            });
            expect(result.journeys).toEqual([{ journeyId: 'journey-reloaded', stages: ['session_pdf_export'] }]);
        });

        it('a boot loaded onto a non-Analytics page is not bound by its control alone', () => {
            const tap = new AnalyticsTap();
            tap.noteDocument(`${ORIGIN}/session`, 5);
            tap.events.push(postReload);
            expect(tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT, `${ORIGIN}/analytics/s-1`)).toBeNull();
        });
    });
});
