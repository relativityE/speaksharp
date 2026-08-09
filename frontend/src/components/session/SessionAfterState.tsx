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
    verdict: SessionVerdictProps;
}

export const SessionAfterState: React.FC<SessionAfterStateProps> = ({ scrubber, transcript, progress, verdict }) => {
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
                    headerMeta={transcript.headerMeta}
                    footer={
                        <span className="flex items-center justify-between">
                            <span data-testid="after-stats">{transcript.stats}</span>
                            <button type="button" className="font-bold text-[#0d7d74] hover:underline" data-testid="after-add-fillers">
                                Add your filler words
                            </button>
                        </span>
                    }
                >
                    <LiveTranscript tokens={transcript.tokens} onFillerSeek={transcript.onFillerSeek} />
                </TranscriptCard>
            }
            slotC={<ProgressVsBaseline result={progress} sessionState="after" />}
            slotD={<CoachingCard sessionState="after" verdict={<SessionVerdict {...verdict} />} />}
        />
    );
};
