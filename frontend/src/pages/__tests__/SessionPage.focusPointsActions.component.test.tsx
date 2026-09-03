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

const BRIEF = {
    projectId: 'proj-1', briefId: 'brief-1',
    points: ['Opening hook', 'The ask'], topic: 'Sales pitch', paceGuideSecPerPoint: 60,
};

const lifecycle = (over: Record<string, unknown> = {}) => ({
    isListening: false, isReady: true,
    metrics: { formattedTime: '00:00', wpm: 0, wpmLabel: 'Optimal', clarityScore: 0, clarityLabel: 'Good', fillerCount: 0 },
    sttStatus: { type: 'ready' as const, message: 'Ready' },
    modelLoadingProgress: null, mode: 'private' as const, setMode: vi.fn(),
    elapsedTime: 0, handleStartStop, showAnalyticsPrompt: false, sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '', fillerData: {}, isProUser: true, isButtonDisabled: false,
    sunsetModal: { type: 'daily', open: false },
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
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
    mockLifecycle.mockReturnValue(
        lifecycle({ showAnalyticsPrompt: true }) as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>,
    );
    const s = useSessionStore.getState();
    s.setCompletedObjectiveBrief(BRIEF);
    s.setObjectiveCoverageResult([
        { label: 'Opening hook', covered: true, coveredAtSec: 12, quote: null },
        { label: 'The ask', covered: false, coveredAtSec: null, quote: null },
    ] as never);
    return render(<SessionPage />);
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
