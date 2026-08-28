import React from 'react';
import { Button } from '@/components/ui/button';

export type PendingResolutionKind = 'initial_save' | 'full_save' | 'attribution' | null;

/**
 * Discard confirmations. Exported so tests assert the real strings.
 *
 * TWO of them, because the destructive action removes different things in different states and a
 * confirmation that names the wrong one is asking for consent the user did not give. The transcript
 * wording may be used ONLY when transcript TEXT is actually present.
 */
export const DISCARD_CONFIRMATION_COPY =
    'Permanently discard this unsaved recording? Its recoverable transcript will be removed. This cannot be undone.';

/** #1360 — metrics-only: there is no transcript to remove, so the confirmation must not claim one. */
export const DISCARD_CONFIRMATION_COPY_METRICS_ONLY =
    'Permanently discard this unsaved recording? Its saved measurements will be removed. No transcript was stored. This cannot be undone.';

export interface UnresolvedRecoveryBannerProps {
    /** Authoritative resolution state published by the controller. `null` renders nothing. */
    pendingResolutionKind: PendingResolutionKind;
    /**
     * TRUE only when TRANSCRIPT TEXT is actually present — the live transcript still on the page.
     *
     * #1360: this used to be a single `hasRecoverableWords` that was ALSO true when a content-free
     * recovery draft happened to carry a numeric `totalWords`. The banner then told the user "Your
     * words are still here" when no words were stored anywhere — a count of words is not words.
     */
    hasTranscriptText: boolean;
    /**
     * TRUE when only NUMERIC measurements survived. Never licenses transcript wording; it only lets the
     * banner say, accurately, that measurements are on the device.
     */
    hasMeasurementsOnly: boolean;
    /** Retries the operation that actually failed. Resolves false when it failed again. */
    onRetry: () => Promise<boolean>;
    /** Confirmed discard. `retryable` means persistence could NOT be reconciled — not a clean discard. */
    onDiscard: () => Promise<{ outcome: 'discarded' | 'retryable' }>;
}

/**
 * #1033 Part-2b (A3/A4) — the single recovery surface for an unresolved recording.
 *
 * #1360 — a second invariant, learned the same way as the first: EVERY claim this banner makes must be
 * true of the state it is in. "Your words are still here" was shown whenever a numeric word COUNT
 * survived on a content-free draft, and the discard confirmation promised to remove "its recoverable
 * transcript" in a state where no transcript was ever stored. A count of words is not words.
 *
 * The critical invariant: an `attribution` failure means the transcript IS persisted and only its
 * producing-engine verification failed. In that state the destructive discard control must be
 * STRUCTURALLY ABSENT — not disabled, not visually hidden, not relabelled — so it can never be
 * rendered, focused, or invoked to "resolve" a metadata problem. The retry action reuses the same
 * controller primitive, but its label and status describe VERIFICATION, never saving.
 */
export const UnresolvedRecoveryBanner: React.FC<UnresolvedRecoveryBannerProps> = ({
    pendingResolutionKind,
    hasTranscriptText,
    hasMeasurementsOnly,
    onRetry,
    onDiscard,
}) => {
    const [confirmDiscard, setConfirmDiscard] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    // Guards against a second submission even if a click lands before React re-renders the disabled state.
    const inFlight = React.useRef(false);

    if (!pendingResolutionKind) return null;

    const isAttributionOnly = pendingResolutionKind === 'attribution';
    // A claim about WORDS requires words. A claim about measurements requires only measurements.
    const recoverableSuffix = hasTranscriptText
        ? ' Your words are still here.'
        : hasMeasurementsOnly
            ? ' Your measurements from this session are still on this device.'
            : '';
    const discardCopy = hasTranscriptText
        ? DISCARD_CONFIRMATION_COPY
        : DISCARD_CONFIRMATION_COPY_METRICS_ONLY;

    const message = busy
        ? 'Working…'
        : error
            ? error
            : isAttributionOnly
                ? 'Your transcript was saved. We could not verify which transcription method produced it.'
                : pendingResolutionKind === 'full_save'
                    ? `Your last recording was not fully saved.${recoverableSuffix}`
                    : `Your last recording has not been saved yet.${recoverableSuffix}`;

    const run = (op: 'retry' | 'discard') => {
        if (inFlight.current) return;
        inFlight.current = true;
        setError(null);
        setBusy(true);
        const done = () => { inFlight.current = false; setBusy(false); };
        if (op === 'retry') {
            void onRetry()
                .then((ok) => {
                    if (!ok) {
                        setError(isAttributionOnly
                            ? 'Verification failed again. You can retry.'
                            : 'Saving failed again. You can retry.');
                    }
                })
                .catch(() => setError('Something went wrong. You can retry.'))
                .finally(done);
            return;
        }
        void onDiscard()
            .then((res) => {
                // Honest: a row we could not mark failed is NOT a clean discard.
                if (res?.outcome !== 'discarded') {
                    setError('We could not discard it cleanly. Your recording was kept — you can retry.');
                } else {
                    setConfirmDiscard(false);
                }
            })
            .catch(() => setError('We could not discard it cleanly. Your recording was kept — you can retry.'))
            .finally(done);
    };

    return (
        <div
            className="mt-3 flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
            data-testid="session-unresolved-recovery"
            data-resolution={pendingResolutionKind}
            role="status"
            aria-live="polite"
        >
            <span className="font-medium text-foreground/80" data-testid="session-unresolved-message">
                {message}
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    data-testid={isAttributionOnly ? 'session-retry-verification' : 'session-retry-save'}
                    onClick={() => run('retry')}
                >
                    {isAttributionOnly ? 'Retry verification' : 'Retry Save'}
                </Button>

                {/* Attribution-only: the transcript IS saved, so no discard affordance exists at all. */}
                {isAttributionOnly ? null : confirmDiscard ? (
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        data-testid="session-discard-confirm"
                        onClick={() => run('discard')}
                    >
                        {discardCopy}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        data-testid="session-discard"
                        onClick={() => setConfirmDiscard(true)}
                    >
                        Discard…
                    </Button>
                )}
            </div>
        </div>
    );
};
