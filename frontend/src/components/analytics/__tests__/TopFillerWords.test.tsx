import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, Mock } from 'vitest';
import { TopFillerWords } from '../TopFillerWords';
import { useAnalytics } from '@/hooks/useAnalytics';

vi.mock('@/hooks/useAnalytics');

describe('TopFillerWords', () => {
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
        accuracyData: []
    };

    it('renders loading state', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            topFillerWords: [],
            loading: true,
            error: null,
        });

        render(<TopFillerWords />);
        expect(screen.getByText('Top Filler Words')).toBeInTheDocument();
    });

    it('renders error state', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            topFillerWords: [],
            loading: false,
            error: new Error('Failed to load'),
        });

        render(<TopFillerWords />);
        expect(screen.getByText('Could not load top filler words.')).toBeInTheDocument();
    });

    it('renders top filler words', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            topFillerWords: [
                { word: 'um', count: 10 },
                { word: 'like', count: 5 },
            ],
            loading: false,
            error: null,
        });

        render(<TopFillerWords />);
        expect(screen.getByText('um')).toBeInTheDocument();
        expect(screen.getByText('10 times')).toBeInTheDocument();
        expect(screen.getByText('like')).toBeInTheDocument();
        expect(screen.getByText('5 times')).toBeInTheDocument();
    });

    it('renders empty state', () => {
        (useAnalytics as Mock).mockReturnValue({
            ...defaultMockData,
            topFillerWords: [],
            loading: false,
            error: null,
        });

        render(<TopFillerWords />);
        expect(screen.getByText('Not enough data to show top filler words.')).toBeInTheDocument();
    });
});