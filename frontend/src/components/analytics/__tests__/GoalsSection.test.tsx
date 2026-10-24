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

    it('unavailable week and all-time: em dashes, no bars, no 0% or 0 sessions, and an honest message', () => {
        (useAnalytics as Mock).mockReturnValue({
            weekly: { status: 'unavailable' }, allTime: { status: 'unavailable', reason: 'summary_failed' }, loading: false, error: null,
        });
        render(<GoalsSection />);
        expect(screen.getByTestId('weekly-sessions-value').textContent).toMatch(/^—/);
        expect(screen.getByTestId('clarity-avg-value').textContent).toMatch(/^—/);
        expect(screen.getByTestId('goals-section').textContent).not.toMatch(/\b0%|^0 /);
        expect(screen.getByText("Your goal progress can't load right now.")).toBeInTheDocument();
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
