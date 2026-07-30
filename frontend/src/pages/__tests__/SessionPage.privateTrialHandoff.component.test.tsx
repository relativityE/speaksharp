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
import { useLocation } from 'react-router-dom';
import { SessionPage } from '../SessionPage';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as UsageLimitHook from '@/hooks/useUsageLimit';
import { useSessionStore } from '@/stores/useSessionStore';

// Observes the live router search so we can prove the ?trial=private lifecycle (retained while
// loading/recording; removed after an eligible/ineligible decision). Rendered inside the same router.
function LocationProbe() {
    const { search } = useLocation();
    return <div data-testid="loc-search">{search}</div>;
}
const searchNow = () => screen.getByTestId('loc-search').textContent ?? '';

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

const withProbe = () => <><SessionPage /><LocationProbe /></>;

// NOTE on "no auto-download": selecting Private (setMode('private')) triggers only a BACKGROUND
// readiness probe — useSessionLifecycle's warm-up effect calls speechRuntimeController.warmUp(), which
// updates the engine policy but never initiates a model byte-download. A missing model resolves to the
// durable `download-required` status; the actual download is owned by the mic click (onDownloadModel →
// initiateModelDownload). That behaviour is covered by the warm-up/model-status suites
// (useSessionLifecycle.test.tsx download-required cases; LiveRecordingCard first-run/#957). Here the
// lifecycle is mocked, so this suite proves only NO AUTO-RECORD (handleStartStop is never called) — it
// does not, and should not claim to, re-prove the no-auto-download property.
describe('SessionPage — #1047 anonymous Private-trial handoff (?trial=private)', () => {
    beforeEach(() => { vi.clearAllMocks(); useSessionStore.setState({ engineSelectionLocked: false }); });
    afterEach(() => { cleanup(); useSessionStore.setState({ engineSelectionLocked: false }); });

    it('ELIGIBLE account → Private preselected once; no auto-record; no notice; intent removed from URL', async () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        render(withProbe(), { route: TRIAL_ROUTE });
        await waitFor(() => expect(setMode).toHaveBeenCalledWith('private'));
        expect(setMode).toHaveBeenCalledTimes(1);        // preselected once, not re-applied
        expect(handleStartStop).not.toHaveBeenCalled();   // NEVER auto-records (no-download is cited above)
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
        await waitFor(() => expect(searchNow()).not.toContain('trial=private')); // consumed after the decision
    });

    it('INELIGIBLE account → Browser retained + truthful notice; Private NOT selected; intent removed', async () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: false }));
        mockUsageLimit.mockReturnValue(usage({ ...FREE_AVAILABLE, private_sample_available: false }));
        render(withProbe(), { route: TRIAL_ROUTE });
        await waitFor(() => expect(screen.getByTestId('private-trial-unavailable-notice')).toBeInTheDocument());
        expect(screen.getByTestId('private-trial-unavailable-notice')).toHaveTextContent(/Private isn’t available/i);
        expect(setMode).not.toHaveBeenCalledWith('private'); // no silent switch
        expect(handleStartStop).not.toHaveBeenCalled();
        await waitFor(() => expect(searchNow()).not.toContain('trial=private')); // consumed after the decision
    });

    it('entitlement STILL LOADING → decision waits; intent RETAINED in the URL', () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true }));
        mockUsageLimit.mockReturnValue(usage(undefined));
        render(withProbe(), { route: TRIAL_ROUTE });
        expect(setMode).not.toHaveBeenCalled();
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
        expect(searchNow()).toContain('trial=private'); // NOT consumed while loading
    });

    it('eligible but ALREADY RECORDING → defers with intent RETAINED, then preselects Private exactly once when idle', async () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true, isListening: true }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        const { rerender } = render(withProbe(), { route: TRIAL_ROUTE });
        // While recording: no switch, no notice, intent preserved for later.
        expect(setMode).not.toHaveBeenCalledWith('private');
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
        expect(searchNow()).toContain('trial=private');
        // Recording ends → the effect re-runs and applies the deferred intent, exactly once.
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true, isListening: false }));
        rerender(withProbe());
        await waitFor(() => expect(setMode).toHaveBeenCalledWith('private'));
        expect(setMode).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(searchNow()).not.toContain('trial=private')); // now consumed
    });

    it('eligible but ENGINE SELECTION LOCKED (not listening: stopping/saving/recovery) → defers with intent RETAINED, applies once the lock clears', async () => {
        // Regression for the P2: during STOPPING/SAVING/retry, isListening can be false while the
        // authoritative engineSelectionLocked is still held; acting then would consume the intent while
        // setMode is rejected, losing the handoff. The effect must defer on the LOCK, not just listening.
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true, isListening: false }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        useSessionStore.setState({ engineSelectionLocked: true });
        const { rerender } = render(withProbe(), { route: TRIAL_ROUTE });
        expect(setMode).not.toHaveBeenCalledWith('private'); // locked → no rejected switch
        expect(searchNow()).toContain('trial=private');       // intent preserved, not silently lost
        // Lock clears → the deferred intent applies exactly once.
        useSessionStore.setState({ engineSelectionLocked: false });
        rerender(withProbe());
        await waitFor(() => expect(setMode).toHaveBeenCalledWith('private'));
        expect(setMode).toHaveBeenCalledTimes(1);
    });

    it('no `?trial` param → the handoff is inert (no preselect, no notice)', () => {
        mockLifecycle.mockReturnValue(lifecycle({ canUsePrivateStt: true }));
        mockUsageLimit.mockReturnValue(usage(FREE_AVAILABLE));
        render(withProbe(), { route: PLAIN_ROUTE });
        expect(setMode).not.toHaveBeenCalled();
        expect(screen.queryByTestId('private-trial-unavailable-notice')).toBeNull();
    });
});
