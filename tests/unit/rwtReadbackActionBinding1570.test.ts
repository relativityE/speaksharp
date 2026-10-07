// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bindReadbackJourneys } from '../live/helpers/rwtOracles';
import { AnalyticsTap } from '../live/helpers/rwtJourney';
import type { ReadbackActionBinding, ReadbackActionStage } from '../live/helpers/rwtAcceptance';

const RELEASE = 'a'.repeat(40);
const RUN_ID = '37658306531';
const RUN_ATTEMPT = '2';
const BASE = [
    { event: 'telemetry_positive_control', at: 1, journeyId: 'journey-current', bootId: 'boot-current', releaseSha: RELEASE, trafficType: 'canary' },
    { event: 'journey_step', at: 2, journeyId: 'journey-current', bootId: 'boot-current', releaseSha: RELEASE, trafficType: 'canary', journeyStep: 'route_change', toRoute: '/analytics/id' },
];
const action = (stage: ReadbackActionStage, overrides: Partial<ReadbackActionBinding> = {}): ReadbackActionBinding => ({
    stage, journeyId: 'journey-current', bootId: 'boot-current', releaseSha: RELEASE,
    trafficType: 'canary', runId: RUN_ID, runAttempt: RUN_ATTEMPT, ...overrides,
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
            reportedJourneyIds: [], missingBindings: [],
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

    it('does not accept a positive control from another journey or traffic class', () => {
        for (const control of [
            { ...BASE[0], journeyId: 'journey-other' },
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
        const captured = tap.captureActionBinding('share_feedback', RELEASE, RUN_ID, RUN_ATTEMPT);
        expect(captured).toEqual(action('share_feedback'));
        expect(tap.actionBindings).toEqual([action('share_feedback')]);
        expect(tap.events.some((event) => event.event === 'feedback_submit')).toBe(false);
        expect(tap.captureActionBinding('session_pdf_export', 'b'.repeat(40), RUN_ID, RUN_ATTEMPT)).toBeNull();
        expect(tap.actionBindings).toHaveLength(1);
    });
});
