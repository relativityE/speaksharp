import { render, screen } from '@testing-library/react';
import { SessionComparisonDialog } from '../SessionComparisonDialog';
import { describe, it, expect, vi } from 'vitest';

// Mock Radix UI Dialog to avoid portal issues in tests
vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: { children: React.ReactNode, open: boolean }) => open ? <div>{children}</div> : null,
    DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

interface SessionMetrics {
    id: string;
    created_at: string;
    wpm: number;
    clarity_score: number;
    filler_count: number;
    duration_seconds: number;
}

const mockSessions: [SessionMetrics, SessionMetrics] = [
    {
        id: '1',
        created_at: '2025-01-01T10:00:00Z',
        wpm: 120,
        clarity_score: 85,
        filler_count: 10,
        duration_seconds: 60,
    },
    {
        id: '2',
        created_at: '2025-01-02T10:00:00Z',
        wpm: 140,
        clarity_score: 90,
        filler_count: 5,
        duration_seconds: 60,
    },
];

describe('SessionComparisonDialog', () => {
    it('renders nothing when closed', () => {
        render(
            <SessionComparisonDialog
                open={false}
                onOpenChange={() => { }}
                sessions={mockSessions}
            />
        );
        expect(screen.queryByText('Session Comparison')).not.toBeInTheDocument();
    });

    it('renders comparison data when open', () => {
        render(
            <SessionComparisonDialog
                open={true}
                onOpenChange={() => { }}
                sessions={mockSessions}
            />
        );

        expect(screen.getByText('Session Comparison')).toBeInTheDocument();
        expect(screen.getByText('Session 1')).toBeInTheDocument();
        expect(screen.getByText('Session 2')).toBeInTheDocument();

        // Check WPM values
        expect(screen.getAllByText('120').length).toBeGreaterThan(0);
        expect(screen.getAllByText('140').length).toBeGreaterThan(0);

        // Check progress labels
        expect(screen.getAllByText(/WPM/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Clarity/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Filler/i).length).toBeGreaterThan(0);
    });
});
