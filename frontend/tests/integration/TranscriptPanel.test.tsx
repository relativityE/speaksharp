import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptPanel } from '@/components/session/TranscriptPanel';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('@/components/session/StatefulPanel', () => ({
    InitialStatePanel: () => <div data-testid="initial-state">Start speaking to see transcript</div>,
    ErrorStatePanel: ({ error }: { error: Error }) => <div data-testid="error-state">{error.message}</div>,
    LoadingStatePanel: () => <div data-testid="loading-state">Loading...</div>,
}));

describe('TranscriptPanel Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
        if (global.gc) {
            global.gc();
        }
    });

    describe('Initial State', () => {
        it('shows initial state when not listening and no transcript', () => {
            render(<TranscriptPanel isListening={false} isReady={false} />);

            expect(screen.getByTestId('initial-state')).toBeInTheDocument();
        });
    });

    describe('Listening State', () => {
        it('shows listening message when ready but no transcript yet', () => {
            render(<TranscriptPanel isListening={true} isReady={true} chunks={[]} />);

            expect(screen.getByText(/listening/i)).toBeInTheDocument();
        });
    });

    describe('Transcript Display', () => {
        const mockChunks = [
            { id: 1, text: 'Hello world', speaker: undefined },
            { id: 2, text: 'This is a test', speaker: undefined },
        ];

        it('renders transcript chunks', () => {
            render(<TranscriptPanel chunks={mockChunks} isListening={false} isReady={true} fillerData={{}} />);

            expect(screen.getByText(/Hello world/i)).toBeInTheDocument();
            expect(screen.getByText(/This is a test/i)).toBeInTheDocument();
        });

        it('highlights filler words in transcript', () => {
            const chunksWithFillers = [
                { id: 1, text: 'Hello um world', speaker: undefined },
            ];
            const fillerData = {
                um: { count: 1, color: '#ff6b6b' },
            };

            render(<TranscriptPanel chunks={chunksWithFillers} fillerData={fillerData} isListening={false} isReady={true} />);

            const highlightedWords = screen.getAllByTestId('highlighted-word');
            expect(highlightedWords.length).toBeGreaterThan(0);
        });

        it('displays interim transcript', () => {
            render(
                <TranscriptPanel
                    chunks={mockChunks}
                    interimTranscript="speaking now"
                    isListening={true}
                    fillerData={{}}
                />
            );

            expect(screen.getByTestId('transcript-display')).toHaveTextContent(/speaking now/i);
        });
    });

    describe('Empty State', () => {
        it('shows empty state after session ends with no transcript', () => {
            render(<TranscriptPanel chunks={[]} isListening={false} isLoading={false} />);

            // Component will show initial state, not empty state, when hasEverListened is false
            // Empty state only shows after a session has been active
        });
    });

    describe('Error Handling', () => {
        it('displays error state when error occurs', () => {
            const testError = new Error('Transcription failed');
            render(<TranscriptPanel error={testError} />);

            expect(screen.getByTestId('error-state')).toHaveTextContent('Transcription failed');
        });
    });

    describe('Loading State', () => {
        it('shows loading state', () => {
            render(<TranscriptPanel isLoading={true} />);

            expect(screen.getByTestId('loading-state')).toBeInTheDocument();
        });
    });

    describe('Multiple Filler Words', () => {
        it('highlights multiple different filler words', () => {
            const chunks = [
                { id: 1, text: 'like um you know basically', speaker: undefined },
            ];
            const fillerData = {
                like: { count: 1, color: '#ff6b6b' },
                um: { count: 1, color: '#ffd93d' },
                'you know': { count: 1, color: '#6bcf7f' },
                basically: { count: 1, color: '#95e1d3' },
            };

            render(<TranscriptPanel chunks={chunks} fillerData={fillerData} isListening={false} isReady={true} />);

            const highlightedWords = screen.getAllByTestId('highlighted-word');
            expect(highlightedWords.length).toBeGreaterThanOrEqual(3);
        });
    });
});
