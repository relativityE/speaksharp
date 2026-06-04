import React from 'react';
import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { LiveTranscriptPanel, splitSettledActiveTranscript } from '@/components/session/LiveTranscriptPanel';
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
        expect(screen.getByTestId('live-transcript-trust-banner')).toHaveTextContent('Draft transcript');
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

    it('does not render a differing interim hypothesis twice', () => {
        render(
            <LiveTranscriptPanel
                transcript="Hello world"
                interimTranscript="speaking now"
                isListening={true}
            />
        );

        const text = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).textContent ?? '';
        expect(text.match(/speaking now/g)).toHaveLength(1);
    });

    it('does not render the same Native interim hypothesis twice when it matches transcript text', () => {
        render(
            <LiveTranscriptPanel
                transcript="a dash of pepper spoils beef stew"
                interimTranscript="a dash of pepper spoils beef stew"
                isListening={true}
            />
        );

        const text = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).textContent ?? '';
        expect(text.match(/a dash of pepper spoils beef stew/g)).toHaveLength(1);
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

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('Processing speech locally…');
        expect(screen.getAllByText('Processing speech locally…')).toHaveLength(1);
        expect(screen.getByText('Private local')).toBeInTheDocument();
    });

    it('shows Private-local listening feedback before speech activity starts', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                isListening={true}
                sttMode="private"
                micLevel={0}
                hasSpeechActivity={false}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('Listening locally…');
        expect(screen.queryByText('Start recording and your words will appear here.')).not.toBeInTheDocument();
    });

    it('keeps non-Private modes on truthful generic processing copy with a stable draft notice', () => {
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

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(transcriptContainer).toHaveTextContent('Processing speech…');
        expect(screen.getByTestId('live-transcript-trust-banner')).toHaveTextContent('Draft transcript');
        expect(transcriptContainer).not.toHaveTextContent('Processing speech locally…');
        expect(transcriptContainer).not.toHaveTextContent('Listening locally…');
    });

    // --- Interim/draft + finalizing UI states (test-agent acceptance criteria) ---

    it('marks provisional text as draft and distinguishes it from final', () => {
        render(
            <LiveTranscriptPanel
                transcript="committed words"
                interimTranscript="draft words"
                sttMode="private"
                isListening={true}
            />
        );
        // Draft preview line is explicitly labeled and flagged for browser assertion.
        const draftLine = screen.getByTestId('live-transcript-current-line');
        expect(draftLine).toHaveAttribute('data-transcript-draft', 'true');
        expect(draftLine).toHaveTextContent('draft words');
        expect(screen.getByTestId('live-transcript-trust-banner')).toHaveTextContent('Draft transcript');
        // Container reports the discrete UI state.
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'drafting');
    });

    it('exposes trust-state proof hooks without scraping transcript text', () => {
        window.__SS_TRUST_TRACE__ = [];
        window.__SS_TRUST_STATE__ = undefined;

        render(
            <LiveTranscriptPanel
                transcript="committed words"
                interimTranscript="draft words"
                sttMode="native"
                isListening={true}
            />
        );

        const panel = screen.getByTestId(TEST_IDS.TRANSCRIPT_PANEL);
        expect(panel).toHaveAttribute('data-draft-banner-visible', 'true');
        expect(panel).toHaveAttribute('data-processing-visible', 'false');
        expect(panel).toHaveAttribute('data-final-state-visible', 'false');
        expect(panel).toHaveAttribute('data-listening-visible', 'false');
        expect(window.__SS_TRUST_STATE__).toEqual(
            expect.objectContaining({
                uiState: 'drafting',
                draftBannerVisible: true,
                processingVisible: false,
                finalStateVisible: false,
                listeningVisible: false,
                sttMode: 'native',
                at: expect.any(Number),
                t: expect.any(Number),
            })
        );
        expect(window.__SS_TRUST_TRACE__).toContainEqual(expect.objectContaining({ uiState: 'drafting' }));
    });

    it('marks committed Private live text as draft while recording even without interim text', () => {
        render(
            <LiveTranscriptPanel
                transcript="day like"
                interimTranscript=""
                sttMode="private"
                isListening={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'drafting');
        const draftRegions = screen.getAllByLabelText('Draft transcript, still being recognized');
        expect(draftRegions.some((region) => region.getAttribute('data-transcript-draft') === 'true')).toBe(true);
        expect(screen.getByTestId('live-transcript-trust-banner')).toHaveTextContent('Draft transcript');
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('day like');
    });

    it('marks non-Private committed live text as draft while recording', () => {
        render(
            <LiveTranscriptPanel
                transcript="native committed text"
                interimTranscript=""
                sttMode="native"
                isListening={true}
            />
        );

        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'drafting');
        expect(screen.getByTestId('live-transcript-trust-banner')).toHaveTextContent('Draft transcript');
        expect(screen.getByLabelText('Draft transcript, still being recognized')).toHaveAttribute('data-transcript-draft', 'true');
    });

    it('does not leak stale interim draft text after Private final state', () => {
        render(
            <LiveTranscriptPanel
                transcript="private final text"
                interimTranscript="stale draft text"
                sttMode="private"
                isListening={false}
                isFinalizing={false}
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(transcriptContainer).toHaveAttribute('data-transcript-state', 'final');
        expect(transcriptContainer).toHaveTextContent('private final text');
        expect(transcriptContainer).not.toHaveTextContent('stale draft text');
        expect(screen.queryByTestId('live-transcript-trust-banner')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Draft transcript, still being recognized')).not.toBeInTheDocument();
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

    it('does not show the idle placeholder while Private finalization has no text yet', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                isListening={false}
                isFinalizing={true}
                sttMode="private"
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(transcriptContainer).toHaveAttribute('data-transcript-state', 'finalizing');
        expect(screen.getByTestId('live-transcript-finalizing')).toHaveTextContent('Processing speech locally');
        expect(screen.getByTestId('live-transcript-finalizing-empty')).toHaveTextContent('Finalizing local transcript…');
        expect(transcriptContainer).not.toHaveTextContent('Start recording and your words will appear here.');
    });

    it('never uses local-processing copy for Native finalization', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                isListening={false}
                isFinalizing={true}
                sttMode="native"
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(screen.getByTestId('live-transcript-finalizing')).toHaveTextContent('Processing transcript…');
        expect(screen.getByTestId('live-transcript-finalizing-empty')).toHaveTextContent('Finalizing transcript…');
        expect(transcriptContainer).toHaveTextContent('Your final transcript will appear here when processing finishes.');
        expect(transcriptContainer).not.toHaveTextContent('Processing speech locally…');
        expect(transcriptContainer).not.toHaveTextContent('Finalizing local transcript…');
        expect(transcriptContainer).not.toHaveTextContent('local processing');
    });

    it('never uses local-processing copy for Cloud finalization', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript=""
                isListening={false}
                isFinalizing={true}
                sttMode="cloud"
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        expect(screen.getByTestId('live-transcript-finalizing')).toHaveTextContent('Processing transcript…');
        expect(screen.getByTestId('live-transcript-finalizing-empty')).toHaveTextContent('Finalizing transcript…');
        expect(transcriptContainer).not.toHaveTextContent('locally');
        expect(transcriptContainer).not.toHaveTextContent('local transcript');
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

    // --- Option 1: live-view segment finalization (settled vs active) ---

    describe('splitSettledActiveTranscript', () => {
        it('returns everything as active when there is no sentence terminator', () => {
            expect(splitSettledActiveTranscript('the quick brown fox')).toEqual({
                settled: '', active: 'the quick brown fox',
            });
        });
        it('splits completed sentences (settled) from the trailing in-progress sentence (active)', () => {
            expect(splitSettledActiveTranscript('First point. Second point. And I am still')).toEqual({
                settled: 'First point. Second point.', active: 'And I am still',
            });
        });
        it('treats a fully-terminated draft as all settled (nothing in progress)', () => {
            expect(splitSettledActiveTranscript('All done here.')).toEqual({
                settled: 'All done here.', active: '',
            });
        });
        it('handles empty input', () => {
            expect(splitSettledActiveTranscript('')).toEqual({ settled: '', active: '' });
        });
    });

    it('REGRESSION(Option 1): a multi-sentence draft settles completed sentences while the active one stays Draft', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript="First clear point. Then a second point. And I am still speaking"
                sttMode="private"
                isListening={true}
            />
        );
        const settled = screen.getByTestId('live-transcript-settled');
        expect(settled).toHaveTextContent('First clear point. Then a second point.');
        expect(settled).not.toHaveTextContent('And I am still speaking');

        const active = screen.getByTestId('live-transcript-current-line');
        expect(active).toHaveTextContent('And I am still speaking');
        expect(active).toHaveAttribute('data-transcript-draft', 'true');
        // Saved/committed transcript surface is untouched (still empty during draft).
        expect(screen.getByTestId('transcript-text-only')).toHaveAttribute('data-transcript-text-only', '');
    });

    it('Option 1: a single in-progress sentence shows no settled block (unchanged single-Draft behaviour)', () => {
        render(
            <LiveTranscriptPanel
                transcript=""
                interimTranscript="I am partway through a thought"
                sttMode="private"
                isListening={true}
            />
        );
        expect(screen.queryByTestId('live-transcript-settled')).not.toBeInTheDocument();
        expect(screen.getByTestId('live-transcript-current-line')).toHaveTextContent('I am partway through a thought');
    });

    it('reports listening state before any text', () => {
        render(
            <LiveTranscriptPanel transcript="" interimTranscript="" isListening={true} sttMode="native" />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'listening');
        expect(screen.getByTestId('live-transcript-trust-banner')).toHaveTextContent('Draft transcript');
    });

    it('REGRESSION: Native keeps a trust indicator visible at every step mic-on -> final (no gap, generic copy)', () => {
        // Blocker #3 requirement (a): the trust/finalizing banner must stay visible
        // across the whole Native journey. The production stop ordering sets
        // isFinalizing=true (freeze) BEFORE isListening flips false (STOPPING), so the
        // finalizing banner takes over from the draft banner without a blank frame.
        const assertTrustIndicatorPresent = () => {
            const draft = screen.queryByTestId('live-transcript-trust-banner');
            const finalizing = screen.queryByTestId('live-transcript-finalizing');
            // Exactly one trust surface is visible at each pre-final step.
            expect(Boolean(draft) || Boolean(finalizing)).toBe(true);
            const text = (draft?.textContent ?? '') + (finalizing?.textContent ?? '');
            // Native must never use Private's on-device copy.
            expect(text.toLowerCase()).not.toContain('locally');
            expect(text.toLowerCase()).not.toContain('local transcript');
        };

        // 1. mic-on, no text yet (listening)
        const { rerender } = render(
            <LiveTranscriptPanel transcript="" interimTranscript="" isListening={true} isFinalizing={false} sttMode="native" />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'listening');
        assertTrustIndicatorPresent();

        // 2. mic-on, drafting text
        rerender(
            <LiveTranscriptPanel transcript="native words so far" interimTranscript="more words" isListening={true} isFinalizing={false} sttMode="native" />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'drafting');
        assertTrustIndicatorPresent();

        // 3. stop -> finalizing (freeze sets isFinalizing before STOPPING clears isListening)
        rerender(
            <LiveTranscriptPanel transcript="native words so far" interimTranscript="" isListening={false} isFinalizing={true} sttMode="native" />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'finalizing');
        expect(screen.getByTestId('live-transcript-finalizing')).toHaveTextContent('Processing transcript…');
        assertTrustIndicatorPresent();

        // 4. final (journey end): committed transcript, no banner
        rerender(
            <LiveTranscriptPanel transcript="native words so far" interimTranscript="" isListening={false} isFinalizing={false} sttMode="native" />
        );
        expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveAttribute('data-transcript-state', 'final');
        expect(screen.queryByTestId('live-transcript-finalizing')).not.toBeInTheDocument();
        expect(screen.queryByTestId('live-transcript-trust-banner')).not.toBeInTheDocument();
    });
});
