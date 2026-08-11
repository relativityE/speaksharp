import React from 'react';
import { SessionBeforeState } from './SessionBeforeState';
import { SessionDuringState } from './SessionDuringState';
import { SessionAfterState } from './SessionAfterState';
import { resolveSessionState } from '@/utils/sessionStateMachine';
import { usePromptOfferDismissed } from '@/hooks/usePromptOfferDismissed';
import { useHeldTip } from '@/hooks/useHeldTip';
import { LiveTip } from './LiveTip';
import { FillerBreakdown } from './FillerBreakdown';
import { computeAggregateProgress, signalsFromSession } from '@/utils/aggregateProgress';
import { getNextPrompt, getNextSample } from '@/services/practice/practiceOnramp';
import { CustomWordsBar } from './CustomWordsBar';
import { type CoverageRailPoint } from './CoverageRail';
import { CoveragePace } from './CoveragePace';
import { FocusPointsRail } from './FocusPointsRail';
import { useFocusNudge } from '@/hooks/useFocusNudge';
import { FocusDeliveryStrip } from './FocusDeliveryStrip';
import { deriveFocusCoverage, markCoveredTokens, type FocusCoverage } from '@/utils/focusCoverage';
import type { ProgressVsBaselineResult } from '@/utils/progressVsBaseline';
import { tokensFromTranscript, waveformFromLevels } from '@/utils/transcriptTokens';
import { liveTipFromMetrics, verdictFromSuggestions, type TwoTakeaways } from '@/utils/liveCoaching';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import type { PracticeSession } from '@/types/session';
import type { SttStatus } from '@/types/transcription';

/**
 * #1222 S11 — the session-overhaul VIEW: maps the live session runtime onto the fixed shell + the three
 * state compositions. Flag-gated OFF (see `sessionOverhaulFlags`), so this renders only when the overhaul
 * flag is ON; the default SessionPage body is unchanged.
 *
 * Wiring reality (honest, per the PO decision 2026-08-08):
 *  - Progress (slot C) uses REAL session history; the `during` state appends the in-progress session so the
 *    percentage ticks live.
 *  - The live waveform is sampled from the app's scalar `micLevel` (the engine exposes no spectrum).
 *  - Transcript highlights reuse the app's own filler tokenizer.
 *  - **after** is TRANSCRIPT-ONLY (the app retains no audio): the scrubber shows the filler map + seek, no
 *    audio playback. Clicking a filler scrolls the transcript to it.
 *  - The live coaching tip source and the verdict/next-fix generator are not yet wired — slot D shows the
 *    honest coaching placeholder until those land (tracked as follow-ups).
 *
 * All values come from `useSessionLifecycle` (passed in by SessionPage) so this stays a pure view.
 */
