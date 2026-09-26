import { render, screen } from '../../../../tests/support/test-utils';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { deriveFocusCoverage } from '@/utils/focusCoverage';

const base: SessionOverhaulViewProps = {
    authUserId: 'user-1',
    isListening: false,
    sttStatus: { type: 'idle' } as SttStatus,
    elapsedTime: 0,
    micLevel: 0,
    transcriptContent: '',
    showAnalyticsPrompt: false,
    metricsFillerCount: 0,
    onStartStop: vi.fn(),
    history: [],
};

// #1222 S11 — the view maps the live runtime onto the correct state through the shared shell.
describe('SessionOverhaulView (#1222 S11)', () => {
    it('idle runtime → before state (mic + prompt offer) through the shell', () => {
        render(<SessionOverhaulView {...base} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('mic-card')).toBeInTheDocument();
        expect(screen.getByTestId('prompt-offer')).toBeInTheDocument();
    });

    it('CASUALTY G16 D1: a first session gets the progress CARD with its plain baseline line, never a disclaimer', () => {
        render(<SessionOverhaulView {...base} history={[]} />);
        expect(screen.queryByTestId('comparable-progress-notice')).toBeNull();
        expect(screen.queryByText(/no universal score/i)).toBeNull();
        const card = screen.getByTestId('clarity-vs-last-session');
        expect(screen.getByTestId('session-slot-d')).toContainElement(card);
        expect(card).toHaveTextContent('Your progress'); // G18: the eyebrow names the outcome, not the composite
        expect(card.textContent ?? '').not.toMatch(/clarity vs last session/i);
        expect(card).toHaveTextContent('First session — this run becomes your baseline.');
    });

    it('CASUALTY G16 D1: a returning user gets a surface with a body — never the bare "See your progress" heading', () => {
        render(
            <SessionOverhaulView
                {...base}
                history={[{ id: 's1', user_id: 'user-1', created_at: '2026-09-01T00:00:00Z', duration: 90 }]}
            />,
        );
        const slotD = screen.getByTestId('session-slot-d');
        expect(slotD.textContent ?? '').not.toMatch(/See your progress/);
        const card = screen.getByTestId('clarity-vs-last-session');
        expect(card).toHaveAttribute('data-progress-body', 'no-history');
        // Not their first session, so the card must not say it is.
        expect(card.textContent ?? '').not.toMatch(/first session/i);
    });

    it('CASUALTY G16 D3: the filler-word control is its own rail card — the transcript header carries no link or tick', () => {
        render(<SessionOverhaulView {...base} />);
        expect(screen.queryByTestId('custom-words-bar')).toBeNull();
        const edit = screen.getByTestId('add-custom-word-button');
        expect(screen.getByTestId('tracked-filler-words-card')).toContainElement(edit);
        expect(screen.getByTestId('transcript-card')).not.toContainElement(edit);
        const header = screen.getByTestId('transcript-before-header');
        expect(header).toHaveTextContent(/live transcript/i);
        expect(header).toHaveTextContent('0 words');
        expect(header.querySelector('svg')).toBeNull();
    });

    it('G16 D3: the only signature-yellow fill in the before row is "Give me a prompt"', () => {
        const { container } = render(<SessionOverhaulView {...base} />);
        const row = container.querySelector('[data-testid="session-shell-row"]') as HTMLElement;
        const yellowFills = [...row.querySelectorAll<HTMLElement>('*')].filter((el) => /(^|\s)bg-signature(\s|$)/.test(el.className));
        expect(yellowFills).toHaveLength(1);
        expect(yellowFills[0]).toHaveTextContent('Give me a prompt');
        expect(row.innerHTML).not.toMatch(/text-signature(-text)?\b/);
    });

    it('G16 D2: the before row stretches both columns; during/after keep items-start', () => {
        const { container, rerender } = render(<SessionOverhaulView {...base} />);
        expect(container.querySelector('[data-testid="session-shell-row"]')!.className).toContain('md:items-stretch');
        rerender(<SessionOverhaulView {...base} isListening transcriptContent="so um" elapsedTime={30} />);
        expect(container.querySelector('[data-testid="session-shell-row"]')!.className).toContain('md:items-start');
    });

    it('listening runtime → during state (recorder bar + live transcript)', () => {
        render(<SessionOverhaulView {...base} isListening transcriptContent="so um hello" elapsedTime={30} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('recorder-bar')).toBeInTheDocument();
        expect(screen.getByTestId('live-transcript')).toBeInTheDocument();
        expect(screen.getAllByTestId('live-filler').length).toBeGreaterThan(0); // "um" highlighted
    });

    it('stopped runtime → after state, transcript-only (no audio play/time)', () => {
        // #1416 F-05 — the after-state transcript now comes from the RETAINED authority, because
        // finalization purges working memory by contract. Passing `transcriptContent` alone described
        // a parent that no longer exists; a real one supplies what the server retained.
        render(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                transcriptContent="so um hello"
                reviewTranscript={{ kind: 'available', text: 'so um hello' }}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        // S-11: slot A is the run's static shape with the mic returned — never a transport.
        expect(screen.getByTestId('run-shape')).toBeInTheDocument();
        expect(screen.queryByTestId('playback-scrubber')).toBeNull();
        // Transcript-only: no audio playback affordances, and the final duration alone (no elapsed/total).
        expect(screen.queryByRole('button', { name: /play|pause|seek/i })).toBeNull();
        expect(screen.getByTestId('run-shape').textContent ?? '').not.toMatch(/\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/);
        // Open Mic keeps the filler legend.
        expect(screen.getByTestId('run-shape-legend')).toBeInTheDocument();
    });

    // PO 2026-08-10: the post-Stop FINALIZING window must resolve to `after`, never `before` — otherwise the
    // "Not sure what to say?" prompt offer flashed back AND the captured mic envelope got wiped (flat waveform).
    it('finalizing (stopped, decode running, analytics not yet shown) resolves to AFTER, not the offer', () => {
        render(<SessionOverhaulView {...base} isFinalizing showAnalyticsPrompt={false} transcriptContent="so um hello" />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        // The captured envelope is kept for the run shape, not wiped.
        expect(screen.getByTestId('run-shape')).toBeInTheDocument();
        // The before-state prompt offer must NOT appear during finalizing.
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
    });

    it('a mic-permission error keeps the before state and surfaces the error in the mic card', () => {
        render(<SessionOverhaulView {...base} sttStatus={{ type: 'error', message: 'Mic blocked' } as SttStatus} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('mic-error')).toHaveTextContent('Mic blocked');
    });

    // #1306 Option A: at the terminal review the transcript/chunks are purged and the live fillerData is zeroed
    // by the useFillerWords sync. The review MUST render the FINAL snapshot (breakdown + counts + words) instead
    // of recounting the (empty) transcript — proving the metrics-only review needs no retained transcript.
    it('renders the FINALIZED filler/word snapshot in the after-state with the transcript purged', () => {
        render(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                transcriptContent=""                    /* transcript purged at terminal */
                metricsFillerCount={0}                    /* live headline zeroed after purge */
                fillerData={{} as unknown as FillerCounts} /* live fillerData zeroed by the useFillerWords sync */
                finalizedWordCount={14}
                finalizedFillerData={{ um: { count: 3 }, like: { count: 2 }, total: { count: 5 } } as unknown as FillerCounts}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        // Breakdown renders from the snapshot (NOT the empty live data / purged transcript).
        expect(screen.getByTestId('filler-breakdown-list')).toBeInTheDocument();
        expect(screen.queryByTestId('filler-breakdown-empty')).toBeNull();
        const words = screen.getAllByTestId('filler-breakdown-word').map((w) => w.getAttribute('data-word'));
        // #1314 C3 (PM ruling): true fillers are preserved and discourse markers ("like") are EXCLUDED from
        // the chips AND the total, so both come from one map and agree: um×3 = 3, and "like" is not a chip.
        expect(words).toEqual(['um']);
        expect(screen.getByTestId('after-stats')).toHaveTextContent('3 fillers · 14 words');
    });
});

// #1314 C3 — the filler total and the per-word chips must never contradict: both derive from ONE
// validated snapshot, and the displayed total is the sum of the rendered chips. Reproduces the actual
// defect sequence (independent sources feed the count vs the breakdown).
describe('SessionOverhaulView filler consistency (#1314 C3)', () => {
    const afterProps = {
        showAnalyticsPrompt: true,
        transcriptContent: '',
        metricsFillerCount: 0,
        fillerData: {} as unknown as FillerCounts,
        finalizedWordCount: 20,
    };
    function renderedTotal(): number {
        const stats = screen.getByTestId('after-stats').textContent || '';
        const m = stats.match(/(\d+)\s+fillers/);
        return m ? Number(m[1]) : NaN;
    }
    function renderedChipSum(): number {
        return screen.queryAllByTestId('filler-breakdown-count')
            .reduce((sum, el) => sum + Number((el.textContent || '').replace(/[^0-9]/g, '')), 0);
    }

    it('displayed total equals the sum of the rendered chips (measured nonzero)', () => {
        render(
            <SessionOverhaulView
                {...base}
                {...afterProps}
                finalizedFillerData={{ um: { count: 2 }, like: { count: 1 }, total: { count: 9 } } as unknown as FillerCounts}
            />,
        );
        expect(renderedChipSum()).toBe(2); // um(2) only; discourse "like" excluded from chips and total
        expect(renderedTotal()).toBe(renderedChipSum());
    });

    it('measured zero renders zero with no chips', () => {
        render(
            <SessionOverhaulView
                {...base}
                {...afterProps}
                finalizedFillerData={{} as unknown as FillerCounts}
            />,
        );
        expect(screen.getByTestId('filler-breakdown-empty')).toBeInTheDocument();
        expect(renderedTotal()).toBe(0);
    });

    it('unavailable snapshot makes no numeric filler claim', () => {
        render(
            <SessionOverhaulView
                {...base}
                {...afterProps}
                finalizedFillerData={null}
            />,
        );
        expect(screen.getByTestId('after-stats').textContent || '').not.toMatch(/\d+\s+fillers/);
    });
});

// #1046 Focus Points — a distinct product on the shared shell (spec: "slots are shared; semantics are
// not"). A bound brief (objectivePoints) turns slot C into live coverage, slot D into the points, strips
// the prompt offer + filler chrome, and highlights coverage in the transcript. Coverage is derived from
// the transcript by the local keyword matcher, so these tests drive it with real covering text.
describe('SessionOverhaulView Focus Points (#1046)', () => {
    // #1533 P2 #3: after-session actions share the mic's live gate — resolve it for this owner, nothing owed.
    beforeEach(() => { useSessionStore.setState({ progressGate: null, progressGateResolvedFor: 'user-1' }); });
    const POINTS = ['Name the price', 'State the guarantee'];

    // F-1 / F-2: the rail (slot D) states the plan above the points, and scores nothing before the run.
    it('objective before (no guide) → the rail states the plan above the points; no 0/N, no pace half', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        const rail = screen.getByTestId('session-slot-d');
        expect(rail).toContainElement(screen.getByTestId('coverage-pace'));
        expect(rail).toContainElement(screen.getByTestId('focus-points-rail'));
        const children = Array.from(rail.children).map((el) => el.getAttribute('data-testid'));
        expect(children).toEqual(['coverage-pace', 'focus-points-rail']);
        expect(screen.getByTestId('coverage-pace-plan')).toHaveTextContent(/^2 points$/);
        for (const id of ['coverage-pace-count', 'coverage-pace-covered', 'coverage-pace-guide', 'coverage-pace-planned', 'coverage-pace-perpoint', 'coverage-pace-projection', 'coverage-pace-bar', 'coverage-pace-nudge']) {
            expect(screen.queryByTestId(id)).toBeNull();
        }
        // F-1: the coaching band exists for Focus Points too, in slot B.
        expect(screen.getByTestId('session-slot-b')).toHaveTextContent('Tips appear as you speak.');
        expect(screen.queryByText(/current pace|at this pace/i)).toBeNull();
        expect(screen.getByTestId('focus-points-rail')).toBeInTheDocument();
        expect(screen.getByTestId('focus-point-0')).toHaveTextContent('Name the price');
        expect(screen.queryByTestId('prompt-offer')).toBeNull();
        // Slot D owns the ordered list; it must NOT repeat the aggregate fraction.
        expect(screen.queryByText(/of 2 points covered/i)).toBeNull();
    });

    it('objective before WITH a pace guide → the guide is stated once, in the plan; Edit pace reopens the editor', () => {
        const onEditPoints = vi.fn();
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} objectivePaceGuideSecPerPoint={60} onEditPoints={onEditPoints} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByTestId('coverage-pace-plan')).toHaveTextContent('2 points · about 2:00 at 1:00 per point');
        fireEvent.click(screen.getByTestId('coverage-pace-edit'));
        expect(onEditPoints).toHaveBeenCalledTimes(1);
        // No count, measured pace, projection, progress bar, countdown, over-guide, or nudge before recording.
        for (const id of ['coverage-pace-count', 'coverage-pace-guide', 'coverage-pace-planned', 'coverage-pace-perpoint', 'coverage-pace-projection', 'coverage-pace-bar', 'coverage-pace-nudge']) {
            expect(screen.queryByTestId(id)).toBeNull();
        }
        expect(screen.queryByText(/current pace|at this pace|actual|remaining|left\b/i)).toBeNull();
    });

    it('objective during → Coverage & pace shows the count and a covered point ticks in slot D', () => {
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent="I will name the price now." elapsedTime={20} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
        expect(screen.queryByTestId('comparable-progress-notice')).toBeNull();
    });

    it('P1 CASUALTY: Open Mic after-state keeps Practice this again, and it starts a new take', () => {
        // `practiceLoopReview` is always an element once a session completes, and passing it as
        // `slotDContent` REPLACED the default verdict instead of adding to it — taking `Practice this
        // again` with it. That is the only desktop control wired to `onStartStop`, and `MobileActionBar`
        // is hidden at `md`, so a desktop user finishing a session had no way to start another take.
        const onStartStop = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                onStartStop={onStartStop}
                practiceLoopReview={<div data-testid="review-slot">the review</div>}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');

        // Both are present: the review did not evict the verdict.
        const practiceAgain = screen.getByTestId('verdict-practice-again');
        expect(practiceAgain).toBeInTheDocument();
        expect(screen.getByTestId('review-slot')).toBeInTheDocument();
        expect(screen.getByTestId('open-mic-practice-loop-review')).toBeInTheDocument();

        // And it actually starts a take rather than merely rendering.
        fireEvent.click(practiceAgain);
        expect(onStartStop).toHaveBeenCalledTimes(1);
    });

    it('objective after → coverage count, missed-point reason, retry + delivery strip', () => {
        // Production shape after #1423: finalization PURGES working memory, and the retained transcript
        // arrives from the server as the review authority. A fixture that leaves words in the buffer models
        // a state the app can no longer be in, and would let coverage pass by reading the wrong source.
        render(<SessionOverhaulView {...base} objectivePoints={POINTS} showAnalyticsPrompt transcriptContent="" reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }} elapsedTime={84} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        // §Duplication acceptance check: the coverage fraction appears EXACTLY ONCE (Slot C). The transcript
        // header must NOT repeat it as a second "n of m points covered" scoreboard.
        expect(screen.queryByText(/of 2 points covered/i)).toBeNull();
        // The missed point is the most important line — it names the honest cause + the forward move.
        expect(screen.getByTestId('focus-point-1-not-detected')).toBeInTheDocument();
        expect(screen.getByTestId('focus-points-retry')).toBeInTheDocument();
        expect(screen.getByTestId('focus-delivery-strip')).toBeInTheDocument();
        expect(screen.queryByTestId('scrubber-legend')).toBeNull();
        expect(screen.queryByRole('button', { name: /seek/i })).toBeNull();
        expect(screen.queryByTestId('comparable-progress-notice')).toBeNull();
    });

    it('terminal coverage uses the stop-seam authority, not a weaker transcript re-score', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={[
                    { id: 'point-1', label: POINTS[0], status: 'missing' },
                    { id: 'point-2', label: POINTS[1], status: 'covered' },
                ]}
                showAnalyticsPrompt
                transcriptContent=""
                // The flattened label matcher cannot match "guarantee" here; the stop seam matched the
                // configured cue against timestamped segments and is the terminal authority.
                reviewTranscript={{ kind: 'available', text: 'I discussed the warranty terms.' }}
            />,
        );
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        expect(screen.getByTestId('focus-point-1')).toHaveAttribute('data-status', 'covered');
        expect(screen.queryByTestId('focus-point-1-not-detected')).toBeNull();
    });

    it('withholds terminal claims when SessionPage supplies no stop-seam result', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={null}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
            />,
        );
        expect(screen.getAllByTestId(/focus-point-\d+$/).map((row) => row.getAttribute('data-status')))
            .toEqual(['pending', 'pending']);
        expect(screen.queryByTestId('coverage-pace-count')).toBeNull();
        expect(screen.queryByText(/not detected/i)).toBeNull();
        // #1258 (PM review of c1fb43379): a null result with an available transcript is the normal window while
        // the point results are still saving — "Checking", never "unavailable" or "couldn't check".
        expect(screen.getByTestId('coverage-checking')).toHaveTextContent('Checking your points…');
        expect(screen.queryByTestId('coverage-unavailable')).toBeNull();
        expect(screen.queryByTestId('focus-points-check-unavailable')).toBeNull();
        expect(screen.getAllByText('Checking…')).toHaveLength(2);
        expect(screen.queryByTestId('clarity-vs-last-session')).toBeNull();
    });

    it('#1258: a check that ENDED without results says so — detection unavailable, and the rail says it could not check', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={null}
                objectiveCoverageFailed
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
            />,
        );
        expect(screen.getByTestId('coverage-unavailable')).toHaveTextContent(/unavailable for this take/i);
        expect(screen.queryByTestId('coverage-checking')).toBeNull();
        expect(screen.getByTestId('focus-points-check-unavailable')).toHaveTextContent('We couldn’t check your points this time.');
        expect(screen.queryByText('Checking…')).toBeNull();
        expect(screen.queryByText(/not detected/i)).toBeNull();
    });

    // Codex P2 r4111548230 (PM: VALID, CURRENT_PR) — the ENDED check is terminal even when the saved transcript cannot be
    // read (still pending, malformed, or its bounded attempts exhausted all surface as `unavailable`). Before the fix the
    // page promised "Coverage will appear…" and the rail said "Checking…" for as long as the page stayed open.
    it('CASUALTY: a check that ENDED is terminal even while the transcript read is unavailable — no promise, no endless Checking', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={null}
                objectiveCoverageFailed
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'unavailable' }}
            />,
        );
        expect(screen.getByTestId('coverage-unavailable')).toHaveTextContent(/unavailable for this take/i);
        expect(screen.queryByTestId('coverage-awaiting-transcript')).toBeNull();
        expect(screen.queryByTestId('coverage-checking')).toBeNull();
        expect(screen.getByTestId('focus-points-check-unavailable')).toHaveTextContent('We couldn’t check your points this time.');
        expect(screen.queryByText('Checking…')).toBeNull();
        expect(screen.queryByText(/not detected/i)).toBeNull();
    });

    it('CONTROL: a check that has NOT ended keeps its honest waiting states (transcript unavailable → coverage will appear; available → Checking)', () => {
        const { unmount } = render(
            <SessionOverhaulView {...base} objectivePoints={POINTS} objectiveCoverage={null} showAnalyticsPrompt transcriptContent=""
                reviewTranscript={{ kind: 'unavailable' }} />,
        );
        expect(screen.getByTestId('coverage-awaiting-transcript')).toHaveTextContent(/when your transcript is available/i);
        expect(screen.queryByTestId('coverage-unavailable')).toBeNull();
        expect(screen.queryByTestId('focus-points-check-unavailable')).toBeNull();
        unmount();
        render(
            <SessionOverhaulView {...base} objectivePoints={POINTS} objectiveCoverage={null} showAnalyticsPrompt transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }} />,
        );
        expect(screen.getByTestId('coverage-checking')).toHaveTextContent('Checking your points…');
        expect(screen.queryByTestId('coverage-unavailable')).toBeNull();
    });

    it.each(['expired', 'not_captured'] as const)(
        'CASUALTY: a terminally %s transcript renders coverage-unavailable, never the Open Mic card',
        (kind) => {
            /**
             * #1427 P1 — SHIPPED, and this is the casualty that pins it.
             *
             * `coverageTerminallyUnavailable` required `kind === 'available'`, and
             * `coverageMayBecomeAvailable` requires `kind === 'unavailable'`. For these two terminal
             * kinds BOTH were false, so slot C fell through to `undefined` and `SessionAfterState`
             * rendered the generic Open Mic progress card — a different product's summary
             * presented as this Focus Points take's result.
             *
             * The existing `available` test above could not catch it: that kind satisfied the old
             * predicate, so the one state that worked was the only one covered. Parameterised over
             * both terminal kinds because fixing one and not the other is the likeliest partial fix.
             */
            render(
                <SessionOverhaulView
                    {...base}
                    objectivePoints={POINTS}
                    /**
                     * STALE COVERAGE, NOT NULL. A save can publish `objectiveCoverageResult` and THEN
                     * fail transcript retention, so the array outlives the transcript it described.
                     * My first version passed `null` here, which is the easy half: the predicate also
                     * required `objectiveCoverage === null`, so a surviving array sent slot C to the
                     * generic Open Mic card with a fabricated "+0% fewer fillers".
                     */
                    objectiveCoverage={[
                        { briefPointId: 'fp-0', point: POINTS[0], status: 'covered' },
                        { briefPointId: 'fp-1', point: POINTS[1], status: 'missing' },
                    ] as never}
                    showAnalyticsPrompt
                    transcriptContent=""
                    reviewTranscript={{ kind }}
                />,
            );
            expect(screen.getByTestId('coverage-unavailable')).toHaveTextContent(/unavailable for this take/i);
            // #1258 G20 B3: here the check truly cannot happen, and the rail says so.
            expect(screen.getByTestId('focus-points-check-unavailable')).toHaveTextContent('We couldn’t check your points this time.');
            // The specific wrong outcome, asserted directly: the Open Mic summary must not stand in.
            expect(screen.queryByTestId('clarity-vs-last-session')).toBeNull();
            // And it must not claim coverage is still coming — this transcript is never coming back.
            expect(screen.queryByTestId('coverage-awaiting-transcript')).toBeNull();
        },
    );

    it('keeps partial stop-seam evidence distinct from a full detection in the terminal rail', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={[
                    { id: 'point-1', label: POINTS[0], status: 'partial' },
                    { id: 'point-2', label: POINTS[1], status: 'covered' },
                ]}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I mentioned price and guarantee.' }}
            />,
        );

        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('2/2');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'partial');
        expect(screen.queryByTestId('coverage-footer')).not.toBeInTheDocument();
        expect(screen.queryByText(/green marks where each point landed/i)).not.toBeInTheDocument();
        expect(screen.getByTestId('focus-point-0')).toHaveTextContent('Partly detected');
        expect(screen.getByTestId('focus-point-1')).toHaveAttribute('data-status', 'covered');
    });

    it('keeps the strongest live status through transcript rewrites without promoting partial', () => {
        const partialText = ['name price', 'price', 'name the amount']
            .find((text) => deriveFocusCoverage(POINTS, text, 20).rows[0]?.status === 'partial');
        expect(partialText, 'fixture must exercise point 1 as partial').toBeDefined();

        const { rerender } = render(
            <SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent={partialText!} elapsedTime={20} />,
        );
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'partial');

        rerender(<SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent="Unrelated rewrite" elapsedTime={21} />);
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'partial');

        rerender(<SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent="I will name the price now." elapsedTime={22} />);
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');

        rerender(<SessionOverhaulView {...base} objectivePoints={POINTS} isListening transcriptContent={partialText!} elapsedTime={23} />);
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
    });

    it('a direct after→during retry starts at 0/N instead of inheriting the prior take count', () => {
        const { rerender } = render(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={[
                    { id: 'point-1', label: POINTS[0], status: 'covered' },
                    { id: 'point-2', label: POINTS[1], status: 'missing' },
                ]}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
            />,
        );
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');

        // Model the batched retry path: no intermediate before render.
        rerender(
            <SessionOverhaulView
                {...base}
                objectivePoints={POINTS}
                objectiveCoverage={null}
                isListening
                showAnalyticsPrompt={false}
                transcriptContent="Unrelated opening words"
                elapsedTime={2}
            />,
        );
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('0/2');
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'pending');
    });

    it('no brief (Open Mic) → no coverage/pace card / points rail; the prompt offer is present', () => {
        render(<SessionOverhaulView {...base} objectivePoints={null} />);
        expect(screen.queryByTestId('coverage-pace')).toBeNull();
        expect(screen.queryByTestId('focus-points-rail')).toBeNull();
        expect(screen.getByTestId('prompt-offer')).toBeInTheDocument();
    });

    // #1046 G6/G7 — on save the LIVE brief is cleared (isolation invariant), so the after-state must fall
    // back to the finished-brief SNAPSHOT or the whole FP review screen (coverage card, delivery strip,
    // highlights) silently reverts to the generic Open-Mic screen. This is the bug the width-regression
    // e2e caught in the real save→render flow.
    it('objective after via the completed SNAPSHOT (live brief cleared on save) → FP review still renders', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={null}
                completedObjectivePoints={POINTS}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={84}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('1/2');
        expect(screen.getByTestId('focus-delivery-strip')).toBeInTheDocument();
        expect(screen.getByTestId('focus-points-rail')).toBeInTheDocument();
    });

    // Isolation: the snapshot must NEVER make a fresh before/during session look like Focus Points — only
    // the after-state consults it. A new Open Mic session with a lingering snapshot stays Open Mic.
    it('completed snapshot is IGNORED in before/during (fresh Open Mic stays Open Mic)', () => {
        render(<SessionOverhaulView {...base} objectivePoints={null} completedObjectivePoints={POINTS} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.queryByTestId('coverage-pace')).toBeNull();
        expect(screen.queryByTestId('focus-points-rail')).toBeNull();
        expect(screen.getByTestId('prompt-offer')).toBeInTheDocument();
    });

    // S-11 — found in a real browser: Stop can drop `isListening` one render BEFORE `isFinalizing` rises, so
    // that single render resolves to `before`. A reset there erased the take, and the after shape was either
    // empty or (previously) padded to a fake flat line.
    it('CASUALTY: the take survives the one-render `before` flash between Stop and finalizing', () => {
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
            () => ({ width: 400, height: 34, top: 0, left: 0, right: 400, bottom: 34, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
        );
        try {
            const { rerender } = render(<SessionOverhaulView {...base} isListening micLevel={0.2} elapsedTime={1} />);
            for (const [i, level] of [0.6, 0.9, 0.3, 0.7].entries()) {
                rerender(<SessionOverhaulView {...base} isListening micLevel={level} elapsedTime={2 + i} />);
            }
            // The race: not listening, not yet finalizing → resolves to `before` for exactly one render.
            rerender(<SessionOverhaulView {...base} isListening={false} micLevel={0} elapsedTime={0} />);
            rerender(<SessionOverhaulView {...base} isListening={false} isFinalizing micLevel={0} elapsedTime={0} transcriptContent="so um hello" />);
            expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
            const lines = screen.getAllByTestId('run-shape-waveform-line');
            expect(lines.length).toBeGreaterThanOrEqual(5);
            // Real levels, not a padded flat line: the loud 0.9 sample is visibly taller than the floor.
            expect(Math.max(...lines.map((l) => parseInt(l.style.height, 10)))).toBeGreaterThan(20);
        } finally {
            rect.mockRestore();
        }
    });

    // PM ruling on #1498 (S-10): the held live tip has ONE home — the THIS RUN rail. It was rendered in slot B
    // as well, so the user read identical advice twice.
    it('CASUALTY: during Open Mic the live tip appears exactly once, in the THIS RUN rail, never in slot B', () => {
        const fillerData = { um: { count: 4 }, total: { count: 4 } } as unknown as FillerCounts;
        render(
            <SessionOverhaulView
                {...base}
                isListening
                elapsedTime={30}
                transcriptContent="um so um we um think um the plan works"
                fillerData={fillerData}
                metricsFillerCount={4}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        const railTip = screen.getByTestId('this-run-tip');
        expect(railTip.textContent?.trim().length).toBeGreaterThan(0);
        expect(screen.getByTestId('session-slot-b').textContent).not.toContain(railTip.textContent!.trim());
        expect(screen.queryByTestId('live-tip')).toBeNull();
    });

    // #1498 P2 — during post-Stop finalization a new start is gated. The returned mic took the press anyway:
    // it looked actionable, emitted a choice, and was then silently swallowed by the lifecycle gate.
    it('CASUALTY: the returned mic is disabled exactly when the start gate blocks a new recording', () => {
        const onStartStop = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                onStartStop={onStartStop}
                isFinalizing
                isButtonDisabled
                showAnalyticsPrompt={false}
                transcriptContent=""
                elapsedTime={0}
                scoringElapsedSeconds={60}
            />,
        );
        const mic = screen.getByTestId('run-shape-mic');
        expect(mic).toBeDisabled();
        fireEvent.click(mic);
        expect(onStartStop).not.toHaveBeenCalled();
    });

    // #1256 P1 — the snapshot-only after-state scores the FINISHED take, whose duration lives in
    // `scoringElapsedSeconds`. The live `elapsedTime` normalizes to 0 once idle, so without this the
    // "<duration> actual" pace line (and per-point timing) rendered 0:00.
    it('after-state shows the recorded duration from scoringElapsedSeconds (not the reset live timer)', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={null}
                completedObjectivePoints={POINTS}
                completedObjectivePaceGuideSecPerPoint={60}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={0}
                scoringElapsedSeconds={84}
            />,
        );
        // The after-state pace card reports "<duration> actual" — must reflect the finished 1:24 take.
        expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('1:24 actual');
    });

    // Contrast/regression guard: with no scoring duration it falls back to the live timer, and a reset
    // live timer (0) is exactly the 0:00 defect — proving `scoringElapsedSeconds` is the fix lever.
    it('after-state duration falls back to the live timer without scoringElapsedSeconds (0:00 guard)', () => {
        render(
            <SessionOverhaulView
                {...base}
                objectivePoints={null}
                completedObjectivePoints={POINTS}
                completedObjectivePaceGuideSecPerPoint={60}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={0}
            />,
        );
        expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('0:00 actual');
    });

    // S-11/S-13 P1 — the Open Mic after-state reads the FINISHED take's duration too. The live `elapsedTime`
    // is 0 by now, so deriving from it showed `00:00` and silently omitted pace and fillers/min.
    it('CASUALTY: Open Mic after-state duration, pace and fillers/min come from the finished take', () => {
        const words = Array.from({ length: 240 }, (_, i) => (i % 40 === 0 ? 'um' : 'word')).join(' ');
        render(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                transcriptContent={words}
                reviewTranscript={{ kind: 'available', text: words }}
                finalizedFillerData={{ um: { count: 6 }, total: { count: 6 } } as unknown as FillerCounts}
                elapsedTime={0}
                scoringElapsedSeconds={120}
            />,
        );
        expect(screen.getByTestId('run-shape-duration')).toHaveTextContent('02:00');
        // 240 words over two minutes: a stated rate, not an omitted row.
        expect(screen.getByTestId('this-run-card-pace')).toHaveTextContent('120');
        expect(screen.getByTestId('this-run-card-fillers')).toHaveTextContent('6 · 3.0/min');
    });

    it('CASUALTY: during finalizing (no snapshot, no retained transcript) words and pace are withheld, never "0"', () => {
        render(
            <SessionOverhaulView
                {...base}
                isFinalizing
                showAnalyticsPrompt={false}
                transcriptContent=""
                elapsedTime={0}
                scoringElapsedSeconds={90}
            />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(screen.queryByTestId('this-run-card-words')).toBeNull();
        expect(screen.queryByTestId('this-run-card-pace')).toBeNull();
        // No surface — card, header meta, stats strip or filler breakdown — prints a count derived from nothing.
        expect(document.body.textContent ?? '').not.toMatch(/\b0 words\b/);
    });

    it('CONTROL: once the finalized snapshot lands, the real word count shows', () => {
        render(
            <SessionOverhaulView
                {...base}
                isFinalizing
                showAnalyticsPrompt={false}
                transcriptContent=""
                finalizedWordCount={180}
                elapsedTime={0}
                scoringElapsedSeconds={90}
            />,
        );
        expect(screen.getByTestId('this-run-card-words')).toHaveTextContent('180');
        expect(screen.getByTestId('this-run-card-pace')).toHaveTextContent('120');
    });

    it('CONTROL: with no finished duration the rates are omitted, never shown as a fabricated zero', () => {
        render(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                transcriptContent="so um hello"
                reviewTranscript={{ kind: 'available', text: 'so um hello' }}
                finalizedFillerData={{ um: { count: 1 }, total: { count: 1 } } as unknown as FillerCounts}
                elapsedTime={0}
            />,
        );
        expect(screen.queryByTestId('this-run-card-pace')).toBeNull();
        expect(screen.getByTestId('this-run-card-fillers')).not.toHaveTextContent('/min');
    });

    // #1256 P1 — "Retry these points" must route to the rebinding onRetryPoints handler, never the generic
    // onStartStop (which starts an Open Mic take because the live brief was cleared on save).
    it('Retry these points invokes onRetryPoints (rebind), not onStartStop', () => {
        const onRetryPoints = vi.fn();
        const onStartStop = vi.fn();
        render(
            <SessionOverhaulView
                {...base}
                onStartStop={onStartStop}
                onRetryPoints={onRetryPoints}
                objectivePoints={null}
                completedObjectivePoints={POINTS}
                showAnalyticsPrompt
                transcriptContent=""
                reviewTranscript={{ kind: 'available', text: 'I will name the price now.' }}
                elapsedTime={0}
                scoringElapsedSeconds={84}
            />,
        );
        fireEvent.click(screen.getByTestId('focus-points-retry'));
        expect(onRetryPoints).toHaveBeenCalledTimes(1);
        expect(onStartStop).not.toHaveBeenCalled();
    });
});

