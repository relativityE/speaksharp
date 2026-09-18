import React from 'react';
import { SessionShell } from './SessionShell';
import { MicCard, type MicCardProps } from './MicCard';
import { TranscriptCard, type TranscriptCardProps } from './TranscriptCard';
import { CoachingCard } from './CoachingCard';

/**
 * The **before** state on the shared slot map (Design Correction Brief S-1…S-7, F-1…F-6):
 *   A = mic card · B = one line of live coaching, on ink · C = transcript with the prompt pair · D = rail.
 *
 * The page's only job here is to get the user talking (S-4), so it asks for at most one decision — the
 * prompt pair inside the transcript's empty state. The rail is supplied by the container because its
 * content is product-specific: Open Mic states its baseline in one plain line, Focus Points states its
 * plan and its points.
 *
 * Presentational only: every interaction is a prop the container wires.
 */
export interface SessionBeforeStateProps {
    mic: MicCardProps;
    transcript: Omit<TranscriptCardProps, 'children'>;
    /** Slot D content. */
    rail: React.ReactNode;
}

export const SessionBeforeState: React.FC<SessionBeforeStateProps> = ({ mic, transcript, rail }) => (
    <SessionShell
        sessionState="before"
        slotA={<MicCard {...mic} />}
        slotB={<CoachingCard sessionState="before" />}
        slotC={<TranscriptCard {...transcript} />}
        slotD={rail}
    />
);
