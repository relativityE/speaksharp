import { fireEvent, render, screen } from '../../../tests/support/test-utils';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import type { UserProfile } from '@/types/user';

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
    averageSessionLength: 30,
    avgAccuracy: 85,
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

    it('should render error display when error occurs', () => {
        renderComponent({ error: new Error('Test error') });
        expect(screen.getByText(/Test error/i)).toBeInTheDocument();
    });

    it('should render empty state when no sessions', () => {
        renderComponent({ sessionHistory: [] });
        expect(screen.getByTestId('analytics-dashboard-empty-state')).toBeInTheDocument();
    });

    it('hides the upgrade prompt when effective trial access is Pro even if the profile has not hydrated it yet', () => {
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
        expect(screen.getByText('Delivery Control')).toBeInTheDocument();
        expect(screen.getByText('Why these tools are here')).toBeInTheDocument();
        expect(screen.getByText(/evidence behind SpeakSharp Score/i)).toBeInTheDocument();
        expect(screen.getByText(/Delivery Control shows which ingredient to improve/i)).toBeInTheDocument();
        expect(screen.getByText(/These cards are selected together/i)).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-speaking_pace')).toBeInTheDocument();

        // Verify session list is rendered
        const sessionItems = screen.getAllByTestId(/session-history-item-/);
        expect(sessionItems.length).toBeGreaterThan(0);
    });

    it.each([
        {
            id: 'delivery_control',
            label: 'Delivery Control',
            outcome: /steadier and more controlled/i,
            statCards: ['stat-card-speaking_pace', 'stat-card-filler_words_per_min', 'stat-card-clarity_score', 'stat-card-total_practice_time'],
            hasTranscriptQuality: false,
        },
        {
            id: 'message_clarity',
            label: 'Message Clarity',
            outcome: /tighten the opening/i,
            statCards: ['stat-card-clarity_score', 'stat-card-speaking_pace', 'stat-card-avg_session_length', 'stat-card-total_sessions'],
            hasTranscriptQuality: false,
        },
        {
            id: 'habit_progress',
            label: 'Habit Progress',
            outcome: /speaking habit is improving/i,
            statCards: ['stat-card-total_sessions', 'stat-card-total_practice_time', 'stat-card-avg_session_length', 'stat-card-filler_words_per_min'],
            hasTranscriptQuality: false,
        },
        {
            id: 'session_proof',
            label: 'Session Proof',
            outcome: /what changed between practice attempts/i,
            statCards: ['stat-card-total_sessions', 'stat-card-speaking_pace', 'stat-card-clarity_score', 'stat-card-filler_words_per_min'],
            hasTranscriptQuality: false,
        },
        {
            id: 'transcript_quality',
            label: 'Transcript Quality',
            outcome: /delivery or capture quality/i,
            statCards: ['stat-card-clarity_score', 'stat-card-speaking_pace', 'stat-card-avg_session_length', 'stat-card-total_sessions'],
            hasTranscriptQuality: true,
        },
    ])('renders the $label analytics focus as a coherent user story', ({ id, label, outcome, statCards, hasTranscriptQuality }) => {
        localStorage.setItem('speaksharp_analytics_tool_group_v1', id);

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
        expect(screen.getByText(outcome)).toBeInTheDocument();
        expect(screen.getByText(`Evidence for ${label}`)).toBeInTheDocument();
        expect(screen.getByText(`${label} Tools`)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(`${label} shows which ingredient to improve`, 'i'))).toBeInTheDocument();
        for (const testId of statCards) {
            expect(screen.getByTestId(testId)).toBeInTheDocument();
        }

        const accuracyComparison = screen.queryByTestId('accuracy-comparison');
        expect(Boolean(accuracyComparison)).toBe(hasTranscriptQuality);
    });

    it('supports a custom toolkit when users want specific tools outside predefined groups', () => {
        localStorage.setItem('speaksharp_analytics_tool_group_v1', 'custom');
        localStorage.setItem('speaksharp_custom_stat_cards_v1', JSON.stringify(['total_sessions', 'clarity_score']));
        localStorage.setItem('speaksharp_custom_analysis_slides_v1', JSON.stringify(['stt_comparison']));

        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByText('Custom Toolkit')).toBeInTheDocument();
        expect(screen.getByText(/inspect the specific signals/i)).toBeInTheDocument();
        expect(screen.getByText(/Custom tools answer their own question/i)).toBeInTheDocument();
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

    it('recalculates session detail fillers from transcript when persisted analytics undercount highlighted words', () => {
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

        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('4');
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

        expect(screen.getByTestId('clarity-score-value')).toHaveTextContent('--');
        expect(screen.getByTestId('clarity-score-value-explanation')).toHaveTextContent(/cannot be scored/i);
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

        expect(screen.getByTestId('session-engine-metadata')).toHaveTextContent(
            'Private (whisper-tiny.en, transformers-js-2.17, cpu)'
        );
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
            'Native Browser'
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
        expect(detail).toHaveTextContent('No transcript available for this session.');
        expect(detail).toHaveAttribute('data-session-detail-transcript', '');
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
        expect(screen.getByTestId('session-engine-badge-native-session')).toHaveTextContent('Native Browser');
    });

    it('shows an explicit open-session link on each history item so testers can verify saved sessions', () => {
        renderComponent({ sessionHistory: mockSessionHistory });

        const openLink = screen.getAllByRole('link', { name: /open saved session details/i })[0];

        expect(openLink).toHaveAttribute('href', '/analytics/session-1');
    });
});
