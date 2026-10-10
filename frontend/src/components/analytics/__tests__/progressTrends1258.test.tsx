/**
 * #1258 D6/D7/D8 (Rev 2 §5.7–5.8) — Progress Trends: collapsed rows whose summaries come from the same points the chart
 * draws, and Filler words as COUNTS for the two newest measured sessions.
 */
import { render, screen, fireEvent, within } from '../../../../tests/support/test-utils';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PracticeSession } from '@/types/session';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import type { TrendDataPoint } from '../trendMetrics';
import { trendSummary } from '../trendSummary';
import { FillerWordsBreakdown } from '../FillerWordsBreakdown';
import { fillerBreakdownModel, fillerSummary } from '../fillerBreakdown';
import { TrendsCard } from '../TrendsCard';

vi.mock('@/hooks/useAnalytics', () => ({
    useAnalytics: () => ({ weeklyActivity: [{ day: 'Mon', sessions: 2 }, { day: 'Tue', sessions: 1 }], loading: false, error: null }),
}));

global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};
beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 600, height: 240, top: 0, left: 0, bottom: 240, right: 600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
});

const point = (i: number, values: Partial<Pick<TrendDataPoint, 'wpm' | 'clarity' | 'pauses'>>): TrendDataPoint => ({
    i, dayLabel: '', createdAt: new Date(2026, 9, i + 1, 12).toISOString(), product: 'open_mic',
    wpm: null, clarity: null, fillers: null, pauses: null, ...values,
});

const PAUSES = { silencePercentage: 10, transitionPauses: 2, extendedPauses: 1, longestPause: 1.2 };
let seq = 0;
const session = (day: number, filler_counts: unknown): PracticeSession => ({
    id: `s${++seq}`, user_id: 'u', created_at: new Date(2026, 9, day, 18, 12).toISOString(), duration: 60,
    wpm: 120, clarity_score: 95, pause_metrics: PAUSES, product: 'open_mic',
    filler_counts: filler_counts as PracticeSession['filler_counts'],
});

describe('#1258 D7/D8 trendSummary reads the points the chart draws', () => {
    it('fewer than three measured points: "After k more sessions" (k counts only measured points)', () => {
        expect(trendSummary('pauses', [point(0, { pauses: 2 }), point(1, {}), point(2, { pauses: 1 }), point(3, {})])).toBe('After 1 more session');
        expect(trendSummary('wpm', [])).toBe('After 3 more sessions');
    });
    it('pace, pauses and clarity summaries', () => {
        const pts = [point(0, { wpm: 99, pauses: 1, clarity: 98 }), point(1, { wpm: 100, pauses: 2, clarity: 100 }), point(2, { wpm: 102, pauses: 2.5, clarity: 99 })];
        expect(trendSummary('wpm', pts)).toBe('Avg 100 wpm');
        expect(trendSummary('pauses', pts)).toBe('Avg 1.8 / min');
        expect(trendSummary('clarity', pts)).toBe('Steady at 98–100%');
        expect(trendSummary('clarity', [point(0, { clarity: 70 }), point(1, { clarity: 90 }), point(2, { clarity: 80 })])).toBe('Avg 80%');
    });
});

