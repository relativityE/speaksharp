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
    const [promptIdx, setPromptIdx] = React.useState<number | null>(null);
    const [sampleIdx, setSampleIdx] = React.useState<number | null>(null);
    const [lastKind, setLastKind] = React.useState<'prompt' | 'sample' | null>(null);

    const takePrompt = React.useCallback(() => {
        const { index, prompt } = getNextPrompt(promptIdx);
        setPromptIdx(index);
        setChosenPrompt(prompt.text);
        setLastKind('prompt');
    }, [promptIdx]);

    const readSample = React.useCallback(() => {
        const { index, sample } = getNextSample(sampleIdx);
        setSampleIdx(index);
        setChosenPrompt(sample.text);
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

    if (sessionState === 'before') {
        return (
            <>
                <SessionBeforeState
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
                transcript={{ tokens: duringTokens, words: wordCount(transcriptContent), fillersPerMin: liveFillersPerMin(metricsFillerCount, elapsedTime), chosenPrompt }}
                progress={progress}
                progressMode="aggregate"
                liveTip={heldTip ? <LiveTip tip={heldTip} /> : undefined}
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
            fillerFooter={<FillerBreakdown fillerData={fillerData} stats={`${metricsFillerCount} fillers · ${wordCount(transcriptContent)} words`} />}
            verdict={{ ...verdictFromSuggestions(aiSuggestions, fillerData), onPracticeAgain: onStartStop, onSeeAllSessions: onSeeAllSessions ?? (() => {}) }}
        />
    );
};

function wordCount(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function liveFillersPerMin(fillerCount: number, elapsedSeconds: number): number {
    return elapsedSeconds > 0 ? Math.round((fillerCount / elapsedSeconds) * 60 * 10) / 10 : 0;
}
