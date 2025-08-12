import React from 'react';

const HighlightedTranscript = ({ transcript, fillerData }) => {
    if (!transcript) return null;

    const fillerWords = Object.keys(fillerData);
    const fillerRegex = new RegExp(`\\b(${fillerWords.join('|')})\\b`, 'gi');
    const parts = transcript.split(fillerRegex);

    return (
        <p className="text-xl leading-relaxed text-foreground">
            {parts.map((part, index) => {
                if (!part) return null;
                const lowerPart = part.toLowerCase();
                const fillerKey = fillerWords.find(key => key.toLowerCase() === lowerPart);
                const fillerInfo = fillerKey ? fillerData[fillerKey] : null;

                return fillerInfo ? (
                    <span key={index} className="px-1 rounded" style={{ backgroundColor: fillerInfo.color, color: '#000' }}>
                        {part}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                );
            })}
        </p>
    );
};


export const TranscriptPanel = ({ transcript, fillerData }) => {
    return (
        <div>
            <div className="mb-4">
                 <h2 className="text-3xl font-bold text-foreground">
                    Live Transcript
                </h2>
                <p className="text-muted-foreground">
                    Your spoken words appear here. Filler words are highlighted.
                </p>
            </div>
            <div className="p-6 rounded-lg bg-card min-h-[10rem] max-h-[60vh] overflow-y-auto transition-all duration-300 ease-in-out border border-border">
                <HighlightedTranscript transcript={transcript} fillerData={fillerData} />
            </div>
        </div>
    );
};
