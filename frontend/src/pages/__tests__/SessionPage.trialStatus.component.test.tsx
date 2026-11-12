import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import { TRIAL_ENDED_COPY } from '@/components/session/trialStatus';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div data-testid="status-bar" /> }));
vi.mock('@/components/session/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => <div /> }));
vi.mock('@/components/session/FillerWordsCard', () => ({ FillerWordsCard: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div data-testid="mobile-bar" /> }));
vi.mock('@/components/session/UserFillerWordsManager', () => ({ UserFillerWordsManager: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));

const mockLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);

const baseLifecycle = {
    isListening: false,
    isReady: true,
    metrics: { formattedTime: '00:00', wpm: 0, wpmLabel: 'Optimal', clarityScore: 0, clarityLabel: 'Good', fillerCount: 0 },
    sttStatus: { type: 'ready' as const, message: 'Ready' },
    modelLoadingProgress: null,
    mode: 'native' as const,
    setMode: vi.fn(),
    elapsedTime: 0,
    handleStartStop: vi.fn(),
    showAnalyticsPrompt: false,
    sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '',
    fillerData: {},
    isProUser: true,
    isButtonDisabled: false,
};

const EXPIRED = { can_start: false, subscription_status: 'free', is_pro: false, streak_count: 0, trial_active: false, trial_seconds_remaining: 0, error: 'trial_expired' };
const activeTrial = (seconds: number) => ({ can_start: true, subscription_status: 'pro', is_pro: true, streak_count: 0, trial_active: true, trial_seconds_remaining: seconds });

const withLifecycle = (overrides: Record<string, unknown>) => mockLifecycle.mockReturnValue(
    { ...baseLifecycle, ...overrides } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>,
);

describe('SessionPage — trial countdown and trial-ended screen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useSessionStore.getState().setProgressGate(null);
        useSessionStore.getState().setProgressGateResolvedFor('');
        useSessionStore.getState().setStartupWaitStartedAt(null);
    });

    it('shows days left from the server value beside the session title', () => {
        withLifecycle({ usageLimit: activeTrial(12 * 86_400) });
        render(<SessionPage />);
        const chip = screen.getByTestId('trial-countdown');
        expect(chip).toHaveTextContent('12 days left in your trial');
        expect(chip).toHaveAttribute('data-trial-tone', 'calm');
        expect(screen.getByTestId('mic-start')).toBeInTheDocument();
        expect(screen.queryByTestId('trial-ended-panel')).not.toBeInTheDocument();
    });

    it('takes the urgent style in the last 24 hours', () => {
        withLifecycle({ usageLimit: activeTrial(3 * 3_600) });
        render(<SessionPage />);
        expect(screen.getByTestId('trial-countdown')).toHaveAttribute('data-trial-tone', 'urgent');
        expect(screen.getByTestId('trial-countdown')).toHaveTextContent('Trial ends in 3 hours');
    });

    it('shows no countdown before the server answers or for a paid account', () => {
        withLifecycle({ usageLimit: undefined });
        const { unmount } = render(<SessionPage />);
        expect(screen.queryByTestId('trial-countdown')).not.toBeInTheDocument();
        unmount();
        withLifecycle({ usageLimit: { ...activeTrial(0), trial_active: false } });
        render(<SessionPage />);
        expect(screen.queryByTestId('trial-countdown')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-start')).toBeInTheDocument();
    });

    it('replaces the recorder with the trial-ended screen when the server refuses with trial_expired', () => {
        withLifecycle({ usageLimit: EXPIRED });
        render(<SessionPage />);
        expect(screen.getByTestId('trial-ended-panel')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: TRIAL_ENDED_COPY.title })).toBeInTheDocument();
        expect(screen.getByTestId('trial-ended-pricing')).toHaveAttribute('href', '/pricing');
        expect(screen.queryByTestId('mic-start')).not.toBeInTheDocument();
        expect(screen.queryByTestId('mobile-bar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('trial-countdown')).not.toBeInTheDocument();
    });

    it('does not show the ended screen for any other refusal', () => {
        withLifecycle({ usageLimit: { ...EXPIRED, error: 'profile_not_found' } });
        render(<SessionPage />);
        expect(screen.queryByTestId('trial-ended-panel')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-start')).toBeInTheDocument();
    });

    it('never pulls a live take out from under the user when the trial ends mid-recording', () => {
        withLifecycle({ usageLimit: EXPIRED, isListening: true });
        render(<SessionPage />);
        expect(screen.queryByTestId('trial-ended-panel')).not.toBeInTheDocument();
    });

    it('keeps the post-save review on screen when the trial ends after the take', () => {
        withLifecycle({ usageLimit: EXPIRED, showAnalyticsPrompt: true });
        render(<SessionPage />);
        expect(screen.queryByTestId('trial-ended-panel')).not.toBeInTheDocument();
    });
});
