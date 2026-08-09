import React from 'react';

/**
 * #1222 slot B (during) — the live transcript body, rendered as the `children` of the single slot-B
 * `TranscriptCard` (so the card never remounts, spec §1). Text is 19px/1.75 in a `min-height:420px` body.
 *
 * Fillers highlight the INSTANT they land (spec §4): background `#fdf3e2`, a 2px `#d98a1f` bottom border,
 * 3px radius. A 2px orange caret marks the live insertion point. Nothing is scored until Stop.
 */
export interface TranscriptToken {
    text: string;
    /** True when this token is a detected filler ("um", "you know", "like", …). */
    filler?: boolean;
}

export interface LiveTranscriptProps {
    tokens: TranscriptToken[];
    /** Show the live insertion caret (during recording). */
    showCaret?: boolean;
}

export const LiveTranscript: React.FC<LiveTranscriptProps> = ({ tokens, showCaret = true }) => {
    return (
        <div
            data-testid="live-transcript"
            style={{ minHeight: 420, fontSize: 19, lineHeight: 1.75, color: '#1f2733' }}
        >
            {tokens.map((t, i) => (
                <React.Fragment key={i}>
                    {t.filler ? (
                        <mark
                            data-testid="live-filler"
                            style={{
                                backgroundColor: '#fdf3e2',
                                borderBottom: '2px solid #d98a1f',
                                borderRadius: 3,
                                padding: '0 2px',
                                color: '#241503',
                            }}
                        >
                            {t.text}
                        </mark>
                    ) : (
                        <span>{t.text}</span>
                    )}{' '}
                </React.Fragment>
            ))}
            {showCaret && (
                <span
                    aria-hidden="true"
                    data-testid="live-caret"
                    style={{ display: 'inline-block', width: 2, height: '1.1em', verticalAlign: 'text-bottom', backgroundColor: '#d98a1f' }}
                />
            )}
        </div>
    );
};
