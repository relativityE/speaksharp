/**
 * #1258 (Rev 2 §4.2; PO 2026-10-09) — a reopened session that has no saved review gets the §2 failed band with an
 * EXPLICIT Try again. Nothing is requested on re-entry: only the press mounts `AISuggestions`, which then makes its one
 * request for this saved session id and shows its own result or failure band. This press is the ONE allowed exception
 * to "only the post-Stop review requests coaching", and only for a saved session with no coaching.
 *
 * The coaching function reads the transcript server-side, so a retry is real only while the session keeps it. When it
 * doesn't (transcript retention), the band is terminal — "Review isn't available for this session" — with no button,
 * never a fake retry. A transcript that expires between render and press still ends terminal: the function answers 409
 * and `AISuggestions` shows its no-transcript message.
 *
 * #1835 — a Retry is a fresh coaching request, so it needs the owner's own recorded choice to allow coaching. An existing
 * user who opens a saved session from History before visiting Practice has no recorded choice: the saved data stays
 * readable, but no Try again is offered and nothing is requested. The press re-checks the choice, too.
 */
import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import AISuggestions, { COACHING_OFF_SAVE_OFF, COACHING_OFF_SAVE_ON } from './AISuggestions';
import { coachingAllowed, transcriptSaveAllowed, usePracticePrivacyStore } from '@/services/practicePrivacy';
import { NOT_AVAILABLE_FOR_SESSION_MESSAGE, UNAVAILABLE_MESSAGE } from './reviewCopy';
import { CoachingDisclosure } from './CoachingDisclosure';
import type { SessionProduct } from '@/types/session';

interface RestoredReviewRetryProps {
    sessionId: string;
    product: SessionProduct | null;
    sessionLabel?: string | null;
    /** The saved row says its transcript is still kept (`resolveTranscriptView(...).kind === 'available'`). */
    transcriptAvailable: boolean;
    /** The saved review's own "Practice again?" action, kept before and after Try again (#1577 Codex P2 4235188535). */
    action?: React.ReactNode;
    /** #1577 Codex P2 4236200867: the session's results are verified ready for coaching (Focus: its saved point set read). */
    resultsReady?: boolean;
}

export const RestoredReviewRetry: React.FC<RestoredReviewRetryProps> = ({ sessionId, product, sessionLabel, transcriptAvailable, action, resultsReady = true }) => {
    const [requested, setRequested] = useState(false);
    const privacy = usePracticePrivacyStore();
    const coachingOn = coachingAllowed(privacy);
    const privacySettled = privacy.status !== 'loading';
    // #1577 Codex P2 4235535994: with no resolved product the coaching function answers product_unknown, so a retry could
    // never generate coaching. Terminal: no button, no claimed send, no request.
    // #1577 Codex P2 4236200867: a Focus take without saved point results is refused (425) on every request: terminal too.
    const retryable = transcriptAvailable && product !== null && resultsReady;
    const canRetry = retryable && coachingOn;
    // #1835: the owner's choice does not allow coaching (unknown, declined or unreadable). Not a retry, not "unavailable".
    const coachingOff = retryable && privacySettled && !coachingOn;
    if (requested) {
        // #1577 Codex P2 4235535990: AISuggestions has no ground of its own; loading, failure and success all stay on the
        // same ink review surface, with the practice action.
        return (
            <section className="rounded-2xl bg-ink p-6" data-testid="restored-review-requested" aria-label="Practice Loop review">
                <AISuggestions canReview sessionId={sessionId} product={product ?? undefined} sessionLabel={sessionLabel ?? null} />
                {action}
            </section>
        );
    }
    return (
        <section className="rounded-2xl bg-ink p-6" data-testid="restored-review-retry"
            data-retry={canRetry ? 'available' : coachingOff ? 'coaching_off' : retryable ? 'checking' : 'unavailable'} aria-label="Practice Loop review">
            <h2 className="mb-4 inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">
                <Sparkles className="h-[15px] w-[15px]" aria-hidden="true" />
                Practice Loop review
            </h2>
            {canRetry ? (
                <>
                    <p className="max-w-[560px] text-[17px] font-bold leading-snug text-ink-text">{UNAVAILABLE_MESSAGE}</p>
                    <button
                        type="button"
                        onClick={() => { if (coachingAllowed()) setRequested(true); }}
                        className="mt-3.5 inline-flex h-10 items-center rounded-lg border border-ink-muted px-4 text-[14px] font-extrabold text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                        data-testid="restored-review-retry-button"
                    >
                        Try again
                    </button>
                    <p className="mt-2 text-[12px] font-semibold text-ink-muted">
                        <CoachingDisclosure product={product} />
                    </p>
                </>
            ) : coachingOff ? (
                <div data-testid="restored-review-coaching-off">
                    <p className="max-w-[560px] text-[17px] font-bold leading-snug text-ink-text">
                        {transcriptSaveAllowed(privacy) ? COACHING_OFF_SAVE_ON : COACHING_OFF_SAVE_OFF}
                    </p>
                    <a
                        href="/account#privacy-data"
                        className="mt-3.5 inline-flex min-h-[44px] items-center rounded-lg border border-ink-hairline px-4 text-[14px] font-extrabold text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                        data-testid="restored-review-privacy-link"
                    >
                        {transcriptSaveAllowed(privacy) ? 'Turn on AI coaching' : 'Change in Privacy & data'}
                    </a>
                </div>
            ) : retryable ? (
                // This owner's choice is still being read: nothing is offered or requested until it is.
                <p className="max-w-[560px] text-[17px] font-bold leading-snug text-ink-text" data-testid="restored-review-checking">
                    {UNAVAILABLE_MESSAGE}
                </p>
            ) : (
                <p className="max-w-[560px] text-[17px] font-bold leading-snug text-ink-text" data-testid="restored-review-not-available">
                    {NOT_AVAILABLE_FOR_SESSION_MESSAGE}
                </p>
            )}
            {action}
        </section>
    );
};
