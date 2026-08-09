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
    /** #1206 — 'aggregate' shows the composite session-progress card; defaults to the single-signal card. */
    progressMode?: 'filler' | 'aggregate';
    liveTip?: React.ReactNode;
    /** #1222 S8 — Focus Points swaps slot D (coaching → coverage rail); defaults to the coaching card. */
    slotDContent?: React.ReactNode;
}

export const SessionDuringState: React.FC<SessionDuringStateProps> = ({ recorder, transcript, progress, progressMode, liveTip, slotDContent }) => {
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
                    live
                    isPrivate
                    headerMeta={formatLiveMeta(transcript.words, transcript.fillersPerMin)}
                    footer="Fillers are highlighted as they happen. Nothing is scored until you stop."
                >
                    {/* #1222 (PO 2026-08-09): the taken prompt/sample must stay READABLE while recording —
                        pinned at the top of the transcript so you read it aloud and watch your live words
                        stream in below. It used to vanish on mic-start, which made samples unusable. */}
                    {transcript.chosenPrompt && transcript.chosenPrompt.trim() && (
                        <div
                            data-testid="during-reading-prompt"
                            className="mb-3 rounded-lg border border-[#e6ddfb] bg-[#f5f0ff] px-4 py-3 text-[15px] leading-relaxed text-[#3b2f5c]"
                        >
                            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6d28d9]">
                                Read this aloud
                            </div>
                            {transcript.chosenPrompt}
                        </div>
                    )}
                    <LiveTranscript tokens={transcript.tokens} />
                </TranscriptCard>
            }
            slotC={<ProgressVsBaseline result={progress} sessionState="during" mode={progressMode} />}
            slotD={slotDContent ?? <CoachingCard sessionState="during" liveTip={liveTip} />}
        />
    );
};
