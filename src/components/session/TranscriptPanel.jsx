import React from 'react';

const HighlightedTranscript = ({ transcript, fillerWords }) => {
    if (!transcript) return null;

    const fillerRegex = new RegExp(`\\b(${fillerWords.join('|')})\\b`, 'gi');
    const parts = transcript.split(fillerRegex);

    return (
        <p className="p" style={{ fontSize: '1.125rem', lineHeight: 1.8, color: 'var(--color-text-primary)' }}>
            {parts.map((part, index) =>
                fillerWords.includes(part.toLowerCase()) ? (
                    <span key={index} style={{ backgroundColor: 'rgba(0, 201, 255, 0.1)', color: 'var(--color-accent)', padding: '2px 4px', borderRadius: '4px' }}>
                        {part}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                )
            )}
        </p>
    );
};


export const TranscriptPanel = ({ transcript, customWords }) => {
    const defaultFillerWords = ['um', 'uh', 'like', 'you know', 'i mean', 'so', 'right'];
    const allFillerWords = [...new Set([...defaultFillerWords, ...customWords.map(w => w.toLowerCase())])];

    return (
        <div style={{ flex: 2 }}>
            <h2 className="h2" style={{ color: 'var(--color-text-primary)', marginBottom: '8px' }}>
                Live Transcript
            </h2>
            <p className="p" style={{ marginBottom: '24px' }}>
                Start speaking and see your words appear here. Filler words will be highlighted.
            </p>
            <div className="card" style={{ minHeight: '60vh', padding: '32px' }}>
                <HighlightedTranscript transcript={transcript} fillerWords={allFillerWords} />
            </div>
        </div>
    );
};
