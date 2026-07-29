import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sessionCoachingMock = vi.hoisted(() => ({
    getSessionCoachingAssignment: vi.fn(() => ({
        variant: 'treatment',
        source: 'default',
        flag: 'session_live_coaching_score',
    })),
    trackSessionCoachingCardViewed: vi.fn(),
    trackSessionCoachingNumericScoreShown: vi.fn(),
}));

vi.mock('@/components/LocalErrorBoundary', () => ({
    LocalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@sentry/react', () => ({
    withScope: vi.fn((cb) => cb({ setTag: vi.fn(), setContext: vi.fn() })),
    captureException: vi.fn(),
}));

vi.mock('@/services/sessionCoachingExperiment', () => sessionCoachingMock);

// Only the recorder card is stubbed (it owns its own focused suite). The help island, the status bar,
// the transcript void and the filler band are the SUBJECT of these tests, so they render for real.
vi.mock('@/components/session/LiveRecordingCard', () => ({
    LiveRecordingCard: () => <div data-testid="live-recording-card" />,
}));
vi.mock('@/components/session/MobileActionBar', () => ({
    MobileActionBar: () => <div data-testid="mobile-action-bar" />,
}));

import { render, screen, cleanup } from '../../../tests/support/test-utils';
import { SessionPage } from '../SessionPage';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import { useSessionStore } from '@/stores/useSessionStore';
import { reconcileFinalizedFillers } from '@/utils/finalizedSessionAnalysis';

vi.mock('@/hooks/useSessionLifecycle', () => ({
    useSessionLifecycle: vi.fn(),
}));

const mockUseSessionLifecycle = vi.mocked(SessionLifecycleHook.useSessionLifecycle);

const THIRTEEN = [
    'um', 'uh', 'ah', 'like', 'you know', 'so', 'oh',
    'i mean', 'kind of', 'sort of', 'actually', 'basically', 'literally',
];

const idleLifecycle = {
    isListening: false,
    isReady: true,
    metrics: {
        formattedTime: '00:00',
        wpm: 0,
        wpmLabel: 'Optimal',
        clarityScore: 0,
        clarityLabel: 'Excellent',
        wordCount: 0,
        fillerCount: 0,
        fillerData: Object.fromEntries([
            ...THIRTEEN.map((w) => [w, { count: 0 }]),
            ['total', { count: 0 }],
        ]),
        // The second, contradictory empty message the old card rendered. Supplied on purpose: it must
        // not reach the screen.
        fillerExplanation: 'No transcript was captured, so filler words cannot be verified yet.',
    },
    sttStatus: { type: 'ready' as const, message: 'Mic ready' },
    modelLoadingProgress: null,
    mode: 'native' as const,
    setMode: vi.fn(),
    elapsedTime: 0,
    handleStartStop: vi.fn(),
    showAnalyticsPrompt: false,
    sessionFeedbackMessage: null,
    pauseMetrics: { totalPauses: 0, averagePauseDuration: 0, longPauses: 0, pauseRate: 0 },
    transcriptContent: '',
    interimTranscript: '',
    history: [],
    isProUser: false,
    isButtonDisabled: false,
    sunsetModal: { type: 'daily' as const, open: false },
};

