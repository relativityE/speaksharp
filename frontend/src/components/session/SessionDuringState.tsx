import React from 'react';
import { SessionShell } from './SessionShell';
import { RecorderBar, type RecorderBarProps } from './RecorderBar';
import { TranscriptCard } from './TranscriptCard';
import { LiveTranscript, type TranscriptToken } from './LiveTranscript';
import { formatLiveMeta } from '@/utils/sessionFormat';
import { ProgressVsBaseline } from './ProgressVsBaseline';
import { CoachingCard } from './CoachingCard';
import type { ProgressVsBaselineResult } from '@/utils/progressVsBaseline';

/**
 * #1222 — the **during** (Rehearse) state through the same fixed shell (spec §4):
 *   A = recorder bar (the mic card collapsed) · B = live transcript · C = progress, live · D = one tip.
 *
 * Same slots, same positions as `before` — only the content and sizes change. The live tip node (slot D)
 * and its 8s-hold behaviour are owned by S5; here slot D accepts a `liveTip` node.
 */
export interface SessionDuringStateProps {
    recorder: RecorderBarProps;
    transcript: {
        tokens: TranscriptToken[];
        words: number;
        fillersPerMin: number;
        /** The taken prompt stays visible through recording (§3); shown as header meta prefix. */
        chosenPrompt?: string | null;
    };
    progress: ProgressVsBaselineResult;
    liveTip?: React.ReactNode;
    /** #1222 S8 — Focus Points swaps slot D (coaching → coverage rail); defaults to the coaching card. */
    slotDContent?: React.ReactNode;
}

export const SessionDuringState: React.FC<SessionDuringStateProps> = ({ recorder, transcript, progress, liveTip, slotDContent }) => {
    return (
        <SessionShell
            sessionState="during"
            slotA={<RecorderBar {...recorder} />}
            slotB={
                <TranscriptCard
                    // Offer handlers are inert while recording — the offer never shows once content exists.
                    offerDismissed
                    onDismissOffer={() => {}}
                    onRestoreOffer={() => {}}
                    onTakePrompt={() => {}}
                    onReadSample={() => {}}
                    headerMeta={formatLiveMeta(transcript.words, transcript.fillersPerMin)}
                    footer="Fillers are highlighted as they happen. Nothing is scored until you stop."
                >
                    <LiveTranscript tokens={transcript.tokens} />
                </TranscriptCard>
            }
            slotC={<ProgressVsBaseline result={progress} sessionState="during" />}
            slotD={slotDContent ?? <CoachingCard sessionState="during" liveTip={liveTip} />}
        />
    );
};
