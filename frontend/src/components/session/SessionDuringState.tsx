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
    // #1222 (PO 2026-08-10): a long taken sample used to fill the transcript card and hide the user's own
    // live words. The reading prompt is now HEIGHT-BOUNDED (its own scroll) AND collapsible, so the live
    // transcript is always visible below it and the reader can reclaim the space entirely once they've read.
    const [promptCollapsed, setPromptCollapsed] = React.useState(false);
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
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-[#6d28d9]">
                                    Read this aloud
                                </span>
                                {/* Reclaim the space entirely — the live transcript below must never be hidden. */}
                                <button
                                    type="button"
                                    data-testid="during-reading-prompt-toggle"
                                    aria-expanded={!promptCollapsed}
                                    onClick={() => setPromptCollapsed((c) => !c)}
                                    className="shrink-0 rounded px-2 py-0.5 text-[12px] font-bold text-[#6d28d9] hover:bg-[#ece3ff]"
                                >
                                    {promptCollapsed ? 'Show' : 'Hide'}
                                </button>
                            </div>
                            {/* Height-bounded with its own scroll so a long sample can't push the live words
                                out of the card; the reader scrolls the prompt, the transcript stays put. */}
                            {!promptCollapsed && (
                                <div className="max-h-[22vh] overflow-y-auto pr-1">
                                    {transcript.chosenPrompt}
                                </div>
                            )}
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
