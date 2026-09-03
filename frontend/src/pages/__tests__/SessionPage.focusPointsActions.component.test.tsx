/**
 * #1407 — "Start a new set" and "Edit" were unreachable.
 *
 * THE DEFECT. `FocusPointsRail` renders Edit only when given `onEdit`, and "Start a new set" only when
 * given `onNewSet`. `SessionOverhaulView` accepted both and forwarded them. `SessionPage` passed
 * NEITHER, so both were permanently `undefined` and the buttons never mounted. Nothing failed: the props
 * are optional, so TypeScript was satisfied by controls that could not exist. `onRetry` survived only
 * because it had a `?? onStartStop` fallback.
 *
 * These drive the REAL parent chain — SessionPage → SessionOverhaulView → FocusPointsRail — because a
 * leaf test that hands the rail a callback directly cannot see the missing wiring that WAS the bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => <div /> }));
vi.mock('@/components/session/FillerWordsCard', () => ({ FillerWordsCard: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div /> }));
vi.mock('@/components/session/UserFillerWordsManager', () => ({ UserFillerWordsManager: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
// The rendered safety gate is OWNER-SCOPED: it compares progressGateResolvedFor to the authenticated
// user's id. Without a resolved owner the gate can never match, so Start is disabled for reasons that
// have nothing to do with #1407 — the test would then pass or fail on the wrong mechanism.
const AUTH_USER_ID = 'user-1';
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    return { ...actual, useAuthProvider: () => ({ session: { user: { id: AUTH_USER_ID } } }) };
});

// The capture form persists through guarded RPCs. Stub the FORM only — the dialog, the page wiring and
// the rail stay real, because the wiring is the thing under test.
const formSpy = vi.fn();
vi.mock('@/components/session/ObjectiveSetupForm', () => ({
    ObjectiveSetupForm: (props: { onReady?: (r: unknown) => void; initial?: unknown }) => {
        formSpy(props.initial);
        return (
            <div data-testid="objective-setup-form">
                <div data-testid="seeded-initial">{JSON.stringify(props.initial ?? null)}</div>
                <button
                    type="button"
                    data-testid="objective-setup-save"
                    onClick={() => props.onReady?.({
                        briefId: 'brief-2', projectId: 'proj-2',
                        points: ['New A', 'New B'], topic: 'New topic', paceGuideSecPerPoint: 90,
                    })}
                >save</button>
            </div>
        );
    },
}));

const mockLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);
const mockRecovery = vi.mocked(RecoveryHook.useUnresolvedRecovery);
const handleStartStop = vi.fn();
/**
 * The analytics prompt is LIFECYCLE state, not store state. The double models it as a real value the
 * page can turn off, because "did the page leave the terminal after-projection?" is exactly the P1.
 */
let promptOn = false;
const setShowAnalyticsPrompt = vi.fn((v: boolean) => { promptOn = v; rerenderPage?.(); });
let rerenderPage: (() => void) | null = null;

const BRIEF = {
    projectId: 'proj-1', briefId: 'brief-1',
    points: ['Opening hook', 'The ask'], topic: 'Sales pitch', paceGuideSecPerPoint: 60,
};

