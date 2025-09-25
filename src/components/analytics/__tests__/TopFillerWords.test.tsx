import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TopFillerWords } from '../TopFillerWords';
import { useAnalytics } from '@/hooks/useAnalytics';

vi.mock('@/hooks/useAnalytics');

const mockUseAnalytics = vi.mocked(useAnalytics);

describe('TopFillerWords', () => {
    it('should render loading state', () => {
        mockUseAnalytics.mockReturnValue({
            topFillerWords: [],
            loading: true,
            error: null,
            accuracyData: [],
        });
        render(<TopFillerWords />);
        expect(screen.getByText('Top Filler Words')).toBeInTheDocument();
    });

    it('should render error state', () => {
        mockUseAnalytics.mockReturnValue({
            topFillerWords: [],
            loading: false,
            error: new Error('Failed to load'),
            accuracyData: [],
        });
        render(<TopFillerWords />);
        expect(screen.getByText('Could not load top filler words.')).toBeInTheDocument();
    });

    it('should render top filler words', () => {
        mockUseAnalytics.mockReturnValue({
            topFillerWords: [
                { word: 'like', count: 10 },
                { word: 'um', count: 5 },
            ],
            loading: false,
            error: null,
            accuracyData: [],
        });
        render(<TopFillerWords />);
        expect(screen.getByText('like')).toBeInTheDocument();
        expect(screen.getByText('10 times')).toBeInTheDocument();
        expect(screen.getByText('um')).toBeInTheDocument();
        expect(screen.getByText('5 times')).toBeInTheDocument();
    });

    it('should render empty state', () => {
        mockUseAnalytics.mockReturnValue({
            topFillerWords: [],
            loading: false,
            error: null,
            accuracyData: [],
        });
        render(<TopFillerWords />);
        expect(screen.getByText('Not enough data to show top filler words.')).toBeInTheDocument();
    });
});