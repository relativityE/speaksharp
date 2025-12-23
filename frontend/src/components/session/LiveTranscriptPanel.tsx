import React from 'react';
import { TEST_IDS } from '@/constants/testIds';

interface LiveTranscriptPanelProps {
    transcript: string;
    isListening: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
}

/**
 * Presentational component for the live transcript display.
 * Extracted from SessionPage for better reusability and testability.
 */
export const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
    transcript,
    isListening,
    containerRef,
}) => {
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
                className="h-[250px] overflow-y-auto p-4 rounded-lg bg-background/50 border border-white/10 scroll-smooth"
                data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                aria-live="polite"
                aria-label="Live transcript of your speech"
                role="log"
            >
                {isListening && (!transcript || transcript.trim() === '') ? (
                    <p className="text-muted-foreground italic animate-pulse">Listening...</p>
                ) : transcript && transcript.trim() !== '' ? (
                    <p className="text-white leading-relaxed">{transcript}</p>
                ) : (
                    <p className="text-white/60 italic">words appear here...</p>
                )}
            </div>
        </div>
    );
};

export default LiveTranscriptPanel;
