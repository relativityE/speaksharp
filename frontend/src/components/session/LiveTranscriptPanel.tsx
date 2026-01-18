import React from 'react';
import { TEST_IDS } from '@/constants/testIds';

import { parseTranscriptForHighlighting, getWordColor } from '@/utils/highlightUtils';

interface LiveTranscriptPanelProps {
    transcript: string;
    isListening: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
    customWords?: string[];
}

/**
 * Presentational component for the live transcript display.
 * Extracted from SessionPage for better reusability and testability.
 */
export const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
    transcript,
    isListening,
    containerRef,
    customWords = [],
}) => {
    const tokens = parseTranscriptForHighlighting(transcript, customWords);

    return (
        <div
            className="bg-card border border-border rounded-lg p-6 shadow-elegant"
            data-testid={TEST_IDS.TRANSCRIPT_PANEL}
        >
            <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-5 bg-primary rounded"></div>
                <h3 className="text-base font-semibold text-foreground">Live Transcript</h3>
            </div>
            <div
                ref={containerRef}
                className="h-[250px] overflow-y-auto p-4 rounded-lg bg-background/50 border border-white/10 scroll-smooth leading-relaxed"
                data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                aria-live="polite"
                aria-label="Live transcript of your speech"
                role="log"
            >
                {isListening && (!transcript || transcript.trim() === '') ? (
                    <p className="text-muted-foreground italic animate-pulse">Listening...</p>
                ) : transcript && transcript.trim() !== '' ? (
                    <div className="text-white text-lg">
                        {tokens.map((token, i) => {
                            if (token.type === 'error') {
                                return (
                                    <span key={i} className="text-destructive font-bold mx-0.5 opacity-80 text-sm tracking-wide">
                                        {token.text}
                                    </span>
                                );
                            }
                            if (token.type === 'filler') {
                                return (
                                    <span
                                        key={i}
                                        style={{ color: token.color || getWordColor(token.text) }}
                                        className="font-medium mx-0.5"
                                    >
                                        {token.text}
                                    </span>
                                );
                            }
                            return <span key={i} className="mx-0.5">{token.text}</span>;
                        })}
                    </div>
                ) : (
                    <p className="text-white/60 italic">words appear here...</p>
                )}
            </div>
        </div>
    );
};

export default LiveTranscriptPanel;
