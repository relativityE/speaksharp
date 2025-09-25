import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AccuracyComparison } from '../AccuracyComparison';
import { useAnalytics } from '@/hooks/useAnalytics';

vi.mock('@/hooks/useAnalytics');

const mockUseAnalytics = vi.mocked(useAnalytics);

describe('AccuracyComparison', () => {
    it('should render loading state', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            loading: true,
            error: null,
            topFillerWords: [],
        });
        render(<AccuracyComparison />);
        // In loading state, the title is simpler
        expect(screen.getByRole('heading', { name: /STT Accuracy Comparison/i })).toBeInTheDocument();
    });

    it('should render error state', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            loading: false,
            error: new Error('Failed to load'),
            topFillerWords: [],
        });
        render(<AccuracyComparison />);
        expect(screen.getByText('Could not load accuracy data.')).toBeInTheDocument();
    });

    it('should render accuracy data', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [
                { date: '2023-10-26', accuracy: 95, engine: 'Cloud AI' },
                { date: '2023-10-27', accuracy: 98, engine: 'On-Device' },
            ],
            loading: false,
            error: null,
            topFillerWords: [],
        });
        render(<AccuracyComparison />);
        // When data is loaded, the full title is shown. Use a more robust query.
        expect(screen.getByRole('heading', { name: 'STT Accuracy Comparison (vs. Ground Truth)' })).toBeInTheDocument();
    });

    it('should render empty state', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            loading: false,
            error: null,
            topFillerWords: [],
        });
        render(<AccuracyComparison />);
        expect(screen.getByText('Provide ground truth transcripts for at least two sessions to see your accuracy trend.')).toBeInTheDocument();
    });
});