import React from 'react';
import { SessionShell } from './SessionShell';
import { PlaybackScrubber, type PlaybackScrubberProps } from './PlaybackScrubber';
import { TranscriptCard } from './TranscriptCard';
import { LiveTranscript, type TranscriptToken } from './LiveTranscript';
import { ProgressVsBaseline } from './ProgressVsBaseline';
import { CoachingCard } from './CoachingCard';
import { SessionVerdict, type SessionVerdictProps } from './SessionVerdict';
import type { ProgressVsBaselineResult } from '@/utils/progressVsBaseline';

/**
 * #1222 — the **after** (Review) state through the same fixed shell (spec §5). Not a new page — the same
 * layout resolving:
 *   A = playback scrubber (the bar resolved) · B = seekable transcript + stats strip · C = final progress
 *   · D = verdict + one fix + two actions.
 */
export interface SessionAfterStateProps {
    scrubber: PlaybackScrubberProps;
    transcript: {
        tokens: TranscriptToken[];
        /** e.g. `318 words · 2.4 fillers/min · tap a highlight to hear it`. */
        headerMeta: string;
        /** thin stats strip, e.g. `5 fillers · 142 wpm · 2:04 spoken`. */
        stats: string;
        onFillerSeek: (token: TranscriptToken, index: number) => void;
    };
    progress: ProgressVsBaselineResult;
    /** #1206 — 'aggregate' shows the composite session-progress card; defaults to the single-signal card. */
    progressMode?: 'filler' | 'aggregate';
    verdict: SessionVerdictProps;
    /** #1222 S8 — Focus Points swaps slot D (verdict → resolved coverage rail); defaults to the verdict. */
    slotDContent?: React.ReactNode;
    /** #1231 R1 — post-Stop decode still running → finalizing banner on the transcript card. */
    finalizing?: boolean;
    /** #891 — finalize-time estimate (s) for the "Finalizing… ~Ns" countdown in the banner. */
    finalizeEstimateSeconds?: number | null;
    /** #1231 R2 — per-word filler breakdown + custom-word manager; replaces the plain stats footer. */
    fillerFooter?: React.ReactNode;
}

export const SessionAfterState: React.FC<SessionAfterStateProps> = ({ scrubber, transcript, progress, progressMode, verdict, slotDContent, finalizing, finalizeEstimateSeconds, fillerFooter }) => {
    return (
        <SessionShell
            sessionState="after"
            slotA={<PlaybackScrubber {...scrubber} />}
            slotB={
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
                            <button type="button" className="font-bold text-[#0d7d74] hover:underline" data-testid="after-add-fillers">
                                Add your filler words
                            </button>
                        </span>
                    )}
                >
                    <LiveTranscript tokens={transcript.tokens} onFillerSeek={transcript.onFillerSeek} />
                </TranscriptCard>
            }
            slotC={<ProgressVsBaseline result={progress} sessionState="after" mode={progressMode} />}
            slotD={slotDContent ?? <CoachingCard sessionState="after" verdict={<SessionVerdict {...verdict} />} />}
        />
    );
};
