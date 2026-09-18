import React from 'react';
import { SessionShell } from './SessionShell';
import { RecorderBar, type RecorderBarProps } from './RecorderBar';
import { TranscriptCard } from './TranscriptCard';
import { LiveTranscript, type TranscriptToken } from './LiveTranscript';
import { formatLiveMeta } from '@/utils/sessionFormat';
import { CoachingCard } from './CoachingCard';

/**
 * The **during** state on the shared slot map (Design Correction Brief G1):
 *   A = recorder bar (the mic card collapsed) · B = one live tip (Open Mic) or the coverage nudge
 *   (Focus Points), on ink · C = live transcript · D = rail.
 *
 * Same slots, same positions as `before` — only the content and sizes change. The tip's 8-second hold is
 * owned upstream; this state only places what it is given.
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
    /** Slot D content. */
    rail: React.ReactNode;
    /** Slot B, Open Mic: the current live tip. */
    liveTip?: React.ReactNode;
    /** Slot B, Focus Points: the coverage nudge, or null while silent. */
    nudge?: string | null;
}

export const SessionDuringState: React.FC<SessionDuringStateProps> = ({ recorder, transcript, rail, liveTip, nudge }) => {
    const isSample = transcript.promptKind === 'sample';
    return (
        <SessionShell
            sessionState="during"
            slotA={<RecorderBar {...recorder} />}
            slotB={<CoachingCard sessionState="during" liveTip={liveTip} nudge={nudge} />}
            slotC={
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
                            className="mb-3 rounded-lg border border-neutral-border bg-neutral-band px-4 py-3 text-[15px] leading-relaxed text-neutral-body"
                        >
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-secondary">
                                    {isSample
                                        ? (transcript.chosenPromptTitle ? `Read aloud · ${transcript.chosenPromptTitle}` : 'Read this aloud')
                                        : 'Your prompt'}
                                </span>
                                <button
                                    type="button"
                                    data-testid="during-reading-prompt-dismiss"
                                    aria-label="Dismiss"
                                    onClick={transcript.onDismissPin}
                                    className="shrink-0 rounded px-2 py-0.5 text-[14px] leading-none font-bold text-signature-text hover:bg-signature-ground"
                                >
                                    ✕
                                </button>
                            </div>
                            {/* A sample shrinks to ~40% of the card and scrolls internally so it can't push the
                                live words out; a short prompt is left un-clamped. */}
                            <div className={isSample ? 'max-h-[16vh] overflow-y-auto pr-1' : ''}>
                                {transcript.chosenPrompt}
                                {transcript.chosenPromptAttribution && (
                                    <div className="mt-1.5 text-[12px] italic text-neutral-secondary">— {transcript.chosenPromptAttribution}</div>
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
                            className="mb-3 inline-flex items-center gap-1 rounded-full border border-signature-border bg-signature-ground px-3 py-1 text-[12px] font-bold text-signature-text hover:bg-signature-border"
                        >
                            Need a prompt?
                        </button>
                    )}
                    <LiveTranscript tokens={transcript.tokens} coverageMode={transcript.coverageMode} />
                </TranscriptCard>
            }
            slotD={rail}
        />
    );
};