const lifecycle = (over: Record<string, unknown> = {}) => ({
    isListening: false, isReady: true,
    metrics: { formattedTime: '00:00', wpm: 0, wpmLabel: 'Optimal', clarityScore: 0, clarityLabel: 'Good', fillerCount: 0 },
    sttStatus: { type: 'ready' as const, message: 'Ready' },
    modelLoadingProgress: null, mode: 'private' as const, setMode: vi.fn(),
    elapsedTime: 0, handleStartStop, showAnalyticsPrompt: promptOn, setShowAnalyticsPrompt,
    sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '', fillerData: {}, isProUser: true, isButtonDisabled: false,
    sunsetModal: { type: 'daily', open: false },
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    promptOn = false;
    rerenderPage = null;
    useSessionStore.getState().resetSession();
    mockRecovery.mockReturnValue({
        recoveryDraft: null, acknowledgeRecoveryDraft: vi.fn(), dismissRecoveryDraft: vi.fn(),
    } as unknown as ReturnType<typeof RecoveryHook.useUnresolvedRecovery>);
    mockLifecycle.mockReturnValue(lifecycle() as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
});

/** BEFORE a take: an active brief, nothing recorded yet. */
const givenBeforeTake = () => {
    useSessionStore.getState().setActiveObjectiveBrief(BRIEF);
    return render(<SessionPage />);
};

/** AFTER review: the take is finished, its brief snapshotted, coverage on screen.
 *  `showAnalyticsPrompt` is what resolves the view to the 'after' state (see resolveSessionState). */
const givenAfterReview = () => {
    promptOn = true;
    // Recomputed on every render so turning the prompt off is observable in the rendered output.
    mockLifecycle.mockImplementation(
        () => lifecycle() as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>,
    );
    const s = useSessionStore.getState();
    s.setCompletedObjectiveBrief(BRIEF);
    s.setObjectiveCoverageResult([
        { label: 'Opening hook', covered: true, coveredAtSec: 12, quote: null },
        { label: 'The ask', covered: false, coveredAtSec: null, quote: null },
    ] as never);
    const utils = render(<SessionPage />);
    rerenderPage = () => utils.rerender(<SessionPage />);
    return utils;
};

describe('#1407 Edit — reachable before a Focus Points take', () => {
    it('CASUALTY: Edit is RENDERED through the real page chain', () => {
        givenBeforeTake();
        expect(screen.getByTestId('focus-points-edit')).toBeInTheDocument();
    });

    it('opens the existing setup seeded with the current topic, points and pace', async () => {
        const user = userEvent.setup();
        givenBeforeTake();
        await user.click(screen.getByTestId('focus-points-edit'));
        await screen.findByTestId('objective-setup-form');
        expect(JSON.parse(screen.getByTestId('seeded-initial').textContent ?? 'null')).toEqual({
            topic: 'Sales pitch',
            points: ['Opening hook', 'The ask'],
            paceGuideSecPerPoint: 60,
        });
    });

    it('saving REBINDS the edited brief to Focus Points', async () => {
        const user = userEvent.setup();
        givenBeforeTake();
        await user.click(screen.getByTestId('focus-points-edit'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => {
            expect(useSessionStore.getState().activeObjectiveBrief).toMatchObject({
                briefId: 'brief-2', points: ['New A', 'New B'], topic: 'New topic',
            });
        });
    });

    it('CANCEL preserves the existing brief', async () => {
        const user = userEvent.setup();
        givenBeforeTake();
        await user.click(screen.getByTestId('focus-points-edit'));
        await screen.findByTestId('objective-setup-form');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByTestId('objective-setup-form')).not.toBeInTheDocument());
        expect(useSessionStore.getState().activeObjectiveBrief).toMatchObject({ briefId: 'brief-1' });
    });

    it('CASUALTY: Edit never starts recording and never switches to Open Mic', async () => {
        const user = userEvent.setup();
        givenBeforeTake();
        await user.click(screen.getByTestId('focus-points-edit'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief?.briefId).toBe('brief-2'));
        expect(handleStartStop, 'editing points must not begin a take').not.toHaveBeenCalled();
        // Still a Focus Points session: a bound brief IS the objective product.
        expect(useSessionStore.getState().activeObjectiveBrief).toBeTruthy();
    });
});

describe('#1407 Start a new set — reachable after review', () => {
    it('CASUALTY: "Start a new set" is RENDERED through the real page chain', () => {
        givenAfterReview();
        expect(screen.getByTestId('focus-points-new-set')).toBeInTheDocument();
    });

    it('opens the setup BLANK — no prior topic, points or pace carry over', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await screen.findByTestId('objective-setup-form');
        expect(JSON.parse(screen.getByTestId('seeded-initial').textContent ?? 'null'),
            'a new set must not inherit the reviewed brief').toBeNull();
    });

    // Without this, seeding "new" from whatever brief happens to be bound passes unnoticed: after a plain
    // take `activeObjectiveBrief` is already null, so the blank assertion above holds either way.
    it('CASUALTY: blank even when a brief is still bound — the source of the seed, not its emptiness', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        useSessionStore.getState().setActiveObjectiveBrief(BRIEF);
        await user.click(screen.getByTestId('focus-points-new-set'));
        await screen.findByTestId('objective-setup-form');
        expect(JSON.parse(screen.getByTestId('seeded-initial').textContent ?? 'null'),
            'a new set must be blank regardless of what is bound').toBeNull();
    });

    it('CASUALTY: saving clears the reviewed take — coverage and completed brief do not survive', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        expect(useSessionStore.getState().objectiveCoverageResult).not.toBeNull();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief?.briefId).toBe('brief-2'));
        const after = useSessionStore.getState();
        expect(after.objectiveCoverageResult, 'old coverage beside a new set is a lie about what was measured').toBeNull();
        expect(after.completedObjectiveBrief).toBeNull();
    });

    it('binds the new brief and returns to Focus Points without recording or switching product', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => {
            expect(useSessionStore.getState().activeObjectiveBrief).toMatchObject({
                briefId: 'brief-2', points: ['New A', 'New B'],
            });
        });
        expect(handleStartStop, 'a new set must not begin a take').not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByTestId('objective-setup-form')).not.toBeInTheDocument());
    });
});

describe('#1407 — Retry and Open Mic are untouched', () => {
    it('"Retry these points" still rebinds the completed brief and starts a take', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-retry'));
        expect(handleStartStop).toHaveBeenCalled();
        expect(useSessionStore.getState().activeObjectiveBrief).toMatchObject({ briefId: 'brief-1' });
    });

    it('Open Mic (no brief) shows no Focus Points actions at all', () => {
        render(<SessionPage />);
        expect(screen.queryByTestId('focus-points-edit')).toBeNull();
        expect(screen.queryByTestId('focus-points-new-set')).toBeNull();
    });
});

/**
 * #1409 RETURN — the two P1s found in review. Both made "Start a new set" finish in a state the user
 * could not actually use, which no assertion on the store alone would have caught.
 */
