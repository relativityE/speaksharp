import React from 'react';
import { SessionShell } from './SessionShell';
import { RecorderBar, type RecorderBarProps } from './RecorderBar';
import { TranscriptCard } from './TranscriptCard';
import { LiveTranscript, type TranscriptToken } from './LiveTranscript';
import { formatLiveMeta } from '@/utils/sessionFormat';
import { ProgressVsBaseline } from './ProgressVsBaseline';
import { CoachingCard } from './CoachingCard';
import type { PracticeFocus } from '@/constants/practiceFocus';
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
        /** #1116 — a read-aloud SAMPLE's title + attribution (author/source), for credit while reading. */
        chosenPromptTitle?: string | null;
        chosenPromptAttribution?: string | null;
        /** #1046 Focus Points — omit the fillers/min from the header (filler chrome is off for FP). */
        hideFillers?: boolean;
        /** Override the footer line (Focus Points uses a coverage-highlight note, not the filler note). */
        footer?: React.ReactNode;
        /** #1046 Focus Points — highlight `covered` tokens as coverage (purple) instead of fillers. */
        coverageMode?: 'during' | 'after';
        /** Sample-overlay split lifespan: 'prompt' (glance-then-speak) vs 'sample' (read the whole way). */
        promptKind?: 'prompt' | 'sample';
        /** Dismiss the pinned prompt/sample (✕). */
        onDismissPin?: () => void;
        /** A prompt auto-hid once words began — show the "Need a prompt?" chip to bring it back. */
        showReopenChip?: boolean;
        onReopenPin?: () => void;
    };
    progress: ProgressVsBaselineResult;
    /** #1206 — 'aggregate' shows the composite session-progress card; defaults to the single-signal card. */
    progressMode?: 'filler' | 'aggregate';
    liveTip?: React.ReactNode;
    /** #1222 S8 — Focus Points swaps slot D (coaching → coverage rail); defaults to the coaching card. */
    slotDContent?: React.ReactNode;
    /** #1264 — the chosen Open Mic Practice Focus, shown as a non-scoring reminder while recording. */
    practiceFocus?: PracticeFocus | null;
    /** #1046 — Focus Points swaps slot C (progress-vs-baseline → Coverage & pace). */
    slotCContent?: React.ReactNode;
}

export const SessionDuringState: React.FC<SessionDuringStateProps> = ({ recorder, transcript, progress, progressMode, liveTip, slotDContent, slotCContent, practiceFocus }) => {
    const isSample = transcript.promptKind === 'sample';
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
                    headerMeta={transcript.hideFillers ? `${transcript.words} words` : formatLiveMeta(transcript.words, transcript.fillersPerMin)}
                    footer={transcript.footer ?? 'Fillers are highlighted as they happen. Nothing is scored until you stop.'}
                >
                    {/* Sample-overlay split lifespan (PO Option 1). The pinned card sits INSIDE the transcript
                        (never a modal — no focus trap, no role=dialog, Space still starts recording). A SAMPLE
                        persists (shrunk, its own scroll) so you can read it the whole way; a reopened PROMPT
                        shows larger. Either is dismissed with ✕. The parent owns visibility. */}
                    {transcript.chosenPrompt && transcript.chosenPrompt.trim() && (
                        <div
                            data-testid="during-reading-prompt"
                            data-prompt-kind={transcript.promptKind ?? 'prompt'}
                            className="mb-3 rounded-lg border border-[#e6ddfb] bg-[#f5f0ff] px-4 py-3 text-[15px] leading-relaxed text-[#3b2f5c]"
                        >
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-[#6d28d9]">
                                    {isSample
                                        ? (transcript.chosenPromptTitle ? `Read aloud · ${transcript.chosenPromptTitle}` : 'Read this aloud')
                                        : 'Your prompt'}
                                </span>
                                <button
                                    type="button"
                                    data-testid="during-reading-prompt-dismiss"
                                    aria-label="Dismiss"
                                    onClick={transcript.onDismissPin}
                                    className="shrink-0 rounded px-2 py-0.5 text-[14px] leading-none font-bold text-[#6d28d9] hover:bg-[#ece3ff]"
                                >
                                    ✕
                                </button>
                            </div>
                            {/* A sample shrinks to ~40% of the card and scrolls internally so it can't push the
                                live words out; a short prompt is left un-clamped. */}
                            <div className={isSample ? 'max-h-[16vh] overflow-y-auto pr-1' : ''}>
                                {transcript.chosenPrompt}
                                {transcript.chosenPromptAttribution && (
                                    <div className="mt-1.5 text-[12px] italic text-[#6b5b8a]">— {transcript.chosenPromptAttribution}</div>
                                )}
                            </div>
                        </div>
                    )}
                    {/* A prompt that auto-hid once words began can be brought back. */}
                    {transcript.showReopenChip && (
                        <button
                            type="button"
                            data-testid="during-reopen-prompt"
                            onClick={transcript.onReopenPin}
                            className="mb-3 inline-flex items-center gap-1 rounded-full border border-[#e6ddfb] bg-[#f5f0ff] px-3 py-1 text-[12px] font-bold text-[#6d28d9] hover:bg-[#ece3ff]"
                        >
                            Need a prompt?
                        </button>
                    )}
                    <LiveTranscript tokens={transcript.tokens} coverageMode={transcript.coverageMode} />
                </TranscriptCard>
            }
            slotC={slotCContent ?? <ProgressVsBaseline result={progress} sessionState="during" mode={progressMode} />}
            slotD={slotDContent ?? <CoachingCard sessionState="during" liveTip={liveTip} practiceFocus={practiceFocus} />}
        />
    );
};
