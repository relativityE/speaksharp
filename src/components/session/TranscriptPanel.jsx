import React from 'react';

const HighlightedTranscript = ({ transcript, fillerWords }) => {
    if (!transcript) return null;

    // A more robust regex to handle different cases and word boundaries
    const fillerRegex = new RegExp(`\\b(${fillerWords.join('|')})\\b`, 'gi');
    const parts = transcript.split(fillerRegex);

    return (
        <p className="text-xl leading-relaxed text-light-text">
            {parts.map((part, index) => {
                const isFiller = fillerWords.includes(part.toLowerCase());
                return isFiller ? (
                    <span key={index} className="px-1 rounded bg-highlight-yellow/20 text-highlight-yellow">
                        {part}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                );
            })}
        </p>
    );
};


export const TranscriptPanel = ({ transcript, customWords }) => {
    // This list should ideally come from a config file
    const defaultFillerWords = ['um', 'uh', 'like', 'you know', 'so', 'actually', 'i mean', 'right'];
    const allFillerWords = [...new Set([...defaultFillerWords, ...customWords.map(w => w.toLowerCase())])];

    return (
        <div className="flex-[2]">
            <div className="mb-6">
                 <h2 className="text-3xl font-bold text-light-text">
                    Live Transcript
                </h2>
                <p className="text-muted-text">
                    Speak and see your words appear here. Filler words will be highlighted in yellow.
                </p>
            </div>
            <div className="p-8 rounded-lg bg-card-bg min-h-[60vh]">
                <HighlightedTranscript transcript={transcript} fillerWords={allFillerWords} />
            </div>
        </div>
    );
};
