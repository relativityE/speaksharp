import React from 'react';
import type { SessionState } from './SessionShell';

/**
 * Slot B — coaching. ONE component in all three states and both products; it sits on the ink ground the
 * shell provides, so it carries no card chrome of its own (Design Correction Brief S-2 / F-1).
 *
 *   before → the yellow `LIVE COACHING` eyebrow and four words: `Tips appear as you speak.` (S-3)
 *   during → Open Mic: one live tip. Focus Points: the coverage nudge, which moved here from the coverage
 *            card so both products coach in the same place (F-1). Silent until there is something to say,
 *            and when silent it keeps the `before` line, so the band never empties or jumps.
 *   after  → the Practice Loop review and its actions.
 *
 * Removed (S-3, S-4, G3): the sentence that explained when the first tip would appear — the interface
 * describing its own mechanics — and the five optional `Practice focus` chips, which asked the user to
 * name what to work on before the product had listened to them.
 */
export interface CoachingCardProps {
    sessionState: SessionState;
    /** during, Open Mic: the current live tip node. */
    liveTip?: React.ReactNode;
    /** during, Focus Points: the nudge sentence, or null while silent. */
    nudge?: string | null;
    /** after: the Practice Loop review and its actions. */
    verdict?: React.ReactNode;
}

const Eyebrow: React.FC<{ text: string }> = ({ text }) => (
    <p className="shrink-0 text-[12px] font-extrabold uppercase tracking-[0.07em] text-signature" data-testid="coaching-eyebrow">
        {text}
    </p>
);

/** The one-line resting state: eyebrow and four words, baseline-aligned (~64px of band). */
const RestingLine: React.FC = () => (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="coaching-placeholder">
        <Eyebrow text="Live coaching" />
        <p className="text-[15px] font-semibold text-ink-muted">Tips appear as you speak.</p>
    </div>
);

export const CoachingCard: React.FC<CoachingCardProps> = ({ sessionState, liveTip, nudge, verdict }) => {
    const hasTip = liveTip != null && liveTip !== false;
    const hasNudge = typeof nudge === 'string' && nudge.trim() !== '';
    return (
        <div data-testid="coaching-card" data-coaching-state={sessionState} className="min-w-0">
            {sessionState === 'before' && <RestingLine />}

            {sessionState === 'during' && (
                <div data-testid="coaching-live">
                    {!hasTip && !hasNudge && <RestingLine />}
                    {hasTip && (
                        <>
                            <Eyebrow text="Live coaching" />
                            <div className="mt-2">{liveTip}</div>
                        </>
                    )}
                    {!hasTip && hasNudge && (
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                            <Eyebrow text="Live coaching" />
                            {/* F-1: the nudge on ink at 15px/700 — a remark, not an alert. */}
                            <p className="text-[15px] font-bold text-ink-text" data-testid="coverage-pace-nudge">{nudge}</p>
                        </div>
                    )}
                </div>
            )}

            {sessionState === 'after' && (
                <div data-testid="coaching-verdict">{verdict}</div>
            )}
        </div>
    );
};
