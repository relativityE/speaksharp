import React from 'react';

/**
 * #1222 — the session-page shell: ONE page, THREE states, FOUR fixed slots.
 *
 * The governing rule (spec §1, as amended for #1474): **a slot keeps stable landmark identity, and slots
 * never reorder WITHIN a state.** Every slot keeps its `data-slot`, `data-testid` and `aria-label` in all
 * three states, so a user who looks away re-finds a surface by its landmark rather than by its position.
 *
 * The original wording forbade any movement between states. #1474 (G10) supersedes that for the **after**
 * state only: the Practice Loop review must be the dominant result once a session is saved, and its
 * acceptance requires coaching to precede the transcript and secondary metrics in keyboard and
 * screen-reader order. Position is what determines both, so the after state deliberately re-arranges which
 * column each slot occupies. Nothing is renamed, nothing is removed, and before/during are untouched.
 *
 * Arrangement per state:
 *   before / during — primary column: A (recorder, sizes to content) then B (transcript, fills).
 *                     rail: C (progress, sizes to content) then D (coaching, fills).
 *   after           — primary column: A (compact saved/audio summary) then D (coaching, fills and dominates).
 *                     rail: C (this-run metrics) then B (transcript reference, fills).
 *
 * Layout: one stacked column on phones; `grid-template-columns: 1.55fr 1fr` from the md breakpoint. The
 * primary column is the wide one in every state, so moving coaching into it in the after state is what makes
 * the review dominant. On phones the single column follows DOM order, so coaching still precedes metrics and
 * transcript without any horizontal dependence.
 */
export type SessionState = 'before' | 'during' | 'after';

export interface SessionShellProps {
    sessionState: SessionState;
    /** Slot A — mic card / recorder bar / playback scrubber. Sizes to content in every state. */
    slotA: React.ReactNode;
    /** Slot B — transcript (empty+prompt / live / seekable). Fills its column. */
    slotB: React.ReactNode;
    /** Slot C — Progress vs baseline / this-run metrics. Sizes to content. */
    slotC: React.ReactNode;
    /** Slot D — coaching placeholder / one live tip / the Practice Loop review. Fills its column. */
    slotD: React.ReactNode;
    className?: string;
}

/** Stable landmark identity per slot — never varies by state. That stability IS the amended §1 rule. */
const SLOTS = {
    A: { testid: 'session-slot-a', label: 'Recorder' },
    B: { testid: 'session-slot-b', label: 'Transcript' },
    C: { testid: 'session-slot-c', label: 'Progress' },
    D: { testid: 'session-slot-d', label: 'Coaching' },
} as const;

type SlotKey = keyof typeof SLOTS;

const Slot = ({ slot, fills, children }: { slot: SlotKey; fills: boolean; children: React.ReactNode }) => (
    <section
        data-slot={slot}
        data-testid={SLOTS[slot].testid}
        aria-label={SLOTS[slot].label}
        style={fills ? { flex: '1 1 auto', minHeight: 0 } : { flex: '0 0 auto' }}
    >
        {children}
    </section>
);

export const SessionShell: React.FC<SessionShellProps> = ({ sessionState, slotA, slotB, slotC, slotD, className }) => {
    const isAfter = sessionState === 'after';
    const column = { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 } as const;

    // #1255: Focus Points and Open Mic both render slot C in every state — the fixed-slot contract has no
    // per-product exception. The guard remains only so a genuinely content-less slot degrades cleanly.
    const hasSlotC = slotC != null && slotC !== false;

    return (
        <div
            data-testid="session-shell"
            data-session-state={sessionState}
            className={`grid grid-cols-1 items-stretch gap-[22px] md:grid-cols-[1.55fr_1fr] ${className ?? ''}`}
        >
            <div style={column}>
                <Slot slot="A" fills={false}>{slotA}</Slot>
                {isAfter
                    /* G10: the review owns the wide column and comes before metrics and transcript. */
                    ? <Slot slot="D" fills>{slotD}</Slot>
                    : <Slot slot="B" fills>{slotB}</Slot>}
            </div>
            <div style={column}>
                {hasSlotC && <Slot slot="C" fills={false}>{slotC}</Slot>}
                {isAfter
                    ? <Slot slot="B" fills>{slotB}</Slot>
                    : <Slot slot="D" fills>{slotD}</Slot>}
            </div>
        </div>
    );
};
