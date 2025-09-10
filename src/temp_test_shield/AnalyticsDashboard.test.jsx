import { render, screen, within } from '../test/test-utils'; // Use the custom render
import { describe, it, expect, vi } from 'vitest';
import { AnalyticsDashboard, AnalyticsDashboardSkeleton } from '../components/AnalyticsDashboard';
import { FILLER_WORD_KEYS } from '../config';

// Mock dependencies
vi.mock('../lib/pdfGenerator', () => ({
  generateSessionPdf: vi.fn(),
}));

// Mocking recharts is tricky. Let's just mock the container to avoid context errors.
vi.mock('recharts', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
    };
});

const mockSessionHistory = [
  {
    id: '1',
    created_at: '2025-08-22T10:00:00.000Z',
    title: 'Test Session 1',
    duration: 600,
    total_words: 1000,
    filler_words: {
        [FILLER_WORD_KEYS.UM]: { count: 5, color: '#BFDBFE' },
        [FILLER_WORD_KEYS.UH]: { count: 3, color: '#FCA5A5' }
    },
    accuracy: 0.95,
  },
  {
    id: '2',
    created_at: '2025-08-23T11:00:00.000Z',
    title: 'Test Session 2',
    duration: 300,
    total_words: 500,
    filler_words: {
        [FILLER_WORD_KEYS.UM]: { count: 2, color: '#BFDBFE' }
    },
    accuracy: 0.98,
  },
];

describe('AnalyticsDashboard', () => {
    const proAuthMock = { profile: { subscription_status: 'pro' } };
    const freeAuthMock = { profile: { subscription_status: 'free' } };

    it('renders the empty state when no session history is provided', () => {
        render(
            <AnalyticsDashboard sessionHistory={[]} profile={freeAuthMock.profile} />,
            { authMock: freeAuthMock }
        );
        expect(screen.getByText('Your Dashboard Awaits!')).toBeInTheDocument();
    });

    it('renders the main dashboard with data for a pro user', () => {
        render(
            <AnalyticsDashboard sessionHistory={mockSessionHistory} profile={proAuthMock.profile} />,
            { authMock: proAuthMock }
        );

        const totalSessionsCard = screen.getByTestId('stat-card-total-sessions');
        expect(within(totalSessionsCard).getByText('2')).toBeInTheDocument();

    const avgFillerCard = screen.getByTestId('avg-filler-words-min');
        expect(within(avgFillerCard).getByText('0.7')).toBeInTheDocument();

        const totalTimeCard = screen.getByTestId('total-practice-time');
        const timeValueElement = totalTimeCard.querySelector('.text-4xl');
        expect(timeValueElement).toHaveTextContent('15.0');

        const avgAccuracyCard = screen.getByTestId('avg-accuracy');
        const accuracyValueElement = avgAccuracyCard.querySelector('.text-4xl');
        expect(accuracyValueElement).toHaveTextContent('96.5');

        expect(screen.queryAllByTestId('responsive-container')).toHaveLength(1);
        expect(screen.queryByText('Unlock Your Full Potential')).not.toBeInTheDocument();
    });

    it('renders the main dashboard with data for a free user', () => {
        render(
            <AnalyticsDashboard sessionHistory={mockSessionHistory} profile={freeAuthMock.profile} />,
            { authMock: freeAuthMock }
        );

        expect(screen.getByText('Unlock Your Full Potential')).toBeInTheDocument();
    });

    it('applies the correct contrast styling to the Upgrade Now button', () => {
        render(
          <AnalyticsDashboard sessionHistory={mockSessionHistory} profile={freeAuthMock.profile} />,
          { authMock: freeAuthMock }
        );

        const upgradeButton = screen.getByRole('button', { name: /Upgrade Now/i });
        expect(upgradeButton.className).toContain('bg-white');
    expect(upgradeButton.className).toContain('text-primary');
    });

    it('renders the session history items with correct duration', () => {
        render(
          <AnalyticsDashboard sessionHistory={mockSessionHistory} profile={proAuthMock.profile} />,
          { authMock: proAuthMock }
        );

        const sessionItems = screen.getAllByTestId('session-history-item');
        expect(sessionItems).toHaveLength(2);

        // Check Session 1
        expect(within(sessionItems[0]).getByText('Test Session 1')).toBeInTheDocument();
        expect(within(sessionItems[0]).getByText('10.0 min')).toBeInTheDocument();

        // Check Session 2
        expect(within(sessionItems[1]).getByText('Test Session 2')).toBeInTheDocument();
        expect(within(sessionItems[1]).getByText('5.0 min')).toBeInTheDocument();
    });
});

describe('AnalyticsDashboardSkeleton', () => {
    it('renders the skeleton component', () => {
        const { container } = render(<AnalyticsDashboardSkeleton />);
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });
});
