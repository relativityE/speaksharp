import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, Mock } from 'vitest';
import { AccuracyComparison } from '../AccuracyComparison';
import { useAnalytics } from '@/hooks/useAnalytics';

vi.mock('@/hooks/useAnalytics');

describe('AccuracyComparison', () => {
    const defaultMockData = {
        overallStats: {
            totalSessions: 0,
            totalPracticeTime: 0,
            avgWpm: 0,
            avgFillerWordsPerMin: "0.0",
            avgAccuracy: "0.0",
            chartData: []
        },
        fillerWordTrends: {},
        sessionHistory: [],
        topFillerWords: []
    };

    it('renders loading state', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            accuracyData: [],
            loading: true,
            error: null,
        });

        render(<AccuracyComparison />);
        expect(screen.getByText('STT Accuracy Comparison')).toBeInTheDocument();
    });

    it('renders error state', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            accuracyData: [],
            loading: false,
            error: new Error('Failed to load'),
        });

        render(<AccuracyComparison />);
        expect(screen.getByText('Could not load accuracy data.')).toBeInTheDocument();
    });

    it('renders accuracy comparison chart', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            accuracyData: [
                { date: '2023-10-27', accuracy: 95, engine: 'Cloud AI' },
                { date: '2023-10-26', accuracy: 90, engine: 'On-Device' },
            ],
            loading: false,
            error: null,
        });

        render(<AccuracyComparison />);
        expect(screen.getByText('STT Accuracy Comparison (vs. Ground Truth)')).toBeInTheDocument();
    });

    it('renders empty state', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            accuracyData: [],
            loading: false,
            error: null,
        });

        render(<AccuracyComparison />);
        expect(screen.getByText('Provide ground truth transcripts for at least two sessions to see your accuracy trend.')).toBeInTheDocument();
    });
});