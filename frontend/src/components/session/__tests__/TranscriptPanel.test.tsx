import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TranscriptPanel } from '../TranscriptPanel';
import type { FillerCounts } from '@/utils/fillerWordUtils';

// Mock the logger
vi.mock('../../../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));

const mockFillerData: FillerCounts = {
    'like': { count: 2, color: '#FCA5A5' },
    'so': { count: 1, color: '#FDE68A' },
};

const mockChunks = [
    { text: 'so this is like the first chunk', id: 1 },
    { text: 'and this is like the second', id: 2 },
];

describe('TranscriptPanel', () => {
    it('renders the transcript and highlights filler words correctly', () => {
        render(
            <TranscriptPanel
                chunks={mockChunks}
                interimTranscript=""
                fillerData={mockFillerData}
                isListening={true}
                isReady={true}
            />
        );

        // Check that the full transcript is rendered by checking the parent container
        const transcriptContainer = screen.getByTestId('transcript-container');
        expect(transcriptContainer).toHaveTextContent('so this is like the first chunk and this is like the second');

        // Check that filler words are highlighted
        const highlightedWords = screen.getAllByTestId('highlighted-word');
        expect(highlightedWords.length).toBe(3); // one 'so', two 'like's

        // Check the text and style of each highlighted word
        expect(highlightedWords[0]).toHaveTextContent('so');
        expect(highlightedWords[0]).toHaveStyle('background-color: #FDE68A');

        expect(highlightedWords[1]).toHaveTextContent('like');
        expect(highlightedWords[1]).toHaveStyle('background-color: #FCA5A5');

        expect(highlightedWords[2]).toHaveTextContent('like');
        expect(highlightedWords[2]).toHaveStyle('background-color: #FCA5A5');
    });

    it('renders interim transcript correctly', () => {
        render(
            <TranscriptPanel
                chunks={mockChunks}
                interimTranscript="and an interim part"
                fillerData={{}}
                isListening={true}
                isReady={true}
            />
        );
        expect(screen.getByText(/and an interim part/)).toBeInTheDocument();
        expect(screen.getByText(/and an interim part/)).toHaveClass('text-muted-foreground');
    });

    it('renders waiting message when listening but no text is available', () => {
        render(
            <TranscriptPanel
                chunks={[]}
                interimTranscript=""
                fillerData={{}}
                isListening={true}
                isReady={true}
            />
        );
        expect(screen.getByText('Listening...')).toBeInTheDocument();
    });

    it('renders speaker labels when provided', () => {
        const chunksWithSpeakers = [
            { text: 'Hello', id: 1, speaker: 'A' },
            { text: 'Hi there', id: 2, speaker: 'B' },
        ];
        render(
            <TranscriptPanel
                chunks={chunksWithSpeakers}
                interimTranscript=""
                fillerData={{}}
                isListening={true}
                isReady={true}
            />
        );
        expect(screen.getByText('Speaker A:')).toBeInTheDocument();
        expect(screen.getByText('Speaker B:')).toBeInTheDocument();
    });

    it('renders the initial state panel before any session activity', () => {
        render(<TranscriptPanel />);
        expect(screen.getByText('Ready to Go')).toBeInTheDocument();
        expect(screen.getByText('Click the "Start Session" button to begin recording and transcription.')).toBeInTheDocument();
    });

    it('renders the loading state panel when loading', () => {
        render(<TranscriptPanel isLoading={true} />);
        expect(screen.getAllByTestId('loading-skeleton').length).toBeGreaterThan(0);
    });

    it('renders the error state panel when an error is provided', () => {
        const error = new Error('A test error occurred');
        render(<TranscriptPanel error={error} />);
        expect(screen.getByText('An Error Occurred')).toBeInTheDocument();
        expect(screen.getByText('A test error occurred')).toBeInTheDocument();
    });

    it('renders the empty state panel after a session with no speech', () => {
        const { rerender } = render(<TranscriptPanel isListening={true} />);

        // Transition from listening to not listening to set hasEverListened ref
        rerender(<TranscriptPanel isListening={false} />);

        expect(screen.getByText('Session Complete')).toBeInTheDocument();
        expect(screen.getByText('No speech was detected during the session.')).toBeInTheDocument();
    });
});
