import { describe, it, expect } from 'vitest';
import { isTrialExpiredRefusal, trialCountdown, TRIAL_SOON_SECONDS, TRIAL_URGENT_SECONDS } from '../trialStatus';

const DAY = 86_400;
const HOUR = 3_600;
const active = (seconds: unknown) => ({ can_start: true, trial_active: true, trial_seconds_remaining: seconds as number });

describe('trialCountdown — server seconds only', () => {
    it('shows nothing without a server answer, off trial, or for a paid account', () => {
        expect(trialCountdown(undefined)).toBeNull();
        expect(trialCountdown(null)).toBeNull();
        expect(trialCountdown({ can_start: true, trial_active: false, trial_seconds_remaining: 0 })).toBeNull();
        // A paid account: the RPC reports trial_active false even if a stale expiry is still on the row.
        expect(trialCountdown({ can_start: true, trial_active: false, trial_seconds_remaining: 20 * DAY })).toBeNull();
    });

    it('shows nothing for a missing, non-finite, zero or negative remainder', () => {
        for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 0, -5, '86400']) {
            expect(trialCountdown(active(bad))).toBeNull();
        }
    });

    it('counts whole days, rounding up, in the calm tone for most of the trial', () => {
        expect(trialCountdown(active(30 * DAY))).toEqual({ tone: 'calm', label: '30 days left in your trial' });
        expect(trialCountdown(active(12 * DAY + 1))).toEqual({ tone: 'calm', label: '13 days left in your trial' });
        expect(trialCountdown(active(TRIAL_SOON_SECONDS + 1))).toEqual({ tone: 'calm', label: '4 days left in your trial' });
    });

    it('takes the stronger tone from three days out', () => {
        expect(trialCountdown(active(TRIAL_SOON_SECONDS))).toEqual({ tone: 'soon', label: '3 days left in your trial' });
        expect(trialCountdown(active(2 * DAY + HOUR))).toEqual({ tone: 'soon', label: '3 days left in your trial' });
        expect(trialCountdown(active(TRIAL_URGENT_SECONDS + 1))).toEqual({ tone: 'soon', label: '2 days left in your trial' });
    });

    it('counts hours in the urgent tone inside the last 24 hours', () => {
        expect(trialCountdown(active(TRIAL_URGENT_SECONDS))).toEqual({ tone: 'urgent', label: 'Trial ends in 24 hours' });
        expect(trialCountdown(active(5 * HOUR + 1))).toEqual({ tone: 'urgent', label: 'Trial ends in 6 hours' });
        expect(trialCountdown(active(HOUR + 1))).toEqual({ tone: 'urgent', label: 'Trial ends in 2 hours' });
        expect(trialCountdown(active(HOUR))).toEqual({ tone: 'urgent', label: 'Trial ends within the hour' });
        expect(trialCountdown(active(1))).toEqual({ tone: 'urgent', label: 'Trial ends within the hour' });
    });

    it('never reads the expiry timestamp, so a wrong device clock cannot move the number', () => {
        const usage = { ...active(10 * DAY), trial_expires_at: '1999-01-01T00:00:00Z' };
        expect(trialCountdown(usage)).toEqual({ tone: 'calm', label: '10 days left in your trial' });
    });
});

describe('isTrialExpiredRefusal', () => {
    it('is true only for the server refusal code trial_expired', () => {
        expect(isTrialExpiredRefusal({ can_start: false, error: 'trial_expired' })).toBe(true);
        expect(isTrialExpiredRefusal({ can_start: false, error: 'profile_not_found' })).toBe(false);
        expect(isTrialExpiredRefusal({ can_start: false })).toBe(false);
        // A start that is allowed is never an ended trial, whatever the error field says.
        expect(isTrialExpiredRefusal({ can_start: true, error: 'trial_expired' })).toBe(false);
        expect(isTrialExpiredRefusal(undefined)).toBe(false);
        expect(isTrialExpiredRefusal(null)).toBe(false);
    });
});
