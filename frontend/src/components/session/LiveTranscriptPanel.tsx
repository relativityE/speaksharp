import React from 'react';
import { TEST_IDS } from '@/constants/testIds';

import { parseTranscriptForHighlighting } from '@/utils/highlightUtils';

interface LiveTranscriptPanelProps {
    transcript: string;
    isListening: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
    userWords?: string[];
    className?: string;
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
