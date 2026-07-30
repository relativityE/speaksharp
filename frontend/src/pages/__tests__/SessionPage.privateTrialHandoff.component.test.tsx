import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Recorder card + heavy children are stubbed — this suite is about the `?trial=private` handoff effect,
// not the recorder UI. The stub also proves the handoff never needs the card to act (no auto-record).
vi.mock('@/components/LocalErrorBoundary', () => ({
    LocalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@sentry/react', () => ({
    withScope: vi.fn((cb) => cb({ setTag: vi.fn(), setContext: vi.fn() })),
    captureException: vi.fn(),
}));
vi.mock('@/services/sessionCoachingExperiment', () => ({
    getSessionCoachingAssignment: vi.fn(() => ({ variant: 'treatment', source: 'default', flag: 'f' })),
    trackSessionCoachingCardViewed: vi.fn(),
    trackSessionCoachingNumericScoreShown: vi.fn(),
}));
vi.mock('@/components/session/LiveRecordingCard', () => ({ LiveRecordingCard: () => <div data-testid="live-recording-card" /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div data-testid="mobile-action-bar" /> }));
vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: vi.fn() }));

import { render, screen, cleanup, waitFor } from '../../../tests/support/test-utils';
import { SessionPage } from '../SessionPage';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as UsageLimitHook from '@/hooks/useUsageLimit';

const mockLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);
const mockUsageLimit = vi.mocked(UsageLimitHook.useUsageLimit);

const setMode = vi.fn();
const handleStartStop = vi.fn();

const baseLifecycle = {
    isListening: false,
    isReady: true,
    metrics: { formattedTime: '00:00', wpm: 0, wpmLabel: 'Optimal', clarityScore: 0, clarityLabel: 'Excellent', wordCount: 0, fillerCount: 0, fillerData: { total: { count: 0 } }, fillerExplanation: '' },
    sttStatus: { type: 'ready' as const, message: 'Mic ready' },
    modelLoadingProgress: null,
    mode: 'native' as const,
    setMode,
    elapsedTime: 0,
    handleStartStop,
    showAnalyticsPrompt: false,
    sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '',
    interimTranscript: '',
    history: [],
    isProUser: false,
    canUsePrivateStt: true,
    canUseCloudStt: false,
    isButtonDisabled: false,
    sunsetModal: { type: 'daily' as const, open: false },
};

const lifecycle = (over: Partial<typeof baseLifecycle> = {}) =>
    ({ ...baseLifecycle, ...over }) as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>;

// A resolved usage-limit row. `available` + `is_pro` drive eligibility; `undefined` = still loading.
type Usage = { is_pro: boolean; private_sample_available: boolean; private_sample_seconds_remaining: number; private_sample_limit_seconds: number } | undefined;
const usage = (u: Usage) => ({ data: u } as unknown as ReturnType<typeof UsageLimitHook.useUsageLimit>);
const FREE_AVAILABLE = { is_pro: false, private_sample_available: true, private_sample_seconds_remaining: 300, private_sample_limit_seconds: 300 };

// The test router seeds a MemoryRouter Location; pass pathname + search SEPARATELY so `useSearchParams`
// actually parses `?trial=private` (a whole "/session?trial=private" string lands in pathname, losing it).
const TRIAL_ROUTE = { pathname: '/session', search: '?trial=private' };
const PLAIN_ROUTE = { pathname: '/session', search: '' };

describe('SessionPage — #1047 anonymous Private-trial handoff (?trial=private)', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => cleanup());

    it('ELIGIBLE account → Private is preselected (setMode once); never auto-records; no notice', async () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        render(<SessionPage />, { route: TRIAL_ROUTE });
        await waitFor(() => expect(setMode).toHaveBeenCalledWith('private'));
        expect(setMode).toHaveBeenCalledTimes(1);       // consumed once, not re-applied
        expect(handleStartStop).not.toHaveBeenCalled();  // NEVER auto-records / auto-downloads
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
    });

    it('INELIGIBLE account → stays on Browser with a truthful notice; Private is NOT selected', async () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: false }));
        mockUsageLimit.mockReturnValue(usage({ ...FREE_AVAILABLE, private_sample_available: false }));
        render(<SessionPage />, { route: TRIAL_ROUTE });
        await waitFor(() => expect(screen.getByTestId('private-trial-unavailable-notice')).toBeInTheDocument());
        expect(screen.getByTestId('private-trial-unavailable-notice')).toHaveTextContent(/Private isn’t available/i);
        expect(setMode).not.toHaveBeenCalledWith('private'); // no silent switch
        expect(handleStartStop).not.toHaveBeenCalled();
    });

    it('entitlement STILL LOADING (usageLimit undefined) → decision WAITS (no preselect, no notice)', () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true }));
        mockUsageLimit.mockReturnValue(usage(undefined));
        render(<SessionPage />, { route: TRIAL_ROUTE });
        expect(setMode).not.toHaveBeenCalled();
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
    });

    it('eligible but ALREADY RECORDING → DEFERS: no mid-recording switch, no notice', () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true, isListening: true }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        render(<SessionPage />, { route: TRIAL_ROUTE });
        expect(setMode).not.toHaveBeenCalledWith('private'); // never switch the engine mid-recording
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
    });

    it('no `?trial` param → the handoff is inert (no preselect, no notice)', () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        render(<SessionPage />, { route: PLAIN_ROUTE });
        expect(setMode).not.toHaveBeenCalled();
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
    });
});
