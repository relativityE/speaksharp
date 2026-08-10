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
import { CoverageRail, type CoverageRailPoint } from './CoverageRail';
import { FocusPointsPlan } from './FocusPointsPlan';
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
     * (after) instead of the verdict. null/empty ⇒ an Open Floor session (unchanged coaching path).
     */
    objectivePoints?: string[] | null;
    /** #1046 Focus Points — per-point coverage resolved at stop (same shape as the rail); null until then. */
    objectiveCoverage?: CoverageRailPoint[] | null;
}

export const SessionOverhaulView: React.FC<SessionOverhaulViewProps> = ({
    authUserId,
    isListening,
    sttStatus,
    elapsedTime,
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
    objectiveCoverage,
}) => {
    const permissionError = sttStatus.type === 'error';
    const sessionState = resolveSessionState({
        firstAudioFrameReceived: isListening,
        stopped: showAnalyticsPrompt && !isListening,
        permissionError,
    });

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

    const takePrompt = React.useCallback(() => {
        const { index, prompt } = getNextPrompt(promptIdx);
        setPromptIdx(index);
        setChosenPrompt(prompt.text);
        setChosenPromptTitle(null);
        setChosenPromptAttribution(null);
        setLastKind('prompt');
    }, [promptIdx]);

    const readSample = React.useCallback(() => {
        const { index, sample } = getNextSample(sampleIdx);
        setSampleIdx(index);
        setChosenPrompt(sample.text);
        setChosenPromptTitle(sample.title);
        setChosenPromptAttribution(sample.attribution);
        setLastKind('sample');
    }, [sampleIdx]);

    const reRoll = React.useCallback(() => {
        if (lastKind === 'sample') readSample();
        else takePrompt();
    }, [lastKind, readSample, takePrompt]);

    // #1222 S12b — one live coaching tip (during), held ≥8s (useHeldTip). Candidate is null when idle.
    const tipCandidate = isListening ? liveTipFromMetrics({ fillerData, wpm, elapsedSeconds: elapsedTime }) : null;
    const heldTip = useHeldTip(tipCandidate);

    // Sample the scalar mic level into a rolling buffer while recording (reset when idle).
    const levelsRef = React.useRef<number[]>([]);
    if (isListening) {
        levelsRef.current = [...levelsRef.current, micLevel].slice(-72);
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

    // #1046 Focus Points: a brief is active when we were handed declared point labels. Slot D then carries
    // the points (plan before/during, resolved coverage after) instead of the coaching card / verdict, so a
    // Focus Points session is visibly its own thing on the shared shell — not an Open Floor session.
    const isObjective = Array.isArray(objectivePoints) && objectivePoints.length > 0;
    const planPoints = React.useMemo(
        () => (objectivePoints ?? []).map((label, i) => ({ id: `fp-${i}`, label })),
        [objectivePoints],
    );
    const objectivePlanSlotD = isObjective ? <FocusPointsPlan points={planPoints} /> : undefined;
    // after: show the resolved coverage rail once it exists; until then keep the plan (nothing scored yet).
    const objectiveAfterSlotD = isObjective
        ? (objectiveCoverage && objectiveCoverage.length > 0
            ? <CoverageRail points={objectiveCoverage} />
            : <FocusPointsPlan points={planPoints} />)
        : undefined;

    if (sessionState === 'before') {
        return (
            <>
                <SessionBeforeState
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
                    }}
                    progress={progress}
                    progressMode="aggregate"
                />
                {/* #1222 G1: the custom filler-word manager is a full-width bar BELOW the 2-col shell in the
                    before-state — "Tracking N filler words" left, "Add your filler words" right. */}
                <CustomWordsBar className="mt-[14px]" />
            </>
        );
    }

    if (sessionState === 'during') {
        return (
            <SessionDuringState
                recorder={{ elapsedSeconds: elapsedTime, amplitudes, recordedCount, deviceLabel: 'Private', onStop: onStartStop }}
                transcript={{ tokens: duringTokens, words: wordCount(transcriptContent), fillersPerMin: liveFillersPerMin(metricsFillerCount, elapsedTime), chosenPrompt, chosenPromptTitle, chosenPromptAttribution }}
                progress={progress}
                progressMode="aggregate"
                liveTip={heldTip ? <LiveTip tip={heldTip} /> : undefined}
                slotDContent={objectivePlanSlotD}
            />
        );
    }

    // after — transcript-only review (no retained audio).
    return (
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
                tokens,
                headerMeta: `${wordCount(transcriptContent)} words · tap a highlight to jump to it`,
                stats: `${metricsFillerCount} fillers · ${wordCount(transcriptContent)} words`,
                onFillerSeek: () => {},
            }}
            progress={progress}
            progressMode="aggregate"
            finalizing={isFinalizing}
            finalizeEstimateSeconds={finalizeEstimateSeconds}
            fillerFooter={<FillerBreakdown fillerData={fillerData} stats={`${metricsFillerCount} fillers · ${wordCount(transcriptContent)} words`} />}
            verdict={{ ...verdictFromSuggestions(aiSuggestions, fillerData), onPracticeAgain: onStartStop, onSeeAllSessions: onSeeAllSessions ?? (() => {}) }}
            slotDContent={objectiveAfterSlotD}
        />
    );
};

function wordCount(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function liveFillersPerMin(fillerCount: number, elapsedSeconds: number): number {
    return elapsedSeconds > 0 ? Math.round((fillerCount / elapsedSeconds) * 60 * 10) / 10 : 0;
}
