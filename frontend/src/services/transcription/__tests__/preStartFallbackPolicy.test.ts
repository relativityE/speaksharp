import { describe, expect, it } from 'vitest';
import {
    decidePreStartFallback,
    FUTURE_V4_PRIMARY_POLICY,
    type PreStartFallbackPolicy,
} from '../preStartFallbackPolicy';

const enabledPolicy: PreStartFallbackPolicy = {
    ...FUTURE_V4_PRIMARY_POLICY,
    enabled: true,
};

describe('future v4-primary pre-Start fallback policy', () => {
    it('leaves the current v2-selected release on v2', () => {
        expect(decidePreStartFallback({
            policy: FUTURE_V4_PRIMARY_POLICY,
            requestedCandidateId: 'v2:base.en',
            cause: 'v4_init_failed',
            takeStarted: false,
            preparationCancelled: false,
            strictExplicitRequest: false,
        })).toEqual({ useFallback: false, candidateId: 'v2:base.en' });
    });

    it.each(['v4_init_failed', 'v4_device_unavailable'] as const)(
        'selects the explicitly named v2 candidate before Start on %s', (cause) => {
            expect(decidePreStartFallback({
                policy: enabledPolicy,
                requestedCandidateId: 'v4:base:q4',
                cause,
                takeStarted: false,
                preparationCancelled: false,
                strictExplicitRequest: false,
            })).toEqual({
                useFallback: true,
                candidateId: 'v2:base.en',
                fromCandidateId: 'v4:base:q4',
                cause,
            });
        },
    );

    it('never downgrades a strict explicit-v4 request', () => {
        expect(decidePreStartFallback({
            policy: enabledPolicy,
            requestedCandidateId: 'v4:base:q4',
            cause: 'v4_init_failed',
            takeStarted: false,
            preparationCancelled: false,
            strictExplicitRequest: true,
        })).toEqual({ useFallback: false, candidateId: 'v4:base:q4' });
    });

    it('never changes the model after Start', () => {
        expect(decidePreStartFallback({
            policy: enabledPolicy,
            requestedCandidateId: 'v4:base:q4',
            cause: 'v4_init_failed',
            takeStarted: true,
            preparationCancelled: false,
            strictExplicitRequest: false,
        })).toEqual({ useFallback: false, candidateId: 'v4:base:q4' });
    });

    it('does not use the v2 fallback when a different primary was requested', () => {
        expect(decidePreStartFallback({
            policy: enabledPolicy,
            requestedCandidateId: 'v4:distil:q4',
            cause: 'v4_device_unavailable',
            takeStarted: false,
            preparationCancelled: false,
            strictExplicitRequest: false,
        })).toEqual({ useFallback: false, candidateId: 'v4:distil:q4' });
    });

    it('does not start a fallback after preparation is cancelled or disposed', () => {
        expect(decidePreStartFallback({
            policy: enabledPolicy,
            requestedCandidateId: 'v4:base:q4',
            cause: 'v4_init_failed',
            takeStarted: false,
            preparationCancelled: true,
            strictExplicitRequest: false,
        })).toEqual({ useFallback: false, candidateId: 'v4:base:q4' });
    });
});