describe('#1409 P1 — after saving a new set the user is back BEFORE a take, and can start it', () => {
    it('CASUALTY: the pre-take Focus Points screen renders with the NEW topic, points and pace', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));

        // Left the terminal analytics projection: the lifecycle prompt is off.
        await waitFor(() => expect(setShowAnalyticsPrompt).toHaveBeenCalledWith(false));

        // The new brief is what the pre-take screen is built from.
        await waitFor(() => {
            expect(useSessionStore.getState().activeObjectiveBrief).toMatchObject({
                briefId: 'brief-2', points: ['New A', 'New B'], topic: 'New topic', paceGuideSecPerPoint: 90,
            });
        });
        const rail = await screen.findByTestId('focus-points-rail');
        expect(rail).toHaveTextContent('New A');
        expect(rail).toHaveTextContent('New B');
        expect(rail).toHaveTextContent('New topic');
        expect(rail, 'the previous set must be gone').not.toHaveTextContent('Opening hook');
    });

    it('CASUALTY: Edit is present, and completed-review semantics are absent', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(setShowAnalyticsPrompt).toHaveBeenCalledWith(false));

        expect(await screen.findByTestId('focus-points-edit')).toBeInTheDocument();
        // The after-state controls belong to a finished take, not to a set that has not been spoken yet.
        expect(screen.queryByTestId('focus-points-new-set')).toBeNull();
        expect(screen.queryByTestId('focus-points-retry')).toBeNull();
    });

    it('CASUALTY: recording has NOT started', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(setShowAnalyticsPrompt).toHaveBeenCalledWith(false));
        expect(handleStartStop).not.toHaveBeenCalled();
    });

    it('CASUALTY: Start is AVAILABLE for a viewer whose gate is already resolved with no debt', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        // A resolved, debt-free gate — the state a returning user is already in.
        useSessionStore.getState().setProgressGate(null);
        useSessionStore.getState().setProgressGateResolvedFor(AUTH_USER_ID);

        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(setShowAnalyticsPrompt).toHaveBeenCalledWith(false));

        // The whole-store reset wiped this, the reconciliation effect did not rerun (same user), and the
        // rendered gate blocked Start on the set the user had just created.
        expect(useSessionStore.getState().progressGateResolvedFor,
            'a new set must not un-resolve the safety gate').toBe(AUTH_USER_ID);
        // `mic-start` is the enabled speaking control; a blocked gate renders it disabled.
        const start = await screen.findByTestId('mic-start');
        expect(start, 'the user must be able to start the set they just created').toBeEnabled();
    });
});

describe('#1409 P1 — the scoped reset preserves app-global authority', () => {
    it('CASUALTY: a RESOLVED, no-debt gate survives starting a new set', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        useSessionStore.getState().setProgressGate(null);
        useSessionStore.getState().setProgressGateResolvedFor(AUTH_USER_ID);

        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief?.briefId).toBe('brief-2'));

        const s = useSessionStore.getState();
        expect(s.progressGateResolvedFor).toBe(AUTH_USER_ID);
        expect(s.progressGate).toBeNull();
    });

    it('CASUALTY: an EXISTING-DEBT gate is preserved too — a new set must not launder it away', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        const debt = { kind: 'retention_failed', sessionId: 'sess-9' } as never;
        useSessionStore.getState().setProgressGate(debt);
        useSessionStore.getState().setProgressGateResolvedFor(AUTH_USER_ID);

        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief?.briefId).toBe('brief-2'));

        const s = useSessionStore.getState();
        expect(s.progressGate, 'outstanding debt must survive a new set').toEqual(debt);
        expect(s.progressGateResolvedFor).toBe(AUTH_USER_ID);
    });

    it('the take and its review ARE cleared — the scoped reset still does its job', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        expect(useSessionStore.getState().objectiveCoverageResult).not.toBeNull();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await user.click(await screen.findByTestId('objective-setup-save'));
        await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief?.briefId).toBe('brief-2'));
        const s = useSessionStore.getState();
        expect(s.objectiveCoverageResult).toBeNull();
        expect(s.completedObjectiveBrief).toBeNull();
        expect(s.sessionSaved).toBe(false);
    });
});

describe('#1409 — cancelling a new set changes nothing', () => {
    it('CASUALTY: Cancel preserves the completed review and coverage, and creates no phantom brief', async () => {
        const user = userEvent.setup();
        givenAfterReview();
        await user.click(screen.getByTestId('focus-points-new-set'));
        await screen.findByTestId('objective-setup-form');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByTestId('objective-setup-form')).not.toBeInTheDocument());

        const s = useSessionStore.getState();
        expect(s.completedObjectiveBrief, 'the reviewed brief must survive a cancel').toMatchObject({ briefId: 'brief-1' });
        expect(s.objectiveCoverageResult, 'coverage must survive a cancel').not.toBeNull();
        expect(s.activeObjectiveBrief, 'cancelling must not bind a phantom brief').toBeNull();
        expect(setShowAnalyticsPrompt).not.toHaveBeenCalledWith(false);
        expect(handleStartStop).not.toHaveBeenCalled();
        // Still the completed review the user was looking at.
        expect(screen.getByTestId('focus-points-new-set')).toBeInTheDocument();
    });
});
