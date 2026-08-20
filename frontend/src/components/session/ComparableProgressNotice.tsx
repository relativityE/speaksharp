import React from 'react';

/**
 * Progress is server-selected after save, once eligibility, recording cohort, chronology, and the
 * persisted recommendation can all be verified together. The live shell must not improvise a second
 * client-only score from whatever history happens to be loaded.
 */
export const ComparableProgressNotice: React.FC<{ sessionState: 'before' | 'during' | 'after' }> = ({ sessionState }) => {
    const message = sessionState === 'before'
        ? 'Your saved Open Mic reviews compare only compatible sessions.'
        : sessionState === 'during'
            ? 'This take will be checked after it is saved.'
            : 'Open the saved review for comparable progress and one next action.';

    return (
        <section
            className="rounded-xl border border-[#dbe2ec] bg-white p-4"
            data-testid="comparable-progress-notice"
            aria-label="Comparable progress"
        >
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#414b5c]">Comparable progress</p>
            <p className="mt-2 text-[16px] font-bold text-[#1f2733]">No universal score</p>
            <p className="mt-1 text-[13px] text-[#414b5c]">{message}</p>
        </section>
    );
};