describe('SessionPage — #1047 simplification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.sessionStorage.clear();
        window.history.pushState({}, '', '/session');
        sessionCoachingMock.getSessionCoachingAssignment.mockReturnValue({
            variant: 'treatment',
            source: 'default',
            flag: 'session_live_coaching_score',
        });
        mockUseSessionLifecycle.mockReturnValue(
            idleLifecycle as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>
        );
    });

    afterEach(() => cleanup());

    it('renders the help island INSIDE the title block, not above the status bar', () => {
        render(<SessionPage />);

        const titleBlock = screen.getByTestId('session-title-block');
        const helpButton = screen.getByTestId('freestyle-help-button');

        expect(titleBlock).toContainElement(helpButton);
        expect(titleBlock).toContainElement(screen.getByText('Practice Session'));
        // It is an ACTION, not another white status row: filled dark green, white text, with a glyph.
        expect(helpButton).toHaveClass('bg-[hsl(var(--session-green-deep))]', 'text-[15px]', 'font-bold');
        expect(helpButton.querySelector('.lucide-play')).not.toBeNull();
        // Decorative glyph is hidden, so the accessible name is the guide's title alone.
        expect(helpButton).toHaveAccessibleName('How Freestyle Practice works');
    });

    it('demotes the at-rest status bar and separates it from the help island', () => {
        render(<SessionPage />);

        const statusBar = screen.getByTestId('live-session-header');
        expect(statusBar).toHaveAttribute('data-quiet', 'true');
        expect(statusBar).not.toHaveClass('surface-shadow');
        // The separation is owned by the title block's bottom margin.
        expect(screen.getByTestId('session-title-block')).toHaveClass('mb-[34px]');
        // …and the status bar sits AFTER the title block in reading order.
        expect(screen.getByTestId('session-title-block').compareDocumentPosition(statusBar))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('shows the collapsed pre-recording filler row with EXACTLY ONE empty message', () => {
        render(<SessionPage />);

        expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-state', 'before-recording');
        expect(screen.getByTestId('filler-tracking-summary')).toHaveTextContent('Tracking 13 filler words');
        expect(screen.getByTestId('filler-support-text')).toHaveTextContent('Counts appear here as you speak.');

        // Neither of the two contradictory messages survives, and there are no zero chips.
        expect(screen.queryByText(/No filler words detected yet/i)).toBeNull();
        expect(screen.queryByText(/cannot be verified yet/i)).toBeNull();
        expect(screen.queryByTestId('filler-words-list')).toBeNull();
    });

    it('after a completed take with zero fillers, states the zero honestly and keeps the #894 disclosure', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...idleLifecycle,
            transcriptContent: 'a clean run with no fillers at all in it',
            metrics: { ...idleLifecycle.metrics, wordCount: 40 },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        render(<SessionPage />);

        expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-state', 'zero-detected');
        expect(screen.queryByText(/as you speak/i)).toBeNull();
        expect(screen.getByTestId('filler-measured-zero'))
            .toHaveTextContent('No detected filler words in this transcript.');
        expect(screen.getByTestId('filler-explanation'))
            .toHaveTextContent('Some spoken fillers may not appear in the transcript.');
    });

    it('never claims a filler result while the transcript is still finalizing', () => {
        useSessionStore.setState({ isTranscriptFinalizing: true });
        mockUseSessionLifecycle.mockReturnValue({
            ...idleLifecycle,
            transcriptContent: 'a take that has stopped and is still decoding',
            metrics: { ...idleLifecycle.metrics, wordCount: 40 },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        render(<SessionPage />);

        expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-state', 'finalizing');
        expect(screen.getByTestId('filler-finalizing-summary'))
            .toHaveTextContent('Checking your transcript for filler words');
        expect(screen.queryByText(/No detected filler words/i)).toBeNull();

        useSessionStore.setState({ isTranscriptFinalizing: false });
    });

    it('distinguishes "could not verify" from a verified zero after a take captured nothing', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...idleLifecycle,
            metrics: { ...idleLifecycle.metrics, wordCount: 0 },
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
        useSessionStore.setState({ completedSessionDurationSeconds: 12 });

        render(<SessionPage />);

        expect(screen.getByTestId('filler-words-card'))
            .toHaveAttribute('data-filler-state', 'insufficient-transcript');
        expect(screen.getByTestId('filler-unverified'))
            .toHaveTextContent('Not enough transcript to verify filler words.');
        expect(screen.queryByText(/No detected filler words/i)).toBeNull();

        useSessionStore.setState({ completedSessionDurationSeconds: null });
    });

    it('keeps the post-save bar prominent — it is never demoted to the ambient wash', () => {
        // The post-save bar is emitted as type 'ready', the same type as idle chrome. It must stay
        // prominent because it carries the reconciliation copy and the Analytics action.
        // Built with the real reconciler rather than a hand-rolled literal, so this fixture cannot
        // drift from the shape the page actually consumes.
        const finalized = {
            sessionId: 'sess-1',
            mode: 'native',
            reconciliation: reconcileFinalizedFillers('a clean finished take', {}),
            persistedTotal: 0,
        };
        useSessionStore.setState({ finalizedAnalysis: finalized });
        mockUseSessionLifecycle.mockReturnValue({
            ...idleLifecycle,
            showAnalyticsPrompt: true,
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        render(<SessionPage />);

        const statusBar = screen.getByTestId('live-session-header');
        expect(screen.getByTestId('post-save-review-session-link')).toBeInTheDocument();
        expect(statusBar).toHaveAttribute('data-quiet', 'false');
        expect(statusBar).toHaveClass('surface-shadow');

        useSessionStore.setState({ finalizedAnalysis: null });
    });

    it('gives the live transcript an explicit floor AND ceiling so it scrolls instead of growing', () => {
        mockUseSessionLifecycle.mockReturnValue({
            ...idleLifecycle,
            isListening: true,
            transcriptContent: 'words arriving during a long take',
        } as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);

        render(<SessionPage />);

        const container = screen.getByTestId('transcript-container');
        // The column no longer has a definite height, so `flex-1` cannot supply either bound.
        expect(container.className).toContain('min-h-[340px]');
        expect(container.className).toContain('max-h-[26rem]');
        expect(container.className).toContain('overflow-y-auto');
        expect(container.className).not.toContain('min-h-[160px]');
        expect(container).toHaveAttribute('data-autoscroll-transcript', 'true');
    });

    it('trims the transcript void to a dashed placeholder that says what goes there', () => {
        render(<SessionPage />);

        expect(screen.getByTestId('live-transcript-empty'))
            .toHaveTextContent('Your words appear here as you speak.');
        const container = screen.getByTestId('transcript-container');
        expect(container.className).toContain('border-dashed');
        // No reserved-but-unused height.
        expect(container.className).not.toContain('min-h-[160px]');
    });

    it('states "no score yet" exactly once on the page', () => {
        render(<SessionPage />);

        expect(screen.getAllByTestId('live-score-empty-panel')).toHaveLength(1);
        expect(screen.getByText('Session feedback')).toBeInTheDocument();
        // The label must NOT promise a Progress feature that does not exist.
        expect(screen.queryByText(/SpeakSharp Progress/i)).toBeNull();
        expect(screen.queryByText(/score soon/i)).toBeNull();
        expect(screen.queryByText(/Speak a little more to get a useful score/i)).toBeNull();
    });

    it('keeps the new surfaces keyboard-reachable, focus-visible and narrow-viewport safe', () => {
        render(<SessionPage />);

        const helpButton = screen.getByTestId('freestyle-help-button');
        // Focusable (never `disabled`, which would strip it from the tab order) with a visible ring.
        expect(helpButton.tagName).toBe('BUTTON');
        expect(helpButton).not.toBeDisabled();
        expect(helpButton.className).toContain('focus-visible:ring-2');
        helpButton.focus();
        expect(document.activeElement).toBe(helpButton);

        // 320px safety: the island's label must be allowed to wrap, and the collapsed filler row must
        // reflow rather than force horizontal scroll.
        expect(helpButton).toHaveClass('whitespace-normal', 'max-w-full');
        expect(screen.getByTestId('filler-words-card')).toHaveClass('flex-wrap');

        // Decorative graphics are hidden from assistive tech.
        expect(helpButton.querySelector('.lucide-play')).toHaveAttribute('aria-hidden', 'true');

        const fillerAction = screen.getByTestId('add-custom-word-button');
        expect(fillerAction).toHaveAccessibleName('Add your filler words');
        expect(fillerAction.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    // The card is called "Session feedback", so its help must TEACH session feedback. An earlier pass
    // renamed only the label and shipped a body that still explained "SpeakSharp Score" — the card
    // said one thing and its own help said another. Asserting the heading alone cleared that bar, so
    // this test OPENS the help and reads what a user would actually be shown.
    it('the Session help teaches session feedback — the retired name is absent from the OPENED panel', async () => {
        const { fireEvent } = await import('@testing-library/react');
        render(<SessionPage />);

        // Nothing on the closed Session surface carries the retired name.
        expect(document.body.textContent).not.toMatch(/SpeakSharp Score/i);

        // Screen readers hear the same name sighted users read.
        expect(screen.getByRole('region', { name: 'Session feedback' })).toBeInTheDocument();

        const helpTrigger = screen.getByTestId('score-help');
        expect(helpTrigger).toHaveAccessibleName('About session feedback');
        fireEvent.click(helpTrigger);

        const help = screen.getByTestId('score-help-content');
        expect(help.textContent).toContain(
            'Pace, detected fillers, delivery signals, and transcript quality support your session feedback.'
        );
        expect(help.textContent).toContain(
            'Session feedback is directional and uses only the practice evidence available for this session.'
        );

        // The retired name, the "one coaching score" promise, and the claim that the same score
        // reappears in Analytics are all gone — from the opened panel and from the whole page.
        expect(help.textContent).not.toMatch(/SpeakSharp Score/i);
        expect(help.textContent).not.toMatch(/one coaching score/i);
        expect(help.textContent).not.toMatch(/Analytics/i);
        expect(document.body.textContent).not.toMatch(/SpeakSharp Score/i);
    });

    it('does not stretch the coaching card to the recorder column', () => {
        render(<SessionPage />);

        const card = screen.getByTestId('live-coaching-score-card');
        expect(card).toHaveClass('self-start');
        expect(card).not.toHaveClass('self-stretch');
        expect(card).not.toHaveClass('h-full');
    });
});
