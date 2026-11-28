import React from 'react';
import { Button } from '@/components/ui/button';
import { youSaidText } from '@/services/confidenceCheck/youSaidText';
import {
    READINESS_LABELS, TARGET_FEEL_LABELS,
    type ConfidencePilotState, type ReadinessRating, type TargetFeel,
} from '@/services/confidenceCheck/pilotState';

/**
 * Practice confidence check pilot (spec Revision 1) — presentational only. The questions are optional, neutral and
 * kept on this device for this session only; nothing here sends an answer anywhere. What the user says is always
 * shown apart from anything measured, and never as evidence that delivery changed.
 */
const READINESS_QUESTION = 'How ready would you feel to give this presentation now?';
const SESSION_ONLY_NOTE = 'Optional. Your answer stays on this device for this session only.';
const RATINGS: ReadinessRating[] = [1, 2, 3, 4, 5];
const FEELS: TargetFeel[] = ['easier', 'same', 'harder', 'not_sure'];

const RatingRow: React.FC<{ selected: ReadinessRating | null; onPick: (r: ReadinessRating) => void; testId: string }> = ({ selected, onPick, testId }) => (
    <div role="group" aria-label={READINESS_QUESTION} className="flex flex-wrap gap-2" data-testid={testId}>
        {RATINGS.map((rating) => (
            <Button key={rating} type="button" size="sm" variant={selected === rating ? 'default' : 'outline'}
                aria-pressed={selected === rating} data-testid={`${testId}-${rating}`} onClick={() => onPick(rating)}>
                {rating} · {READINESS_LABELS[rating]}
            </Button>
        ))}
    </div>
);

/**
 * Before the first take. Starting a practice loop is its own choice ("Start a practice loop"); only then is the optional
 * readiness rating offered. Not choosing it leaves an ordinary one-off take with no questions.
 */
export const ConfidencePreCard: React.FC<{
    loopStarted: boolean;
    pre: ConfidencePilotState['pre'];
    onStartLoop: () => void;
    onAnswer: (answer: ReadinessRating | 'skipped') => void;
}> = ({ loopStarted, pre, onStartLoop, onAnswer }) => (
    <section data-testid="confidence-pre" aria-label="Practice loop" className="rounded-xl border border-primary/20 bg-background p-4 space-y-2">
        {!loopStarted ? (
            <>
                <p className="text-sm text-foreground/80">Want to practise this as a loop? Record, read the tip, then repeat it.</p>
                <Button type="button" size="sm" variant="outline" data-testid="confidence-start-loop" onClick={onStartLoop}>Start a practice loop</Button>
            </>
        ) : (
            <>
                <p className="text-sm font-semibold text-foreground">Practice loop started. Before your first take:</p>
                <p className="text-sm text-foreground/80">{READINESS_QUESTION}</p>
                <RatingRow selected={typeof pre === 'number' ? pre : null} onPick={onAnswer} testId="confidence-pre-rating" />
                <div className="flex flex-wrap items-center gap-2">
                    {pre === null && (
                        <Button type="button" size="sm" variant="ghost" data-testid="confidence-pre-skip" onClick={() => onAnswer('skipped')}>Skip</Button>
                    )}
                    <p className="text-xs text-foreground/60">{SESSION_ONLY_NOTE}</p>
                </div>
            </>
        )}
    </section>
);

/** After a repeat take, BEFORE its review: readiness first, then the target chip. The review is one press away. */
export const ConfidencePostCard: React.FC<{
    post: ConfidencePilotState['post'];
    feel: ConfidencePilotState['feel'];
    targetLabel: string;
    onRate: (answer: ReadinessRating | 'skipped') => void;
    onFeel: (answer: TargetFeel) => void;
    onReveal: () => void;
}> = ({ post, feel, targetLabel, onRate, onFeel, onReveal }) => (
    <section data-testid="confidence-post" aria-label="Readiness after practice" className="rounded-xl border border-primary/20 bg-background p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Before you see your review</p>
        <div className="space-y-2">
            <p className="text-sm text-foreground/80">{READINESS_QUESTION}</p>
            <RatingRow selected={typeof post === 'number' ? post : null} onPick={onRate} testId="confidence-post-rating" />
        </div>
        {post !== null && (
            <div className="space-y-2" data-testid="confidence-feel">
                <p className="text-sm text-foreground/80">{targetLabel}</p>
                <div role="group" aria-label={targetLabel} className="flex flex-wrap gap-2">
                    {FEELS.map((option) => (
                        <Button key={option} type="button" size="sm" variant={feel === option ? 'default' : 'outline'}
                            aria-pressed={feel === option} data-testid={`confidence-feel-${option}`} onClick={() => onFeel(option)}>
                            {TARGET_FEEL_LABELS[option]}
                        </Button>
                    ))}
                </div>
            </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" data-testid="confidence-reveal" onClick={onReveal}>Show my review</Button>
            {post === null && (
                <Button type="button" size="sm" variant="ghost" data-testid="confidence-post-skip" onClick={() => onRate('skipped')}>Skip</Button>
            )}
            <p className="text-xs text-foreground/60">{SESSION_ONLY_NOTE}</p>
        </div>
    </section>
);

export const ConfidenceYouSaid: React.FC<{ state: Pick<ConfidencePilotState, 'pre' | 'post' | 'feel'> }> = ({ state }) => {
    const text = youSaidText(state);
    if (!text) return null;
    return (
        <p data-testid="confidence-you-said" className="text-xs text-foreground/70">
            {text} <span className="text-foreground/60">Self-reported, not a measurement of your delivery.</span>
        </p>
    );
};
