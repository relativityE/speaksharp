import React from 'react';

/**
 * Design Correction Brief G1 / S-1 / F-1 — ONE page, THREE states, FOUR fixed slots, and ONE slot map shared
 * by Open Mic and Focus Points.
 *
 *     ┌─────────────────────────────────────────────┐  A  full width — recorder
 *     ├─────────────────────────────────────────────┤  B  full width, INK — coaching → Practice Loop review
 *     ├───────────────────────────┬─────────────────┤
 *     │ C  flex: 1; min-width: 0  │ D  310px        │  C transcript · D rail
 *     └───────────────────────────┴─────────────────┘
 *
 * **Slots never move between states. They only change size and content.** The previous shell started its
 * two-column split at the top, with the recorder at half width and coaching in the rail, and so had no
 * full-width place for the Practice Loop review to land in `after`. It worked around that by swapping
 * columns in `after` only (#1474) — a page that visibly reorganised itself at the moment the user most
 * needed to find their result. With A and B full width, the review simply grows into B where the coaching
 * line already was, and nothing reorders in any state.
 *
 * **Slot B's ink ground belongs to the shell, not to its content.** It is the ink role from first paint in
 * every state (S-2), so a component placed in B cannot forget it, and a white B — the "everything blends"
 * failure the palette change was made to fix — is structurally impossible.
 *
 * The rail does not stretch to the transcript (`items-start`), so a long transcript never leaves D with a
 * column of dead space. Below the `md` breakpoint the row stacks, C before D, following DOM order.
 */
export type SessionState = 'before' | 'during' | 'after';

export interface SessionShellProps {
    sessionState: SessionState;
    /** Slot A — the mic card / recorder bar / the mic returned with the run's static shape. Full width. */
    slotA: React.ReactNode;
    /** Slot B — live coaching, then the Practice Loop review. Full width, on ink the shell provides. */
    slotB: React.ReactNode;
    /** Slot C — the transcript. `flex: 1; min-width: 0`. */
    slotC: React.ReactNode;
    /** Slot D — the rail: Open Mic progress / this-run counts; Focus Points coverage & points. 310px. */
    slotD: React.ReactNode;
    className?: string;
}

/** Stable landmark identity per slot — never varies by state or product. */
const SESSION_SLOTS = {
    A: { testid: 'session-slot-a', label: 'Recorder' },
    B: { testid: 'session-slot-b', label: 'Coaching' },
    C: { testid: 'session-slot-c', label: 'Transcript' },
    D: { testid: 'session-slot-d', label: 'This run' },
} as const;

type SlotKey = keyof typeof SESSION_SLOTS;

const Slot = ({ slot, className, children }: { slot: SlotKey; className?: string; children: React.ReactNode }) => (
    <section
        data-slot={slot}
        data-testid={SESSION_SLOTS[slot].testid}
        aria-label={SESSION_SLOTS[slot].label}
        className={className}
    >
        {children}
    </section>
);

export const SessionShell: React.FC<SessionShellProps> = ({ sessionState, slotA, slotB, slotC, slotD, className }) => (
    <div
        data-testid="session-shell"
        data-session-state={sessionState}
        className={`flex flex-col gap-[14px] ${className ?? ''}`}
    >
        <Slot slot="A" className="w-full min-w-0">{slotA}</Slot>
        {/* S-2: ink in every state, owned here. Flat fill only — no gradient, opacity or overlay (G2). */}
        <Slot slot="B" className="w-full min-w-0 rounded-[14px] bg-ink px-5 py-4 text-ink-text md:px-6">{slotB}</Slot>
        <div data-testid="session-shell-row" className="flex flex-col gap-[14px] md:flex-row md:items-start">
            <Slot slot="C" className="min-w-0 md:flex-1">{slotC}</Slot>
            <Slot slot="D" className="flex min-w-0 flex-col gap-[14px] md:w-[310px] md:shrink-0">{slotD}</Slot>
        </div>
    </div>
);
