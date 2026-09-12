import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useJourneyBoundary, isProductRoute } from '../useJourneyBoundary';
import { currentJourneyId, currentAttemptSeq, beginRecordingAttempt, __resetJourneyIdentityForTests } from '@/services/telemetry/journeyIdentity';

beforeEach(() => { __resetJourneyIdentityForTests(); });

describe('#1259 — a journey begins where the user enters a product', () => {
    it('CASUALTY: re-entering a product starts a NEW journey', () => {
        // `beginJourney` had no production caller; only tests invoked it. One lazily minted journey
        // therefore covered every visit for the life of the tab, so two separate visits shared a
        // `journey_id` while `attempt_seq` kept counting across them.
        const { rerender } = renderHook(({ path }) => useJourneyBoundary(path), {
            initialProps: { path: '/session' },
        });
        const first = currentJourneyId();
        beginRecordingAttempt();
        expect(currentAttemptSeq()).toBe(1);

        // Leave the product entirely...
        rerender({ path: '/' });
        // ...and come back. This is a different visit and must not share the first one's identity.
        rerender({ path: '/session' });

        expect(currentJourneyId()).not.toBe(first);
        // The ordinal restarts with the journey; otherwise a second visit's first take reports as a retry.
        expect(currentAttemptSeq()).toBe(0);
    });

    it('moving BETWEEN product surfaces is ONE journey', () => {
        // Session -> Analytics -> Session is the post-session navigation these events exist to describe.
        // Splitting it would hide the very behaviour being measured.
        const { rerender } = renderHook(({ path }) => useJourneyBoundary(path), {
            initialProps: { path: '/session' },
        });
        const first = currentJourneyId();
        rerender({ path: '/analytics' });
        rerender({ path: '/analytics/9f2c4b1e-8a7d-4c3b-9e1f-2a3b4c5d6e7f' });
        rerender({ path: '/session' });
        expect(currentJourneyId()).toBe(first);
    });

    it('entering a product directly by URL is an entry, not a continuation', () => {
        const { result } = renderHook(() => useJourneyBoundary('/practice'));
        expect(result.current).toBeUndefined();
        expect(currentJourneyId()).toBeTruthy();
    });

    it('classifies product routes and their children, and nothing else', () => {
        for (const p of ['/session', '/session/x', '/practice', '/analytics', '/analytics/abc']) {
            expect({ path: p, product: isProductRoute(p) }).toEqual({ path: p, product: true });
        }
        for (const p of ['/', '/pricing', '/login', '/sessions-archive']) {
            expect({ path: p, product: isProductRoute(p) }).toEqual({ path: p, product: false });
        }
    });
});
