/**
 * #1472 — Goals never present a partial page or a failed summary as this week's count or the all-time clarity average.
 */
import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GoalsSection } from '../GoalsSection';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useGoals } from '@/hooks/useGoals';

vi.mock('@/hooks/useAnalytics', () => ({ useAnalytics: vi.fn() }));
vi.mock('@/hooks/useGoals', () => ({ useGoals: vi.fn() }));

const stats = {
    totalSessions: 21, totalPracticeTime: 30, totalPracticeTimeSeconds: 1800, averageSessionLength: null,
    averageSessionLengthSeconds: null, averageWPM: 120, avgFillerWordsPerMin: null, avgClarity: 88, avgPausesPerMin: null, chartData: [],
};

describe('GoalsSection (#1472 availability)', () => {
    beforeEach(() => {
        (useGoals as Mock).mockReturnValue({ goals: { weeklyGoal: 5, clarityGoal: 80 }, setGoals: vi.fn() });
    });

    it('shows a safe goal-sync warning rather than masking the permission error', () => {
        (useGoals as Mock).mockReturnValue({ goals: { weeklyGoal: 5, clarityGoal: 80 }, setGoals: vi.fn(),
            syncError: new Error('permission denied: private diagnostic text') });
        (useAnalytics as Mock).mockReturnValue({
            weekly: { status: 'complete', count: 6, activity: [] }, allTime: { status: 'complete', stats }, loading: false, error: null,
        });
        render(<GoalsSection />);
        expect(screen.getByRole('status')).toHaveTextContent('Account goal sync is unavailable. Showing local goals or defaults.');
        expect(screen.queryByText(/private diagnostic text/)).toBeNull();
    });

    it('unavailable week and all-time: em dashes, no bars, no 0% or 0 sessions, and an honest message', () => {
        (useAnalytics as Mock).mockReturnValue({
            weekly: { status: 'unavailable' }, allTime: { status: 'unavailable', reason: 'summary_failed' }, loading: false, error: null,
        });
        render(<GoalsSection />);
        expect(screen.getByTestId('weekly-sessions-value').textContent).toMatch(/^—/);
        expect(screen.getByTestId('clarity-avg-value').textContent).toMatch(/^—/);
        expect(screen.getByTestId('goals-section').textContent).not.toMatch(/\b0%|^0 /);
        expect(screen.getByText("Your goal progress can't load right now.")).toBeInTheDocument();
        expect(screen.queryAllByTestId('goal-actual-fill-track')).toHaveLength(0);
    });

    it('a complete aggregate with no clarity evidence keeps clarity unknown: no 0%, no clarity bar', () => {
        (useAnalytics as Mock).mockReturnValue({
            weekly: { status: 'complete', count: 2, activity: [] }, allTime: { status: 'complete', stats: { ...stats, avgClarity: null } }, loading: false, error: null,
        });
        render(<GoalsSection />);
        expect(screen.getByTestId('clarity-avg-value').textContent).toMatch(/^—/);
        expect(screen.getByTestId('goals-section').textContent).not.toMatch(/\b0%/);
        expect(screen.queryAllByTestId('goal-actual-fill-track')).toHaveLength(1); // the weekly bar only
    });

    it('a failed recent history does not hide goals the complete aggregates can answer', () => {
        (useAnalytics as Mock).mockReturnValue({
            weekly: { status: 'complete', count: 6, activity: [] }, allTime: { status: 'complete', stats }, loading: false, error: new Error('history failed'),
        });
        render(<GoalsSection />);
        expect(screen.queryByText('Could not load goals.')).toBeNull();
        expect(screen.getByTestId('weekly-sessions-value').textContent).toMatch(/^6/);
    });

    it('CONTROL complete week and all-time: the real count, the real clarity and the goal message', () => {
        (useAnalytics as Mock).mockReturnValue({
            weekly: { status: 'complete', count: 6, activity: [] }, allTime: { status: 'complete', stats }, loading: false, error: null,
        });
        render(<GoalsSection />);
        expect(screen.getByTestId('weekly-sessions-value').textContent).toMatch(/^6/);
        expect(screen.getByTestId('clarity-avg-value').textContent).toMatch(/^88%/);
        expect(screen.getByText("Excellent work — you've cleared both goals this week.")).toBeInTheDocument();
    });
});
