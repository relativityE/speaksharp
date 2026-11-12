// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    attemptTimeoutMs, canAdmitAttempt, planNextAttempt,
    PROVIDER_BUDGET_MS, PROVIDER_ATTEMPT_CAP_MS, MIN_ATTEMPT_MS, MAX_PROVIDER_ATTEMPTS,
} from '../../backend/supabase/functions/get-ai-suggestions/providerRetry';

describe('coaching attempt cap inside the shared provider budget', () => {
    it('allows 15 s per attempt while retaining the 45 s budget and retry limits', () => {
        expect(PROVIDER_ATTEMPT_CAP_MS).toBe(15_000);
        expect(PROVIDER_BUDGET_MS).toBe(45_000);
        expect(MIN_ATTEMPT_MS).toBe(10_000);
        expect(MAX_PROVIDER_ATTEMPTS).toBe(3);
    });

    it.each([[0, 15_000], [10_000, 15_000], [20_500, 15_000], [31_500, 13_500], [35_000, 10_000], [35_001, 9_999], [45_000, 0], [46_000, 0]])(
        'caps an attempt after %i ms at %i ms', (elapsed, expected) => {
            expect(attemptTimeoutMs(elapsed)).toBe(expected);
        },
    );

    it('shortens the third timeout after two 15 s timeouts and jitter to the shared budget', () => {
        expect(planNextAttempt({ attemptsDone: 1, elapsedMs: 15_000, retryAfter: { kind: 'absent' }, random: 0.5 }))
            .toEqual({ kind: 'wait', ms: 500, source: 'jitter' });
        expect(planNextAttempt({ attemptsDone: 2, elapsedMs: 30_500, retryAfter: { kind: 'absent' }, random: 0.5 }))
            .toEqual({ kind: 'wait', ms: 1000, source: 'jitter' });
        expect(canAdmitAttempt(31_500)).toBe(true);
        expect(attemptTimeoutMs(31_500)).toBe(13_500);
        expect(planNextAttempt({ attemptsDone: 3, elapsedMs: 45_000, retryAfter: { kind: 'absent' }, random: 0.5 }))
            .toEqual({ kind: 'stop', why: 'attempt_cap' });
    });

    it('still refuses positive backoff when only the minimum retry window remains', () => {
        expect(planNextAttempt({ attemptsDone: 1, elapsedMs: 35_000, retryAfter: { kind: 'absent' }, random: 0.5 }))
            .toEqual({ kind: 'stop', why: 'budget' });
        expect(planNextAttempt({ attemptsDone: 1, elapsedMs: 35_000, retryAfter: { kind: 'valid', ms: 1000 }, random: 0 }))
            .toEqual({ kind: 'stop', why: 'retry_after_over_budget' });
    });

    it('admits only an exact zero-delay retry at the boundary, with a fresh clock check', () => {
        expect(planNextAttempt({ attemptsDone: 1, elapsedMs: 35_000, retryAfter: { kind: 'absent' }, random: 0 }))
            .toEqual({ kind: 'wait', ms: 0, source: 'jitter' });
        expect(canAdmitAttempt(35_000)).toBe(true);
        expect(canAdmitAttempt(35_001)).toBe(false);
        expect(canAdmitAttempt(45_000)).toBe(false);
    });
});
