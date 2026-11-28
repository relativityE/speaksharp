/**
 * Focus Points — opt-in for meaning-based detection (default-off; `VITE_FOCUS_MEANING_MATCHER_ENABLED`).
 *
 * Renders NOTHING unless the flag is on. When on:
 *   - nothing downloads until the user presses the button; the size quoted comes from the shipped pins;
 *   - pressing records consent (read back) and starts the download with byte-level progress;
 *   - a user who consented earlier gets the model made ready from the browser's verified cache, which never
 *     touches the network for model files (a cache miss simply shows the button again);
 *   - a failure shows a retry.
 *
 * The model runs only after Stop. The live checklist during recording stays keyword-based.
 */
import React, { useEffect } from 'react';
import { isFocusMeaningMatcherEnabled } from '@/config/focusMeaningMatcher';
import { getMeaningMatcher } from '@/services/objective/meaning/MeaningMatcher';
import { useMeaningMatcherStatus } from '@/services/objective/meaning/useMeaningMatcherStatus';
import { MEANING_MODEL_APPROX_MB } from '@/services/objective/meaning/meaningAssetPins';

export const MEANING_OPT_IN_LABEL = `Enable meaning-based detection (about ${MEANING_MODEL_APPROX_MB} MB, one-time download)`;
export const MEANING_READY_COPY = 'Meaning-based detection is ready';

const FocusMeaningOptInControl: React.FC = () => {
    const status = useMeaningMatcherStatus();

    // A previous opt-in on this browser: load from the verified cache only. Never a download.
    // Only on mount: a cache miss returns to `consented`, which must NOT retry in a loop.
    useEffect(() => {
        const matcher = getMeaningMatcher();
        if (matcher.getStatus().kind === 'consented') void matcher.warmFromCache();
    }, []);

    const enable = () => {
        getMeaningMatcher().ensureLoaded().catch(() => {
            // The status already shows the failure and offers a retry.
        });
    };

    return (
        <section
            data-testid="focus-meaning-opt-in"
            aria-label="Meaning-based detection"
            className="mt-3 rounded-2xl border border-neutral-border-strong bg-card p-4"
        >
            {(status.kind === 'absent' || status.kind === 'consented') && (
                <>
                    <button
                        type="button"
                        onClick={enable}
                        data-testid="focus-meaning-enable"
                        className="w-full rounded-lg border-2 border-focus-points px-4 py-2.5 text-[14px] font-bold text-focus-points hover:bg-focus-points-ground"
                    >
                        {MEANING_OPT_IN_LABEL}
                    </button>
                    <p className="mt-2 text-[12px] leading-snug text-neutral-secondary">
                        Checks your points by meaning after you stop, on this device. Nothing downloads until you press this.
                    </p>
                </>
            )}
            {status.kind === 'downloading' && (
                <div role="status" data-testid="focus-meaning-progress">
                    <p className="text-[13px] font-semibold text-neutral-body">
                        {status.fromCache ? 'Loading meaning-based detection…' : 'Downloading meaning-based detection…'} {status.pct}%
                    </p>
                    <div
                        role="progressbar"
                        aria-label="Meaning-based detection download"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={status.pct}
                        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-border-soft"
                    >
                        <div className="h-full bg-focus-points" style={{ width: `${status.pct}%` }} />
                    </div>
                </div>
            )}
            {status.kind === 'ready' && (
                <p role="status" data-testid="focus-meaning-ready" className="text-[13px] font-semibold text-status">
                    {MEANING_READY_COPY}
                </p>
            )}
            {status.kind === 'failed' && (
                <div role="alert" data-testid="focus-meaning-failed">
                    <p className="text-[13px] font-semibold text-state-error">
                        Meaning-based detection couldn&rsquo;t be set up. Your points will be checked by keywords.
                    </p>
                    <button
                        type="button"
                        onClick={enable}
                        data-testid="focus-meaning-retry"
                        className="mt-2 rounded-lg border border-neutral-border-strong px-3 py-1.5 text-[13px] font-bold text-neutral-body hover:bg-neutral-border-soft"
                    >
                        Try again
                    </button>
                </div>
            )}
        </section>
    );
};

/** Flag gate first, so the flag-off render calls no hooks and touches no matcher. */
const FocusMeaningOptIn: React.FC = () => (isFocusMeaningMatcherEnabled() ? <FocusMeaningOptInControl /> : null);

export default FocusMeaningOptIn;
