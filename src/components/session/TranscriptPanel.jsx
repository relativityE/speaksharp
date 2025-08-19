import React, { useEffect, useRef } from 'react';

const Chunk = ({ chunk, fillerData }) => {
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
                    <span key={index} className="px-1 rounded font-semibold" style={{ backgroundColor: fillerInfo.color, color: 'black' }}>
                        {part}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                );
            })}
        </>
    );
}

const MemoizedChunk = React.memo(Chunk);

const HighlightedTranscript = ({ chunks, interimTranscript, fillerData }) => {
    return (
        <p className="text-lg leading-relaxed text-foreground">
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

export const TranscriptPanel = ({ chunks = [], interimTranscript, fillerData }) => {
    const scrollContainerRef = useRef(null);

    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [chunks, interimTranscript]);

    return (
        <div>
            <div className="mb-4">
                 <h2 className="text-2xl font-bold text-foreground">
                    Live Transcript
                </h2>
                <p className="text-base text-muted-foreground">
                    Your spoken words appear here. Filler words are highlighted.
                </p>
            </div>
            <div ref={scrollContainerRef} className="p-6 rounded-lg bg-secondary/30 border border-border/50 h-[18rem] overflow-y-auto transition-all duration-300 ease-in-out">
                <HighlightedTranscript chunks={chunks} interimTranscript={interimTranscript} fillerData={fillerData} />
            </div>
        </div>
    );
};
