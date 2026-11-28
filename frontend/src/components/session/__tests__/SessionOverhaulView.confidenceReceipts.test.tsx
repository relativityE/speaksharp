/**
 * Confidence check pilot (Codex P2 on #1994): while the repeat's review is hidden behind the post questions, the
 * visibility receipts (`practice_loop` rendered, the `review_rendered` completion stage, `post_session_options`) must
 * NOT claim the review or its actions were shown. They publish when the user chooses "Show my review".
 */
import { render, screen } from '../../../../tests/support/test-utils';
import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetPracticeLoopTelemetryForTests } from '@/services/telemetry/practiceLoopTelemetry';
import { __resetJourneyIdentityForTests, beginJourney } from '@/services/telemetry/journeyIdentity';
import { reachedStages, __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';
import type { SttStatus } from '@/types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';
import { clearConfidencePilot } from '@/services/confidenceCheck/pilotState';

const POINTS = ['Name the price', 'Close with the next step'];
const base: SessionOverhaulViewProps = {
    authUserId: 'user-1', isListening: false, sttStatus: { type: 'idle' } as SttStatus, elapsedTime: 0, micLevel: 0,
    transcriptContent: '', showAnalyticsPrompt: false, metricsFillerCount: 0, onStartStop: vi.fn(), history: [],
};
const focusAfter = (extra: Partial<SessionOverhaulViewProps> = {}) => <SessionOverhaulView {...base} objectivePoints={POINTS}
    showAnalyticsPrompt reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }} elapsedTime={84}
    onRetryPoints={vi.fn()} {...extra} />;
const focusDuring = () => <SessionOverhaulView {...base} objectivePoints={POINTS} isListening elapsedTime={40} onRetryPoints={vi.fn()} />;

let pushSpy: ReturnType<typeof vi.spyOn>;
const rows = (name: string) => pushSpy.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);
const freshTakeTelemetry = () => {
    __resetPracticeLoopTelemetryForTests(); __resetJourneyIdentityForTests(); __resetCompletionStagesForTests(); beginJourney();
    pushSpy.mockClear();
};

beforeEach(() => {
    clearConfidencePilot();
    useSessionStore.setState({ captureLive: true, progressGate: null, progressGateResolvedFor: 'user-1' });
    pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
    freshTakeTelemetry();
});
afterEach(() => { vi.unstubAllEnvs(); pushSpy.mockRestore(); });

describe('confidence pilot: visibility receipts wait for the review to be revealed', () => {
    it('a hidden Focus Points repeat review is not reported as rendered or offered until "Show my review"', () => {
        vi.stubEnv('VITE_CONFIDENCE_CHECK_PILOT_ENABLED', 'true');
        const { rerender } = render(focusAfter());
        fireEvent.click(screen.getByTestId('focus-points-retry'));
        rerender(focusDuring());
        freshTakeTelemetry();
        rerender(focusAfter());
        expect(screen.getByTestId('confidence-post')).toBeInTheDocument();
        expect(rows('practice_loop').filter((r) => r.rendered === true)).toHaveLength(0);
        expect(rows('journey_step').filter((r) => r.step === 'post_session_options')).toHaveLength(0);
        expect(reachedStages()).not.toContain('review_rendered');

        fireEvent.click(screen.getByTestId('confidence-reveal'));
        expect(rows('practice_loop').filter((r) => r.rendered === true)).toHaveLength(1);
        expect(rows('journey_step').filter((r) => r.step === 'post_session_options')).toHaveLength(1);
        expect(reachedStages()).toContain('review_rendered');
    });

    it('CONTROL: flag off, the settled review reports as today', () => {
        render(focusAfter());
        expect(rows('practice_loop').filter((r) => r.rendered === true)).toHaveLength(1);
        expect(rows('journey_step').filter((r) => r.step === 'post_session_options')).toHaveLength(1);
        expect(reachedStages()).toContain('review_rendered');
    });
});
