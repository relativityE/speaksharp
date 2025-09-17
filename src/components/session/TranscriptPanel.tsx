import React, { useEffect, useRef } from 'react';
import { InitialStatePanel, ErrorStatePanel, LoadingStatePanel } from './StatefulPanel';
import { MicOff } from 'lucide-react';
import type { FillerCounts } from '@/utils/fillerWordUtils';

// --- Prop and Type Interfaces ---

interface Chunk {
  id: number;
  text: string;
}

interface ChunkProps {
  chunk: string;
  fillerData: FillerCounts;
}

interface HighlightedTranscriptProps {
  chunks: Chunk[];
  interimTranscript: string;
  fillerData: FillerCounts;
}

interface TranscriptPanelProps {
  chunks?: Chunk[];
  interimTranscript?: string;
  fillerData?: FillerCounts;
  isLoading?: boolean;
  isListening?: boolean;
  isReady?: boolean;
  error?: Error | null;
}

// --- Sub-components ---

const EmptyStatePanel: React.FC = () => (
    <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
            <MicOff className="w-12 h-12 mx-auto mb-4" />
            <p className="text-lg font-semibold">Session Complete</p>
            <p>No speech was detected during the session.</p>
        </div>
    </div>
);

const ChunkComponent: React.FC<ChunkProps> = ({ chunk, fillerData }) => {
    const fillerWords = Object.keys(fillerData);
    if (fillerWords.length === 0) {
        return <span>{chunk}</span>;
    }
    const fillerRegex = new RegExp(`\\b(${fillerWords.join('|')})\\b`, 'gi');
    const parts = chunk.split(fillerRegex);

    return (
        <>
            {parts.map((part, index) => {
                if (!part) return null;
                const lowerPart = part.toLowerCase();
                const fillerKey = fillerWords.find(key => key.toLowerCase() === lowerPart);
                const fillerInfo = fillerKey ? fillerData[fillerKey] : null;

                return fillerInfo ? (
                    <strong key={index} className="px-1 rounded" style={{ backgroundColor: fillerInfo.color, color: 'black' }} data-testid="highlighted-word">
                        {part}
                    </strong>
                ) : (
                    <span key={index}>{part}</span>
                );
            })}
        </>
    );
};

const MemoizedChunk = React.memo(ChunkComponent);

const HighlightedTranscript: React.FC<HighlightedTranscriptProps> = ({ chunks, interimTranscript, fillerData }) => {
    return (
        <p className="text-lg leading-relaxed text-foreground" data-testid="transcript-container">
            {chunks.map((chunk, index) => (
                <React.Fragment key={chunk.id}>
                    <MemoizedChunk chunk={chunk.text} fillerData={fillerData} />
                    {index < chunks.length - 1 && ' '}
                </React.Fragment>
            ))}
            {interimTranscript && <span className="text-muted-foreground">{interimTranscript ? ` ${interimTranscript}` : ''}</span>}
        </p>
    );
};

// --- Main Component ---

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    chunks = [],
    interimTranscript = '',
    fillerData = {},
    isLoading = false,
    isListening = false,
    isReady = false,
    error = null
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hasEverListened = useRef(false);

    if (isListening) {
        hasEverListened.current = true;
    }

    useEffect(() => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
            if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
            }
        }, 100);
        return () => {
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, [chunks, interimTranscript]);

    const showWaitingMessage = isListening && isReady && !chunks.length && !interimTranscript;
    const showEmptyState = hasEverListened.current && !isListening && !isLoading && !error && chunks.length === 0;

    const renderContent = () => {
        if (error) return <ErrorStatePanel error={error} />;
        if (isLoading) return <LoadingStatePanel />;
        if (showEmptyState) return <EmptyStatePanel />;
        if (!isListening && !hasEverListened.current) return <InitialStatePanel />;
        if (showWaitingMessage) {
            return (
                <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-lg text-muted-foreground animate-pulse">Listening...</p>
                </div>
            );
        }
        return <HighlightedTranscript chunks={chunks} interimTranscript={interimTranscript} fillerData={fillerData} />;
    };

    return (
        <div data-testid="transcript-panel">
            <div className="mb-4">
                <h2 className="text-2xl font-bold text-foreground">Live Transcript</h2>
                <p className="text-base text-muted-foreground">
                    Your spoken words appear here. Filler words are highlighted.
                </p>
            </div>
            <div ref={scrollContainerRef} className="relative p-6 rounded-lg bg-secondary/30 border border-border/50 h-[18rem] overflow-y-auto transition-all duration-300 ease-in-out">
                {renderContent()}
            </div>
        </div>
    );
};
