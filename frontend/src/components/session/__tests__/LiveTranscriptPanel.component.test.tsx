import React from 'react';
import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { TEST_IDS } from '@/constants/testIds';

describe('LiveTranscriptPanel', () => {
    it('shows interim transcript text while listening before final chunks arrive', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript="speaking now"
                isListening={true}
            />
        );

        expect(screen.queryByText('Listening...')).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('speaking now');
    });

    it('renders final and interim text with normal word spacing', () => {
        render(
            <LiveTranscriptPanel
                transcript="Hello world"
                interimTranscript="speaking now"
                isListening={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).textContent).toContain('Hello world speaking now');
    });
});
