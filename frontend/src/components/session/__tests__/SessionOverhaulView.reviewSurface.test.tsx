/**
 * #1421 P1 — THE REVIEW RECEIPT MUST DESCRIBE THE SURFACE THAT RENDERED.
 *
 * There are two reviews, not one. Raw Takes shows the coaching verdict; Focus Points replaces it with
 * the points rail and is never handed `aiSuggestions` in production at all. The receipt was written as
 * if only the first existed, so on every settled Focus Points review it reported fallback coaching
 * sources and a count of 0 for copy that was not merely absent but not part of the screen — and the
 * options receipt named `practice_next`/`view_analytics`, a menu that product never rendered.
 *
 * Decoded, an entire product looked like a review whose generation had failed.
 */
import { render, screen } from '../../../../tests/support/test-utils';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetPracticeLoopTelemetryForTests } from '@/services/telemetry/practiceLoopTelemetry';
import { __resetJourneyIdentityForTests, beginJourney } from '@/services/telemetry/journeyIdentity';
import { reachedStages, __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';
import type { SttStatus } from '@/types/transcription';

const POINTS = ['Name the price', 'Close with the next step'];

const base: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: false,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

let pushSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    __resetPracticeLoopTelemetryForTests();
    __resetJourneyIdentityForTests();
    __resetCompletionStagesForTests();
    beginJourney();
    pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
});

const rows = (name: string) => pushSpy.mock.calls
    .filter((c) => c[0] === name)
    .map((c) => c[1] as Record<string, unknown>);

/** The most recent one. `Array.prototype.at` is outside this project's target lib. */
const last = (list: Record<string, unknown>[]): Record<string, unknown> | undefined => list[list.length - 1];

/** The production Focus Points review: a bound brief, a retained transcript, and NO suggestions. */
const renderFocusPointsReview = (extra: Partial<SessionOverhaulViewProps> = {}) => render(
    <SessionOverhaulView
        {...base}
        objectivePoints={POINTS}
        showAnalyticsPrompt
        transcriptContent=""
        reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
        elapsedTime={84}
        {...extra}
    />,
);

describe('#1421 P1 — Focus Points review receipts', () => {
    it('CASUALTY: the rail is reported as the rail, not as coaching that fell back', () => {
        renderFocusPointsReview();

        const receipt = last(rows('practice_loop'));
        expect({
            surface: receipt?.review_surface,
            wentWellSource: receipt?.what_went_well_source,
            toImproveSource: receipt?.what_to_improve_source,
            suppression: receipt?.suppression_reason,
        }).toEqual({
            surface: 'focus_points_rail',
            // `not_applicable`, NOT `fallback`. Fallback asserts substitute coaching copy was displayed.
            wentWellSource: 'not_applicable',
            toImproveSource: 'not_applicable',
            suppression: 'objective_rail',
        });
        // Not zero either: zero says the rail tried to show a phrase and had none.
        expect({ wentWell: receipt?.what_went_well_count, toImprove: receipt?.what_to_improve_count })
            .toEqual({ wentWell: -1, toImprove: -1 });
    });

    it('CASUALTY: the options receipt names the options the rail actually offers', () => {
        renderFocusPointsReview({ onNewSet: vi.fn() });

        const options = last(rows('journey_step').filter((r) => r.step === 'post_session_options'));
        expect({ offered: options?.options_shown }).toEqual({ offered: ['retry_points', 'new_set'] });
    });

    it('CASUALTY: choosing on the rail is recorded, not only offered', () => {
        const onRetryPoints = vi.fn();
        renderFocusPointsReview({ onRetryPoints });

        fireEvent.click(screen.getByTestId('focus-points-retry'));

        const selected = last(rows('journey_step').filter((r) => r.step === 'option_selected'));
        // The rail's handlers were passed through unwrapped, so this product recorded which options were
        // offered and never which one was taken — the gap `option_selected` exists to close.
        expect({ chosen: selected?.option_selected, delegated: onRetryPoints.mock.calls.length })
            .toEqual({ chosen: 'retry_points', delegated: 1 });
    });

    it('CONTROL: the rail review still publishes both completion links', () => {
        // PM disposition on #1422: Focus Points rail telemetry is unchanged by the ownership move. The
        // rail IS this view's own review, so this view still marks the two links where it renders it.
        renderFocusPointsReview();

        expect({
            ready: reachedStages().includes('practice_loop_ready'),
            rendered: reachedStages().includes('review_rendered'),
        }).toEqual({ ready: true, rendered: true });
    });

    it('CASUALTY (#1422 P1, Codex 3994409733): the Raw Takes review is reported by the card that renders it, not by this view', () => {
        // This view cannot see whether the generated review exists. It emitted a `coaching_verdict`
        // receipt claiming one strength and one improvement were on screen the moment the review
        // SETTLED — while `AISuggestions` was still requesting, had failed, or had been handed a
        // malformed answer — and marked `practice_loop_ready`/`review_rendered` on the same evidence.
        // `AISuggestions` owns that receipt and those two stages now (its own suite proves the
        // truthful/pending/failed/superseded cases), so on the Raw Takes surface this view emits
        // nothing and pre-marks nothing.
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={null}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={84}
            />,
        );

        expect({
            receipts: rows('practice_loop').length,
            ready: reachedStages().includes('practice_loop_ready'),
            rendered: reachedStages().includes('review_rendered'),
        }).toEqual({ receipts: 0, ready: false, rendered: false });

        // The options menu is this view's own observation and is unaffected by the move.
        const options = last(rows('journey_step').filter((r) => r.step === 'post_session_options'));
        expect({ offered: options?.options_shown }).toEqual({ offered: ['practice_next'] });
    });

    it('CONTROL: both Raw Takes option selections still emit before delegating', () => {
        // The integration rewired slot D. If either verdict action had been reconnected to the raw
        // handler, the pick would be delegated and never recorded, which is the #1259 gap reopening.
        const onStartStop = vi.fn();
        const onSeeAllSessions = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={null}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={84}
                onStartStop={onStartStop}
                onSeeAllSessions={onSeeAllSessions}
            />,
        );

        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        const practiceAgain = last(rows('journey_step').filter((r) => r.step === 'option_selected'));
        expect({ chosen: practiceAgain?.option_selected, delegated: onStartStop.mock.calls.length })
            .toEqual({ chosen: 'practice_next', delegated: 1 });

        fireEvent.click(screen.getByTestId('verdict-see-all'));
        const seeAll = last(rows('journey_step').filter((r) => r.step === 'option_selected'));
        expect({ chosen: seeAll?.option_selected, delegated: onSeeAllSessions.mock.calls.length })
            .toEqual({ chosen: 'view_analytics', delegated: 1 });
    });
});
