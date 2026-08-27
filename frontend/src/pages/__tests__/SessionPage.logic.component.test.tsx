import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';

// --- Mocks ---
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';

const mockHandleStartStop = vi.fn();
const mockSetMode = vi.fn();

// Mock useSessionLifecycle
vi.mock('@/hooks/useSessionLifecycle', () => ({
    useSessionLifecycle: vi.fn(),
}));

const mockUseSessionLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);

const defaultLifecycle = {
    isListening: false,
    isReady: true,
    metrics: {
        formattedTime: '00:00',
        wpm: 0,
        wpmLabel: 'Optimal',
        clarityScore: 0,
        clarityLabel: 'Good',
        fillerCount: 0
    },
    sttStatus: { type: 'ready' as const, message: 'Ready' },
    modelLoadingProgress: null,
    mode: 'native' as const,
    setMode: mockSetMode,
    elapsedTime: 0,
    handleStartStop: mockHandleStartStop,
    showAnalyticsPrompt: false,
    sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '',
    fillerData: {},
    isProUser: true,
    isButtonDisabled: false,
    sunsetModal: { type: 'daily', open: false }
};


// Redundant mocks removed, using useSessionLifecycle instead

// Mock child components to isolate logic
vi.mock('@/components/session/StatusNotificationBar', () => ({
    StatusNotificationBar: () => <div data-testid="status-bar" />,
}));

vi.mock('@/components/session/LiveTranscriptPanel', () => ({
    LiveTranscriptPanel: () => <div data-testid="transcript-panel" />,
}));

vi.mock('@/components/session/FillerWordsCard', () => ({
    FillerWordsCard: () => <div data-testid="filler-card" />,
}));

vi.mock('@/components/session/SpeakingTipsCard', () => ({
    SpeakingTipsCard: () => <div data-testid="tips-card" />,
}));

vi.mock('@/components/session/MobileActionBar', () => ({
    MobileActionBar: () => <div data-testid="mobile-bar" />,
}));

vi.mock('@/components/session/SessionPageSkeleton', () => ({
    SessionPageSkeleton: () => <div data-test-id="skeleton" />,
}));

vi.mock('@/components/session/UserFillerWordsManager', () => ({
    UserFillerWordsManager: () => <div data-testid="filler-manager" />,
}));

// Mock sonner to prevent timer issues
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        id: vi.fn(),
    },
}));

// Child component mocks remain as they are useful for isolating SessionPage


describe('SessionPage Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseSessionLifecycle.mockReturnValue(defaultLifecycle as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
        // #1354: the Start control is gated on the Progress gate having been DETERMINED, and it starts
        // undetermined so a reload cannot render an enabled Start over unproven evidence. The resolver
        // (`useProgressReconciliation`) is mounted app-globally in App.tsx; this file renders SessionPage
        // in isolation, without that shell, so it must state the resolved condition itself.
        //
        // The fail-closed default is deliberate, not incidental: SessionOverhaulView.progressGate.test.tsx
        // asserts that an UNRESOLVED gate disables Start.
        useSessionStore.getState().setProgressGate(null);
        // '' marks "determined for an ANONYMOUS viewer" — this isolated render has no auth session, so
        // SessionPage passes authUserId=null and the gate resolution must be recorded against that same
        // owner. Recording it for a signed-in id would leave the viewer unresolved and Start disabled.
        useSessionStore.getState().setProgressGateResolvedFor('');
    });




    describe('Loading State Logic', () => {
        it('should show loading skeleton when metrics are missing', () => {
            mockUseSessionLifecycle.mockReturnValue({
                ...defaultLifecycle,
                metrics: null,
            } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

            render(<SessionPage />);

            expect(screen.queryByTestId('recording-card')).not.toBeInTheDocument();
        });
    });

    describe('Interaction Logic', () => {
        // #1222: the new session page's before-state mic control is `mic-start` (onStart → handleStartStop).
        it('should call handleStartStop via the mic control', () => {
            render(<SessionPage />);

            screen.getByTestId('mic-start').click();

            expect(mockHandleStartStop).toHaveBeenCalledTimes(1);
        });
    });

    // Mode switching logic is now tested in useSessionLifecycle, 
    // but we can verify SessionPage passes the correct props.
});
