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
 *   A = mic card · B = transcript + prompt offer · C = Slot C card · D = coaching / points rail.
 *
 * #1255 — the fixed-slot contract applies to Focus Points before/during/after just as to Open Mic: Slot C is
 * always present. Open Mic before shows Progress vs baseline (default); Focus Points before supplies its own
 * `slotCContent` (the guide-only Coverage & pace card).
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
    /** #1222/#1255 — Slot C content; defaults to Progress vs baseline (Open Mic). Focus Points passes its
     *  guide-only Coverage & pace card here. Slot C is never omitted. */
    slotCContent?: React.ReactNode;
}

export const SessionBeforeState: React.FC<SessionBeforeStateProps> = ({ mic, transcript, progress, progressMode, slotDContent, slotCContent, practiceFocus, onSelectFocus }) => {
    return (
        <SessionShell
            sessionState="before"
            slotA={<MicCard {...mic} />}
            slotB={<TranscriptCard {...transcript} />}
            slotC={slotCContent ?? <ProgressVsBaseline result={progress} sessionState="before" mode={progressMode} />}
            slotD={slotDContent ?? <CoachingCard sessionState="before" practiceFocus={practiceFocus} onSelectFocus={onSelectFocus} />}
        />
    );
};
