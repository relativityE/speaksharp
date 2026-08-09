import React from 'react';
import { SessionShell } from './SessionShell';
import { MicCard, type MicCardProps } from './MicCard';
import { TranscriptCard, type TranscriptCardProps } from './TranscriptCard';
import { ProgressVsBaseline } from './ProgressVsBaseline';
import { CoachingCard } from './CoachingCard';
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
    /** #1222 S8 — Focus Points swaps slot D (coaching → capture step); defaults to the coaching card. */
    slotDContent?: React.ReactNode;
}

export const SessionBeforeState: React.FC<SessionBeforeStateProps> = ({ mic, transcript, progress, slotDContent }) => {
    return (
        <SessionShell
            sessionState="before"
            slotA={<MicCard {...mic} />}
            slotB={<TranscriptCard {...transcript} />}
            slotC={<ProgressVsBaseline result={progress} sessionState="before" />}
            slotD={slotDContent ?? <CoachingCard sessionState="before" />}
        />
    );
};
