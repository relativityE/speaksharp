import React from 'react';
import { Lock, Cloud } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

import { parseTranscriptForHighlighting } from '@/utils/highlightUtils';

interface LiveTranscriptPanelProps {
    transcript: string;
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
    isListening,
    containerRef,
    userWords = [],
    className = "",
    history = [],
}) => {
    const tokens = parseTranscriptForHighlighting(transcript, userWords);

    return (
        <div
            className={`bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col ${className}`}
            data-testid={TEST_IDS.TRANSCRIPT_PANEL}
        >
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-5 bg-primary rounded"></div>
                <h3 className="text-lg font-semibold text-foreground">Live Transcript</h3>
            </div>
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto p-3 rounded-lg bg-muted/30 leading-relaxed transition-all min-h-[160px]"
                data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                aria-live="polite"
                aria-label="Live transcript of your speech"
                role="log"
            >
                {/* Segmented History (Chapters) */}
                {history.map((segment, idx) => (
                    <div key={`history-${idx}`} className="mb-6 last:mb-4 opacity-80 group">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/5 border border-white/10 shadow-sm">
                                {segment.mode === 'private' ? (
                                    <>
                                        <Lock className="h-3 w-3 text-emerald-500" />
                                        <span className="text-[10px] font-black uppercase tracking-tighter text-emerald-500">Chapter {idx + 1}: Private</span>
                                    </>
                                ) : (
                                    <>
                                        <Cloud className="h-3 w-3 text-sky-400" />
                                        <span className="text-[10px] font-black uppercase tracking-tighter text-sky-400">Chapter {idx + 1}: Cloud</span>
                                    </>
                                )}
                            </div>
                            <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
                        </div>
                        <div className="pl-2 border-l-2 border-primary/20 text-foreground/70 text-base leading-relaxed italic">
                            {segment.text}
                        </div>
                    </div>
                ))}

                {/* Engine Handoff Separator */}
                {history.length > 0 && transcript.trim() !== '' && (
                    <div className="flex items-center gap-4 my-6 select-none pointer-events-none">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500/50">Engine Handoff</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent" />
                    </div>
                )}

                {/* Current Active Segment */}
                {isListening && (!transcript || transcript.trim() === '') ? (
                    <p className="text-muted-foreground italic animate-pulse">Listening...</p>
                ) : transcript && transcript.trim() !== '' ? (
                    <div className="text-foreground text-lg">
                        {tokens.map((token, i) => {
                            if (token.type === 'error') {
                                return (
                                    <span key={i} className="text-destructive font-bold mx-0.5 opacity-80 text-sm tracking-wide">
                                        {token.transcript}
                                    </span>
                                );
                            }
                            if (token.type === 'filler') {
                                return (
                                    <span
                                        key={i}
                                        style={{ color: token.color, backgroundColor: `${token.color}15` }}
                                        className="px-1.5 py-0.5 rounded mx-0.5 font-bold transition-all border border-current"
                                    >
                                        {token.transcript}
                                    </span>
                                );
                            }
                            return <span key={i} className="mx-0.5">{token.transcript}</span>;
                        })}
                    </div>
                ) : (
                    <p className="text-muted-foreground italic">words appear here...</p>
                )}
            </div>
        </div>
    );
};

export default LiveTranscriptPanel;