export interface SessionOverhaulViewProps {
    authUserId: string | null;
    isListening: boolean;
    sttStatus: SttStatus;
    elapsedTime: number;
    /** #1256 P1 — the finished take's scoring duration, used for the after-state ONLY. The live
     *  `elapsedTime` normalizes back to 0 once idle/ready, which would render the snapshot-only Focus
     *  Points review (coverage pace + per-point timestamps) as 0:00. Defaults to `elapsedTime`. */
    scoringElapsedSeconds?: number;
    micLevel: number;
    transcriptContent: string;
    showAnalyticsPrompt: boolean;
    metricsFillerCount: number;
    onStartStop: () => void;
    /** Real practice history (newest-first is fine; the adapter re-orders). */
    history: PracticeSession[];
    /** #1222 S12a — Private model lifecycle so a first-time user can download + start on the new page. */
    privateModelStatus?: string;
    modelLoadingProgress?: number | null;
    onDownloadModel?: () => void;
    isButtonDisabled?: boolean;
    /** #1222 S12b — live coaching (during) + verdict (after) sources. */
    fillerData?: FillerCounts | null;
    wpm?: number | null;
    /** The saved session's two takeaways (after-state verdict); null → honest deterministic fallback. */
    aiSuggestions?: TwoTakeaways | null;
    onSeeAllSessions?: () => void;
    /** #1231 R1 — live-updating tail (rendered muted/settling) + post-Stop finalizing banner. */
    interimTranscript?: string;
    isFinalizing?: boolean;
    /** #891 — finalize-time estimate (s) for the "Finalizing… ~Ns" countdown in the transcript banner. */
    finalizeEstimateSeconds?: number | null;
    /**
     * #1046 Focus Points — when a Focus Points brief is active this is the declared point labels; slot D then
     * becomes the points plan (before/during) instead of the coaching card, and the resolved coverage rail
     * (after) instead of the verdict. null/empty ⇒ an Open Mic session (unchanged coaching path).
     */
    objectivePoints?: string[] | null;
    /** #1046 G6/G7 — the Focus Points topic (the `goal`), shown above the points in slot D and NEVER scored
     *  as one. null ⇒ Open Mic, or a set saved before the topic was threaded. */
    objectiveTopic?: string | null;
    /** #1046 G6/G7 §2 — the pace guide (seconds/point); null when skipped → no pace UI, no pace nudge. */
    objectivePaceGuideSecPerPoint?: number | null;
    /**
     * #1046 G6/G7 — the SNAPSHOT of the just-finished brief, used ONLY by the after-state. On a successful
     * save the live brief (objectivePoints) is intentionally cleared so it can never attach to the next
     * (Open Mic) recording — but that also strips the FP after-state (coverage card, delivery strip,
     * highlights). These carry the finished brief forward for the review screen only; they are ignored in
     * before/during, and are cleared when the next recording starts, so isolation is preserved.
     */
    completedObjectivePoints?: string[] | null;
    completedObjectiveTopic?: string | null;
    completedObjectivePaceGuideSecPerPoint?: number | null;
    /** #1046 Focus Points — per-point coverage resolved at stop (same shape as the rail); null until then.
     *  Retained for the SessionPage contract; the view now derives its own live+final coverage from the
     *  transcript (see focusCoverage) so slot C, slot D, and the highlights share one source. */
    objectiveCoverage?: CoverageRailPoint[] | null;
    /** #1046 Focus Points slot-D actions. Edit → point editor (before); Retry → same set again (after);
     *  New set → fresh brief (after). Retry falls back to a plain restart when no handler is supplied. */
    onEditPoints?: () => void;
    onRetryPoints?: () => void;
    onNewSet?: () => void;
}

