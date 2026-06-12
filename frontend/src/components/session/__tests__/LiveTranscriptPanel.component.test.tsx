import React from 'react';
import { render, screen } from '../../../../tests/support/test-utils';
import { act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import {
    collapseAdjacentRepeatedPhrases,
    hasSevereRepetitionLoop,
    splitSettledActiveTranscript,
    trimOverlappingDraftTranscript
} from '@/components/session/liveTranscriptUtils';
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

    it('trims overlapping rolling draft text before displaying it to the user', () => {
        render(
            <LiveTranscriptPanel
                transcript="On the other hand the magnitude and difficulty"
                interimTranscript="On the other hand the magnitude and difficulty of the trust to which the voice of my country called me"
                isListening={true}
                sttMode="private"
            />
        );

        const text = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).textContent ?? '';
        expect(text.match(/On the other hand/g)).toHaveLength(1);
        expect(screen.getByTestId('live-transcript-current-line')).toHaveTextContent('of the trust to which the voice of my country called me');
    });

    it('collapses adjacent repeated live phrases for display without changing the raw transcript surface', () => {
        const rawTranscript = 'we need focus we need focus now';
        render(
            <LiveTranscriptPanel
                transcript={rawTranscript}
                interimTranscript=""
                isListening={true}
                sttMode="private"
            />
        );

        const visibleText = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER).textContent ?? '';
        expect(visibleText.match(/we need focus/g)).toHaveLength(1);
        expect(screen.getByTestId('transcript-text-only')).toHaveAttribute('data-transcript-text-only', rawTranscript);
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
        expect(transcriptContainer).toHaveAttribute('data-autoscroll-transcript', 'true');
        expect(transcriptContainer).toHaveClass('overflow-y-auto');
        expect(transcriptContainer).toHaveClass('live-transcript-scroll');
        expect(transcriptContainer).toHaveClass('h-[18rem]');
        expect(transcriptContainer).toHaveClass('sm:h-[20rem]');
        expect(transcriptContainer).toHaveClass('lg:h-[22rem]');
    });

    it('keeps new transcript text pinned inside the fixed scroll region', async () => {
        const { rerender } = render(
            <LiveTranscriptPanel
                transcript="first sentence"
                interimTranscript=""
                isListening={true}
            />
        );

        const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        Object.defineProperty(transcriptContainer, 'scrollHeight', {
            configurable: true,
            value: 1200,
        });
        Object.defineProperty(transcriptContainer, 'clientHeight', {
            configurable: true,
            value: 320,
        });
        transcriptContainer.scrollTop = 0;

        rerender(
            <LiveTranscriptPanel
                transcript={Array.from({ length: 80 }, (_, index) => `sentence ${index + 1}`).join(' ')}
                interimTranscript="latest words"
                isListening={true}
            />
        );

        await act(async () => {});
        expect(transcriptContainer.scrollTop).toBe(1200);
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

    describe('trimOverlappingDraftTranscript', () => {
        it('returns only the trailing new words when draft repeats the committed prefix', () => {
            expect(
                trimOverlappingDraftTranscript(
                    'On the other hand the magnitude and difficulty',
                    'On the other hand the magnitude and difficulty of the trust'
                )
            ).toBe('of the trust');
        });

        it('handles a one-word recognition correction before the overlapping region', () => {
            expect(
                trimOverlappingDraftTranscript(
                    'Veneration and love from a retreat which I had chosen',
                    'generation and love from a retreat which I had chosen with the fondest predilection'
                )
            ).toBe('with the fondest predilection');
        });

        it('keeps unrelated draft text intact', () => {
            expect(trimOverlappingDraftTranscript('first point', 'second point')).toBe('second point');
        });
    });

    describe('collapseAdjacentRepeatedPhrases', () => {
        it('removes immediate repeated phrases from the live display string', () => {
            expect(collapseAdjacentRepeatedPhrases('we need focus we need focus now')).toBe('we need focus now');
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

    describe('native formatting notice (threshold-only)', () => {
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });

        const renderFinalNative = (nativeFormatting: { status: 'idle' | 'pending' | 'complete' | 'failed'; startedAt: number | null }) =>
            render(
                <LiveTranscriptPanel
                    transcript="hello world"
                    isListening={false}
                    sttMode="native"
                    nativeFormatting={nativeFormatting}
                />
            );

        it('stays silent before the ~1.5s threshold, then shows the notice while pending', () => {
            renderFinalNative({ status: 'pending', startedAt: Date.now() });
            // Fast path: nothing yet (no perceived slowness).
            expect(screen.queryByText(/tidying up punctuation/i)).not.toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(1500); });
            expect(screen.getByText(/tidying up punctuation/i)).toBeInTheDocument();
        });

        it('never shows the notice on the fast path (idle/complete)', () => {
            renderFinalNative({ status: 'idle', startedAt: null });
            act(() => { vi.advanceTimersByTime(3000); });
            expect(screen.queryByText(/tidying up punctuation/i)).not.toBeInTheDocument();
        });

        it('never shows the notice for non-native modes even while pending', () => {
            render(
                <LiveTranscriptPanel
                    transcript="hello world"
                    isListening={false}
                    sttMode="private"
                    nativeFormatting={{ status: 'pending', startedAt: Date.now() }}
                />
            );
            act(() => { vi.advanceTimersByTime(3000); });
            expect(screen.queryByText(/tidying up punctuation/i)).not.toBeInTheDocument();
        });
    });

    describe('trust banner spacing', () => {
        it('separates the draft label and disclaimer so extracted text is not glued', () => {
            render(
                <LiveTranscriptPanel
                    transcript=""
                    interimTranscript="speaking now"
                    isListening
                    sttMode="native"
                />
            );
            const banner = screen.getByTestId('live-transcript-trust-banner');
            // Regression: previously textContent read "Draft transcriptText may change…".
            expect(banner).toHaveTextContent('Draft transcript Text may change before the final transcript is saved.');
            expect(banner.textContent).not.toContain('transcriptText');
        });

        it('keeps the trust banner outside the scrollable transcript log so text cannot scroll underneath it', () => {
            render(
                <LiveTranscriptPanel
                    transcript={Array.from({ length: 80 }, (_, index) => `sentence ${index + 1}`).join(' ')}
                    interimTranscript="latest words"
                    isListening
                    sttMode="private"
                />
            );

            const transcriptContainer = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
            const banner = screen.getByTestId('live-transcript-trust-banner');
            const slot = screen.getByTestId('live-transcript-banner-slot');

            expect(slot).toContainElement(banner);
            expect(transcriptContainer).not.toContainElement(banner);
            expect(transcriptContainer).toHaveClass('overflow-y-auto');
        });
    });

    describe('v4 repetition-loop withholding (LIVE-TRANSCRIPT-REPEATED-DISPLAY)', () => {
        // Real failure mode from Test artifact speaksharp-official-stt-ab-targeted-trust-1781263998:
        // the v4 rolling/streaming hypothesis loops ("It's a question" x28) in the COMMITTED store
        // transcript during drafting/finalizing, while the final whole-utterance decode is clean.
        // The display must WITHHOLD the looped live text (show Processing) until the clean final
        // arrives — without mutating any transcript data.
        const REAL_LOOP = 'Love from a return. ' + "It's a question. ".repeat(28);

        it('withholds a severe v4 loop from the visible surface and shows Processing (private)', () => {
            render(
                <LiveTranscriptPanel transcript={REAL_LOOP} interimTranscript="" isListening={false} isFinalizing sttMode="private" />
            );
            const container = screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
            const visibleReps = (container.textContent?.match(/it'?s a question/gi) || []).length;
            expect(visibleReps).toBeLessThan(3);
            expect(screen.getByTestId('live-transcript-loop-withheld')).toBeInTheDocument();
            expect(container).toHaveTextContent(/processing speech locally/i);
        });

        it('renders a clean final transcript normally (no withhold)', () => {
            render(
                <LiveTranscriptPanel transcript="This is a clean final transcript with varied content and no repetition loops." interimTranscript="" isListening={false} sttMode="private" />
            );
            expect(screen.queryByTestId('live-transcript-loop-withheld')).not.toBeInTheDocument();
            expect(screen.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER)).toHaveTextContent('This is a clean final transcript');
        });

        it('does NOT withhold in native (non-private) mode even with a looped transcript', () => {
            render(
                <LiveTranscriptPanel transcript={REAL_LOOP} interimTranscript="" isListening sttMode="native" />
            );
            expect(screen.queryByTestId('live-transcript-loop-withheld')).not.toBeInTheDocument();
        });

        describe('hasSevereRepetitionLoop detector', () => {
            it('flags a severe repetition loop', () => {
                expect(hasSevereRepetitionLoop(REAL_LOOP)).toBe(true);
            });
            it('does NOT flag clean varied text', () => {
                expect(hasSevereRepetitionLoop('This is a perfectly normal sentence with varied content and absolutely no loops here.')).toBe(false);
            });
            it('does NOT flag short text', () => {
                expect(hasSevereRepetitionLoop('too short to judge')).toBe(false);
            });
        });
    });
});
