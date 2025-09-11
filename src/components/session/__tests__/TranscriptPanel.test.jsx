import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TranscriptPanel } from '../TranscriptPanel';

// Mock the logger
vi.mock('../../../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));

const mockFillerData = {
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
});
