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
    /**
     * #1231 R1: this token is in the live-updating tail — the model may still revise it. Rendered muted so
     * the user sees the "still deciding" edge settle into solid body text; live re-writes read as intended.
     */
    interim?: boolean;
    /** after: playback position of this filler, seconds — used by onFillerSeek. */
    seekSeconds?: number;
    /**
     * #1046 Focus Points: this token is inside a covering phrase. Highlighted for COVERAGE, not disfluency
     * — purple during, green after (see `coverageMode`). Orange stays reserved for the mic and fillers, so
     * a coverage token never renders as a filler.
     */
    covered?: boolean;
}

export interface LiveTranscriptProps {
    tokens: TranscriptToken[];
    /** Show the live insertion caret (during recording). Ignored when seekable. */
    showCaret?: boolean;
    /** after: makes fillers clickable seek targets; receives (token, index). */
    onFillerSeek?: (token: TranscriptToken, index: number) => void;
    /**
     * #1046 Focus Points: when set, `covered` tokens highlight as coverage (purple `during` / green
     * `after`) instead of fillers being highlighted at all.
     */
    coverageMode?: 'during' | 'after';
}

const fillerStyle: React.CSSProperties = {
    backgroundColor: '#fdf3e2',
    borderBottom: '2px solid #d98a1f',
    borderRadius: 3,
    padding: '0 2px',
    color: '#241503',
};

const coverageStyle = (mode: 'during' | 'after'): React.CSSProperties => ({
    backgroundColor: mode === 'during' ? '#f5f0ff' : '#e7f4ed',
    borderBottom: `2px solid ${mode === 'during' ? '#6d28d9' : '#1f9d6b'}`,
    borderRadius: 3,
    padding: '0 2px',
});

export const LiveTranscript: React.FC<LiveTranscriptProps> = ({ tokens, showCaret = true, onFillerSeek, coverageMode }) => {
    const seekable = typeof onFillerSeek === 'function';

    return (
        <div
            data-testid="live-transcript"
            style={{ minHeight: 420, fontSize: 19, lineHeight: 1.75, color: '#1f2733' }}
        >
            {tokens.map((t, i) => (
                <React.Fragment key={i}>
                    {coverageMode && t.covered ? (
                        <mark data-testid="coverage-span" style={coverageStyle(coverageMode)}>{t.text}</mark>
                    ) : t.filler ? (
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
                        // #1231 R1: the live-updating tail renders muted (settling) → solid once locked in.
                        <span
                            data-testid={t.interim ? 'live-interim' : undefined}
                            style={t.interim ? { color: '#8a94a6' } : undefined}
                        >
                            {t.text}
                        </span>
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
