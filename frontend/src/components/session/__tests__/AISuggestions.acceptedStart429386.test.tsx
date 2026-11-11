import React from 'react';
import { act, cleanup, render, screen, waitFor } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AISuggestions from '../AISuggestions';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetPracticeLoopTelemetryForTests } from '@/services/telemetry/practiceLoopTelemetry';
import { __resetJourneyIdentityForTests, beginJourney, beginRecordingAttempt, currentAttemptId } from '@/services/telemetry/journeyIdentity';
import { __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';
import { useSessionStore } from '@/stores/useSessionStore';
import type { SttStatus } from '@/types/transcription';
import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';
import { __resetRecordingIntentForTests } from '@/services/recordingIntent';

vi.mock('@/lib/supabaseClient');
const invoke = vi.fn();
const events: Array<{ event: string; properties: Record<string, unknown>; ambient: string | null }> = [];
let revealCard: IntersectionObserverCallback | null;
const base: SessionOverhaulViewProps = {
  authUserId: 'user-1', isListening: false, sttStatus: { type: 'idle' } as SttStatus,
  elapsedTime: 20, micLevel: 0, transcriptContent: '', showAnalyticsPrompt: true,
  metricsFillerCount: 0, onStartStop: vi.fn(), history: [],
  reviewTranscript: { kind: 'available', text: 'Previous saved take A.' },
};
const card = <AISuggestions canReview sessionId="saved-take-a" product="open_mic" sessionLabel="Session A · Open Mic" />;

beforeEach(() => {
  vi.clearAllMocks(); invoke.mockReset(); events.length = 0; revealCard = null;
  (window.location as unknown as { pathname: string }).pathname = '/session';
  vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
  __resetPracticeLoopTelemetryForTests(); __resetJourneyIdentityForTests(); __resetCompletionStagesForTests(); beginJourney();
  __resetRecordingIntentForTests();
  useSessionStore.setState({ progressGate: null, progressGateResolvedFor: 'user-1', isTranscriptFinalizing: false, engineSelectionLocked: false, captureLive: false, startupWaitStartedAt: null, runtimeState: 'READY' });
  vi.spyOn(analyticsBuffer, 'push').mockImplementation((event, properties) => { events.push({ event, properties: properties as Record<string, unknown>, ambient: currentAttemptId() }); });
  vi.stubGlobal('IntersectionObserver', vi.fn((callback: IntersectionObserverCallback) => {
    revealCard = callback;
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []) } as unknown as IntersectionObserver;
  }));
});
afterEach(async () => { cleanup(); await new Promise(resolve => setTimeout(resolve, 0)); vi.unstubAllGlobals(); });

describe('run42938644148 accepted-start preparation gap', () => {
  it('real controller admits B and keeps A review identity while next-take preparation is pending', async () => {
    let releasePreparation!: () => void;
    const preparation = new Promise<void>(resolve => { releasePreparation = resolve; });
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    const controller = new Controller();
    const state = controller as unknown as { state: string; capturedUserId: string; nextTakePreparation: Promise<void> | null; lifecycleVersion: number };
    state.state = 'READY'; state.capturedUserId = 'user-1'; state.nextTakePreparation = preparation;
    useSessionStore.setState({ completedSessionId: 'saved-take-a', finalizedAnalysis: { sessionId: 'saved-take-a' } as never });
    let completed = false;
    const start = controller.startRecording({ allowNative: false, allowCloud: false, allowPrivate: true, preferredMode: 'private', allowFallback: false, executionIntent: 'test' } as never, []).catch(() => undefined).finally(() => { completed = true; });
    expect(useSessionStore.getState().engineSelectionLocked).toBe(true);
    expect(useSessionStore.getState().completedSessionId).toBe('saved-take-a');
    expect(useSessionStore.getState().finalizedAnalysis?.sessionId).toBe('saved-take-a');
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(controller.getState()).toBe('READY');
    // Retire the synthetic start before releasing its preparation, so this test never opens a real engine.
    state.lifecycleVersion += 1;
    releasePreparation();
    await start;
  });

  it('reproduces A appearing in the retained A review while ambient attempt is B, then disappears at actual B recording', async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const a = beginRecordingAttempt();
    const view = render(<SessionOverhaulView {...base} practiceLoopReview={card} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const request = events.find(e => e.event === 'ai_coaching_lifecycle' && e.properties.stage === 'requested')!;
    expect(request.properties.origin_attempt_id).toBe(a);

    // useSessionLifecycle accepts B before controller waits for nextTakePreparation.
    // Completed A's identity and after-state intentionally survive until B records.
    const b = beginRecordingAttempt();
    act(() => { useSessionStore.setState({ engineSelectionLocked: true, startupWaitStartedAt: Date.now() }); });
    await act(async () => { finish({ data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'Delayed A worked.', what_to_try_next: 'Delayed A next.' } }, error: null }); });
    expect(await screen.findByText('Delayed A next.')).toBeInTheDocument();
    expect(screen.getByText('Session A · Open Mic')).toBeInTheDocument();
    const shown = screen.getByTestId('ai-suggestions-card');
    act(() => revealCard?.([{ target: shown, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    const rendered = events.find(e => e.event === 'ai_coaching_lifecycle' && e.properties.stage === 'rendered')!;
    expect(rendered.properties.origin_attempt_id).toBe(a);
    expect(rendered.properties.render_target_attempt_id).toBe(a);
    expect(rendered.ambient).toBe(b);
    expect(events.filter(e => e.event === 'ai_coaching_lifecycle' && e.properties.stage !== 'rendered')
      .every(e => e.properties.render_target_attempt_id === undefined)).toBe(true);
    expect(events.find(e => e.event === 'ai_coaching_lifecycle' && e.properties.stage === 'ended')?.properties.end_reason).toBe('completed');
    expect(invoke.mock.calls[0][1].body.sessionId).toBe('saved-take-a');

    act(() => { useSessionStore.setState({ captureLive: true, runtimeState: 'RECORDING' }); });
    view.rerender(<SessionOverhaulView {...base} isListening showAnalyticsPrompt={false} practiceLoopReview={card} />);
    expect(screen.queryByText('Delayed A next.')).toBeNull();
    expect(screen.queryByTestId('ai-suggestions-card')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