export const SessionOverhaulView: React.FC<SessionOverhaulViewProps> = ({
    authUserId,
    isListening,
    sttStatus,
    elapsedTime,
    scoringElapsedSeconds,
    micLevel,
    transcriptContent,
    showAnalyticsPrompt,
    metricsFillerCount,
    onStartStop,
    history,
    privateModelStatus,
    modelLoadingProgress,
    onDownloadModel,
    isButtonDisabled,
    fillerData,
    wpm,
    aiSuggestions,
    onSeeAllSessions,
    interimTranscript,
    isFinalizing,
    finalizeEstimateSeconds,
    objectivePoints,
    objectiveTopic,
    objectivePaceGuideSecPerPoint,
    completedObjectivePoints,
    completedObjectiveTopic,
    completedObjectivePaceGuideSecPerPoint,
    onEditPoints,
    onRetryPoints,
    onNewSet,
}) => {
    const permissionError = sttStatus.type === 'error';
    const sessionState = resolveSessionState({
        firstAudioFrameReceived: isListening,
        // PO 2026-08-10: the post-Stop FINALIZING window (decode still running, save/analytics not yet
        // fired) must resolve to `after`, not `before`. Without `isFinalizing` here the transcript card
        // briefly reverted to the "Not sure what to say?" prompt offer during finalizing, and the
        // "Finalizing… ~Ns" banner never showed (it lives on the after-state).
        stopped: (showAnalyticsPrompt || Boolean(isFinalizing)) && !isListening,
        permissionError,
    });

    // #1046 G6/G7 — the after-state falls back to the finished-brief SNAPSHOT when the live brief has been
    // cleared on save (so the review screen keeps its coverage card, delivery strip, and highlights). Before
    // and during use ONLY the live brief, so a stale snapshot can never make a fresh Open Mic session look
    // like Focus Points (the isolation invariant that motivated clearing the live brief in the first place).
    const inAfter = sessionState === 'after';
    const effObjectivePoints = objectivePoints ?? (inAfter ? completedObjectivePoints ?? null : null);
    const effObjectiveTopic = objectiveTopic ?? (inAfter ? completedObjectiveTopic ?? null : null);
    const effObjectivePaceGuideSecPerPoint = objectivePaceGuideSecPerPoint ?? (inAfter ? completedObjectivePaceGuideSecPerPoint ?? null : null);
    // #1256 P1 — the after-state scores the FINISHED take, whose duration lives in `scoringElapsedSeconds`
    // (live `elapsedTime` has already normalized to 0). Before/during keep the live timer.
    const effElapsed = inAfter ? (scoringElapsedSeconds ?? elapsedTime) : elapsedTime;

    const offer = usePromptOfferDismissed(authUserId);

    // #1222 G1 prompt/sample bug fix: "Give me a prompt" / "Read a sample" must SHOW the text in the
    // transcript frame — the user reads it, THEN presses the mic. They must NOT start recording. The chosen
    // text stays visible in the before-state transcript (TranscriptCard renders `chosenPrompt` in place) and
    // is re-rollable via ↻ (re-invokes the last kind).
    const [chosenPrompt, setChosenPrompt] = React.useState<string | null>(null);
    // #1116 — a read-aloud SAMPLE also carries a title + attribution (author/source) so the reader gets
    // full credit and can identify the passage; a generated speaking prompt has neither.
    const [chosenPromptTitle, setChosenPromptTitle] = React.useState<string | null>(null);
    const [chosenPromptAttribution, setChosenPromptAttribution] = React.useState<string | null>(null);
    const [promptIdx, setPromptIdx] = React.useState<number | null>(null);
    const [sampleIdx, setSampleIdx] = React.useState<number | null>(null);
    const [lastKind, setLastKind] = React.useState<'prompt' | 'sample' | null>(null);
    // Sample-overlay split lifespan (PO Option 1): a generated PROMPT is a starter you glance at then
    // speak — it auto-hides the instant your own words start, with a "Need a prompt?" chip to bring it
    // back. A read-aloud SAMPLE is something you read the whole way through — it persists (shrunk) until
    // you dismiss it with ✕ or Stop. These two flags carry the per-take manual overrides.
    const [samplePinDismissed, setSamplePinDismissed] = React.useState(false);
    const [promptReopened, setPromptReopened] = React.useState(false);

    const takePrompt = React.useCallback(() => {
        const { index, prompt } = getNextPrompt(promptIdx);
        setPromptIdx(index);
        setChosenPrompt(prompt.text);
        setChosenPromptTitle(null);
        setChosenPromptAttribution(null);
        setLastKind('prompt');
        setSamplePinDismissed(false);
        setPromptReopened(false);
    }, [promptIdx]);

    const readSample = React.useCallback(() => {
        const { index, sample } = getNextSample(sampleIdx);
        setSampleIdx(index);
        setChosenPrompt(sample.text);
        setChosenPromptTitle(sample.title);
        setChosenPromptAttribution(sample.attribution);
        setSamplePinDismissed(false);
        setPromptReopened(false);
        setLastKind('sample');
    }, [sampleIdx]);

    const reRoll = React.useCallback(() => {
        if (lastKind === 'sample') readSample();
        else takePrompt();
    }, [lastKind, readSample, takePrompt]);

    // #1222 S12b — one live coaching tip (during), held ≥8s (useHeldTip). Candidate is null when idle.
    const tipCandidate = isListening ? liveTipFromMetrics({ fillerData, wpm, elapsedSeconds: elapsedTime, isReadingSample: lastKind === 'sample' }) : null;
    const heldTip = useHeldTip(tipCandidate);

    // Sample the scalar mic level into a rolling buffer while recording; the captured envelope must SURVIVE
    // into the after-state so the playback scrubber can draw the recorded waveform. Reset ONLY on a fresh
    // `before` (a new session). This is load-bearingly coupled to the finalizing→`after` fix above: when
    // finalizing wrongly resolved to `before`, this branch wiped the envelope mid-finalize and the
    // after-state waveform rendered flat. Keep finalizing OUT of `before` or the bars go blank again.
    const levelsRef = React.useRef<number[]>([]);
    if (isListening) {
        // Keep the FULL recording envelope (capped generously) so the after-state waveform can peak-
        // downsample the WHOLE take to 72 bars — not just the last 72 samples (which showed only the tail).
        levelsRef.current = [...levelsRef.current, micLevel].slice(-12000);
    } else if (sessionState === 'before') {
        levelsRef.current = [];
    }
    const { amplitudes, recordedCount } = waveformFromLevels(levelsRef.current);

    const tokens = tokensFromTranscript(transcriptContent);
    // during: append the live-updating tail as muted "interim" tokens so re-writes read as intentional.
    const duringTokens = interimTranscript && interimTranscript.trim()
        ? [...tokens, ...tokensFromTranscript(interimTranscript).map((t) => ({ ...t, interim: true }))]
        : tokens;
    const fillerBars = tokens
        .map((t, i) => (t.filler ? Math.round((i / Math.max(1, tokens.length - 1)) * 71) : -1))
        .filter((n) => n >= 0);

    // #1206 — session progress is the AGGREGATE of the four signals (filler/clarity/pace/pause), computed
    // from real completed sessions. It is a session-completion read, so all three states show the same
    // standing aggregate (last completed vs baseline) rather than a fragile live tick; the number is
    // background anyway (the coaching takeaways are the product).
    const progress = React.useMemo<ProgressVsBaselineResult>(() => {
        const oldestFirst = [...history].reverse().map(signalsFromSession);
        const agg = computeAggregateProgress(oldestFirst);
        return {
            isBaseline: agg.isBaseline,
            tooShort: agg.tooShort,
            currentRate: agg.currentQuality,
            baselineRate: agg.baselineQuality,
            deltaPercent: agg.aggregatePercent,
            direction: agg.direction,
            trend: agg.trend,
        };
    }, [history]);

    // #1046 Focus Points: a brief is active when we were handed declared point labels. This is a distinct
    // product on the shared shell (spec: "slots are shared; semantics are not"). Slot C becomes coverage,
    // slot D becomes the points, filler chrome is gone, and the transcript highlights mean coverage.
    const isObjective = Array.isArray(effObjectivePoints) && effObjectivePoints.length > 0;

    // Live coverage, derived from the growing transcript via the local keyword matcher (nothing leaves the
    // device). `coveredLatch` guarantees a lit tick never regresses (spec §6); it resets on a fresh session.
    const coveredLatch = React.useRef<Set<number>>(new Set());
    if (isObjective && sessionState === 'before') coveredLatch.current = new Set();
    let coverage: FocusCoverage | null = null;
    if (isObjective) {
        coverage = deriveFocusCoverage(effObjectivePoints ?? [], transcriptContent, effElapsed, coveredLatch.current);
        coverage.rows.forEach((r, i) => { if (r.covered) coveredLatch.current.add(i); });
    }

    // For Focus Points the transcript highlights mean COVERAGE (purple during / green after), never
    // fillers — mark the covering spans on the base tokens (fillers cleared) and re-append the live tail.
    const fpTokens = isObjective && coverage ? markCoveredTokens(tokens, coverage.coveredQuotes) : null;
    const fpDuringTokens = fpTokens
        ? (interimTranscript && interimTranscript.trim()
            ? [...fpTokens, ...tokensFromTranscript(interimTranscript).map((t) => ({ ...t, interim: true }))]
            : fpTokens)
        : duringTokens;

    // §2 nudge — the live coaching for Focus Points, computed here (hook called unconditionally) and rendered
    // INSIDE the Coverage & pace card. Silent unless the pace ratio breaks (or the no-guide coverage fallback).
    const guideSecPerPoint = isObjective ? (effObjectivePaceGuideSecPerPoint ?? null) : null;
    const nudge = useFocusNudge({
        sessionState,
        elapsedSec: effElapsed,
        coveredCount: coverage?.coveredCount ?? 0,
        totalPoints: coverage?.total ?? 0,
        guideSecPerPoint,
        nextPointNumber: coverage && coverage.nextIndex != null ? coverage.nextIndex + 1 : null,
    });
    // §2 Slot C — Coverage & pace. NOT rendered in `before` (the rail begins with Slot D). during carries the
    // live nudge; after freezes the bar and shows `actual`.
    const objectiveDuringSlotC = coverage
        ? <CoveragePace covered={coverage.coveredCount} total={coverage.total} elapsedSec={elapsedTime} guideSecPerPoint={guideSecPerPoint} sessionState="during" nudge={nudge} />
        : undefined;
    const objectiveAfterSlotC = coverage
        ? <CoveragePace covered={coverage.coveredCount} total={coverage.total} elapsedSec={effElapsed} guideSecPerPoint={guideSecPerPoint} sessionState="after" />
        : undefined;
    const objectivePlanSlotD = coverage
        ? <FocusPointsRail rows={coverage.rows} topic={effObjectiveTopic ?? null} sessionState="before" onEdit={onEditPoints} />
        : undefined;
    const objectiveDuringSlotD = coverage
        ? <FocusPointsRail rows={coverage.rows} topic={effObjectiveTopic ?? null} sessionState="during" nextIndex={coverage.nextIndex} />
        : undefined;
    const objectiveAfterSlotD = coverage
        ? <FocusPointsRail rows={coverage.rows} topic={effObjectiveTopic ?? null} sessionState="after" onRetry={onRetryPoints ?? onStartStop} onNewSet={onNewSet} />
        : undefined;

    if (sessionState === 'before') {
        return (
            <>
                <SessionBeforeState
                    hideSlotC={isObjective}
                    slotDContent={objectivePlanSlotD}
                    mic={{
                        onStart: onStartStop,
                        error: permissionError ? sttStatus.message : null,
                        privateModelStatus,
                        modelLoadingProgress,
                        onDownloadModel,
                        disabled: isButtonDisabled,
                    }}
                    transcript={{
                        offerDismissed: offer.dismissed,
                        onDismissOffer: offer.dismiss,
                        onRestoreOffer: offer.restore,
                        onTakePrompt: takePrompt,
                        onReadSample: readSample,
                        chosenPrompt,
                        chosenPromptTitle,
                        chosenPromptAttribution,
                        onRerollPrompt: reRoll,
                        // #1046 PO 2026-08-10: Focus Points is its own product — the "Not sure what to say?"
                        // prompt/sample offer is an Open-Floor concept and doesn't belong here; the speaker's
                        // "what to say" IS their declared points (shown in slot D).
                        hidePromptOffer: isObjective,
                    }}
                    progress={progress}
                    progressMode="aggregate"
                />
                {/* #1222 G1: the custom filler-word manager is a full-width bar BELOW the 2-col shell in the
                    before-state — "Tracking N filler words" left, "Add your filler words" right.
                    #1046 PO 2026-08-10: filler-word tracking is an Open-Floor (delivery-polish) concept; a
                    Focus Points session is judged on point coverage, so the filler card is omitted for it. */}
                {!isObjective && <CustomWordsBar className="mt-[14px]" />}
            </>
        );
    }

    if (sessionState === 'during') {
        // Sample-overlay split lifespan (Open Mic only; Focus Points has no prompt/sample). A prompt
        // auto-hides the moment your own words begin (with a reopen chip); a sample persists until ✕/Stop.
        const words = wordCount(transcriptContent);
        const isSampleKind = lastKind === 'sample';
        const promptAutoHidden = lastKind === 'prompt' && words > 0 && !promptReopened;
        const pinVisible = !isObjective && Boolean(chosenPrompt) && !(isSampleKind ? samplePinDismissed : promptAutoHidden);
        const showReopenChip = !isObjective && promptAutoHidden;
        return (
            <SessionDuringState
                recorder={{ elapsedSeconds: elapsedTime, amplitudes, recordedCount, deviceLabel: 'Private', onStop: onStartStop }}
                transcript={{
                    tokens: isObjective ? fpDuringTokens : duringTokens,
                    words,
                    fillersPerMin: liveFillersPerMin(metricsFillerCount, elapsedTime),
                    chosenPrompt: pinVisible ? chosenPrompt : null,
                    chosenPromptTitle,
                    chosenPromptAttribution,
                    promptKind: lastKind ?? undefined,
                    onDismissPin: () => (isSampleKind ? setSamplePinDismissed(true) : setPromptReopened(false)),
                    showReopenChip,
                    onReopenPin: () => setPromptReopened(true),
                    // #1046 Focus Points: no filler chrome; the transcript footer speaks to coverage instead.
                    hideFillers: isObjective,
                    footer: isObjective ? 'Highlighted spans are where a point landed.' : undefined,
                    coverageMode: isObjective ? 'during' : undefined,
                }}
                progress={progress}
                progressMode="aggregate"
                slotCContent={objectiveDuringSlotC}
                liveTip={isObjective ? undefined : (heldTip ? <LiveTip tip={heldTip} /> : undefined)}
                slotDContent={objectiveDuringSlotD}
            />
        );
    }

    // after — transcript-only review (no retained audio).
    return (
        <>
            <SessionAfterState
                scrubber={{
                    playing: false,
                    onTogglePlay: () => {},
                    positionSeconds: 0,
                    durationSeconds: elapsedTime,
                    amplitudes,
                    fillerBars,
                    onSeek: () => {},
                    audioAvailable: false,
                }}
                transcript={{
                    tokens: isObjective && fpTokens ? fpTokens : tokens,
                    // Honest copy: the app retains no audio (transcript-only review), so highlights mark
                    // where each point landed rather than being audio-seek targets.
                    // §Duplication: the coverage FRACTION appears exactly once, in Slot C — never repeated
                    // here. The FP header speaks to the highlights, not a second `n of m` scoreboard.
                    headerMeta: isObjective
                        ? `${wordCount(transcriptContent)} words · green marks where each point landed`
                        : `${wordCount(transcriptContent)} words · tap a highlight to jump to it`,
                    stats: `${metricsFillerCount} fillers · ${wordCount(transcriptContent)} words`,
                    onFillerSeek: () => {},
                    coverageMode: isObjective ? 'after' : undefined,
                }}
                progress={progress}
                progressMode="aggregate"
                slotCContent={objectiveAfterSlotC}
                finalizing={isFinalizing}
                finalizeEstimateSeconds={finalizeEstimateSeconds}
                // #1046 Focus Points: highlights mean coverage here, not fillers — the footer says so, and
                // the filler breakdown is deferred to the delivery strip below (spec §4/§5).
                fillerFooter={isObjective
                    ? <span data-testid="coverage-footer">Green highlights show where each point landed.</span>
                    : <FillerBreakdown fillerData={fillerData} stats={`${metricsFillerCount} fillers · ${wordCount(transcriptContent)} words`} />}
                verdict={{ ...verdictFromSuggestions(aiSuggestions, fillerData, elapsedTime), onPracticeAgain: onStartStop, onSeeAllSessions: onSeeAllSessions ?? (() => {}) }}
                slotDContent={objectiveAfterSlotD}
            />
            {isObjective && (
                <FocusDeliveryStrip
                    fillerCount={metricsFillerCount}
                    fillerData={fillerData}
                    hasMissedPoint={Boolean(coverage && coverage.coveredCount < coverage.total)}
                />
            )}
        </>
    );
};

function wordCount(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function liveFillersPerMin(fillerCount: number, elapsedSeconds: number): number {
    return elapsedSeconds > 0 ? Math.round((fillerCount / elapsedSeconds) * 60 * 10) / 10 : 0;
}
