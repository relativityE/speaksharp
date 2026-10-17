import type { CandidateId } from './candidateRegistry';

export type PreStartFallbackCause = 'v4_init_failed' | 'v4_device_unavailable';

export class ExplicitV4DowngradeRefusedError extends Error {
    readonly cause: unknown;
    constructor(cause: unknown) {
        super('Private v4 preparation failed; policy refused a model change for this take.');
        this.name = 'ExplicitV4DowngradeRefusedError';
        this.cause = cause;
    }
}

export interface PreStartFallbackPolicy {
    enabled: boolean;
    primaryCandidate: CandidateId;
    fallbackCandidate: CandidateId;
}

export type PreStartFallbackDecision =
    | { useFallback: false; candidateId: CandidateId }
    | { useFallback: true; candidateId: CandidateId; fromCandidateId: CandidateId; cause: PreStartFallbackCause };

/**
 * This implements the future v4-primary policy without changing the current release selector, which
 * remains v2. The policy only applies when v4:base:q4 is actually selected. It permits the named v2
 * fallback before a take starts; strict explicit-v4 requests and failures after Start never switch.
 */
export const FUTURE_V4_PRIMARY_POLICY: Readonly<PreStartFallbackPolicy> = Object.freeze({
    enabled: true,
    primaryCandidate: 'v4:base:q4',
    fallbackCandidate: 'v2:base.en',
});

export function decidePreStartFallback(input: {
    policy: PreStartFallbackPolicy;
    requestedCandidateId: CandidateId;
    cause: PreStartFallbackCause;
    takeStarted: boolean;
    preparationCancelled: boolean;
    strictExplicitRequest: boolean;
}): PreStartFallbackDecision {
    const { policy, requestedCandidateId, cause, takeStarted, preparationCancelled, strictExplicitRequest } = input;
    if (!policy.enabled || takeStarted || preparationCancelled || strictExplicitRequest || requestedCandidateId !== policy.primaryCandidate) {
        return { useFallback: false, candidateId: requestedCandidateId };
    }
    return {
        useFallback: true,
        candidateId: policy.fallbackCandidate,
        fromCandidateId: requestedCandidateId,
        cause,
    };
}
