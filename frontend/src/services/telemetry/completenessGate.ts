import { GOVERNED_EVENTS, type GovernedEvent } from '../telemetryAllowlist';

/**
 * #1259 — a readback that finds nothing must say HOLD, not pass.
 *
 * Every other guard in this program asks "is what arrived acceptable?". None asked "did anything arrive
 * at all?" — and absence is the failure mode this instrumentation exists to rule out. A Production
 * readback missing `recording_intent` entirely looks exactly like a readback of a session nobody started,
 * and a run that qualifies on an empty set is worse than no run: it reports confidence it did not earn.
 *
 * So this fails CLOSED. A missing family, an unrecognised name, a non-array input, no input at all — every
 * one of them is a HOLD. Qualification requires an explicit sighting of every required family.
 */

/**
 * The families a real-world qualification run MUST contain.
 *
 * Deliberately not "all governed events": most are conditional on a path the run may not take, and
 * requiring those would make the gate fire on runs that were fine. These are the ones a session that
 * actually happened cannot fail to produce.
 */
export const REQUIRED_EVENT_FAMILIES: readonly GovernedEvent[] = Object.freeze([
    // The tab spoke to PostHog at all. Without this, every other absence is unexplained.
    'telemetry_positive_control',
    // The account the run belongs to. An unattributed run cannot be compared to anything.
    'account_identified',
    // Someone pressed the control, and the runtime answered. F-01's whole subject.
    'recording_intent',
    'recording_state',
    'session_started',
    // The session reached the database.
    'session_saved',
    // The transcript survived to the review, or provably did not.
    'transcript_authority',
    // The user was offered, and shown, a practice loop.
    'practice_loop',
    // The journey the above hang from.
    'journey_step',
]);

export type CompletenessVerdict = 'QUALIFIED' | 'HOLD';

export interface CompletenessResult {
    verdict: CompletenessVerdict;
    missing: string[];
    unrecognised: string[];
    reasons: string[];
}

/**
 * Decide whether an observed set of event names qualifies a run.
 *
 * PURE, so every rejection path is falsifiable without spending a readback. The caller collects names;
 * this decides. `observed` is whatever the readback saw — duplicates, unknown names and junk included,
 * because a decoder that silently tidies its input cannot report that the input was wrong.
 */
export function evaluateTelemetryCompleteness(
    observed: unknown,
    required: readonly string[] = REQUIRED_EVENT_FAMILIES,
): CompletenessResult {
    const reasons: string[] = [];

    // A non-array must not coerce into "nothing to check, therefore fine".
    if (!Array.isArray(observed)) {
        return {
            verdict: 'HOLD',
            missing: [...required],
            unrecognised: [],
            reasons: ['observed event set is not an array — nothing was read back, so nothing is proven'],
        };
    }

    const names = observed.filter((n): n is string => typeof n === 'string' && n.length > 0);
    // Junk in the observed set means the decoder is not producing what we believe it produces, which makes
    // every OTHER conclusion from this readback suspect — including the families that appeared to be there.
    // Noting it in a reason while still qualifying would be the lax reading of a fail-closed gate.
    const malformed = observed.length - names.length;
    if (malformed > 0) {
        reasons.push(`observed set contained ${malformed} non-string entr${malformed === 1 ? 'y' : 'ies'}; the readback is not trustworthy`);
    }

    const seen = new Set(names);
    const missing = required.filter((family) => !seen.has(family));
    // A name outside the governed vocabulary means the decoder and the allowlist disagree, which makes
    // every OTHER conclusion from this readback suspect — including the ones that looked fine.
    const unrecognised = [...seen].filter((name) => !GOVERNED_EVENTS.includes(name)).sort();

    if (missing.length > 0) {
        reasons.push(`required event families never observed: ${missing.join(', ')}`);
    }
    if (unrecognised.length > 0) {
        reasons.push(`event names outside the governed allowlist: ${unrecognised.join(', ')}`);
    }

    return {
        verdict: missing.length === 0 && unrecognised.length === 0 && malformed === 0 ? 'QUALIFIED' : 'HOLD',
        missing: [...missing],
        unrecognised,
        reasons,
    };
}
