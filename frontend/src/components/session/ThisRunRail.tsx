import React from 'react';

/**
 * S-10 — slot D in `during`: the `THIS RUN` rail, on ink.
 *
 * **The filler count takes the accent, and pace matches its size.** The filler count is the one number the
 * user is trying to move, so it is the only one in signature yellow. Pace is context — but at the *same*
 * 40px, because the two are read as a pair; dropping it to 24px made it look like a subordinate statistic
 * rather than the other half of the reading.
 *
 * **The tip stays neutral** (`ink-text`), under the rail's single yellow eyebrow. A yellow tip would put
 * the accent on advice rather than on the number, and two yellows on one ink card means neither reads as
 * the emphasis.
 *
 * **One tip, never a stack.** Phrased as the next action rather than a scolding. The 8-second minimum hold
 * before a tip may be replaced is owned by the container that chooses the tip — this component renders
 * whatever it is given, so the hold cannot be defeated by a re-render here.
 *
 * Both numbers are true readings of a run in progress, so a zero is earned rather than a scoreboard the
 * user has not played yet (G4): during a run, `0 fillers so far` is a fact.
 */
export interface ThisRunRailProps {
    /** Fillers counted so far this run. */
    fillerCount: number;
    /** Words per minute so far, or null while there is not yet enough speech to state one. */
    wordsPerMinute: number | null;
    /** The current live tip, already held for its minimum by the container. Omit for none. */
    tip?: string | null;
}

export const ThisRunRail: React.FC<ThisRunRailProps> = ({ fillerCount, wordsPerMinute, tip }) => {
    const hasTip = typeof tip === 'string' && tip.trim() !== '';
    return (
        <section
            className="rounded-[14px] bg-ink px-5 pb-5 pt-[18px]"
            data-testid="this-run-rail"
            aria-label="This run"
        >
            <p className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">This run</p>

            <div className="mt-3.5 flex items-end justify-between gap-3">
                <div>
                    <p
                        className="text-[40px] font-extrabold leading-none tracking-[-0.035em] text-signature [font-variant-numeric:tabular-nums]"
                        data-testid="this-run-fillers"
                    >
                        {fillerCount}
                    </p>
                    <p className="mt-[5px] text-[13px] font-bold text-ink-muted">fillers so far</p>
                </div>
                {/* Pace is omitted entirely rather than shown as a dash: a rate needs enough speech to be
                    true, and an em-dash beside a live number reads as a failed measurement. */}
                {wordsPerMinute != null && (
                    <div className="text-right">
                        <p
                            className="text-[40px] font-extrabold leading-none tracking-[-0.035em] text-ink-text [font-variant-numeric:tabular-nums]"
                            data-testid="this-run-pace"
                        >
                            {Math.round(wordsPerMinute)}
                        </p>
                        <p className="mt-[5px] text-[13px] font-bold text-ink-muted">words / min</p>
                    </div>
                )}
            </div>

            {hasTip && (
                <p
                    className="mt-4 border-t border-ink-hairline pt-3.5 text-[13px] font-bold leading-[1.45] text-ink-text"
                    data-testid="this-run-tip"
                >
                    {tip}
                </p>
            )}
        </section>
    );
};
