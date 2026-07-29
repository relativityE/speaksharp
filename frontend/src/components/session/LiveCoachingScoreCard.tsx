import React from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { HelpPopover } from './HelpPopover';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import { calculateSpeakingScore } from '@/utils/speakingScore';
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

/**
 * #1047: the settled name for this surface, rendered as the inner panel's label. 13px/800 with a
 * .06em track, muted — it names the panel without competing with the value inside it.
 */
const PANEL_LABEL_CLASS = 'text-[13px] font-extrabold tracking-[0.06em] text-muted-foreground';

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
    // #1047: at 'warming-up' the card stated "no data" THREE times at once — a `--` value, a
    // "SCORE SOON" sublabel, and a "Speak a little more to get a useful score" headline (plus a
    // "Confidence: Building" chip and an empty progress bar). One statement is enough. This collapses
    // ONLY the genuinely-empty state; 'directional' still carries real information ("Early signal",
    // "Confidence: Directional") and is left exactly as it was.
    const isEmptySignal = result.confidence === 'warming-up';
    // EVIDENCE, and where the protection actually comes from. `calculateSpeakingScore` falls back to
    // generic openers ("Start with one complete thought.") below MIN_RELIABLE_SCORING_WORDS (3) — advice
    // invented from nothing, which must never be numbered and presented as if it were about this take.
    // An explicit `wordCount >= 3` gate here would be DEAD CODE: guidance only renders in the
    // `!isEmptySignal` branch, and leaving 'warming-up' already requires MIN_WORDS_FOR_DIRECTIONAL (25),
    // which subsumes 3. So the empty-signal collapse above IS the guarantee — the generic openers are
    // unreachable on screen at every word count. Asserted directly in the tests rather than restated as
    // a redundant condition here.
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
            // The announced region name matches what the card calls itself. It was "Live Coaching
            // Score", so a screen-reader user was told this card was a score while sighted users read
            // something else entirely — the same card-says-one-thing defect as the help body, in the
            // accessibility layer.
            aria-label="Progress"
        >
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    {/* #1047 NAMING (settled): the surface is "Progress" — never "SpeakSharp Progress"
                        ("SpeakSharp" is redundant here), never "SpeakSharp Score", never a bare "SCORE",
                        and no asterisk. The name is carried ONCE, by the inner panel label below; there
                        is deliberately no <h2> stacking a second copy of it directly above that panel. */}
                    <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                        <Target className="h-4 w-4" aria-hidden="true" />
                        Live Coaching
                        <HelpPopover
                            // The help title tracks the surface name. An earlier pass renamed only this
                            // label and left the body still explaining "SpeakSharp Score" — the card
                            // said one thing and its own help said another. The body copy stays neutral:
                            // it describes the evidence and does not need to name a score at all.
                            label="About progress"
                            testId="score-help"
                            panelClassName="w-72"
                        >
                            <div className="space-y-2" data-testid="score-help-body">
                                {/* Neutral by construction: names the evidence, claims no portable
                                    score, and does not promise that anything reappears in Analytics. */}
                                <p>
                                    Pace, detected fillers, delivery signals, and transcript quality support your progress.
                                </p>
                                <p>
                                    Progress is directional and uses only the practice evidence available for this session.
                                </p>
                                <div className="rounded-md border border-border bg-white p-2.5">
                                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground/70">
                                        What this is based on
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
                                        This is not a black box; it is a transparent rollup of the live signals shown here.
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
                                {/* The old trailing footnote is deliberately gone rather than reworded.
                                    It carried the retired name, promised "progress over time", and
                                    restated the directional caveat that body line 2 above now makes
                                    once — three problems in one sentence. */}
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
                            {/* "score soon" was the retired identity again, in the sublabel. */}
                            {showNumericScore ? 'out of 10' : 'not yet'}
                        </div>
                        <div
                            className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${confidenceChipClass}`}
                            data-testid="live-score-confidence"
                            data-score-confidence={result.confidence}
                            data-transcript-trusted={result.qualitySignals.trusted ? 'true' : 'false'}
                            title="Transcript quality affects how confidently this feedback is shown."
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
                    <div className={PANEL_LABEL_CLASS} data-testid="live-score-panel-label">PROGRESS</div>
                    <div className="mt-1 text-4xl font-extrabold leading-none text-foreground" data-testid="live-session-score">
                        --
                    </div>
                    {/* The hint names NO duration. Leaving this state depends on WORD COUNT
                        (MIN_WORDS_FOR_DIRECTIONAL = 25), not elapsed time: 30 seconds of slow speech
                        still shows nothing, and 25 words in 10 seconds shows the panel. The spec's
                        "~30s" was `MIN_SECONDS_FOR_USABLE` — a different gate, for a different state,
                        that additionally needs 75 words and a trusted transcript — so translating the
                        word gate into a duration would be an invented threshold. */}
                    <p className="mt-2 text-sm font-semibold text-foreground/70" data-testid="live-score-empty-hint">
                        Speak a little more to see progress.
                    </p>
                </div>
            ) : (
                <div className={`${SESSION_INSET_SURFACE_CLASS} p-3`}>
                    {/* Same label, same slot, in both panel states — the surface names itself once. */}
                    <div className={`mb-1 ${PANEL_LABEL_CLASS}`} data-testid="live-score-panel-label">PROGRESS</div>
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
                </div>
            )}

            {/* #1047 item 8 — the coaching block is LAYOUT: header, numbered items with amber numerals,
                and a footer, present in every state so the card is never a bare `--`.
                Its CONTENT is evidence-gated. `calculateSpeakingScore` falls back to generic openers
                ("Start with one complete thought.") below the reliable-scoring floor — advice invented
                from nothing, which must never be numbered and presented as if it were about this take.
                Reaching `!isEmptySignal` already means the session cleared the 25-word directional
                floor, so the actions rendered there are derived from real signals. With no evidence yet
                we say exactly that, rather than filling the slot with generic advice. */}
            <div className="mt-3" data-testid="live-coaching-guidance">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground/70">
                    Try this now
                </h3>
                {isEmptySignal ? (
                    <p
                        className="text-sm font-semibold leading-snug text-foreground/70"
                        data-testid="live-coaching-no-evidence"
                    >
                        Coaching appears here once you have spoken enough for it to be based on this session.
                    </p>
                ) : (
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
                )}
                <p className="mt-3 border-t border-border pt-2 text-xs font-medium text-foreground/60" data-testid="live-coaching-footer">
                    Coaching updates as you speak.
                </p>
            </div>
        </section>
    );
};

export default LiveCoachingScoreCard;
