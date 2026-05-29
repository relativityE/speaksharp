import React from 'react';
import { Target, TrendingUp } from 'lucide-react';
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

export const LiveCoachingScoreCard: React.FC<LiveCoachingScoreCardProps> = ({
    transcript,
    wordCount,
    wpm,
    clarityScore,
    fillerCount,
    elapsedSeconds,
    pauseMetrics,
    engine,
    isListening,
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
    const showNumericScore = result.confidence !== 'warming-up';
    const confidenceLabel = result.confidence === 'usable'
        ? 'Usable signal'
        : result.confidence === 'directional'
            ? 'Early signal'
            : 'Warming up';
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
            className={`${SESSION_SURFACE_CLASS} p-4 ${className}`}
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
                    <h2 className="text-xl font-extrabold text-foreground">SpeakSharp Score</h2>
                    <p className="mt-1 text-sm font-semibold leading-snug text-foreground/75">
                        The visible tools roll up into one directional game score: structure, pace/fillers/pauses, clarity, and audience impact.<sup className="ml-0.5 text-[10px]">1</sup>
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-foreground/75">
                        {result.headline}
                    </p>
                </div>

                <div className="min-w-[120px] rounded-lg border border-[hsl(var(--border-strong))] bg-white px-4 py-3 text-center surface-shadow">
                    <div className="text-4xl font-extrabold leading-none text-foreground" data-testid="live-session-score">
                        {showNumericScore ? result.score.toFixed(1) : '--'}
                    </div>
                    <div className="mt-1 text-xs font-bold uppercase tracking-wider text-foreground/70">
                        {showNumericScore ? 'out of 10' : 'score soon'}
                    </div>
                </div>
            </div>

            <div className={`${SESSION_INSET_SURFACE_CLASS} p-3`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-foreground">{result.label}</span>
                    <span className="flex items-center gap-1 text-xs font-bold text-foreground/70">
                        <TrendingUp className="h-3.5 w-3.5" />
                        {showNumericScore ? result.target.label : confidenceLabel}
                    </span>
                </div>
                <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-white border border-border">
                    <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${showNumericScore ? scorePercent : 0}%` }}
                    />
                </div>

                <div className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                    <div>
                        <h3 className="mb-2 text-sm font-bold text-foreground">
                            Try this now
                        </h3>
                        <ul className="space-y-1.5" data-testid="live-coaching-actions">
                            {result.actions.map((action) => (
                                <li key={action} className="flex gap-2 text-sm font-semibold leading-snug text-foreground/80">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                    <span>{action}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="rounded-lg border border-border bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                                Why this score moved
                            </span>
                            <span className="text-xs font-bold text-foreground/70">
                                {isListening ? confidenceLabel : 'Ready'}
                            </span>
                        </div>
                        <div className="space-y-2 text-xs font-semibold text-foreground/75" data-testid="live-score-evidence">
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
                                <span>Audience impact</span>
                                <span>{formatBreakdown(result.breakdown.audienceImpact)}</span>
                            </div>
                        </div>
                        <p className="mt-3 text-[11px] font-semibold leading-snug text-foreground/60">
                            The score is not a black box; it is a gamified rollup of the live signals shown here.
                        </p>
                    </div>
                </div>
                <p className="mt-3 text-[11px] font-semibold leading-snug text-foreground/60">
                    <sup>1</sup> Directional practice signal; progress over time matters more than one exact number.
                </p>
            </div>
        </section>
    );
};

export default LiveCoachingScoreCard;
