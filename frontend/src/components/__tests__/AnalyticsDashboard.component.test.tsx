import { fireEvent, render, screen } from '../../../tests/support/test-utils';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import type { UserProfile } from '@/types/user';
import { TEST_IDS } from '@/constants/testIds';

// Mock dependencies
vi.mock('../../lib/pdfGenerator', () => ({
    generateSessionPdf: vi.fn(),
}));

// Mock sub-components explicitly to ensure isolation
vi.mock('../analytics/STTAccuracyVsBenchmark', () => ({ STTAccuracyVsBenchmark: () => <div data-testid="accuracy-comparison" /> }));
vi.mock('../analytics/WeeklyActivityChart', () => ({ WeeklyActivityChart: () => <div data-testid="weekly-activity-chart" /> }));
vi.mock('../analytics/GoalsSection', () => ({ GoalsSection: () => <div data-testid="goals-section" /> }));
vi.mock('../analytics/TopFillerWords', () => ({ TopFillerWords: () => <div data-testid="top-filler-words" /> }));
vi.mock('../analytics/FillerWordTable', () => ({ FillerWordTable: () => <div data-testid="filler-word-table" /> }));
vi.mock('../analytics/TrendChart', () => ({ TrendChart: () => <div data-testid="trend-chart" /> }));

// Mock Recharts to avoid canvas/resize observer issues in JSDOM
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    LineChart: () => <div data-testid="line-chart" />,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
}));

// Define strict Mock Data matching Interfaces
const mockProfile: UserProfile = {
    id: 'test-user',
    email: 'test@example.com',
    subscription_status: 'free',
    created_at: '2023-01-01',
    usage_seconds: 0,
    usage_reset_date: '2023-01-01',
    // Optional fields omitted as per interface
};

// Matches local OverallStats type in AnalyticsDashboard.tsx
const mockStats = {
    totalSessions: 10,
    averageWPM: 120,
    avgFillerWordsPerMin: 5,
    totalPracticeTime: 300,
    totalPracticeTimeSeconds: 18000,
    averageSessionLength: 30,
    averageSessionLengthSeconds: 1800,
    avgClarity: 85,
    avgPausesPerMin: 8,
    chartData: [
        { date: '2023-01-01', 'FW/min': 5, clarity: 80 },
        { date: '2023-01-02', 'FW/min': 4, clarity: 85 },
    ],
};

const mockSessionHistory = [
    {
        id: 'session-1',
        user_id: 'test-user',
        created_at: '2023-01-01T10:00:00Z',
        duration: 600,
        total_words: 1200,
        filler_words: { um: { count: 5 } },
        accuracy: 0.9,
    },
];

