import React from 'react';
import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { TEST_IDS } from '@/constants/testIds';

describe('LiveTranscriptPanel', () => {
    it('records a timestamped UI-visible lifecycle trace when text renders', () => {
        window.__SS_TRANSCRIPT_TRACE__ = [];
        window.__SS_TRANSCRIPT_TRACE_SEQ__ = 0;

        render(
            <LiveTranscriptPanel
                transcript="Hello world"
                interimTranscript="speaking now"
                isListening={true}
            />
        );

        expect(window.__SS_TRANSCRIPT_TRACE__).toEqual([
            expect.objectContaining({
                sequence: 1,
                stage: 'ui:visible',
                timestamp: expect.any(Number),
                t: expect.any(Number),
                textLength: 'Hello world speaking now'.length,
                preview: 'Hello world speaking now',
            }),
        ]);
    });

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
        expect(screen.getByTestId('live-transcript-current-line')).toHaveTextContent('speaking now');
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
        expect(screen.getByTestId('live-transcript-current-line')).toHaveTextContent('speaking now');
    });

    it('does not render the same Native interim hypothesis twice when it matches transcript text', () => {
        render(
            <LiveTranscriptPanel
                transcript="a dash of pepper spoils beef stew"
                interimTranscript="a dash of pepper spoils beef stew"
                isListening={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).textContent).toBe('a dash of pepper spoils beef stew');
    });

    it('does not erase final transcript text when later interim text is empty', () => {
        const { rerender } = render(
            <LiveTranscriptPanel
                transcript="um final words are visible"
                interimTranscript="temporary interim"
                isListening={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('um final words are visible temporary interim');

        rerender(
            <LiveTranscriptPanel
                transcript="um final words are visible"
                interimTranscript=""
                isListening={true}
            />
        );

        expect(screen.queryByText('Listening...')).not.toBeInTheDocument();
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('um final words are visible');
    });

    it('keeps finalized history visible across an engine handoff with a new blank segment', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                history={[{ mode: 'private', text: 'first finalized private segment' }]}
                isListening={true}
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(transcriptContainer).toHaveTextContent('Chapter 1: Private');
        expect(transcriptContainer).toHaveTextContent('first finalized private segment');
        expect(transcriptContainer).toHaveTextContent('Listening...');
    });

    it('keeps the live transcript scrollable without a visible scrollbar', () => {
        render(
            <LiveTranscriptPanel
                transcript="first sentence second sentence third sentence"
                interimTranscript=""
                isListening={true}
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(transcriptContainer).toHaveAttribute('data-scrollable-transcript', 'true');
        expect(transcriptContainer).toHaveClass('overflow-y-auto');
        expect(transcriptContainer).toHaveClass('live-transcript-scroll');
    });

    it('shows Private-only processing feedback before transcript text arrives', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                isListening={true}
                sttMode="private"
                micLevel={0.45}
                hasSpeechActivity={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('Processing locally...');
        expect(screen.getAllByText('Processing locally...')).toHaveLength(1);
        expect(screen.getByText('Private local')).toBeInTheDocument();
    });

    it('keeps non-Private modes on the simple listening state', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                isListening={true}
                sttMode="native"
                micLevel={0.45}
                hasSpeechActivity={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('Listening...');
        expect(screen.queryByText('Processing locally...')).not.toBeInTheDocument();
    });

    // --- Interim/draft + finalizing UI states (test-agent acceptance criteria) ---

    it('marks provisional text as draft and distinguishes it from final', () => {
        render(
            <LiveTranscriptPanel
                transcript="committed words"
                interimTranscript="draft words"
                isListening={true}
            />
        );
        // Draft preview line is explicitly labeled and flagged for browser assertion.
        const draftLine = screen.getByTestId('live-transcript-current-line');
        expect(draftLine).toHaveAttribute('data-transcript-draft', 'true');
        expect(draftLine).toHaveTextContent('Draft');
        expect(draftLine).toHaveTextContent('draft words');
        // Container reports the discrete UI state.
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'drafting');
    });

    it('shows "Processing speech locally…" and finalizing state during whole-utterance decode', () => {
        render(
            <LiveTranscriptPanel
                transcript="rough draft so far"
                interimTranscript="rough draft so far"
                isListening={false}
                isFinalizing={true}
                sttMode="private"
            />
        );
        expect(screen.getByTestId('live-transcript-finalizing')).toHaveTextContent('Processing speech locally');
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'finalizing');
    });

    it('reports final state (no draft) once listening stops with committed text', () => {
        render(
            <LiveTranscriptPanel
                transcript="the final committed transcript"
                interimTranscript=""
                isListening={false}
                isFinalizing={false}
            />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'final');
        expect(screen.queryByTestId('live-transcript-finalizing')).not.toBeInTheDocument();
        expect(screen.queryByTestId('live-transcript-current-line')).not.toBeInTheDocument();
    });

    it('reports listening state before any text', () => {
        render(
            <LiveTranscriptPanel transcript="" interimTranscript="" isListening={true} sttMode="native" />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'listening');
    });
});
