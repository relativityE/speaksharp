import React from 'react';
import { Lock, Cloud } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

import { parseTranscriptForHighlighting } from '@/utils/highlightUtils';

interface LiveTranscriptPanelProps {
    transcript: string;
    interimTranscript?: string;
    isListening: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
    userWords?: string[];
    className?: string;
    history?: Array<{ mode: string; text: string }>;
}

/**
 * Presentational component for the live transcript display.
 * Extracted from SessionPage for better reusability and testability.
 */
export const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
    transcript,
    interimTranscript = '',
    isListening,
    containerRef,
    userWords = [],
    className = "",
    history = [],
}) => {
    const tokens = parseTranscriptForHighlighting(transcript, userWords);
    const hasTranscript = transcript.trim() !== '';
    const hasInterimTranscript = interimTranscript.trim() !== '';

    return (
        <div
            className={`bg-card border border-border rounded-xl p-4 shadow-card flex flex-col ${className}`}
            data-testid={TEST_IDS.TRANSCRIPT_PANEL}
        >
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-5 bg-primary rounded"></div>
                <h3 className="text-lg font-semibold text-foreground">Live Transcript</h3>
            </div>
            <div
                ref={containerRef}
                className="live-transcript-scroll flex-1 overflow-y-auto p-3 pr-5 rounded-lg bg-muted/22 leading-relaxed transition-all min-h-[160px]"
                data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                data-scrollable-transcript="true"
                aria-live="polite"
                aria-label="Live transcript of your speech"
                role="log"
            >
                {/* Segmented History (Chapters) */}
                {history.map((segment, idx) => (
                    <div key={`history-${idx}`} className="mb-6 last:mb-4 opacity-80 group">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted border border-border shadow-sm">
                                {segment.mode === 'private' ? (
                                    <>
                                        <Lock className="h-3 w-3 text-success" />
                                        <span className="text-[10px] font-semibold text-success">Chapter {idx + 1}: Private</span>
                                    </>
                                ) : (
                                    <>
                                        <Cloud className="h-3 w-3 text-accent" />
                                        <span className="text-[10px] font-semibold text-accent">Chapter {idx + 1}: Cloud</span>
                                    </>
                                )}
                            </div>
                            <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
                        </div>
                        <div className="pl-2 border-l-2 border-primary/20 text-foreground/70 text-base leading-relaxed italic">
                            {segment.text}
                        </div>
                    </div>
                ))}

                {/* Engine Handoff Separator */}
                {history.length > 0 && hasTranscript && (
                    <div className="flex items-center gap-4 my-6 select-none pointer-events-none">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                        <span className="text-[10px] font-semibold text-primary/80">Engine Handoff</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                    </div>
                )}

                {/* Current Active Segment */}
                {isListening && !hasTranscript && !hasInterimTranscript ? (
                    <p className="text-muted-foreground animate-pulse">Listening...</p>
                ) : hasTranscript || hasInterimTranscript ? (
                    <div className="text-foreground text-lg leading-relaxed">
                        {tokens.map((token) => {
                            if (token.type === 'error') {
                                return (
                                    <span key={token.id} className="text-destructive font-bold opacity-80 text-sm tracking-wide">
                                        {token.transcript}
                                    </span>
                                );
                            }
                            if (token.type === 'filler') {
                                return (
                                    <span
                                        key={token.id}
                                        style={{ color: token.color, backgroundColor: `${token.color}15` }}
                                        className="px-1.5 py-0.5 rounded font-bold transition-all border border-current"
                                    >
                                        {token.transcript}
                                    </span>
                                );
                            }
                            return <span key={token.id}>{token.transcript}</span>;
                        })}
                        {hasInterimTranscript && (
                            <span className="text-muted-foreground">
                                {hasTranscript ? ' ' : ''}
                                {interimTranscript}
                            </span>
                        )}
                    </div>
                ) : (
                    <p className="text-muted-foreground">Words appear here...</p>
                )}
            </div>
        </div>
    );
};

export default LiveTranscriptPanel;