describe('AnalyticsDashboard', () => {
    const defaultProps = {
        profile: mockProfile,
        sessionHistory: [],
        overallStats: mockStats,
        fillerWordTrends: {},
        loading: false,
        error: null,
        onUpgrade: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    const renderComponent = (propsOverride = {}) => {
        const props = { ...defaultProps, ...propsOverride };
        return render(<AnalyticsDashboard {...props} />);
    };

    it('should render loading skeleton when loading', () => {
        renderComponent({ loading: true });
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('saved-session (PDF report) row uses current vocabulary labels, not the old WPM/Fillers/Clarity card labels', () => {
        renderComponent({ sessionHistory: mockSessionHistory });
        // New product vocabulary on the saved-session row (matches the stat cards + PDF generator;
        // getAllByText because the same vocabulary intentionally appears on the stat cards too).
        expect(screen.getAllByText('Speaking Pace').length).toBeGreaterThan(0);
        // #894: the filler metric label is now "Detected filler words" (transcript-derived, honest lower bound).
        expect(screen.getAllByText('Detected filler words').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Clear Delivery').length).toBeGreaterThan(0);
        // The stale bare card labels are gone. "WPM" survives ONLY as the unit beside the value,
        // never as a standalone label element.
        expect(screen.queryByText('Fillers')).not.toBeInTheDocument();
        expect(screen.queryByText('Clarity')).not.toBeInTheDocument();
    });

    it('uses contained slide controls instead of outside carousel arrows', () => {
        renderComponent({ sessionHistory: mockSessionHistory });
        expect(screen.queryByRole('button', { name: 'Previous slide' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /Go to slide/i }).length).toBeGreaterThan(1);
    });

    it('should render error display when error occurs', () => {
        renderComponent({ error: new Error('Test error') });
        expect(screen.getByText(/Test error/i)).toBeInTheDocument();
    });

    it('should render empty state when no sessions', () => {
        renderComponent({ sessionHistory: [] });
        expect(screen.getByTestId('analytics-dashboard-empty-state')).toBeInTheDocument();
    });

    it('hides the upgrade prompt when effective entitlement is Pro even if the profile has not hydrated it yet', () => {
        renderComponent({
            sessionHistory: [],
            isProUser: true,
            profile: { ...mockProfile, subscription_status: 'free' },
        });

        expect(screen.getByTestId('analytics-dashboard-empty-state')).toBeInTheDocument();
        expect(screen.queryByTestId('analytics-upgrade-button')).not.toBeInTheDocument();
        expect(screen.queryByText(/Want unlimited sessions/i)).not.toBeInTheDocument();
    });

    it('should render dashboard content when data exists', () => {
        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByTestId('analytics-dashboard')).toBeInTheDocument();
        expect(screen.getByText('Analytics Focus')).toBeInTheDocument();
        expect(screen.getByText('Sound Confident')).toBeInTheDocument();
        expect(screen.getByText('Why these tools are here')).toBeInTheDocument();
        expect(screen.getByText(/stored evidence you can inspect/i)).toBeInTheDocument();
        expect(screen.queryByText(/SpeakSharp Score/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Sound Confident shows which ingredient to improve/i)).toBeInTheDocument();
        expect(screen.getByText(/These cards are selected together/i)).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-clarity_score')).toBeInTheDocument();
        expect(screen.queryByText('Delivery Control')).not.toBeInTheDocument();
        expect(screen.queryByText('Message Clarity')).not.toBeInTheDocument();
        expect(screen.queryByText('Habit Progress')).not.toBeInTheDocument();
        expect(screen.queryByText('Session Proof')).not.toBeInTheDocument();
        expect(screen.queryByText('Transcript Quality')).not.toBeInTheDocument();

        // Verify session list is rendered
        const sessionItems = screen.getAllByTestId(/session-history-item-/);
        expect(sessionItems.length).toBeGreaterThan(0);
    });

    it.each([
        {
            id: 'speak_clearly',
            label: 'Speak Clearly',
            outcome: /sharper point and less repetition/i,
            statCards: ['stat-card-clarity_score', 'stat-card-avg_session_length', 'stat-card-filler_words_per_min', 'stat-card-total_sessions'],
            hasTranscriptQuality: false,
        },
        {
            id: 'sound_confident',
            label: 'Sound Confident',
            outcome: /steadier, calmer, and more confident/i,
            // Sound Confident must surface Pause Rhythm so the cards match its "pace, pauses, fillers,
            // delivery" promise (regression guard against pauses being claimed but not shown).
            statCards: ['stat-card-speaking_pace', 'stat-card-pause_rhythm', 'stat-card-filler_words_per_min', 'stat-card-clarity_score'],
            hasTranscriptQuality: false,
        },
        {
            id: 'track_progress',
            label: 'Track Progress',
            outcome: /proof of what changed/i,
            statCards: ['stat-card-total_sessions', 'stat-card-total_practice_time', 'stat-card-avg_session_length', 'stat-card-clarity_score'],
            hasTranscriptQuality: false,
        },
    ])('renders the $label analytics focus as a coherent user story', ({ id, label, outcome, statCards, hasTranscriptQuality }) => {
        localStorage.setItem('speaksharp_analytics_tool_group_v1', id);

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
        expect(screen.getByText(outcome)).toBeInTheDocument();
        expect(screen.getByText(`Your ${label} signals`)).toBeInTheDocument();
        expect(screen.getByText(`${label} Tools`)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(`${label} shows which ingredient to improve`, 'i'))).toBeInTheDocument();
        for (const testId of statCards) {
            expect(screen.getByTestId(testId)).toBeInTheDocument();
        }

        const accuracyComparison = screen.queryByTestId('accuracy-comparison');
        expect(Boolean(accuracyComparison)).toBe(hasTranscriptQuality);
    });

    it('decodes Sound Confident tools into plain labels and shows one Try this next action', () => {
        // mockStats: averageWPM 120 → Slow (off); avgPausesPerMin 8 → Smooth; avgClarity 85 → Strong.
        localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
        renderComponent({ sessionHistory: mockSessionHistory });

        // Narrative-first: cards lead with the decoded coaching label.
        expect(screen.getByTestId('stat-card-speaking_pace-interpretation')).toHaveTextContent('Slow');
        expect(screen.getByTestId('stat-card-pause_rhythm-interpretation')).toHaveTextContent('Smooth');
        expect(screen.getByTestId('stat-card-clarity_score-interpretation')).toHaveTextContent('Strong');

        // Narrative-first: action first, then the named driver and a connecting "why".
        expect(screen.getByTestId('try-this-next-action'))
            .toHaveTextContent('Pick up the pace on familiar points.');
        expect(screen.getByTestId('try-this-next-driver'))
            .toHaveTextContent('Main driver: Speaking Pace — Slow');
        expect(screen.getByTestId('try-this-next-why'))
            .toHaveTextContent('Your pause rhythm and clear delivery are steady; pace is the main adjustment.');
    });

    it.each([
        ['delivery_control', 'Sound Confident'],
        ['message_clarity', 'Speak Clearly'],
        ['habit_progress', 'Track Progress'],
        ['session_proof', 'Track Progress'],
        ['transcript_quality', 'Speak Clearly'],
        ['custom_toolkit', 'Custom'],
    ])('maps legacy analytics focus %s to %s without showing old primary labels', (legacyFocus, expectedLabel) => {
        localStorage.setItem('speaksharp_analytics_tool_group_v1', legacyFocus);

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByRole('heading', { name: expectedLabel })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Delivery Control' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Message Clarity' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Habit Progress' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Session Proof' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Transcript Quality' })).not.toBeInTheDocument();
    });

    it('supports custom measurement when users want specific tools outside predefined groups', () => {
        localStorage.setItem('speaksharp_analytics_tool_group_v1', 'custom');
        localStorage.setItem('speaksharp_custom_stat_cards_v1', JSON.stringify(['total_sessions', 'clarity_score']));
        localStorage.setItem('speaksharp_custom_analysis_slides_v1', JSON.stringify(['stt_comparison']));

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByRole('heading', { name: 'Custom' })).toBeInTheDocument();
        expect(screen.getByText(/specific metrics/i)).toBeInTheDocument();
        expect(screen.getByText(/Custom metrics answer their own question/i)).toBeInTheDocument();
        expect(screen.getByText(/Selected tools are interpreted independently/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /choose stat cards/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /choose analysis tools/i })).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-total_sessions')).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-clarity_score')).toBeInTheDocument();
        expect(screen.queryByTestId('stat-card-speaking_pace')).not.toBeInTheDocument();
        expect(screen.getByTestId('accuracy-comparison')).toBeInTheDocument();
    });

    it('uses persisted WPM and clarity values for session comparison instead of recalculating legacy fields', () => {
        renderComponent({
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 111,
                    clarity_score: 77,
                    filler_words: { um: { count: 2 } },
                    accuracy: 0.9,
                    // #1047: an `available` transcript backs these persisted measurements so the comparison
                    // legitimately shows real numbers (not_captured/expired would correctly gate to N/A).
                    transcript: 'the practiced words for session one',
                    transcript_state: 'available',
                },
                {
                    id: 'session-2',
                    user_id: 'test-user',
                    created_at: '2023-01-02T10:00:00Z',
                    duration: 60,
                    total_words: 140,
                    wpm: 123,
                    clarity_score: 88,
                    filler_words: { um: { count: 1 } },
                    accuracy: 0.95,
                    transcript: 'the practiced words for session two',
                    transcript_state: 'available',
                },
            ],
        });

        screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
        fireEvent.click(screen.getByRole('button', { name: /compare selected/i }));

        expect(screen.getByText('Session Comparison')).toBeInTheDocument();
        expect(screen.getAllByText('111').length).toBeGreaterThan(0);
        expect(screen.getAllByText('123').length).toBeGreaterThan(0);
        expect(screen.getAllByText('77%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('88%').length).toBeGreaterThan(0);
    });

    it('does not double-count synthetic total filler rows in session detail metrics', () => {
        renderComponent({
            sessionId: 'session-1',
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 90,
                    filler_words: {
                        um: { count: 2 },
                        like: { count: 3 },
                        total: { count: 5 },
                    },
                    transcript: 'um like like like words',
                },
            ],
        });

        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('5');
    });

    it('SSOT: shows the persisted canonical filler count and does not inflate it from the transcript', () => {
        // Live-canonical SSOT: persisted total 2 is authoritative even though the transcript text contains
        // 4 filler-ish words. Previous behavior wrongly recalculated to max(persisted, recount) = 4.
        renderComponent({
            sessionId: 'session-1',
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 90,
                    filler_words: {
                        total: { count: 2 },
                    },
                    transcript: 'so this is like what I am testing so it should count like the live view',
                },
            ],
        });

        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('2');
    });

    it('explains session detail metrics so users can understand the numbers', () => {
        renderComponent({
            sessionId: 'session-1',
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 30,
                    total_words: 60,
                    wpm: 120,
                    clarity_score: 93,
                    filler_words: { um: { count: 2 } },
                    transcript: 'um this is a short practice sample with um enough words to explain the score',
                },
            ],
        });

        expect(screen.getByTestId('stat-card-speaking_pace-explanation')).toHaveTextContent(/a little relaxed/i);
        expect(screen.getByTestId('clarity-score-value-explanation')).toHaveTextContent(/filler/i);
        expect(screen.getByTestId('filler-count-value-explanation')).toHaveTextContent(/captured words/i);
    });

    it('does not show a fake perfect clarity score when a saved session has no transcript or words', () => {
        renderComponent({
            sessionId: 'empty-session',
            sessionHistory: [
                {
                    id: 'empty-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 30,
                    total_words: 0,
                    wpm: 0,
                    clarity_score: 100,
                    filler_words: {},
                    transcript: '',
                },
            ],
        });

        // #1045: unified vocabulary — the unscorable session says "Not enough data", not a bare "--".
        expect(screen.getByTestId('clarity-score-value')).toHaveTextContent(/not enough data/i);
        expect(screen.getByTestId('clarity-score-value-explanation')).toHaveTextContent(/cannot be scored/i);
    });

    it('#1131 round-4 (#1): an EXPIRED session shows its persisted clarity score but WITHHOLDS the recomputed explanation', () => {
        renderComponent({
            sessionId: 'expired-session',
            sessionHistory: [
                {
                    id: 'expired-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 88,
                    filler_words: { um: { count: 2 }, total: { count: 2 } },
                    // server-owned: transcript removed by retention, measurements survive.
                    transcript_state: 'expired',
                    transcript: null,
                },
            ],
        });

        // The persisted score still shows (measurements survive retention)…
        expect(screen.getByTestId('clarity-score-value')).toHaveTextContent(/88/);
        // …but the transcript-recomputed explanation (errorCount=0 from absent text) is withheld entirely.
        expect(screen.queryByTestId('clarity-score-value-explanation')).toBeNull();
        expect(screen.queryByTestId('stat-card-speaking_pace-explanation')).toBeNull();
        expect(screen.queryByTestId('filler-count-value-explanation')).toBeNull();
    });

    it('shows saved recording mode metadata in the session detail view', () => {
        renderComponent({
            sessionId: 'session-1',
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'private',
                    engine_version: 'transformers-js-2.17',
                    model_name: 'whisper-tiny.en',
                    device_type: 'cpu',
                    transcript: 'hello world',
                },
            ],
        });

        // item-8: user-facing copy shows ONLY the friendly mode (no model names); the exact
        // technical identity is preserved on data-* attributes for tests/telemetry.
        const engineMetadata = screen.getByTestId('session-engine-metadata');
        expect(engineMetadata).toHaveTextContent('Private');
        expect(engineMetadata).not.toHaveTextContent('whisper-tiny.en');
        expect(engineMetadata).toHaveAttribute('data-model', 'whisper-tiny.en');
        expect(engineMetadata).toHaveAttribute('data-engine-version', 'transformers-js-2.17');
        expect(engineMetadata).toHaveAttribute('data-device-type', 'cpu');
    });

    it('normalizes native metadata and hides placeholder details in detail view', () => {
        renderComponent({
            sessionId: 'native-session',
            sessionHistory: [
                {
                    id: 'native-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'native',
                    engine_version: 'unknown',
                    model_name: 'unknown',
                    device_type: 'unknown',
                },
            ],
        });

        expect(screen.getByTestId('session-engine-metadata')).toHaveTextContent(
            'Browser'
        );
    });

    it('renders the saved Native transcript in the session detail view and exposes it for proofs', () => {
        renderComponent({
            sessionId: 'native-session',
            sessionHistory: [
                {
                    id: 'native-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 6,
                    engine: 'native',
                    transcript: 'native browser microphone proof works',
                },
            ],
        });

        const detail = screen.getByTestId('session-detail-transcript');
        expect(detail).toHaveTextContent('native browser microphone proof works');
        expect(detail).toHaveAttribute('data-session-detail-transcript', 'native browser microphone proof works');
    });

    it('REGRESSION: a whitespace-only placeholder transcript shows the empty fallback, not a blank panel', () => {
        // A session that started (placeholder `transcript: " "`) but was never finalized
        // must not render a silent blank panel that looks like a lost transcript.
        renderComponent({
            sessionId: 'placeholder-session',
            sessionHistory: [
                {
                    id: 'placeholder-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 5,
                    total_words: 0,
                    engine: 'native',
                    transcript: ' ',
                },
            ],
        });

        const detail = screen.getByTestId('session-detail-transcript');
        // #1047 PR-U1: a placeholder-only transcript (no server transcript_state) derives not_captured and
        // shows the honest reason, not the old ambiguous "No transcript available for this session." blank.
        expect(detail).toHaveTextContent('No transcript was captured.');
        expect(detail).toHaveAttribute('data-transcript-state', 'not_captured');
        expect(detail).toHaveAttribute('data-session-detail-transcript', '');
    });

    it('shows a transcript-quality caveat in the detail view for a weak (Native) saved session', () => {
        renderComponent({
            sessionId: 'native-weak',
            sessionHistory: [
                {
                    id: 'native-weak',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 36,
                    wpm: 110,
                    clarity_score: 80,
                    engine: 'native',
                    transcript: 'This is a clear practice sentence. It has proper punctuation throughout. I am speaking about my project update today. There are several distinct sentences here. That should be more than enough words to score this sample.',
                },
            ],
        });

        const caveat = screen.getByTestId('session-detail-quality-caveat');
        expect(caveat).toBeInTheDocument();
        expect(caveat).toHaveTextContent(/directional|filler/i);
    });

    it('does NOT show the quality caveat for a clean, trusted (Private) saved session', () => {
        renderComponent({
            sessionId: 'private-clean',
            sessionHistory: [
                {
                    id: 'private-clean',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 16,
                    wpm: 120,
                    clarity_score: 90,
                    engine: 'private',
                    transcript: 'This is a clear sentence. Here is another one. And a third, just to be sure.',
                },
            ],
        });

        expect(screen.queryByTestId('session-detail-quality-caveat')).not.toBeInTheDocument();
    });

    it('shows PDF export in saved session detail without script upload controls', () => {
        renderComponent({
            sessionId: 'free-session',
            profile: { ...mockProfile, subscription_status: 'free' },
            sessionHistory: [
                {
                    id: 'free-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 90,
                    filler_words: { um: { count: 1 } },
                    transcript: 'hello world',
                },
            ],
        });

        expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
        expect(screen.queryByTestId('upload-ground-truth-btn')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upload script|update script/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/reference script/i)).not.toBeInTheDocument();
    });

    it('shows visible STT engine badges on session history cards', () => {
        renderComponent({
            sessionHistory: [
                {
                    id: 'cloud-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'cloud',
                },
                {
                    id: 'private-session',
                    user_id: 'test-user',
                    created_at: '2023-01-02T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'private',
                },
                {
                    id: 'native-session',
                    user_id: 'test-user',
                    created_at: '2023-01-03T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'native',
                },
            ],
        });

        expect(screen.getByTestId('session-engine-badge-cloud-session')).toHaveTextContent('Cloud');
        expect(screen.getByTestId('session-engine-badge-private-session')).toHaveTextContent('Private');
        expect(screen.getByTestId('session-engine-badge-native-session')).toHaveTextContent('Browser');
    });

    it('shows an explicit open-session link on each history item so testers can verify saved sessions', () => {
        renderComponent({ sessionHistory: mockSessionHistory });

        const openLink = screen.getAllByRole('link', { name: /open saved session details/i })[0];

        expect(openLink).toHaveAttribute('href', '/analytics/session-1');
    });

    // #1047 PR-U1: the session-detail transcript honors the server-owned transcript_state — available text
    // renders, expired/not_captured show their honest reason (never the removed text, never an ordinary
    // empty transcript), measurements stay visible, and the AI/text action is disabled when unavailable.
    describe('#1047 detail transcript-state matrix', () => {
        const detailSession = (over: Record<string, unknown>) => ([{
            id: 'sx', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
            duration: 600, total_words: 1200, wpm: 120, clarity_score: 85,
            filler_words: { um: { count: 5 } }, accuracy: 0.9, ...over,
        }]);

        it('available → renders the transcript text and enables the AI action', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({ transcript: 'the practiced words', transcript_state: 'available' }) });
            const el = screen.getByTestId('session-detail-transcript');
            expect(el).toHaveAttribute('data-transcript-state', 'available');
            expect(el.textContent).toContain('the practiced words');
            expect(screen.getByRole('button', { name: /Get Suggestions/i })).toBeEnabled();
        });

        it('expired → shows the reason, hides the removed text, keeps measurements, disables the AI action', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({ transcript: 'removed words', transcript_state: 'expired' }) });
            const el = screen.getByTestId('session-detail-transcript');
            expect(el).toHaveAttribute('data-transcript-state', 'expired');
            expect(el.textContent).toContain('Transcript expired. Your measurements are still available.');
            expect(el.textContent).not.toContain('removed words');
            expect(screen.getAllByText('Speaking Pace').length).toBeGreaterThan(0); // measurements remain visible
            expect(screen.getByRole('button', { name: /Get Suggestions/i })).toBeDisabled();
        });

        it('not_captured → shows the reason and disables the AI action', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({ transcript: '', transcript_state: 'not_captured' }) });
            const el = screen.getByTestId('session-detail-transcript');
            expect(el).toHaveAttribute('data-transcript-state', 'not_captured');
            expect(el.textContent).toContain('No transcript was captured.');
            expect(screen.getByRole('button', { name: /Get Suggestions/i })).toBeDisabled();
        });

        it('not_captured with sentinel metrics → detail tiles show Not enough data, never a measured zero', () => {
            renderComponent({
                sessionId: 'sx',
                sessionHistory: [{
                    id: 'sx', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                    duration: 600, total_words: 0, filler_words: {}, transcript: '', transcript_state: 'not_captured',
                }],
            });
            // The Speaking Pace tile reads "Not enough data", not a sentinel zero.
            expect(screen.getAllByText(/Not enough data/i).length).toBeGreaterThan(0);
            const paceCard = screen.getByTestId(TEST_IDS.STAT_CARD_SPEAKING_PACE);
            expect(paceCard.textContent).toContain('Not enough data');
            expect(paceCard.textContent).not.toMatch(/\b0\s*WPM\b/);
        });
    });

    it('#1047 not_captured history item shows N/A for transcript-derived metrics (no sentinel zeros)', () => {
        renderComponent({
            sessionHistory: [{
                id: 'nc-1', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                duration: 600, total_words: 0, filler_words: {}, transcript: '', transcript_state: 'not_captured',
            }],
        });
        const row = screen.getByTestId(`${TEST_IDS.SESSION_HISTORY_ITEM}-nc-1`);
        expect(row.textContent).toContain('N/A');
        expect(row.textContent).not.toMatch(/\b0\s*WPM\b/);
    });
});
