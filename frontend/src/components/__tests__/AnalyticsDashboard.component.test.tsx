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

// Mock sub-components explicitly to ensure isolation.
// #1306: the STTAccuracyVsBenchmark / by-engine comparison component is REMOVED — no mock, no surface.
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
        filler_counts: { um: 5 },
        status: 'completed',
        next_action_signal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
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

    it('stacks every analysis tool instead of hiding them behind a carousel (#G4 §3)', () => {
        renderComponent({ sessionHistory: mockSessionHistory });
        // The carousel is retired: no swipe arrows, no indicator dots.
        expect(screen.queryByRole('button', { name: 'Previous slide' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Go to slide/i })).not.toBeInTheDocument();
        // The default focus renders three trend charts (pace, pause, clarity). All are in the DOM at
        // once now — under the old carousel only the active slide mounted, so exactly one would appear.
        expect(screen.getAllByTestId('trend-chart').length).toBeGreaterThan(1);
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
        expect(screen.getByText('Working on')).toBeInTheDocument();
        expect(screen.getByText('Sound Confident')).toBeInTheDocument();
        expect(screen.queryByText(/SpeakSharp Score/i)).not.toBeInTheDocument();
        // #G4: the explanation boxes + "selected together" subtitle are gone; the section leads with a
        // position-based heading instead of a sentence.
        expect(screen.queryByText('Why these tools are here')).not.toBeInTheDocument();
        expect(screen.queryByText(/These cards are selected together/i)).not.toBeInTheDocument();
        expect(screen.getByText(/that.s based on/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Across your last 6 sessions/i).length).toBeGreaterThan(0);
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
        },
        {
            id: 'sound_confident',
            label: 'Sound Confident',
            outcome: /steadier, calmer, and more confident/i,
            // Sound Confident must surface Pause Rhythm so the cards match its "pace, pauses, fillers,
            // delivery" promise (regression guard against pauses being claimed but not shown).
            statCards: ['stat-card-speaking_pace', 'stat-card-pause_rhythm', 'stat-card-filler_words_per_min', 'stat-card-clarity_score'],
        },
        {
            id: 'track_progress',
            label: 'Track Progress',
            outcome: /proof of what changed/i,
            statCards: ['stat-card-total_sessions', 'stat-card-total_practice_time', 'stat-card-avg_session_length', 'stat-card-clarity_score'],
        },
    ])('renders the $label analytics focus as a coherent user story', ({ id, label, statCards }) => {
        localStorage.setItem('speaksharp_analytics_tool_group_v1', id);

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
        // #G4: focus explanation boxes deleted; signals section leads with a position-based heading.
        expect(screen.getByText(/that.s based on/i)).toBeInTheDocument();
        for (const testId of statCards) {
            expect(screen.getByTestId(testId)).toBeInTheDocument();
        }
        // #1306: the customer STT-accuracy / by-engine comparison surface no longer exists anywhere.
        expect(screen.queryByTestId('accuracy-comparison')).not.toBeInTheDocument();
    });

    it('decodes Sound Confident tools into plain labels and shows one Try this next action', () => {
        // mockStats: averageWPM 120 → Slow (off); avgPausesPerMin 8 → Smooth; avgClarity 85 → Strong.
        localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
        renderComponent({ sessionHistory: mockSessionHistory });

        // #G4 §2: cards lead with the NUMBER; the coaching label + guidance sit in the one sentence below.
        expect(screen.getByTestId('stat-card-speaking_pace-detail')).toHaveTextContent('Slow');
        expect(screen.getByTestId('stat-card-pause_rhythm-detail')).toHaveTextContent('Smooth');
        expect(screen.getByTestId('stat-card-clarity_score-detail')).toHaveTextContent('Strong');
        // The status chip carries the one scale (fix / on track / need more).
        expect(screen.getByTestId('stat-card-speaking_pace-chip')).toHaveTextContent('FIX THIS');
        expect(screen.getByTestId('stat-card-pause_rhythm-chip')).toHaveTextContent('ON TRACK');

        // #G4 §1 hero: the imperative action leads; the evidence paragraph carries the connecting "why".
        expect(screen.getByTestId('try-this-next-action'))
            .toHaveTextContent('Pick up the pace on familiar points.');
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
        localStorage.setItem('speaksharp_custom_analysis_slides_v1', JSON.stringify(['clarity_trend', 'filler_words']));

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByRole('heading', { name: 'Custom' })).toBeInTheDocument();
        expect(screen.getByText(/specific metrics/i)).toBeInTheDocument();
        // #G4: the focus explanation boxes + "interpreted independently" subtitle are deleted.
        expect(screen.getByRole('button', { name: /choose stat cards/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /choose analysis tools/i })).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-total_sessions')).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-clarity_score')).toBeInTheDocument();
        expect(screen.queryByTestId('stat-card-speaking_pace')).not.toBeInTheDocument();
        // #1306: no customer STT-accuracy / by-engine comparison surface exists to select.
        expect(screen.queryByTestId('accuracy-comparison')).not.toBeInTheDocument();
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
                    filler_counts: { um: 2 },
                    // #1306: persisted measurements are present, so the comparison legitimately shows real
                    // numbers (an absent metric would correctly gate to N/A).
                },
                {
                    id: 'session-2',
                    user_id: 'test-user',
                    created_at: '2023-01-02T10:00:00Z',
                    duration: 60,
                    total_words: 140,
                    wpm: 123,
                    clarity_score: 88,
                    filler_counts: { um: 1 },
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
                    filler_counts: { um: 2, like: 3 },
                },
            ],
        });

        // #1231/#1306: the headline is the TRUE-filler tier — um(2); "like"(3) is a discourse marker, excluded
        // by default. The flat filler_counts carries no synthetic `total`, so there is nothing to double-count.
        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('2');
    });

    it('#1306: shows the stored filler count (no transcript exists to inflate it from)', () => {
        // The stored flat filler_counts is authoritative — there is no transcript to recount, so the headline
        // is exactly the stored true-filler count.
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
                    filler_counts: { um: 2 },
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
                    filler_counts: { um: 2 },
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
                    filler_counts: {},
                },
            ],
        });

        // #1045: unified vocabulary — the unscorable session says "Not enough data", not a bare "--".
        expect(screen.getByTestId('clarity-score-value')).toHaveTextContent(/not enough data/i);
        expect(screen.getByTestId('clarity-score-value-explanation')).toHaveTextContent(/cannot be scored/i);
    });

    it('#1306: a session with persisted clarity + words shows BOTH the value AND its explanation (metric-presence)', () => {
        // There is no transcript_state to "withhold" an explanation on — a persisted metric renders its value
        // and its explanation together.
        renderComponent({
            sessionId: 'measured-session',
            sessionHistory: [
                {
                    id: 'measured-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 88,
                    filler_counts: { um: 2 },
                    status: 'completed',
                    next_action_signal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
                },
            ],
        });

        expect(screen.getByTestId('clarity-score-value')).toHaveTextContent(/88/);
        expect(screen.getByTestId('clarity-score-value-explanation')).toBeInTheDocument();
        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('2');
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

        expect(screen.getByTestId('session-engine-metadata')).toHaveTextContent('Legacy recording');
    });

    it('#1306: session detail renders NO transcript pane and NO transcript-quality caveat — and shows the next action', () => {
        renderComponent({
            sessionId: 'native-session',
            sessionHistory: [
                {
                    id: 'native-session', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                    duration: 60, total_words: 6, engine: 'native', clarity_score: 80,
                    filler_counts: { um: 1 }, status: 'completed',
                    next_action_signal: { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' },
                },
            ],
        });

        // #1306 Step 3: this row carries NO transcript_state, so it fails closed to not_captured — the
        // superseded "no transcript is ever stored" contract is gone, but a stateless row still shows
        // no text. The quality caveat remains retired.
        expect(screen.queryByTestId('session-detail-transcript')).not.toBeInTheDocument();
        // A row carrying NO transcript_state is unknown, not proven empty — so the honest surface is
        // "could not be loaded", never "no transcript was captured".
        expect(screen.getByTestId('session-detail-transcript-unavailable')).toBeInTheDocument();
        expect(screen.queryByTestId('session-detail-transcript-not_captured')).not.toBeInTheDocument();
        expect(screen.queryByTestId('session-detail-quality-caveat')).not.toBeInTheDocument();
        // The ONE structured next action is shown (content-free coaching), and metrics still render.
        expect(screen.getByTestId('session-detail-next-action')).toBeInTheDocument();
        expect(screen.getByTestId('session-next-action-title')).toHaveTextContent('Trim the filler words');
        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('1');
    });

    it('#1306: an incomplete/empty session renders no transcript panel and no caveat (nothing to leak)', () => {
        renderComponent({
            sessionId: 'placeholder-session',
            sessionHistory: [
                {
                    id: 'placeholder-session', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                    duration: 5, total_words: 0, engine: 'native', status: 'failed',
                },
            ],
        });

        expect(screen.queryByTestId('session-detail-transcript')).not.toBeInTheDocument();
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
                    filler_counts: { um: 1 },
                },
            ],
        });

        expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
        expect(screen.queryByTestId('upload-ground-truth-btn')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /upload script|update script/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/reference script/i)).not.toBeInTheDocument();
    });

    it('does not clutter Recent-session rows with a per-row engine/PRIVATE badge (#G4 chunk 3)', () => {
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
                    id: 'native-session',
                    user_id: 'test-user',
                    created_at: '2023-01-02T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'native',
                },
            ],
        });

        // #G4 chunk 3: the per-row engine/PRIVATE badge is gone (the section footer carries the privacy
        // promise). Recording mode still lives on the session detail view.
        expect(screen.queryByTestId('session-engine-badge-cloud-session')).toBeNull();
        expect(screen.queryByTestId('session-engine-badge-native-session')).toBeNull();
    });

    it('shows an explicit open-session link on each history item so testers can verify saved sessions', () => {
        renderComponent({ sessionHistory: mockSessionHistory });

        const openLink = screen.getAllByRole('link', { name: /open saved session details/i })[0];

        expect(openLink).toHaveAttribute('href', '/analytics/session-1');
    });

    // #1306 metrics-only: there is NO transcript pane and NO transcript_state to honor. The session detail
    // renders persisted measurements and exactly one durable next action; nothing recomputes from text.
    describe('#1306 session-detail is metrics-only (no transcript surface)', () => {
        const completedSignal = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' };
        const detailSession = (over: Record<string, unknown>) => ([{
            id: 'sx', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
            duration: 600, total_words: 1200, wpm: 120, clarity_score: 85,
            filler_counts: { um: 5 }, status: 'completed', next_action_signal: completedSignal, ...over,
        }]);

        it('renders persisted measurements and never a transcript pane or an AI/text action', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({}) });
            expect(screen.queryByTestId('session-detail-transcript')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /Get Suggestions/i })).not.toBeInTheDocument();
            // Measurements remain visible.
            expect(screen.getAllByText('Speaking Pace').length).toBeGreaterThan(0);
            expect(screen.getByTestId('clarity-score-value')).toHaveTextContent(/85/);
        });

        it('a completed session renders exactly one valid next action', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({}) });
            expect(screen.getAllByTestId('session-next-action-title')).toHaveLength(1);
            expect(screen.queryByTestId('session-next-action-integrity-error')).not.toBeInTheDocument();
            expect(screen.queryByTestId('session-next-action-none')).not.toBeInTheDocument();
        });

        it('a completed session MISSING its next action renders a data-integrity failure, not a friendly empty state', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({ next_action_signal: undefined }) });
            expect(screen.getByTestId('session-next-action-integrity-error')).toBeInTheDocument();
            expect(screen.queryByTestId('session-next-action-none')).not.toBeInTheDocument();
            expect(screen.queryByTestId('session-next-action-title')).not.toBeInTheDocument();
        });

        it('a measured-zero session ({} filler, no words) shows Not enough data, never a sentinel zero', () => {
            renderComponent({
                sessionId: 'sx',
                sessionHistory: [{
                    id: 'sx', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                    duration: 600, total_words: 0, filler_counts: {},
                }],
            });
            // The Speaking Pace tile reads "Not enough data", not a sentinel zero.
            expect(screen.getAllByText(/Not enough data/i).length).toBeGreaterThan(0);
            const paceCard = screen.getByTestId(TEST_IDS.STAT_CARD_SPEAKING_PACE);
            expect(paceCard.textContent).toContain('Not enough data');
            expect(paceCard.textContent).not.toMatch(/\b0\s*WPM\b/);
        });
    });

    it('#1306 a history item with unmeasured pace (NULL total_words) shows N/A, never a sentinel zero', () => {
        renderComponent({
            sessionHistory: [{
                id: 'nc-1', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                duration: 600, total_words: 0, filler_counts: {},
            }],
        });
        const row = screen.getByTestId(`${TEST_IDS.SESSION_HISTORY_ITEM}-nc-1`);
        expect(row.textContent).toContain('N/A');
        expect(row.textContent).not.toMatch(/\b0\s*WPM\b/);
    });

    // ---------------------------------------------------------------------------------------------
    // #1306 Step 3 subtask C — the review surface renders from the SERVER's transcript_state.
    // All three honest states, plus malformed contradictions that must fail closed.
    // ---------------------------------------------------------------------------------------------
    describe('session detail transcript states', () => {
        const MARKER = 'DASHBOARD-TRANSCRIPT-CANARY-4b7e19';
        const detailRow = (over: Record<string, unknown>) => ({
            id: 'detail-session', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
            duration: 60, total_words: 6, engine: 'private', clarity_score: 80,
            filler_counts: { um: 1 }, status: 'completed',
            next_action_signal: { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' },
            ...over,
        });
        const renderDetail = (over: Record<string, unknown>) =>
            renderComponent({ sessionId: 'detail-session', sessionHistory: [detailRow(over)] });

        it('available WITH text renders the transcript', () => {
            renderDetail({ transcript_state: 'available', transcript: `spoken ${MARKER} words` });
            expect(screen.getByTestId('session-detail-transcript')).toHaveTextContent(MARKER);
        });

        it('available WITHOUT usable text shows an honest gap, never a blank transcript pane', () => {
            renderDetail({ transcript_state: 'available', transcript: '   ' });
            expect(screen.queryByTestId('session-detail-transcript')).not.toBeInTheDocument();
            expect(screen.getByTestId('session-detail-transcript-unavailable')).toBeInTheDocument();
        });

        it('expired shows the retention explanation and keeps metrics visible', () => {
            renderDetail({ transcript_state: 'expired', transcript: null });
            expect(screen.getByTestId('session-detail-transcript-expired')).toBeInTheDocument();
            // Metrics survive expiry — that is the whole point of newest-two retention.
            expect(screen.getByTestId('filler-count-value')).toHaveTextContent('1');
        });

        it('not_captured is distinct from expired — different states, different copy', () => {
            renderDetail({ transcript_state: 'not_captured', transcript: null });
            expect(screen.getByTestId('session-detail-transcript-not_captured')).toBeInTheDocument();
            expect(screen.queryByTestId('session-detail-transcript-expired')).not.toBeInTheDocument();
        });

        it.each([
            ['expired', 'expired'],
            ['not_captured', 'not_captured'],
        ])('MALFORMED: %s while still carrying text suppresses the text', (_l, state) => {
            // A contradictory row must not leak content past its retention window.
            renderDetail({ transcript_state: state, transcript: `spoken ${MARKER} words` });
            expect(screen.queryByTestId('session-detail-transcript')).not.toBeInTheDocument();
            expect(document.body.textContent ?? '').not.toContain(MARKER);
        });

        it('MALFORMED: an unknown state suppresses text and reports it as unavailable', () => {
            renderDetail({ transcript_state: 'something_new', transcript: `spoken ${MARKER} words` });
            expect(document.body.textContent ?? '').not.toContain(MARKER);
            expect(screen.getByTestId('session-detail-transcript-unavailable')).toBeInTheDocument();
            // Never claim "not captured" on a state we do not recognise.
            expect(screen.queryByTestId('session-detail-transcript-not_captured')).not.toBeInTheDocument();
        });

        it('never infers availability from text presence alone', () => {
            // Decisive: identical text, no state → no render.
            renderDetail({ transcript: `spoken ${MARKER} words` });
            expect(document.body.textContent ?? '').not.toContain(MARKER);
            expect(screen.getByTestId('session-detail-transcript-unavailable')).toBeInTheDocument();
        });

        it('copy is position-neutral — never claims the metrics are "below"', () => {
            renderDetail({ transcript_state: 'expired', transcript: null });
            const panel = screen.getByTestId('session-detail-transcript-expired');
            expect(panel).toHaveTextContent('session metrics are unaffected');
            expect(panel.textContent ?? '').not.toContain('below');
        });
    });
});
