import React from 'react';

/**
 * #1222 — the session-page shell: ONE page, THREE states, FOUR fixed slots.
 *
 * The governing rule (spec §1): **elements never move between states — they only change size and content.**
 * This shell owns the fixed grid and the four slot wrappers; each slot keeps a stable DOM identity
 * (`data-slot` + a stable landmark) across before/during/after so a user who looks away never has to
 * re-find anything. The slots' CONTENT is passed in and swaps per state; the WRAPPERS never remount or
 * reorder.
 *
 * Layout (spec §1): `grid-template-columns: 1.55fr 1fr`. Left column and rail are each a flex column;
 * slot A/C size to content, slot B/D take the remaining height (`flex:1`) so no card stretches past its
 * content with nothing to fill it.
 */
export type SessionState = 'before' | 'during' | 'after';

export interface SessionShellProps {
    sessionState: SessionState;
    /** Slot A — left column, top: mic card / recorder bar / playback scrubber. Sizes to content. */
    slotA: React.ReactNode;
    /** Slot B — left column, fills: transcript (empty+prompt / live / seekable). */
    slotB: React.ReactNode;
    /** Slot C — rail, top: Progress vs baseline. Sizes to content. */
    slotC: React.ReactNode;
    /** Slot D — rail, fills: coaching placeholder / one live tip / verdict + fix. */
    slotD: React.ReactNode;
    className?: string;
}

export const SessionShell: React.FC<SessionShellProps> = ({ sessionState, slotA, slotB, slotC, slotD, className }) => {
    return (
        <div
            data-testid="session-shell"
            data-session-state={sessionState}
            className={className}
            style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 22, alignItems: 'stretch' }}
        >
            {/* Left column: A sizes to content, B fills. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <section data-slot="A" data-testid="session-slot-a" aria-label="Recorder" style={{ flex: '0 0 auto' }}>
                    {slotA}
                </section>
                <section data-slot="B" data-testid="session-slot-b" aria-label="Transcript" style={{ flex: '1 1 auto', minHeight: 0 }}>
                    {slotB}
                </section>
            </div>
            {/* Rail: C sizes to content, D fills. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                <section data-slot="C" data-testid="session-slot-c" aria-label="Progress" style={{ flex: '0 0 auto' }}>
                    {slotC}
                </section>
                <section data-slot="D" data-testid="session-slot-d" aria-label="Coaching" style={{ flex: '1 1 auto', minHeight: 0 }}>
                    {slotD}
                </section>
            </div>
        </div>
    );
};
