import React, { useEffect, useState } from 'react';
import { loadSavedFocusPointsCoverage, type SavedFocusPointsCoverage as Coverage } from '@/services/objective/savedFocusPointsCoverage';
import { fmtDuration } from '@/utils/focusPace';
import { PRODUCT_NAMES } from '@/constants/productNames';

/**
 * #1258 / #1407 — the saved Focus Points result on the Analytics session detail.
 *
 * Shows exactly what the save persisted: each point the person entered, whether it was detected (and when), and the
 * detected total. Words, not colour alone, carry every state. The wording matches the live rail so the review and
 * Analytics never describe the same take differently. Renders nothing for an Open Mic session.
 */
export const SavedFocusPointsCoverage: React.FC<{ sessionId: string }> = ({ sessionId }) => {
    const [coverage, setCoverage] = useState<Coverage | null>(null);

    useEffect(() => {
        let active = true;
        setCoverage(null);
        void loadSavedFocusPointsCoverage(sessionId).then((result) => { if (active) setCoverage(result); });
        return () => { active = false; };
    }, [sessionId]);

    if (coverage === null || coverage.kind === 'none') return null;

    if (coverage.kind === 'error') {
        return (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="saved-focus-points-error" role="status">
                {PRODUCT_NAMES.objective} results for this session couldn’t be loaded. Reload to try again.
            </p>
        );
    }

    return (
        <section className="mt-4 rounded-lg border border-[hsl(var(--border))] p-4" data-testid="saved-focus-points" aria-label={`${PRODUCT_NAMES.objective} results`}>
            <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-sm font-extrabold text-neutral-body">{PRODUCT_NAMES.objective}</h4>
                <p className="text-sm font-bold text-neutral-secondary" data-testid="saved-coverage-total">
                    {coverage.detected}/{coverage.total} points detected
                </p>
            </div>
            <ol className="mt-3 space-y-2.5">
                {coverage.points.map((point, i) => {
                    const covered = point.status === 'detected';
                    const missing = point.status === 'not_detected';
                    return (
                        <li
                            key={i}
                            data-testid={`focus-point-${i}`}
                            data-status={covered ? 'covered' : missing ? 'missing' : 'pending'}
                            className="text-sm leading-snug"
                        >
                            <p className="text-neutral-body">{point.label}</p>
                            <p className={`mt-0.5 text-[12px] font-semibold ${covered ? 'text-status' : 'text-signature-text'}`}>
                                {covered
                                    ? `Detected${point.detectedAtSeconds !== null ? ` at ${fmtDuration(point.detectedAtSeconds)}` : ''}`
                                    : missing ? 'Not detected' : 'Not evaluated'}
                            </p>
                            {missing && (
                                <p className="mt-1 text-[13px] leading-snug text-signature-text">
                                    We couldn’t detect this point in the transcript. You may have covered it in different words.
                                </p>
                            )}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
};

export default SavedFocusPointsCoverage;
