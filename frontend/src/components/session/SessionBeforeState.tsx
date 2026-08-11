import React from 'react';
import { SessionShell } from './SessionShell';
import { MicCard, type MicCardProps } from './MicCard';
import { TranscriptCard, type TranscriptCardProps } from './TranscriptCard';
import { ProgressVsBaseline } from './ProgressVsBaseline';
import { CoachingCard } from './CoachingCard';
import type { PracticeFocus } from '@/constants/practiceFocus';
import type { ProgressVsBaselineResult } from '@/utils/progressVsBaseline';

/**
 * #1222 — the **before** (Prepare) state composed through the fixed 4-slot shell (spec §3):
 *   A = mic card · B = transcript + prompt offer · C = progress vs baseline · D = coaching placeholder.
 *
 * Presentational only: every interaction is a prop the container (a later integration slice) wires to
 * `useSessionLifecycle`. Keeping the composition here lets the whole before-state render + be tested
 * without the app's live audio/store machinery.
 */
export interface SessionBeforeStateProps {
    mic: MicCardProps;
    transcript: Omit<TranscriptCardProps, 'children'>;
    progress: ProgressVsBaselineResult;
    /** #1206 — 'aggregate' shows the composite session-progress card; defaults to the single-signal card. */
    progressMode?: 'filler' | 'aggregate';
    /** #1222 S8 — Focus Points swaps slot D (coaching → capture step); defaults to the coaching card. */
    slotDContent?: React.ReactNode;
    /** #1264 — optional Open Mic Practice Focus + its setter (Open Mic only; drives the before chooser). */
    practiceFocus?: PracticeFocus | null;
    onSelectFocus?: (focus: PracticeFocus) => void;
    /** #1046 — Focus Points swaps slot C (progress-vs-baseline → coverage-this-run). */
    slotCContent?: React.ReactNode;
    /** #1046 G6/G7 §2 — Focus Points renders NO slot C in `before` (nothing has happened yet; a `0/N`
     *  scoreboard only says "you haven't started"). The rail begins with slot D. */
    hideSlotC?: boolean;
}

export const SessionBeforeState: React.FC<SessionBeforeStateProps> = ({ mic, transcript, progress, progressMode, slotDContent, slotCContent, hideSlotC, practiceFocus, onSelectFocus }) => {
    return (
        <SessionShell
            sessionState="before"
            slotA={<MicCard {...mic} />}
            slotB={<TranscriptCard {...transcript} />}
            slotC={hideSlotC ? null : (slotCContent ?? <ProgressVsBaseline result={progress} sessionState="before" mode={progressMode} />)}
            slotD={slotDContent ?? <CoachingCard sessionState="before" practiceFocus={practiceFocus} onSelectFocus={onSelectFocus} />}
        />
    );
};
