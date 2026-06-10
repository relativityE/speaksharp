import { describe, expect, it } from 'vitest';
import { getTrialSecondsRemaining, isTrialPrivateSession } from '../trialCountdown';

describe('trialCountdown', () => {
    it('uses trial_expires_at as the canonical wall-clock countdown', () => {
        const nowMs = Date.parse('2026-06-10T12:00:00.000Z');

        expect(getTrialSecondsRemaining({
            trial_active: true,
            trial_expires_at: '2026-06-10T12:09:30.000Z',
            trial_seconds_remaining: 60,
        }, { nowMs, elapsedSecondsFallback: 20 })).toBe(570);
    });

    it('falls back to trial_seconds_remaining minus active elapsed time', () => {
        expect(getTrialSecondsRemaining({
            trial_active: true,
            trial_seconds_remaining: 30,
        }, { elapsedSecondsFallback: 31 })).toBe(0);
    });

    it('returns null when the trial is inactive', () => {
        expect(getTrialSecondsRemaining({
            trial_active: false,
            trial_seconds_remaining: 600,
        })).toBeNull();
    });

    it('scopes trial expiry enforcement to Private trial sessions', () => {
        expect(isTrialPrivateSession({ trial_active: true }, 'private', false)).toBe(true);
        expect(isTrialPrivateSession({ trial_active: true }, 'native', false)).toBe(false);
        expect(isTrialPrivateSession({ trial_active: true }, 'private', true)).toBe(false);
    });
});