// #1264 — optional Open Mic Practice Focus. The chooser lives in the before-state coaching slot (Open Mic
// only), the chosen intention shows as a non-scoring reminder while recording, and it never appears on a
// Focus Points session (which owns slot D with its rail).
describe('SessionOverhaulView — practice-focus chips removed (S-4)', () => {
    it('CASUALTY: Open Mic before offers no focus chooser, even when a handler is wired', () => {
        render(<SessionOverhaulView {...base} onSelectFocus={vi.fn()} practiceFocus={null} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.queryByTestId('practice-focus-chooser')).toBeNull();
        expect(screen.queryByText(/practice focus/i)).toBeNull();
    });

    it('CASUALTY: Open Mic during shows no focus reminder, even when a focus is set', () => {
        render(<SessionOverhaulView {...base} isListening transcriptContent="so hello there" elapsedTime={30} practiceFocus="steady_pace" />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(screen.queryByTestId('practice-focus-reminder')).toBeNull();
    });

    it('Focus Points before → no focus chooser either', () => {
        render(<SessionOverhaulView {...base} objectivePoints={['Name the price']} onSelectFocus={vi.fn()} />);
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.queryByTestId('practice-focus-chooser')).toBeNull();
        expect(screen.getByTestId('focus-points-rail')).toBeInTheDocument();
    });

    /**
     * #1429 — RETRY MUST START AT 0/N.
     *
     * `coveredLatch` exists so a lit tick never regresses mid-take, and it reset only when the shell
     * passed through `before`. "Retry these points" goes after-state -> during directly and never
     * touches `before`, so the previous take's latched indices survived into the new take and the
     * pace card read the old N/N from its first frame. The user pressed Retry and was told they had
     * already covered everything.
     *
     * The controller-side coverage fence does not reach this: during a take the number is derived
     * HERE, in the component, from the live transcript and this latch — not from
     * `objectiveCoverageResult`.
     */
    it('CASUALTY: Retry (after -> during) starts a fresh take at 0/N, not the previous take\'s N/N', () => {
        const points = ['Name the price', 'State the guarantee'];
        const spoken = 'First I will name the price clearly. Then I state the guarantee we offer.';

        // Take A runs to its after-state with both points covered.
        const { rerender } = render(
            <SessionOverhaulView
                {...base}
                isListening
                objectivePoints={points}
                transcriptContent={spoken}
                elapsedTime={60}
            />,
        );
        expect(screen.getByTestId('coverage-pace-covered')).toHaveTextContent('2');

        rerender(
            <SessionOverhaulView
                {...base}
                showAnalyticsPrompt
                objectivePoints={points}
                completedObjectivePoints={points}
                transcriptContent={spoken}
                elapsedTime={60}
            />,
        );

        // RETRY: straight back into a recording take, with the transcript reset as a new take begins.
        rerender(
            <SessionOverhaulView
                {...base}
                isListening
                objectivePoints={points}
                transcriptContent=""
                elapsedTime={0}
            />,
        );

        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(
            screen.getByTestId('coverage-pace-covered'),
            "the retry must not inherit the previous take's coverage",
        ).toHaveTextContent('0');
        expect(screen.getByTestId('coverage-pace-total')).toHaveTextContent(`/${points.length}`);
    });

    it('CASUALTY: within a take, a lit tick still never regresses', () => {
        // The other half of the latch contract, and the guarantee the retry fix could have broken.
        // Resetting on every `during` render — rather than on ENTRY to `during` — would satisfy the
        // retry casualty above while un-ticking a point mid-take the moment the rolling transcript
        // stopped matching it. The user would watch a covered point go dark while still speaking.
        const points = ['Name the price', 'State the guarantee'];

        const { rerender } = render(
            <SessionOverhaulView
                {...base}
                isListening
                objectivePoints={points}
                transcriptContent="First I will name the price clearly."
                elapsedTime={20}
            />,
        );
        expect(screen.getByTestId('coverage-pace-covered')).toHaveTextContent('1');

        // The take continues and the rolling transcript no longer contains the covering phrase.
        rerender(
            <SessionOverhaulView
                {...base}
                isListening
                objectivePoints={points}
                transcriptContent="and moving on to something else entirely now"
                elapsedTime={40}
            />,
        );

        expect(
            screen.getByTestId('coverage-pace-covered'),
            'a covered point must stay covered for the rest of its take',
        ).toHaveTextContent('1');
    });
});
