import React from 'react';
import { Lock, Cloud } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

import { parseTranscriptForHighlighting } from '@/utils/highlightUtils';

interface LiveTranscriptPanelProps {
    transcript: string;
    interimTranscript?: string;
    isListening: boolean;
    sttMode?: string;
    micLevel?: number;
    hasSpeechActivity?: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
    userWords?: string[];
    className?: string;
    history?: Array<{ mode: string; text: string }>;
}

const WaveformMeter: React.FC<{ level: number; isProcessing: boolean }> = ({ level, isProcessing }) => {
    const visibleLevel = Math.max(0.08, Math.min(level, 1));
    const bars = [0.35, 0.62, 0.9, 0.5, 0.74];

    return (
        <div className="flex h-8 items-center justify-center gap-1" aria-hidden="true">
            {bars.map((weight, index) => (
                <span
                    key={index}
                    className={`w-1.5 rounded-full bg-primary transition-[height,opacity] duration-150 ${isProcessing ? 'animate-pulse' : ''}`}
                    style={{
                        height: `${8 + (visibleLevel * weight * 24)}px`,
                        opacity: 0.35 + (visibleLevel * 0.65),
                    }}
                />
            ))}
        </div>
    );
};

/**
 * Presentational component for the live transcript display.
 * Extracted from SessionPage for better reusability and testability.
 */
export const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
    transcript,
    interimTranscript = '',
    isListening,
    sttMode,
    micLevel = 0,
    hasSpeechActivity = false,
    containerRef,
    userWords = [],
    className = "",
    history = [],
}) => {
    const tokens = parseTranscriptForHighlighting(transcript, userWords);
    const hasTranscript = transcript.trim() !== '';
    const displayInterimTranscript =
        transcript.trim() === interimTranscript.trim() ? '' : interimTranscript;
    const hasInterimTranscript = displayInterimTranscript.trim() !== '';
    const showPrivateFeedback = sttMode === 'private' && isListening;
    const privateStatus = hasTranscript || hasInterimTranscript ? 'Live text' : 'Private local';

    return (
        <div
            className={`bg-card border border-[hsl(var(--border-strong))] rounded-xl p-4 shadow-[var(--shadow-card-primary)] flex flex-col ${className}`}
            data-testid={TEST_IDS.TRANSCRIPT_PANEL}
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-primary rounded"></div>
                    <h3 className="text-lg font-semibold text-foreground">Live Transcript</h3>
                </div>
                {showPrivateFeedback && (
                    <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                        <WaveformMeter level={micLevel} isProcessing={hasSpeechActivity && !hasTranscript && !hasInterimTranscript} />
                        <span>{privateStatus}</span>
                    </div>
                )}
            </div>
            <div
                ref={containerRef}
                className="live-transcript-scroll flex-1 overflow-y-auto p-3 pr-5 rounded-lg border border-[hsl(var(--border-strong))] bg-[#F8FAFC] leading-relaxed transition-all min-h-[160px]"
                data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                data-scrollable-transcript="true"
                aria-live="polite"
                aria-label="Live transcript of your speech"
                role="log"
            >
                {/* Segmented History (Chapters) */}
                {history.map((segment, idx) => (
                    <div key={`history-${idx}`} className="mb-6 last:mb-4 group">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border border-[hsl(var(--border-strong))] shadow-card">
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
                        <div className="pl-2 border-l-2 border-primary/30 text-[#4B5563] text-base leading-relaxed italic">
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
                    sttMode === 'private' ? (
                        <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 text-center text-[#4B5563]">
                            <div className={`relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/5 ${hasSpeechActivity ? 'shadow-[0_0_0_8px_hsl(var(--primary)/0.08)]' : ''}`}>
                                {hasSpeechActivity && <span className="absolute inset-0 rounded-full border border-primary/30 animate-ping" />}
                                <WaveformMeter level={micLevel} isProcessing={hasSpeechActivity} />
                            </div>
                            <p className={hasSpeechActivity ? 'text-primary font-medium' : 'animate-pulse'}>
                                {hasSpeechActivity ? 'Processing locally...' : 'Listening...'}
                            </p>
                        </div>
                    ) : (
                        <p className="text-[#4B5563] animate-pulse">Listening...</p>
                    )
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
                            <span className="text-[#4B5563]">
                                {hasTranscript ? ' ' : ''}
                                {displayInterimTranscript}
                            </span>
                        )}
                    </div>
                ) : (
                    <p className="text-[#4B5563]">Words appear here...</p>
                )}
            </div>
        </div>
    );
};

export default LiveTranscriptPanel;
