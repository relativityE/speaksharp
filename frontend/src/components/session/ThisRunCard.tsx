import React from 'react';

/**
 * S-13's companion — slot D in `after`: `THIS RUN`, final. A white card, because slot B's ink is the one
 * dark surface per screen and a second would flatten the hierarchy.
 *
 * Three labelled rows — Fillers, Pace (wpm), Words — then the provenance line and the
 * correction path. Each metric keeps the colour it has everywhere else: fillers in the signature family,
 * pace in the status green, words in body ink.
 *
 * **A row renders only when its value exists** (G4). An absent measurement is omitted rather than shown as
 * a zero or an em-dash: a fabricated `0 fillers` is indistinguishable from a genuinely clean run, and that
 * is the flattering lie this page must never tell.
 *
 * **`Counted on device from the transcript.`** is the provenance, stated plainly — these numbers never
 * depended on the network, which is why they survive a failed review.
 */
export interface ThisRunCardProps {
    /** Fillers counted on device, or null when filler evidence is absent rather than zero. */
    fillers: number | null;
    /** Fillers per minute, or null when it cannot be derived truthfully. */
    fillersPerMinute: number | null;
    /** Words per minute, or null when the run is too short to state a rate. */
    wordsPerMinute: number | null;
    /** Words in the finalized transcript. */
    words: number | null;
    /**
     * Opens the correction path for the product's weakest claim (missed fillers). The spec treats this as
     * non-optional; it is optional in this component only because a link that opens nothing is worse than
     * an absent one, so it renders only once an opener exists.
     */
    onCountLookWrong?: () => void;
}

/**
 * #1258 punch list R2-2/R2-3: the unit lives in the label ("Pace (wpm)") and every value is a bare number in one
 * right-aligned column, at the same size and weight. Rows are grid children so labels and values line up.
 */
const Row: React.FC<{ label: string; children: React.ReactNode; testid: string; valueClassName: string }> = ({ label, children, testid, valueClassName }) => (
    <>
        <span className="text-[14px] font-bold text-neutral-secondary">{label}</span>
        <span className={`text-right text-[24px] font-extrabold tracking-[-0.02em] ${valueClassName}`} data-testid={testid}>
            {children}
        </span>
    </>
);

export const ThisRunCard: React.FC<ThisRunCardProps> = ({
    fillers, wordsPerMinute, words, onCountLookWrong,
}) => (
    <section
        className="rounded-[14px] border border-neutral-border-strong bg-white px-5 pb-5 pt-[18px]"
        data-testid="this-run-card"
        aria-label="This run"
    >
        <p className="mb-3.5 text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary">This run</p>

        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-3 [font-variant-numeric:tabular-nums]">
            {fillers !== null && (
                <Row label="Fillers" testid="this-run-card-fillers" valueClassName="text-signature-text">{fillers}</Row>
            )}
            {wordsPerMinute !== null && (
                <Row label="Pace (wpm)" testid="this-run-card-pace" valueClassName="text-neutral-heading">{Math.round(wordsPerMinute)}</Row>
            )}
            {words !== null && (
                <Row label="Words" testid="this-run-card-words" valueClassName="text-neutral-heading">{words}</Row>
            )}
        </div>

        <p className="mt-[15px] border-t border-neutral-border-soft pt-[13px] text-[12px] font-semibold leading-[1.45] text-neutral-muted">
            Counted on device from the transcript.{' '}
            {onCountLookWrong && (
                <button
                    type="button"
                    onClick={onCountLookWrong}
                    className="font-bold text-signature-text underline-offset-2 hover:underline"
                    data-testid="this-run-card-count-wrong"
                >
                    Count look wrong?
                </button>
            )}
        </p>
    </section>
);
