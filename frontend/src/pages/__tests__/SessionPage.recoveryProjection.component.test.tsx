import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '../../../tests/support/test-utils';
import React from 'react';
import SessionPage from '../SessionPage';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';

// #1033 Part-2b — the FULL user-visible chain proven through the REAL SessionPage:
//   click Retry/Discard -> real controller resolves -> controller republishes lock/pending to the
//   store -> SessionPage re-projects -> banner disappears + selector unlocks.
// Nothing is fabricated: we seed the controller into a genuine unresolved state (a recording that
// failed to save) and drive the real recovery operations; storage is mocked to make those operations
// deterministically succeed or fail.

vi.mock('posthog-js', () => ({ default: { capture: vi.fn(), identify: vi.fn() } }));
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')), useNavigate: () => vi.fn() }));
vi.mock('@/contexts/AuthProvider', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/contexts/AuthProvider')>()),
    useAuthProvider: () => ({ session: { user: { id: 'owner-user' } } }),
}));
// LiveRecordingCard mocked to EXPOSE the engineSelectionLocked projection SessionPage passes to it.
vi.mock('@/components/session/LiveRecordingCard', () => ({
    LiveRecordingCard: ({ engineSelectionLocked }: { engineSelectionLocked?: boolean }) => (
        <div data-testid="lrc" data-locked={engineSelectionLocked ? 'true' : 'false'} />
    ),
}));
vi.mock('@/components/session/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => <div /> }));
vi.mock('@/components/session/FillerWordsCard', () => ({ FillerWordsCard: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('@/components/session/UserFillerWordsManager', () => ({ UserFillerWordsManager: () => <div /> }));
vi.mock('@/components/session/SessionPageSkeleton', () => ({ SessionPageSkeleton: () => <div /> }));
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/SunsetModals', () => ({ SunsetModals: () => <div /> }));
vi.mock('@/components/session/LiveCoachingScoreCard', () => ({ LiveCoachingScoreCard: () => <div /> }));
vi.mock('@/components/LocalErrorBoundary', () => ({ LocalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));

const storage = vi.hoisted(() => ({
    completeSession: vi.fn(), updateSession: vi.fn(), saveSession: vi.fn(),
}));
vi.mock('@/lib/storage', () => storage);

import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';

const lifecycle = {
    isListening: false, isReady: true, metrics: { formattedTime: '00:00', wpm: 0, clarityScore: 100, clarityLabel: 'Great', wpmLabel: 'Normal', fillerCount: 0 },
    sttStatus: { type: 'ready', message: 'Ready' }, modelLoadingProgress: null, privateModelStatus: 'ready',
    mode: 'native', setMode: vi.fn(), recordingIntent: false, elapsedTime: 0, handleStartStop: vi.fn(),
    showAnalyticsPrompt: false, sessionFeedbackMessage: null, sunsetModal: { type: 'daily', open: false }, setSunsetModal: vi.fn(),
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 }, micLevel: 0, hasSpeechActivity: false,
    // a transcript is on screen, so the recovery hook does NOT auto-restore / interfere.
    transcriptContent: 'on screen', interimTranscript: '', isProUser: false, canUsePrivateStt: false, canUseCloudStt: false,
    activeEngine: 'native', isButtonDisabled: false, history: [],
};

const ctrl = speechRuntimeController as unknown as Record<string, unknown>;
const seedUnresolved = (kind: 'full_save' | 'attribution') => {
    ctrl.sessionId = 'sess-x';
    ctrl.recordingStartedUnresolved = true;
    ctrl.recordingEngineMode = null;
    ctrl.pendingFullSaveRetry = kind === 'full_save'
        ? { sessionId: 'sess-x', completeArgs: { status: 'completed', transcript: 'words', duration: 10 }, attributionPatch: { attribution_status: 'unverified' } }
        : null;
    ctrl.pendingAttributionRetry = kind === 'attribution'
        ? { sessionId: 'sess-x', patch: { attribution_status: 'verified', engine: 'native' } }
        : null;
    (ctrl.publishLockState as () => void)();
};

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useSessionLifecycle).mockReturnValue(lifecycle as unknown as ReturnType<typeof useSessionLifecycle>);
    storage.completeSession.mockResolvedValue({ success: true });
    storage.updateSession.mockResolvedValue({ success: true });
    ctrl.pendingFullSaveRetry = null; ctrl.pendingAttributionRetry = null; ctrl.recordingStartedUnresolved = false;
    (ctrl.publishLockState as () => void)();
});
afterEach(() => { cleanup(); ctrl.pendingFullSaveRetry = null; ctrl.pendingAttributionRetry = null; ctrl.recordingStartedUnresolved = false; });

const banner = () => screen.queryByTestId('session-unresolved-recovery');
const locked = () => screen.getByTestId('lrc').getAttribute('data-locked');

describe('#1033 SessionPage recovery projection (full chain)', () => {
    it('1. successful Retry Save removes the banner and UNLOCKS the selector', async () => {
        seedUnresolved('full_save');
        render(<SessionPage />);
        expect(banner()).toBeInTheDocument();
        expect(locked()).toBe('true');
        fireEvent.click(screen.getByTestId('session-retry-save'));
        await waitFor(() => expect(banner()).toBeNull());
        expect(locked()).toBe('false');
    });

    it('2. FAILED Retry Save keeps the banner, actions, lock, and preserves the owned durable draft', async () => {
        storage.completeSession.mockResolvedValue({ success: false });
        const draft = await import('@/services/sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-x', userId: 'owner-user', transcript: 'words', durationSeconds: 10, mode: 'private' });
        seedUnresolved('full_save');
        render(<SessionPage />);
        fireEvent.click(screen.getByTestId('session-retry-save'));
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/failed/i));
        expect(banner()).toBeInTheDocument();
        expect(screen.getByTestId('session-retry-save')).toBeInTheDocument();
        expect(locked()).toBe('true');
        // the failed retry must not touch the owned durable draft
        expect(draft.getSessionRecoveryDraft()?.sessionId).toBe('sess-x');
    });

    it('3. successful Retry verification removes the attribution banner and unlocks (Discard never present)', async () => {
        seedUnresolved('attribution');
        render(<SessionPage />);
        expect(banner()).toBeInTheDocument();
        expect(screen.queryByTestId('session-discard')).toBeNull(); // attribution: no discard affordance
        fireEvent.click(screen.getByTestId('session-retry-verification'));
        await waitFor(() => expect(banner()).toBeNull());
        expect(locked()).toBe('false');
        expect(storage.completeSession).not.toHaveBeenCalled(); // attribution retry never runs a full save
    });

    it('4. successful confirmed Discard removes the banner, unlocks, and clears the owned draft', async () => {
        const draft = await import('@/services/sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-x', userId: 'owner-user', transcript: 'words', durationSeconds: 10, mode: 'private' });
        seedUnresolved('full_save');
        render(<SessionPage />);
        fireEvent.click(screen.getByTestId('session-discard'));
        fireEvent.click(screen.getByTestId('session-discard-confirm'));
        await waitFor(() => expect(banner()).toBeNull());
        expect(locked()).toBe('false');
        expect(draft.getSessionRecoveryDraft()).toBeNull();
    });

    it('5. RETRYABLE Discard keeps the banner, lock, and the owned draft', async () => {
        storage.completeSession.mockResolvedValue({ success: false }); // row cannot be marked failed
        const draft = await import('@/services/sessionRecoveryDraft');
        draft.saveSessionRecoveryDraft({ sessionId: 'sess-x', userId: 'owner-user', transcript: 'words', durationSeconds: 10, mode: 'private' });
        seedUnresolved('full_save');
        render(<SessionPage />);
        fireEvent.click(screen.getByTestId('session-discard'));
        fireEvent.click(screen.getByTestId('session-discard-confirm'));
        await waitFor(() => expect(screen.getByTestId('session-unresolved-message')).toHaveTextContent(/could not discard it cleanly/i));
        expect(banner()).toBeInTheDocument();
        expect(locked()).toBe('true');
        expect(draft.getSessionRecoveryDraft()?.sessionId).toBe('sess-x'); // draft preserved
    });
});
