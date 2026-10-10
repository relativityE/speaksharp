import { fireEvent, render, screen, within } from '../../../tests/support/test-utils';
import { setCurrentLogin } from '@/services/loginSessionLog';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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
vi.mock('../analytics/TrendChart', () => ({ TrendChart: ({ metric }: { metric: string }) => <div data-testid="trend-chart" data-metric={metric} /> }));
const pdfDownloaded = vi.fn();
// #1258 (RWT run 36955422629): a list PDF reads THIS session's detail row first. Default: no detail row (null).
const sessionDetailRead = vi.fn((_id: string): Promise<unknown> => Promise.resolve(null));
vi.mock('@/lib/storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/storage')>()),
    getSessionById: (id: string) => sessionDetailRead(id),
}));
vi.mock('@/services/reviewSurfaceTelemetry', () => ({ trackSessionPdfDownloaded: (...args: unknown[]) => pdfDownloaded(...args) }));
// #1258 G20: the saved review has its own tests; here only its placement and ownership of the next action matter.
vi.mock('../analytics/SavedPracticeLoopReview', () => ({
    SavedPracticeLoopReview: ({ sessionId, sessionLabel }: { sessionId: string; sessionLabel?: string | null }) =>
        <section data-testid="saved-review" data-session={sessionId} data-label={sessionLabel ?? ''} />,
}));

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

    it('#1258 D9: a Recent sessions row — date/time title, product tag, units in labels, ink Open, yellow PDF', () => {
        const [base] = mockSessionHistory;
        renderComponent({ sessionHistory: [{ ...base, product: 'focus_points' }, { ...base, id: 'legacy-1', product: null }] });
        const row = screen.getByTestId(`${TEST_IDS.SESSION_HISTORY_ITEM}-session-1`);
        const text = row.textContent ?? '';
        // Units live in the labels; the values are bare and uncoloured.
        for (const label of ['Pace (wpm)', 'Fillers', 'Clear delivery (%)']) expect(text).toContain(label);
        expect(row.querySelectorAll('.text-success, .text-signature-text')).toHaveLength(0);
        // Removed: the WPM unit, the old labels, the clock/duration line, the timestamp title and the bullet.
        expect(text).not.toMatch(/WPM|Detected filler words|Speaking Pace|duration|•|Practice Session/);
        expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
        expect(screen.getByTestId('session-detail-link-session-1').textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2,3}( \d{4})?, \d{1,2}:\d{2}/);
        expect(text).toMatch(/10:00/); // mm:ss duration (600 s)
        // The product comes from the persisted field only; a legacy row with no product shows no tag.
        expect(within(row).getByTestId('session-product-tag')).toHaveTextContent('Focus Points');
        expect(within(screen.getByTestId(`${TEST_IDS.SESSION_HISTORY_ITEM}-legacy-1`)).queryByTestId('session-product-tag')).toBeNull();
        expect(screen.getByTestId('open-session-detail-session-1')).toHaveClass('bg-ink');
        expect(screen.getByTestId('download-pdf-btn-session-1')).toHaveClass('bg-signature');
        expect(within(row).getByRole('checkbox', { name: /^Compare Focus Points, / })).toBeInTheDocument();
        // One responsive row: the separate mobile block is gone.
        expect(screen.queryByTestId('download-pdf-btn-mobile-session-1')).toBeNull();
    });

    it('#1258 D7: Trends lists every selected tool as a collapsed row; a chart mounts only when its row opens', () => {
        renderComponent({ sessionHistory: mockSessionHistory });
        // The carousel stays retired: no swipe arrows, no indicator dots.
        expect(screen.queryByRole('button', { name: 'Previous slide' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Go to slide/i })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Trends' })).toBeInTheDocument();
        expect(screen.queryByText(/Sound Confident Tools|Each chart answers part of the same coaching question/)).toBeNull();
        // Default focus (Sound Confident): pace, pause, fillers, clarity — all collapsed, no chart mounted.
        for (const id of ['pace_trend', 'pause_trend', 'filler_words', 'clarity_trend']) {
            expect(screen.getByTestId(`trend-row-${id}`)).toHaveAttribute('aria-expanded', 'false');
        }
        expect(screen.queryAllByTestId('trend-chart')).toHaveLength(0);
        fireEvent.click(screen.getByTestId('trend-row-clarity_trend'));
        expect(screen.getByTestId('trend-chart')).toHaveAttribute('data-metric', 'clarity');
    });

    it('#1258 D8 CASUALTY (flat 0/min pause line): sessions without pause evidence are left out, never averaged as 0', () => {
        const at = (n: number, pause_metrics?: Record<string, number>) => ({
            ...mockSessionHistory[0], id: `p${n}`, created_at: `2026-10-0${n}T10:00:00Z`, wpm: 120, pause_metrics,
        });
        const valid = { silencePercentage: 10, transitionPauses: 3, extendedPauses: 0, longestPause: 1.1 };
        // Newest first: three sessions with no pause evidence, one with it.
        renderComponent({ sessionHistory: [at(4), at(3), at(2, {}), at(1, valid)] });
        expect(screen.getByTestId('trend-row-pause_trend').textContent).toContain('After 2 more sessions');
        expect(screen.getByTestId('trend-row-pause_trend').textContent).not.toMatch(/Avg 0\.0/);
        expect(screen.getByTestId('trend-row-pace_trend').textContent).toContain('Avg 120 wpm');
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
        // #1258 D5: the ink header leads — "Your progress" owns the h1 and names the focus in its latest line.
        expect(screen.getByTestId('progress-header')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Your progress' })).toHaveAttribute('data-testid', 'dashboard-heading');
        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent('Working on Sound Confident');
        // The white WORKING ON card and the "What that's based on / Across your last 6 sessions" heading are retired.
        expect(screen.queryByText('Working on', { exact: true })).not.toBeInTheDocument();
        expect(screen.queryByText(/SpeakSharp Score/i)).not.toBeInTheDocument();
        // #G4: the explanation boxes + "selected together" subtitle are gone; the section leads with a
        // position-based heading instead of a sentence.
        expect(screen.queryByText('Why these tools are here')).not.toBeInTheDocument();
        expect(screen.queryByText(/These cards are selected together/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/that.s based on/i)).not.toBeInTheDocument();
        expect(screen.queryByText('Across your last 6 sessions')).not.toBeInTheDocument(); // the heading (exact text)
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

        // #1258 D5: the focus is named on the ink header's latest line.
        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent(`Working on ${label}`);
        for (const testId of statCards) {
            expect(screen.getByTestId(testId)).toBeInTheDocument();
        }
        // #1306: the customer STT-accuracy / by-engine comparison surface no longer exists anywhere.
        expect(screen.queryByTestId('accuracy-comparison')).not.toBeInTheDocument();
    });

    describe('#1258 D5 rule card and stat cards (Rev 2 §5.5–5.6; PO 2026-10-07: newest 4 sessions)', () => {
        const PAUSES = { silencePercentage: 12, transitionPauses: 6, extendedPauses: 2, longestPause: 1.4 };
        const row = (n: number, wpm: number, filler_counts: unknown, duration = 600) => ({
            id: `w${n}`, user_id: 'test-user', created_at: `2026-10-0${n}T10:00:00Z`, duration, total_words: wpm * duration / 60,
            wpm, clarity_score: 95, pause_metrics: PAUSES, filler_counts, status: 'completed', product: 'open_mic',
            next_action_signal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
        });
        // Newest first. The OLDEST session (outside the window) is fast with many fillers: averaged over all five the
        // pace would read "over", so "under" proves the card reads only the newest four.
        const history = [row(5, 100, { um: 2 }), row(4, 100, { um: 1 }), row(3, 100, {}), row(2, 100, null), row(1, 900, { um: 50 })];

        it('CASUALTY (window): the rule card states the newest-4 pace with its real count and one Practise action', () => {
            localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
            renderComponent({ sessionHistory: history });
            const card = screen.getByTestId('try-this-next');
            expect(within(card).getByTestId('rule-card-window')).toHaveTextContent('From your last 4 sessions');
            expect(screen.getByTestId('try-this-next-action')).toHaveTextContent('Your pace averaged 100 words a minute, under the 130–150 target.');
            expect(within(card).getByTestId('rule-card-chip')).toHaveTextContent('Focus: pace');
            expect(within(card).getByRole('link', { name: 'Practise pace' })).toHaveAttribute('href', '/session');
            expect(within(card).getByText('How we worked this out')).toBeInTheDocument();
            // Retired: the ◎ "Do this next" eyebrow, the imperative headline, the WHAT TO TRY list and the yellow button.
            expect(card.textContent).not.toMatch(/Do this next|What to try|Practise this now|Pick up the pace on familiar points/i);
            expect(card.querySelector('.bg-signature')).toBeNull();
        });

        it('stat cards: no chips, uncoloured numbers, a metric dot, pace target in the sentence, filler count per session', () => {
            localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
            renderComponent({ sessionHistory: history });
            for (const id of ['speaking_pace', 'pause_rhythm', 'filler_words_per_min', 'clarity_score']) {
                expect(screen.queryByTestId(`stat-card-${id}-chip`)).toBeNull();
                expect(screen.getByTestId(`stat-card-${id}-interpretation`)).toHaveClass('text-neutral-heading');
                expect(screen.getByTestId(`stat-card-${id}-dot`)).toBeInTheDocument();
            }
            expect(screen.queryByText(/FIX THIS|ON TRACK|NEED 2 MORE|leave this alone/)).toBeNull();
            // mockStats (all sessions): 120 wpm → Slow.
            expect(screen.getByTestId('stat-card-speaking_pace-detail')).toHaveTextContent('Slow · target 130–150');
            // Filler card: newest 4 only; observed counts in, the unobservable `{}` (#1472) and the unmeasured (null)
            // session out → (2 + 1) / 2.
            const filler = screen.getByTestId('stat-card-filler_words_per_min');
            expect(filler).toHaveTextContent('Average fillers per session · last 4 sessions');
            expect(screen.getByTestId('stat-card-filler_words_per_min-interpretation')).toHaveTextContent(/^1\.5$/);
            expect(screen.getByTestId('stat-card-clarity_score')).toHaveTextContent('Clear delivery');
        });

        // #1573 Codex P1 4230859591: the card shows the TRUE-filler count per session, so its judgment and the rule card's
        // driver must come from the same true-filler basis and window — never the legacy all-keys per-minute rate, which
        // still counts default-excluded discourse markers such as "so" and "like".
        // #1472 (Browser PM 6102458581): discourse markers the true-filler tier excludes are not a true-filler zero either —
        // the card withholds the number and the grade (no "0.0", no "Low"), as the session review withholds that zero.
        it('CASUALTY: discourse markers only → no true-filler number or grade (never High, never a clean "0.0 … Low"), never the rule card\'s focus', () => {
            localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
            const markersOnly = [5, 4, 3, 2].map((n) => row(n, 140, { so: 40, like: 40 }));   // legacy rate 8/min → "High"
            renderComponent({ sessionHistory: markersOnly });
            expect(screen.getByTestId('stat-card-filler_words_per_min-interpretation')).toHaveTextContent(/^—$/);
            const detail = screen.getByTestId('stat-card-filler_words_per_min-detail').textContent ?? '';
            expect(detail).not.toMatch(/High|Noticeable|Low|\d/);
            const card = screen.queryByTestId('try-this-next');
            const chip = card ? (within(card).queryByTestId('rule-card-chip')?.textContent ?? '') : '';
            expect(chip).not.toMatch(/filler/i);
        });

        it('CONTROL: real true fillers still read High and can drive the rule card', () => {
            localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
            const fillerHeavy = [5, 4, 3, 2].map((n) => row(n, 140, { um: 40, uh: 40 }));     // 80 per 10 min = 8/min
            renderComponent({ sessionHistory: fillerHeavy });
            expect(screen.getByTestId('stat-card-filler_words_per_min-detail')).toHaveTextContent(/High/);
            expect(within(screen.getByTestId('try-this-next')).getByTestId('rule-card-chip')).toHaveTextContent(/filler/i);
        });

        // #1573 Codex P1 4232318053 + PO 2026-10-09: the headline is the per-session count; the grade states the per-minute
        // rate it judges, so short and long takes are graded fairly and the grade never judges a number the user can't see.
        it('CASUALTY: short takes — "7.0" per session is graded on its rate: "High · about 7 a minute, target under 3"', () => {
            localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
            const shortTakes = [5, 4, 3, 2].map((n) => row(n, 140, { um: 7 }, 60));      // 7 fillers in 1 minute each
            renderComponent({ sessionHistory: shortTakes });
            expect(screen.getByTestId('stat-card-filler_words_per_min-interpretation')).toHaveTextContent(/^7\.0$/);
            expect(screen.getByTestId('stat-card-filler_words_per_min-detail')).toHaveTextContent(/^High · about 7 a minute, target under 3$/);
            expect(within(screen.getByTestId('try-this-next')).getByTestId('try-this-next-action'))
                .toHaveTextContent(/^You averaged 7\.0 filler words per session, about 7 a minute\.$/);
        });

        it('CONTROL: long takes — a higher count at a low rate reads "Low · under 1 a minute" and is never the focus', () => {
            localStorage.setItem('speaksharp_analytics_tool_group_v1', 'sound_confident');
            const longTakes = [5, 4, 3, 2].map((n) => row(n, 140, { um: 5 }, 600));     // 5 fillers in 10 minutes each
            renderComponent({ sessionHistory: longTakes });
            expect(screen.getByTestId('stat-card-filler_words_per_min-interpretation')).toHaveTextContent(/^5\.0$/);
            expect(screen.getByTestId('stat-card-filler_words_per_min-detail')).toHaveTextContent(/^Low · under 1 a minute, target under 3$/);
            const card = screen.queryByTestId('try-this-next');
            const chip = card ? (within(card).queryByTestId('rule-card-chip')?.textContent ?? '') : '';
            expect(chip).not.toMatch(/filler/i);
        });

        it('fewer than two sessions: no rule card', () => {
            renderComponent({ sessionHistory: [history[0]] });
            expect(screen.queryByTestId('try-this-next')).toBeNull();
        });

        it('CASUALTY (CLI PM 6048239789): newest sessions with no measurable signal show no rule card, never "all on target"', () => {
            const unmeasured = [5, 4, 3].map((n) => ({
                id: `u${n}`, user_id: 'test-user', created_at: `2026-10-0${n}T10:00:00Z`, duration: 600,
                filler_counts: null, status: 'completed', product: 'open_mic',
                next_action_signal: { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' },
            }));
            renderComponent({ sessionHistory: unmeasured });
            expect(screen.queryByTestId('try-this-next')).toBeNull();
            expect(screen.queryByText('Pace, fillers and clarity are all on target.')).toBeNull();
        });

        it('CASUALTY #1472: empty filler maps never yield "Pace, fillers and clarity are all on target"', () => {
            const smooth = { silencePercentage: 12, transitionPauses: 60, extendedPauses: 20, longestPause: 1.4 };
            const unverified = [row(5, 140, {}), row(4, 140, {}), row(3, 140, {})].map((r) => ({ ...r, pause_metrics: smooth }));
            renderComponent({ sessionHistory: unverified });
            expect(screen.queryByText('Pace, fillers and clarity are all on target.')).toBeNull();
        });

        it('every signal on target: the on-target sentence, no chip and no Practise button', () => {
            // 80 meaningful pauses in 10 minutes = 8 a minute (Smooth); 140 wpm; few OBSERVED fillers (#1472); clarity 95.
            const smooth = { silencePercentage: 12, transitionPauses: 60, extendedPauses: 20, longestPause: 1.4 };
            const steady = [row(5, 140, { um: 1 }), row(4, 140, { um: 1 }), row(3, 140, { um: 1 })].map((r) => ({ ...r, pause_metrics: smooth }));
            renderComponent({ sessionHistory: steady });
            const card = screen.getByTestId('try-this-next');
            expect(within(card).getByTestId('rule-card-window')).toHaveTextContent('From your last 3 sessions');
            expect(screen.getByTestId('try-this-next-action')).toHaveTextContent('Pace, fillers and clarity are all on target.');
            expect(within(card).queryByTestId('rule-card-chip')).toBeNull();
            expect(within(card).queryByRole('link', { name: /Practise/ })).toBeNull();
        });
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

        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent(`Working on ${expectedLabel}`);
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

        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent('Working on Custom');
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

    it('#1306: session detail renders NO transcript pane and NO transcript-quality caveat — and the saved review leads', () => {
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
        // #1258 G20: the saved review is the FIRST block and owns the one next action; the signal's generic copy is
        // no longer shown beside it. Metrics still render.
        const review = screen.getByTestId('saved-review');
        expect(review).toHaveAttribute('data-session', 'native-session');
        // #1535 Codex P2 r4112111970: no ordinal on the detail route (the prop holds only this session) — the date alone.
        expect(review.getAttribute('data-label')).not.toMatch(/Session \d/);
        const detail = review.parentElement!;
        expect(detail.firstElementChild).toBe(review);
        expect(screen.queryByTestId('session-detail-next-action')).not.toBeInTheDocument();
        expect(screen.queryByTestId('session-next-action-title')).not.toBeInTheDocument();
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

        const openLink = screen.getByTestId('open-session-detail-session-1');
        expect(openLink).toHaveTextContent('Open');

        expect(openLink).toHaveAttribute('href', '/analytics/session-1');
    });

    // #1306 metrics-only: there is NO transcript pane and NO transcript_state to honor. The session detail
    // renders persisted measurements and exactly one durable next action; nothing recomputes from text.
    describe('#1306 session-detail is metrics-only (no transcript surface)', () => {
        // #1573: a PDF is bound to the signed-in owner (AuthProvider applies it before any authenticated surface renders).
        beforeEach(() => setCurrentLogin('test-user', 1_790_000_000_000));
        afterEach(() => setCurrentLogin(null, null));

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

        // #1258 (PM RETURN, #1535 cycle 1): `session_pdf_downloaded` names a SUCCESS. It is sent only after the PDF was
        // actually handed to the browser (the generator resolves true) — never before generation, never on a failed
        // generation (resolves false; the toast already tells the person) and never on a rejection. Exactly one event,
        // carrying only its closed-enum surface.
        // #1258 D9: one responsive row replaced the separate mobile block, so the list has ONE surface (`history_list`).
        type Surface = 'history_list' | 'session_detail';
        const press: Record<Surface, () => void> = {
            history_list: () => fireEvent.click(screen.getByTestId('download-pdf-btn-sx')),
            session_detail: () => fireEvent.click(screen.getByRole('button', { name: /Export PDF/i })),
        };
        const renderFor = (surface: Surface) => surface === 'session_detail'
            ? renderComponent({ sessionId: 'sx', sessionHistory: detailSession({}) })
            : renderComponent({ sessionHistory: detailSession({}) });
        const outcomes = [
            ['saved (resolves true)', () => Promise.resolve(true), 1],
            ['failed inside the generator (resolves false)', () => Promise.resolve(false), 0],
            ['rejected', () => Promise.reject(new Error('boom')), 0],
        ] as const;

        for (const surface of ['history_list', 'session_detail'] as const) {
            for (const [label, result, events] of outcomes) {
                it(`#1258: PDF from ${surface}, ${label} → ${events} session_pdf_downloaded`, async () => {
                    const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                    let settle!: () => void;
                    const gate = new Promise<void>((resolve) => { settle = resolve; });
                    vi.mocked(generateSessionPdf).mockReset().mockImplementation(() => gate.then(result) as Promise<boolean>);
                    pdfDownloaded.mockReset();
                    renderFor(surface);
                    press[surface]();
                    await vi.waitFor(() => expect(generateSessionPdf).toHaveBeenCalledTimes(1));
                    // Nothing is reported while the PDF is still being generated.
                    expect(pdfDownloaded).not.toHaveBeenCalled();
                    settle();
                    await vi.waitFor(() => expect(vi.mocked(generateSessionPdf).mock.results[0]).toBeDefined());
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    // Exactly `events` success events, each carrying only its closed-enum surface.
                    expect(pdfDownloaded.mock.calls).toEqual(Array.from({ length: events }, () => [surface]));
                });
            }
        }

        // #1258 (RWT run 36955422629): the list row is the metrics-only LIST select and never carries `transcript`, so a
        // PDF downloaded from the list had no transcript page. A list download builds the PDF from THIS session's detail
        // row; a failed detail read still produces the metrics PDF from the list row; the detail surface reads nothing.
        for (const surface of ['history_list'] as const) {
            it(`#1258: a PDF from ${surface} is built from this session's detail row, which carries the transcript`, async () => {
                const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
                const detail = { ...detailSession({})[0], transcript_state: 'available', transcript: 'the saved words' };
                sessionDetailRead.mockReset().mockResolvedValue(detail);
                renderFor(surface);
                press[surface]();
                await vi.waitFor(() => expect(generateSessionPdf).toHaveBeenCalledTimes(1));
                expect(sessionDetailRead.mock.calls).toEqual([['sx']]);
                expect(vi.mocked(generateSessionPdf).mock.calls[0][0]).toBe(detail);
            });

            it(`#1258: a failed detail read on ${surface} still downloads the metrics PDF from the list row`, async () => {
                const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
                sessionDetailRead.mockReset().mockRejectedValue(new Error('Unable to load this session.'));
                renderFor(surface);
                press[surface]();
                await vi.waitFor(() => expect(generateSessionPdf).toHaveBeenCalledTimes(1));
                const built = vi.mocked(generateSessionPdf).mock.calls[0][0];
                expect(built.id).toBe('sx');
                expect(built).not.toHaveProperty('transcript');
            });
        }

        // #1573 Codex P1 (review 5460913397): a list PDF is bound to the login that started it. Its detail read can finish
        // after a sign-out or account switch; then nothing is generated (no old-account transcript or metrics PDF) and
        // nothing is reported — whether the read resolved or failed into the list-row fallback.
        describe('#1573: a list PDF never completes for a login other than the one that started it', () => {
            afterEach(() => setCurrentLogin(null, null));
            const startDeferred = async (outcome: 'resolve' | 'reject', after: () => void) => {
                const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
                pdfDownloaded.mockReset();
                const row = detailSession({})[0];
                // The starting login owns the row, exactly as in the app (the list is RLS-scoped to the signed-in user).
                setCurrentLogin(String(row.user_id ?? 'owner-a'), 1_790_000_000_000);
                let settle!: () => void;
                const detail = { ...row, transcript_state: 'available', transcript: 'account A words' };
                sessionDetailRead.mockReset().mockReturnValue(new Promise((resolve, reject) => {
                    settle = () => (outcome === 'resolve' ? resolve(detail) : reject(new Error('read failed')));
                }));
                renderFor('history_list');
                press.history_list();
                await vi.waitFor(() => expect(sessionDetailRead).toHaveBeenCalledTimes(1));
                after();     // the identity changes while the read is in flight
                settle();
                await new Promise((resolve) => setTimeout(resolve, 0));
                await new Promise((resolve) => setTimeout(resolve, 0));
                return generateSessionPdf;
            };
            for (const outcome of ['resolve', 'reject'] as const) {
                it(`CASUALTY: an account switch during the detail read (${outcome}) generates and reports nothing`, async () => {
                    const generate = await startDeferred(outcome, () => setCurrentLogin('owner-b', 1_790_000_000_500));
                    expect(generate).not.toHaveBeenCalled();
                    expect(pdfDownloaded).not.toHaveBeenCalled();
                });
                it(`CASUALTY: a sign-out during the detail read (${outcome}) generates and reports nothing`, async () => {
                    const generate = await startDeferred(outcome, () => setCurrentLogin(null, null));
                    expect(generate).not.toHaveBeenCalled();
                    expect(pdfDownloaded).not.toHaveBeenCalled();
                });
            }
            // Codex P1 4223017340 (Browser PM 6067207123): an owner whose session has no valid `last_sign_in_at` still binds
            // — a sign-out OR an account switch during the deferred detail read (resolved or rejected) yields no PDF, no event.
            for (const outcome of ['resolve', 'reject'] as const) {
                for (const [change, apply] of [
                    ['sign-out', () => setCurrentLogin(null, null)],
                    ['account switch', () => setCurrentLogin('other-user', null)],
                ] as const) {
                    it(`CASUALTY: no sign-in time, ${change} during the detail read (${outcome}) → no PDF, no event`, async () => {
                        const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                        vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
                        pdfDownloaded.mockReset();
                        const row = detailSession({})[0];
                        setCurrentLogin(String(row.user_id), null);          // last_sign_in_at absent: owner known, no LoginIdentity
                        let settle!: () => void;
                        sessionDetailRead.mockReset().mockReturnValue(new Promise((resolve, reject) => {
                            settle = () => (outcome === 'resolve' ? resolve({ ...row, transcript: 'account A words' }) : reject(new Error('read failed')));
                        }));
                        renderFor('history_list');
                        press.history_list();
                        await vi.waitFor(() => expect(sessionDetailRead).toHaveBeenCalledTimes(1));
                        apply();
                        settle();
                        await new Promise((resolve) => setTimeout(resolve, 0));
                        await new Promise((resolve) => setTimeout(resolve, 0));
                        expect(generateSessionPdf).not.toHaveBeenCalled();
                        expect(pdfDownloaded).not.toHaveBeenCalled();
                    });
                }
            }
            it('CONTROL: an owner without a sign-in time and no identity change still downloads', async () => {
                const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
                const row = detailSession({})[0];
                setCurrentLogin(String(row.user_id), null);
                sessionDetailRead.mockReset().mockResolvedValue({ ...row, transcript: 'the saved words' });
                renderFor('history_list');
                press.history_list();
                await vi.waitFor(() => expect(generateSessionPdf).toHaveBeenCalledTimes(1));
            });
            it('CASUALTY: with no signed-in owner at the start, nothing is read or generated (fail closed)', async () => {
                const { generateSessionPdf } = await import('../../lib/pdfGenerator');
                vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
                sessionDetailRead.mockReset().mockResolvedValue(null);
                renderFor('history_list');
                setCurrentLogin(null, null);
                press.history_list();
                await new Promise((resolve) => setTimeout(resolve, 0));
                expect(sessionDetailRead).not.toHaveBeenCalled();
                expect(generateSessionPdf).not.toHaveBeenCalled();
            });
            it('CONTROL: the same login still downloads, with a guard bound to that login', async () => {
                const generate = await startDeferred('resolve', () => undefined);
                expect(generate).toHaveBeenCalledTimes(1);
                const guard = vi.mocked(generate).mock.calls[0][4] as (() => boolean) | undefined;
                expect(guard?.()).toBe(true);
                setCurrentLogin('owner-b', 1_790_000_000_500);
                expect(guard?.()).toBe(false);
            });
        });

        it('#1258: a PDF from the session detail uses the detail row it already holds — no second read', async () => {
            const { generateSessionPdf } = await import('../../lib/pdfGenerator');
            vi.mocked(generateSessionPdf).mockReset().mockResolvedValue(true);
            sessionDetailRead.mockReset();
            renderFor('session_detail');
            press.session_detail();
            await vi.waitFor(() => expect(generateSessionPdf).toHaveBeenCalledTimes(1));
            expect(sessionDetailRead).not.toHaveBeenCalled();
        });

        it('CASUALTY (#1535 Codex P2 r4112111970): a LATER saved session opened on its detail never reads "Session 1" — the exact label is its date', () => {
            // useAnalytics passes ONLY the opened session on /analytics/:id, so its index is always 0.
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({ created_at: '2026-09-24T10:00:00Z' }) });
            const label = screen.getByTestId('saved-review').getAttribute('data-label');
            const date = new Date('2026-09-24T10:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            expect(label).toBe(date); // e.g. "24 Sept" — the date alone
            expect(label).not.toMatch(/Session \d/);
        });

        it('a completed session with a valid next action: the saved review owns it, and no integrity error shows', () => {
            renderComponent({ sessionId: 'sx', sessionHistory: detailSession({}) });
            expect(screen.getAllByTestId('saved-review')).toHaveLength(1);
            expect(screen.queryByTestId('session-next-action-title')).not.toBeInTheDocument();
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

    it('#1306 a history item with unmeasured pace (NULL total_words) shows a dash, never a sentinel zero', () => {
        renderComponent({
            sessionHistory: [{
                id: 'nc-1', user_id: 'test-user', created_at: '2023-01-01T10:00:00Z',
                duration: 600, total_words: 0, filler_counts: {},
            }],
        });
        const row = screen.getByTestId(`${TEST_IDS.SESSION_HISTORY_ITEM}-nc-1`);
        // #1258 D9: unmeasured reads "—" beside its label; a measured zero would read "0".
        expect(row.textContent).toContain('Pace (wpm)—');
        expect(row.textContent).not.toMatch(/Pace \(wpm\)0|\b0\s*WPM\b/);
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
            // Metrics survive expiry — that is the whole point of newest-one retention.
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
