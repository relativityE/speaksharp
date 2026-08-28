/**
 * #1360 — the recovery surface must not promise what it cannot deliver.
 *
 * THE DEFECT. `SessionPage` told the user "A locally saved transcript draft is available" and offered
 * "Restore draft". Both statements were false:
 *
 *   - the recovery draft is CONTENT-FREE by construction. `sessionRecoveryDraft.ts` whitelists numeric
 *     fields explicitly rather than spreading input, and refuses outright to load any legacy draft
 *     carrying `transcript`, `ai_suggestions` or `ground_truth`. There has never been a transcript in it.
 *   - the handler behind "Restore draft" CLEARED the draft and set a status message. Nothing was
 *     restored. A user pressing it lost the draft and was told they had recovered something.
 *
 * These render the real page against the two real recovery states and assert on what a user would
 * actually read, so the copy cannot drift back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';
import type { SessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));

vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => <div /> }));
vi.mock('@/components/session/FillerWordsCard', () => ({ FillerWordsCard: () => <div /> }));
vi.mock('@/components/session/SpeakingTipsCard', () => ({ SpeakingTipsCard: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('@/components/session/UserFillerWordsManager', () => ({ UserFillerWordsManager: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));

const mockLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);
const mockRecovery = vi.mocked(RecoveryHook.useUnresolvedRecovery);

const dismissRecoveryDraft = vi.fn();
const acknowledgeRecoveryDraft = vi.fn();

const defaultLifecycle = {
    isListening: false,
    isReady: true,
    metrics: {
        formattedTime: '00:00', wpm: 0, wpmLabel: 'Optimal',
        clarityScore: 0, clarityLabel: 'Good', fillerCount: 0,
    },
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
    sunsetModal: { type: 'daily', open: false },
};

const draft = (
    recoveryState: SessionRecoveryDraft['recoveryState'],
    totalWords = 0,
): SessionRecoveryDraft => ({
    sessionId: 'sess-1',
    userId: 'user-1',
    recoveryState,
    durationSeconds: 42,
    // 'unknown' is a real member of the draft's mode union; 'native' was retired from it.
    mode: 'unknown',
    // Numbers only. There is no transcript field to populate — that is the point.
    metrics: totalWords > 0 ? { totalWords } : {},
    savedAt: new Date(0).toISOString(),
});

const renderWith = (recoveryDraft: SessionRecoveryDraft | null) => {
    mockRecovery.mockReturnValue({
        recoveryDraft, acknowledgeRecoveryDraft, dismissRecoveryDraft,
    } as unknown as ReturnType<typeof RecoveryHook.useUnresolvedRecovery>);
    return render(<SessionPage />);
};

beforeEach(() => {
    vi.clearAllMocks();
    mockLifecycle.mockReturnValue(
        defaultLifecycle as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>,
    );
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor('');
});

describe('an INTERRUPTED session promises nothing it cannot deliver', () => {
    it('says the session was interrupted and that no transcript was saved', () => {
        renderWith(draft('active_interrupted'));
        const message = screen.getByTestId('session-recovery-message').textContent ?? '';
        expect(message).toMatch(/interrupted/i);
        expect(message).toMatch(/no transcript was saved/i);
    });

    it('mentions partial measurements ONLY when the draft actually has some', () => {
        // Offering "partial measurements" for a draft holding none is the same class of promise as
        // offering a transcript that was never stored.
        //
        // The first render is UNMOUNTED before the second: two mounted copies leave two matching
        // elements in the document and `getByTestId` then throws on the ambiguity rather than
        // comparing anything.
        const first = renderWith(draft('active_interrupted', 0));
        expect(screen.getByTestId('session-recovery-message').textContent ?? '')
            .not.toMatch(/partial measurements/i);
        first.unmount();

        renderWith(draft('active_interrupted', 137));
        expect(screen.getByTestId('session-recovery-message').textContent ?? '')
            .toMatch(/partial measurements/i);
    });

    it('offers NO restore affordance — there is nothing to put back', () => {
        renderWith(draft('active_interrupted'));
        expect(screen.queryByTestId('session-recovery-restore')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
    });

    it('the only action dismisses, and cannot claim content was recovered', () => {
        renderWith(draft('active_interrupted', 12));
        const dismiss = screen.getByTestId('session-recovery-dismiss');
        expect(dismiss.textContent).toMatch(/dismiss/i);
        dismiss.click();
        expect(dismissRecoveryDraft).toHaveBeenCalledTimes(1);
        // The handler that used to sit behind "Restore draft" is not reachable from this surface.
        expect(acknowledgeRecoveryDraft).not.toHaveBeenCalled();
    });
});

describe('a FINALIZED PENDING-SAVE session states what actually survived', () => {
    it('says the measurements were kept and no transcript was stored', () => {
        renderWith(draft('finalized_pending_save', 210));
        const message = screen.getByTestId('session-recovery-message').textContent ?? '';
        expect(message).toMatch(/measurements were kept/i);
        expect(message).toMatch(/no transcript was stored/i);
    });

    it('is distinguishable from the interrupted state in the rendered output', () => {
        // The two states mean different things to a user — one lost the save, the other lost the
        // session. Rendering the same sentence for both would make the distinction unusable.
        const first = renderWith(draft('finalized_pending_save'));
        const finalized = screen.getByTestId('session-recovery-actions');
        expect(finalized.getAttribute('data-recovery-state')).toBe('finalized_pending_save');
        const finalizedText = screen.getByTestId('session-recovery-message').textContent;
        first.unmount();

        renderWith(draft('active_interrupted'));
        expect(screen.getByTestId('session-recovery-actions').getAttribute('data-recovery-state'))
            .toBe('active_interrupted');
        expect(screen.getByTestId('session-recovery-message').textContent).not.toBe(finalizedText);
    });
});

describe('no content-recovery wording survives anywhere on this surface', () => {
    it.each(['active_interrupted', 'finalized_pending_save'] as const)(
        '%s renders no transcript-available or restore promise',
        (state) => {
            const mounted = renderWith(draft(state, 99));
            const surface = screen.getByTestId('session-recovery-actions').textContent ?? '';
            // The exact old copy, and the affordance that went with it.
            expect(surface).not.toMatch(/transcript draft is available/i);
            expect(surface).not.toMatch(/restore draft/i);
            // Any claim that a transcript is available, however phrased.
            expect(surface).not.toMatch(/transcript[^.]*\bavailable\b/i);
            mounted.unmount();
        },
    );

    it('renders nothing at all when there is no draft', () => {
        renderWith(null);
        expect(screen.queryByTestId('session-recovery-actions')).not.toBeInTheDocument();
    });
});
