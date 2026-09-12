/**
 * #1426 — refuse a scored comparison take unless requested === observed === expected.
 *
 * Switching and recording are separate user actions. A successful check during the switch is not a
 * durable guarantee for a later take: a safety kill, failed reinitialisation, stale identity, or future
 * resolver change can alter one of the terms in between. The recording authority therefore recomputes
 * the three-way equality immediately before it begins any recording/transcription work.
 */
import { effectiveCandidate } from './candidateSelection';
import { runtimeCandidateExpectation } from './runtimeCandidateSwitch';
import { resolvedEngine } from '@/services/telemetry/runtimeAttribution';

export type RuntimeCandidateTakeRefusal =
    | 'requested_mismatch'
    | 'observed_missing'
    | 'observed_mismatch';

export type RuntimeCandidateTakeGate =
    | { enabled: false; allowed: true }
    | {
        enabled: true;
        allowed: boolean;
        expected: string;
        requested: string;
        observed: string | null;
        refusal: RuntimeCandidateTakeRefusal | null;
    };

/** Pure read of the authorities; no UI, network, storage, or engine side effects. */
export function evaluateRuntimeCandidateTakeGate(): RuntimeCandidateTakeGate {
    const expected = runtimeCandidateExpectation();
    if (expected === null) return { enabled: false, allowed: true };

    const requested = effectiveCandidate().candidate.id;
    const observed = resolvedEngine()?.candidateId ?? null;
    const refusal: RuntimeCandidateTakeRefusal | null = requested !== expected
        ? 'requested_mismatch'
        : observed === null
            ? 'observed_missing'
            : observed !== expected
                ? 'observed_mismatch'
                : null;

    return { enabled: true, allowed: refusal === null, expected, requested, observed, refusal };
}