describe('#1258 D6 Filler words: counts for the two newest measured sessions', () => {
    it('CASUALTY: a not-measured session (null / absent / invalid) is never latest or previous', () => {
        const newest = session(7, null);
        const invalid = session(6, { not_a_key: 3 });
        const measured = session(5, { um: 2 });
        const emptyMap = session(3, {}); // #1472: an empty map alone is not a measured zero
        const older = session(2, { uh: 1 });
        const model = fillerBreakdownModel([newest, invalid, measured, emptyMap, older]);
        expect(model.latest?.id).toBe(measured.id);
        expect(model.previous?.id).toBe(older.id);
    });

    it('the headline is the session page count, and the rows add up to it (true fillers by default)', () => {
        const latest = session(7, { um: 2, uh: 1, so: 3, you_know: 1 });
        const previous = session(1, { um: 1 });
        const model = fillerBreakdownModel([latest, previous]);
        expect(model.latest?.count).toBe(getSessionAnalysisMetrics(latest).fillerCount);
        expect(model.latest?.count).toBe(3);
        expect(model.rows.map((r) => [r.label, r.latest, r.previous])).toEqual([['Um', 2, 1], ['Uh', 1, 0]]);
        expect(model.rows.reduce((sum, r) => sum + r.latest, 0)).toBe(model.latest?.count);
        expect(fillerSummary(model)).toBe('3 in your latest session');
    });

    it('with discourse markers opted in, the guide example renders: So 2 times / 1 time, You know 1 time / —', () => {
        const model = fillerBreakdownModel([session(7, { so: 2, you_know: 1 }), session(1, { so: 1 })], { includeDiscourseMarkers: true });
        render(<FillerWordsBreakdown model={model} />);
        const so = screen.getByTestId('filler-breakdown-row-so');
        expect(so.textContent?.replace(/\s+/g, ' ')).toBe('So2 times1 time');
        const youKnow = screen.getByTestId('filler-breakdown-row-you_know');
        expect(within(youKnow).getByRole('rowheader').textContent).toBe('You know');
        expect(youKnow.textContent).toContain('—');
        expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 rows; no all-dash row
        expect(screen.getByText('Times each word was said')).toBeInTheDocument();
        expect(screen.getByText('· counted, not per minute')).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/_|per min(?!ute)|\d\.\d/);
    });

    it('both measured sessions at a true-filler zero (observed discourse markers only): one line, no table', () => {
        // #1472: the zero must be OBSERVED evidence (a counted discourse marker), never an empty map.
        render(<FillerWordsBreakdown model={fillerBreakdownModel([session(7, { like: 2 }), session(1, { so: 4 })])} />);
        expect(screen.getByText('No filler words detected in your last two sessions.')).toBeInTheDocument();
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('only one measured session: no comparison line and no second column', () => {
        render(<FillerWordsBreakdown model={fillerBreakdownModel([session(7, { um: 1 }), session(1, null)])} />);
        expect(screen.getByText('1 in your latest session')).toBeInTheDocument();
        expect(screen.queryByText(/in the one before/)).toBeNull();
        expect(screen.getAllByRole('columnheader')).toHaveLength(2);
        expect(screen.getByTestId('filler-breakdown-row-um').textContent).toBe('Um1 time');
    });
});

describe('#1258 D7 TrendsCard', () => {
    const data = [point(0, { wpm: 100, clarity: 99, pauses: null }), point(1, { wpm: 100, clarity: 100, pauses: null }), point(2, { wpm: 100, clarity: 98, pauses: null })];
    const sessions = [session(7, { um: 2 }), session(1, { um: 1 })];

    it('every row starts collapsed with a summary, and no chart is mounted until a row opens', () => {
        const { container } = render(<TrendsCard slideIds={['pace_trend', 'pause_trend', 'filler_words', 'clarity_trend']} trendData={data} sessions={sessions} />);
        const ids = ['pace_trend', 'pause_trend', 'filler_words', 'clarity_trend'];
        for (const id of ids) expect(screen.getByTestId(`trend-row-${id}`)).toHaveAttribute('aria-expanded', 'false');
        expect(container.querySelector('.recharts-wrapper')).toBeNull();
        expect(screen.getByTestId('trend-row-pace_trend').textContent).toContain('Avg 100 wpm');
        expect(screen.getByTestId('trend-row-pause_trend').textContent).toContain('After 3 more sessions');
        expect(screen.getByTestId('trend-row-clarity_trend').textContent).toContain('Clear delivery');
        expect(screen.getByTestId('trend-row-filler_words').textContent).toContain('2 in your latest session');

        fireEvent.click(screen.getByTestId('trend-row-pace_trend'));
        expect(screen.getByTestId('trend-row-pace_trend')).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('.recharts-wrapper')).toBeTruthy();
    });

    it('opening Filler words shows the counted table', () => {
        render(<TrendsCard slideIds={['filler_words']} trendData={data} sessions={sessions} />);
        fireEvent.click(screen.getByTestId('trend-row-filler_words'));
        expect(screen.getByText('Times each word was said')).toBeInTheDocument();
        expect(screen.getByTestId('filler-breakdown-row-um').textContent).toBe('Um2 times1 time');
    });

    it('weekly activity summarises this week\'s sessions', () => {
        render(<TrendsCard slideIds={['weekly_activity']} trendData={data} sessions={sessions} />);
        expect(screen.getByTestId('trend-row-weekly_activity').textContent).toContain('3 sessions this week');
    });
});
