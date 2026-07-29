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

    it('shows the collapsed filler row with EXACTLY ONE empty message', () => {
        render(<SessionPage />);

        expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-collapsed', 'true');
        expect(screen.getByTestId('filler-tracking-summary'))
            .toHaveTextContent('Tracking 13 filler words — counts appear here once you speak.');

        // Neither of the two contradictory messages survives, and there are no zero chips.
        expect(screen.queryByText(/No filler words detected yet/i)).toBeNull();
        expect(screen.queryByText(/cannot be verified yet/i)).toBeNull();
        expect(screen.queryByTestId('filler-words-list')).toBeNull();
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

    it('does not stretch the coaching card to the recorder column', () => {
        render(<SessionPage />);

        const card = screen.getByTestId('live-coaching-score-card');
        expect(card).toHaveClass('self-start');
        expect(card).not.toHaveClass('self-stretch');
        expect(card).not.toHaveClass('h-full');
    });
});
