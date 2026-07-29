import React from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { HelpPopover } from './HelpPopover';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import { calculateSpeakingScore } from '@/utils/speakingScore';
import { ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';
import type { SessionCoachingAssignment } from '@/services/sessionCoachingExperiment';
import {
    trackSessionCoachingCardViewed,
    trackSessionCoachingNumericScoreShown,
} from '@/services/sessionCoachingExperiment';
import { SESSION_INSET_SURFACE_CLASS, SESSION_SURFACE_CLASS } from './sessionSurface';

interface LiveCoachingScoreCardProps {
    transcript: string;
    wordCount: number;
    wpm: number;
    clarityScore: number;
    fillerCount: number;
    elapsedSeconds: number;
    pauseMetrics: PauseMetrics;
    engine?: 'native' | 'private' | 'cloud' | string;
    isListening: boolean;
    experimentAssignment: SessionCoachingAssignment;
    className?: string;
}

export const LiveCoachingScoreCard: React.FC<LiveCoachingScoreCardProps> = ({
    transcript,
    wordCount,
    wpm,
    clarityScore,
    fillerCount,
    elapsedSeconds,
    pauseMetrics,
    engine,
    experimentAssignment,
    className = '',
}) => {
    const result = React.useMemo(() => calculateSpeakingScore({
        transcript,
        wordCount,
        wpm,
        clarityScore,
        fillerCount,
        elapsedSeconds,
        pauseMetrics,
        engine,
    }), [clarityScore, elapsedSeconds, engine, fillerCount, pauseMetrics, transcript, wordCount, wpm]);

    const scorePercent = Math.max(0, Math.min(100, result.score * 10));
    // Only present a precise numeric score at 'usable' confidence. 'directional'
    // (short session, low transcript confidence, or weak readability) shows the
    // qualitative state instead, so a weak transcript never looks like a precise grade.
    const showNumericScore = result.confidence === 'usable';
    const confidenceLabel = result.confidence === 'usable'
        ? 'Usable signal'
        : result.confidence === 'directional'
            ? 'Early signal'
            : 'Warming up';
    // Always-visible, color-coded confidence so the user can never mistake a
    // weak/uncertain transcript for a precise grade (trust-loop, Option 2).
    const confidenceText = result.confidence === 'usable'
        ? 'Confidence: High'
        : result.confidence === 'directional'
            ? 'Confidence: Directional'
            : 'Confidence: Building';
    const confidenceChipClass = result.confidence === 'usable'
        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
        : result.confidence === 'directional'
            ? 'bg-amber-50 text-amber-900 border border-amber-300'
            : 'bg-muted text-foreground/70 border border-border';
    // #1047: EVIDENCE GATE. `calculateSpeakingScore` falls back to generic openers ("Start with one
    // complete thought.") when there are too few words to say anything about THIS session. That is
    // invented advice dressed as feedback, so it must not be numbered and presented as guidance. Below
    // the reliable-scoring floor we show an explicit neutral first-session state instead; the numbered
    // list appears only once the session itself supports it.
    const hasGuidanceEvidence = wordCount >= ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS;
    // #1047: at 'warming-up' the card stated "no data" THREE times at once — a `--` value, a
    // "SCORE SOON" sublabel, and a "Speak a little more to get a useful score" headline (plus a
    // "Confidence: Building" chip and an empty progress bar). One statement is enough. This collapses
    // ONLY the genuinely-empty state; 'directional' still carries real information ("Early signal",
    // "Confidence: Directional") and is left exactly as it was.
    const isEmptySignal = result.confidence === 'warming-up';
    const formatBreakdown = (value: number) => `${Math.round(value * 10)}%`;
    const trackedCardKeyRef = React.useRef<string | null>(null);
    const trackedNumericKeyRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        const trackingKey = [
            experimentAssignment.variant,
            result.confidence,
            result.label,
            result.actions.length,
            result.transcription.engine ?? 'unknown',
        ].join(':');

        if (trackedCardKeyRef.current !== trackingKey) {
            trackedCardKeyRef.current = trackingKey;
            trackSessionCoachingCardViewed(experimentAssignment, result);
        }

        if (showNumericScore && trackedNumericKeyRef.current !== trackingKey) {
            trackedNumericKeyRef.current = trackingKey;
            trackSessionCoachingNumericScoreShown(experimentAssignment, result);
        }
    }, [experimentAssignment, result, showNumericScore]);

    return (
        <section
            className={`${SESSION_SURFACE_CLASS} flex flex-col p-4 ${className}`}
            data-testid="live-coaching-score-card"
            data-experiment="session-live-coaching-score"
            aria-label="Live Coaching Score"
        >
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                        <Target className="h-4 w-4" />
                        Live Coaching
                    </div>
                    <div className="flex items-center gap-1.5">
                        {/* #1047 LABEL RULE: NOT "SpeakSharp Progress". Progress does not exist yet, and a
                            label must not promise a feature that is not there. "Session feedback" is the
                            neutral, truthful name for what this card actually shows. The asterisk is gone
                            too — it implied a disclaimer with nowhere to read it. */}
                        <h2 className="text-xl font-extrabold text-foreground">Session feedback</h2>
                        <HelpPopover
                            label="About the SpeakSharp Score"
                            testId="score-help"
                            panelClassName="w-72"
                        >
                            <div className="space-y-2" data-testid="score-help-body">
                                <p>
                                    The visible tools roll up into one coaching score: structure, pace/fillers/pauses, clarity, and audience impact.
                                </p>
                                <p>
                                    Improve the ingredients, then come back and try to lift the score.
                                </p>
                                <div className="rounded-md border border-border bg-white p-2.5">
                                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground/70">
                                        Why this score moved
                                    </div>
                                    <div className="space-y-1" data-testid="live-score-evidence">
                                        <div className="flex justify-between gap-2">
                                            <span>Structure from transcript</span>
                                            <span>{formatBreakdown(result.breakdown.messageStructure)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>Pace, fillers, pauses</span>
                                            <span>{formatBreakdown(result.breakdown.deliveryControl)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>Clarity signal</span>
                                            <span>{formatBreakdown(result.breakdown.languageClarity)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>Audience Impact</span>
                                            <span>{formatBreakdown(result.breakdown.audienceImpact)}</span>
                                        </div>
                                    </div>
                                    <p className="mt-2 text-[11px] leading-snug text-foreground/60">
                                        The score is not a black box; it is a transparent rollup of the live signals shown here.
                                    </p>
                                </div>
                                {result.qualityNote && (
                                    <p
                                        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900"
                                        data-testid="live-score-quality-caveat"
                                        role="note"
                                    >
                                        {result.qualityNote}
                                    </p>
                                )}
                                <p className="border-t border-border pt-2 text-[11px] leading-snug text-foreground/60">
                                    SpeakSharp Score is a directional practice signal; progress over time matters more than one exact number. Transcript quality (readability and how reliably your engine catches filler words) affects how confidently the score is shown.
                                </p>
                            </div>
                        </HelpPopover>
                    </div>
                    {/* The headline is suppressed in the empty state — it was the third simultaneous way
                        of saying "no data yet". */}
                    {!isEmptySignal && (
                        <p className="mt-1 text-sm font-semibold leading-snug text-foreground/75" data-testid="live-score-headline">
                            {result.headline}
                        </p>
                    )}
                </div>

                {!isEmptySignal && (
                    <div className="min-w-[120px] rounded-lg border border-[hsl(var(--border-strong))] bg-white px-4 py-3 text-center surface-shadow">
                        <div className="text-4xl font-extrabold leading-none text-foreground" data-testid="live-session-score">
                            {showNumericScore ? result.score.toFixed(1) : '--'}
                        </div>
                        <div className="mt-1 text-xs font-bold uppercase tracking-wider text-foreground/70">
                            {showNumericScore ? 'out of 10' : 'score soon'}
                        </div>
                        <div
                            className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${confidenceChipClass}`}
                            data-testid="live-score-confidence"
                            data-score-confidence={result.confidence}
                            data-transcript-trusted={result.qualitySignals.trusted ? 'true' : 'false'}
                            title="Transcript quality affects how confidently the score is shown."
                        >
                            {confidenceText}
                        </div>
                    </div>
                )}
            </div>

            {/* The SINGLE no-score-yet panel: one label, one `--`, one hint. Nothing else in the card
                repeats the fact that there is no data. */}
            {isEmptySignal ? (
                <div className={`${SESSION_INSET_SURFACE_CLASS} p-3 text-center`} data-testid="live-score-empty-panel">
                    {/* The panel's own label. Deliberately NOT a second "Session feedback" — the card
                        heading already says that, and repeating it would reintroduce the duplication
                        this collapse exists to remove. */}
                    <div className="text-xs font-bold uppercase tracking-wider text-foreground/70">Score</div>
                    <div className="mt-1 text-4xl font-extrabold leading-none text-foreground" data-testid="live-session-score">
                        --
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground/70" data-testid="live-score-empty-hint">
                        Speak ~30s to see progress
                    </p>
                </div>
            ) : (
                <div className={`${SESSION_INSET_SURFACE_CLASS} p-3`}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-foreground">{result.label}</span>
                        <span className="flex items-center gap-1 text-xs font-bold text-foreground/70">
                            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                            {showNumericScore ? result.target.label : confidenceLabel}
                        </span>
                    </div>
                    <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-white border border-border">
                        <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${showNumericScore ? scorePercent : 0}%` }}
                        />
                    </div>

                    {/* #1047: guidance is NUMBERED (amber numerals) so the steps read as an ordered plan
                        rather than an undifferentiated bullet dump — and it renders ONLY when this
                        session produced enough speech to justify it. With no evidence we say so plainly
                        instead of emitting generic openers that were never about the user's take. */}
                    {hasGuidanceEvidence ? (
                        <div>
                            <h3 className="mb-2 text-sm font-bold text-foreground">
                                Try this now
                            </h3>
                            <ol className="space-y-1.5" data-testid="live-coaching-actions">
                                {result.actions.map((action, index) => (
                                    <li key={action} className="flex gap-2 text-sm font-semibold leading-snug text-foreground/80">
                                        <span className="mt-px shrink-0 text-sm font-black tabular-nums text-primary" aria-hidden="true">
                                            {index + 1}.
                                        </span>
                                        <span>{action}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    ) : (
                        <p className="text-sm font-semibold leading-snug text-foreground/70" data-testid="live-coaching-no-evidence">
                            No guidance yet — it appears here once this session has enough speech to base it on.
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};

export default LiveCoachingScoreCard;
