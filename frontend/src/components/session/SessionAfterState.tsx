import React from 'react';
import { SessionShell } from './SessionShell';
import { PlaybackScrubber, type PlaybackScrubberProps } from './PlaybackScrubber';
import { TranscriptCard } from './TranscriptCard';
import { LiveTranscript, type TranscriptToken } from './LiveTranscript';
import { CoachingCard } from './CoachingCard';

/**
 * The **after** state on the shared slot map. Not a new page — the same layout resolving
 * (Design Correction Brief G1):
 *   A = the run's static shape · B = the Practice Loop review and its actions, on ink, directly under the
 *   recorder · C = the transcript as reference · D = rail.
 *
 * Because B was already full width in `before` and `during`, the review grows into the slot the coaching
 * line occupied. Nothing swaps columns — the previous shell had to, because it had no full-width slot.
 */
export interface SessionAfterStateProps {
    scrubber: PlaybackScrubberProps;
    transcript: {
        tokens: TranscriptToken[];
        /** e.g. `318 words · 2.4 fillers/min · tap a highlight to hear it`. */
        headerMeta: string;
        /** thin stats strip, e.g. `5 fillers · 142 wpm · 2:04 spoken`. */
        stats: string;
        onFillerSeek?: (token: TranscriptToken, index: number) => void;
        /** #1046 Focus Points — highlight `covered` tokens as coverage (green) instead of fillers. */
        coverageMode?: 'during' | 'after';
    };
    /** Slot B content: the Practice Loop review and its actions. */
    review: React.ReactNode;
    /** Slot D content. */
    rail: React.ReactNode;
    /**
     * #1416 F-05 — shown in the transcript slot (C) instead of a transcript when the retained authority says there is
     * nothing readable yet. It sits WITH the transcript rather than replacing the slot, so the reason
     * appears where the words would have been.
     */
    slotBNotice?: React.ReactNode;
    /** #1231 R1 — post-Stop decode still running → finalizing banner on the transcript card. */
    finalizing?: boolean;
    /** #891 — finalize-time estimate (s) for the "Finalizing… ~Ns" countdown in the banner. */
    finalizeEstimateSeconds?: number | null;
    /** #1231 R2 — per-word filler breakdown + custom-word manager; replaces the plain stats footer. */
    fillerFooter?: React.ReactNode;
}

export const SessionAfterState: React.FC<SessionAfterStateProps> = ({ scrubber, transcript, review, rail, slotBNotice, finalizing, finalizeEstimateSeconds, fillerFooter }) => {
    return (
        <SessionShell
            sessionState="after"
            slotA={<PlaybackScrubber {...scrubber} />}
            slotB={<CoachingCard sessionState="after" verdict={review} />}
            slotC={
                <TranscriptCard
                    offerDismissed
                    onDismissOffer={() => {}}
                    onRestoreOffer={() => {}}
                    onTakePrompt={() => {}}
                    onReadSample={() => {}}
                    finalizing={finalizing}
                    finalizeEstimateSeconds={finalizeEstimateSeconds}
                    isPrivate
                    headerMeta={transcript.headerMeta}
                    footer={fillerFooter ?? (
                        <span className="flex items-center justify-between">
                            <span data-testid="after-stats">{transcript.stats}</span>
                            <button type="button" className="font-bold text-signature-text hover:underline" data-testid="after-add-fillers">
                                Add your filler words
                            </button>
                        </span>
                    )}
                >
                    {slotBNotice}
                    {!slotBNotice && (
                        <LiveTranscript testId="review-transcript" tokens={transcript.tokens} onFillerSeek={transcript.onFillerSeek} coverageMode={transcript.coverageMode} />
                    )}
                </TranscriptCard>
            }
            slotD={rail}
        />
    );
};
