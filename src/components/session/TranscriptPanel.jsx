import React from 'react';

const HighlightedTranscriptComponent = ({ transcript, fillerWords }) => {
    if (!transcript) return null;

    const fillerRegex = new RegExp(`\\b(${fillerWords.join('|')})\\b`, 'gi');
    const parts = transcript.split(fillerRegex);

    return (
        <p className="text-xl leading-relaxed text-foreground">
            {parts.map((part, index) => {
                const isFiller = fillerWords.some(word => new RegExp(`^${word}$`, 'i').test(part));
                return isFiller ? (
                    <span key={index} className="px-1 rounded bg-highlight text-highlight-foreground">
                        {part}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                );
            })}
        </p>
    );
};
export const HighlightedTranscript = React.memo(HighlightedTranscriptComponent);


const TranscriptPanelComponent = ({ transcript, customWords }) => {
    const defaultFillerWords = ['um', 'uh', 'like', 'you know', 'so', 'actually', 'i mean', 'right'];
    const allFillerWords = [...new Set([...defaultFillerWords, ...customWords.map(w => w.toLowerCase())])];

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
            <div className="p-6 rounded-lg bg-card min-h-[60vh] border border-border">
                <HighlightedTranscript transcript={transcript} fillerWords={allFillerWords} />
            </div>
        </div>
    );
};
export const TranscriptPanel = React.memo(TranscriptPanelComponent);
