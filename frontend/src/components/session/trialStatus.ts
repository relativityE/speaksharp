import type { UsageLimitCheck } from '@/hooks/useUsageLimit';
import { PAID_CONTINUATION_UNAVAILABLE } from '@/components/pricing/offerDisclosure';

/**
 * Trial presentation for the practice page, derived ONLY from the server's `check_usage_limit` answer.
 *
 * The countdown reads `trial_seconds_remaining`, which the RPC computes from `trial_expires_at - now()` on the
 * database clock. It never compares `trial_expires_at` with the browser clock: a wrong or changed device clock
 * would otherwise move the number the user plans around. The value refreshes whenever the usage query does
 * (page focus, mount); it is not ticked down locally.
 */

const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

/** At or below this many seconds the countdown takes the stronger "soon" style. */
export const TRIAL_SOON_SECONDS = 3 * SECONDS_PER_DAY;
/** At or below this many seconds the countdown takes the strongest "urgent" style and counts hours. */
export const TRIAL_URGENT_SECONDS = SECONDS_PER_DAY;

export type TrialCountdownTone = 'calm' | 'soon' | 'urgent';

export interface TrialCountdown {
    tone: TrialCountdownTone;
    label: string;
}

type TrialUsage = Pick<UsageLimitCheck, 'can_start' | 'trial_active' | 'trial_seconds_remaining' | 'error'>;

/**
 * The countdown to show, or `null` when there is nothing true to say: no answer yet, not on an active trial
 * (paid accounts report `trial_active: false`), or a remaining value that is missing, non-finite or spent.
 */
export function trialCountdown(usage: TrialUsage | null | undefined): TrialCountdown | null {
    if (!usage || usage.trial_active !== true) return null;
    const seconds = usage.trial_seconds_remaining;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;

    if (seconds <= TRIAL_URGENT_SECONDS) {
        const hours = Math.ceil(seconds / SECONDS_PER_HOUR);
        return {
            tone: 'urgent',
            label: hours <= 1 ? 'Trial ends within the hour' : `Trial ends in ${hours} hours`,
        };
    }

    // Rounded up: 2 days and 1 hour still has part of a third day in it, and "2 days left" would undersell it.
    const days = Math.ceil(seconds / SECONDS_PER_DAY);
    return {
        tone: seconds <= TRIAL_SOON_SECONDS ? 'soon' : 'calm',
        label: `${days} days left in your trial`,
    };
}

/** True only when the server refused recording because the trial has ended (the #1282 fail-closed code). */
export function isTrialExpiredRefusal(usage: TrialUsage | null | undefined): boolean {
    return usage?.can_start === false && usage.error === 'trial_expired';
}

/**
 * Copy for the practice page once the server refuses recording with `trial_expired` (#1282). Exported so tests
 * assert the real strings. The title matches the refusal message `useSessionLifecycle` already shows.
 */
export const TRIAL_ENDED_COPY = Object.freeze({
    title: 'Your 30-day free trial has ended',
    body: 'Recording new sessions is closed on this account. Everything you already saved is still yours.',
    keeps: [
        { key: 'history' as const, label: 'Your saved sessions and their reviews, in Progress' },
        { key: 'export' as const, label: 'PDF export of any saved session, from Progress' },
        { key: 'account' as const, label: 'Your account settings, including deleting your account' },
    ],
    /** Payments open: Pricing shows checkout. */
    continueOpen: 'Continue with Pro to keep recording.',
    /** Payments closed (the fail-closed default): Pricing shows its "not open yet" notice, never a checkout. */
    continueClosed: PAID_CONTINUATION_UNAVAILABLE.title,
    pricingCta: 'See pricing',
});

export type TrialEndedKeep = (typeof TRIAL_ENDED_COPY.keeps)[number]['key'];
