import React from 'react';

/**
 * #1222 slot B — the transcript body, rendered as the `children` of the single slot-B `TranscriptCard`
 * (so the card never remounts across states, spec §1). Text is 19px/1.75 in a `min-height:420px` body.
 *
 * during (§4): fillers highlight the INSTANT they land (background `#fdf3e2`, 2px `#d98a1f` bottom border,
 * 3px radius); a 2px orange caret marks the live insertion point.
 * after  (§5): the SAME body, now seekable — clicking a highlighted filler jumps playback to it. Pass
 * `onFillerSeek` to turn fillers into seek buttons and drop the caret.
 */
export interface TranscriptToken {
    text: string;
    /** True when this token is a detected filler ("um", "you know", "like", …). */
    filler?: boolean;
    /** after: playback position of this filler, seconds — used by onFillerSeek. */
    seekSeconds?: number;
}

export interface LiveTranscriptProps {
    tokens: TranscriptToken[];
    /** Show the live insertion caret (during recording). Ignored when seekable. */
    showCaret?: boolean;
    /** after: makes fillers clickable seek targets; receives (token, index). */
    onFillerSeek?: (token: TranscriptToken, index: number) => void;
}

const fillerStyle: React.CSSProperties = {
    backgroundColor: '#fdf3e2',
    borderBottom: '2px solid #d98a1f',
    borderRadius: 3,
    padding: '0 2px',
    color: '#241503',
};

export const LiveTranscript: React.FC<LiveTranscriptProps> = ({ tokens, showCaret = true, onFillerSeek }) => {
    const seekable = typeof onFillerSeek === 'function';

    return (
        <div
            data-testid="live-transcript"
            style={{ minHeight: 420, fontSize: 19, lineHeight: 1.75, color: '#1f2733' }}
        >
            {tokens.map((t, i) => (
                <React.Fragment key={i}>
                    {t.filler ? (
                        seekable ? (
                            <button
                                type="button"
                                data-testid="live-filler"
                                onClick={() => onFillerSeek?.(t, i)}
                                aria-label={`Play from "${t.text}"`}
                                style={{ ...fillerStyle, cursor: 'pointer', border: 0, borderBottom: '2px solid #d98a1f', font: 'inherit' }}
                            >
                                {t.text}
                            </button>
                        ) : (
                            <mark data-testid="live-filler" style={fillerStyle}>{t.text}</mark>
                        )
                    ) : (
                        <span>{t.text}</span>
                    )}{' '}
                </React.Fragment>
            ))}
            {showCaret && !seekable && (
                <span
                    aria-hidden="true"
                    data-testid="live-caret"
                    style={{ display: 'inline-block', width: 2, height: '1.1em', verticalAlign: 'text-bottom', backgroundColor: '#d98a1f' }}
                />
            )}
        </div>
    );
};
