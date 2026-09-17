import React from 'react';

/**
 * Open Mic's rail (slot D) in `before` — one plain line, no heading, no chrome (Design Correction Brief
 * S-5, G4).
 *
 * This slot used to hold a card headed `COMPARABLE PROGRESS / No universal score`: the rail's most valuable
 * position spent telling the user what the product does not give them, before they had done anything.
 *
 * The live shell deliberately computes no progress number — the saved review is the single progress
 * authority, because only it can verify eligibility and cohort — so this line never invents one:
 *   - no practice history → `First session — this run becomes your baseline.`
 *   - returning user      → a plain `See your progress` link, where the real comparison lives.
 */
export interface OpenMicBaselineLineProps {
    /** True when the user has no saved practice history at all. */
    isFirstSession: boolean;
    /** Opens the progress page. Absent → the returning-user line renders nothing. */
    onSeeProgress?: () => void;
}

export const OpenMicBaselineLine: React.FC<OpenMicBaselineLineProps> = ({ isFirstSession, onSeeProgress }) => {
    if (isFirstSession) {
        return (
            <p className="px-1 text-[15px] font-semibold leading-snug text-surface-session-text" data-testid="open-mic-baseline-line">
                First session — this run becomes your baseline.
            </p>
        );
    }
    if (!onSeeProgress) return null;
    return (
        <button
            type="button"
            onClick={onSeeProgress}
            data-testid="open-mic-see-progress"
            className="self-start px-1 text-[15px] font-bold text-surface-session-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature-text focus-visible:ring-offset-2"
        >
            See your progress
        </button>
    );
};
