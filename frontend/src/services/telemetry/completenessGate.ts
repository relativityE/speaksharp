import { GOVERNED_EVENTS, type GovernedEvent } from '../telemetryAllowlist';
import { attemptedEventFamilies } from '../AnalyticsBuffer';

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
    /**
     * A saved session necessarily reaches several completion marks — the user's Stop, runtime
     * termination, the save — and each emits `stage_latency`. Leaving it out meant a readback that lost
     * every latency row could still be marked QUALIFIED, while the post-Stop breakdown this
     * instrumentation exists to produce was wholly missing. A gate that cannot notice the absence of the
     * thing being measured is not a gate.
     */
    'stage_latency',
]);

/**
 * The required families that are NOT part of a product journey, by construction.
 *
 * A controlled user signs in and only then enters `/practice`. `account_identified` and the
 * identity-settled positive control are therefore emitted under the PRE-PRODUCT journey, and
 * `ensureJourneyBoundary()` mints a new `journey_id` on the transition into the product — correctly, and
 * before any recording begins. A single journey-scoped readback can consequently contain the identity
 * receipts or the session receipts, never both, so requiring both inside one journey made an ordinary
 * complete run impossible to qualify.
 *
 * Splitting them is the honest fix rather than moving the boundary: these two receipts genuinely belong
 * to the sign-in, not to the pass through the product. They are still REQUIRED, and still scoped to the
 * release and traffic class — just not to the journey, because they were never in it.
 */
export const PRE_JOURNEY_EVENT_FAMILIES: readonly GovernedEvent[] = Object.freeze([
    'telemetry_positive_control',
    'account_identified',
]);

/** The required families that a single pass through the product must itself produce. */
export const IN_JOURNEY_EVENT_FAMILIES: readonly GovernedEvent[] = Object.freeze(
    REQUIRED_EVENT_FAMILIES.filter((f) => !PRE_JOURNEY_EVENT_FAMILIES.includes(f)),
);

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
/**
 * A DEBUGGING view for this tab. NOT a release gate.
 *
 * It reports whether this tab ATTEMPTED to send each required family — useful while diagnosing a
 * session, and no more than that. `posthog.capture()` is fire-and-forget, so an attempt establishes
 * nothing about ingestion: a tab whose every request failed in the network would still look complete
 * here. Release completeness is decided only by reading the events back from the server, in
 * `scripts/telemetry-readback-qualification.mts`.
 *
 * The name says `currentRun`, not `qualified`, for that reason. A QUALIFIED verdict from this function
 * means "this tab tried"; it must never be quoted as evidence that a release is instrumented.
 */
export function currentRunCompleteness(
    attempted: readonly string[] = attemptedEventFamilies(),
): CompletenessResult {
    return evaluateTelemetryCompleteness([...attempted]);
}

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

/**
 * #1421 P1 — SCENARIO PROFILES: WHICH FAMILIES EACH UI STAGE MUST PRODUCE.
 *
 * `REQUIRED_EVENT_FAMILIES` is the generic session spine, and a journey could return QUALIFIED with
 * every Share Feedback, During and After family absent — the readback said "the session happened"
 * and nothing about whether the surfaces under test were observable. A test that cannot diagnose the
 * failures it was run to find is not evidence.
 *
 * A TABLE, NOT A FRAMEWORK. Each stage owns its required families and, where a family alone is not
 * enough, a predicate over the decoded rows. Adding a stage is a row here; it needs no new machinery,
 * and the qualifier keeps its single verdict path. Missing stage data is a HOLD, like every other
 * absence in this gate.
 *
 * Predicates read decoded READBACK rows only — never producer objects, DOM state, an HTTP status or a
 * send buffer — and they may only ask closed-set, count, boolean or hash questions. They never see
 * transcript, feedback prose, audio, URLs or tokens, because those never leave the process.
 */
export interface QualificationStage {
    readonly stage: string;
    readonly requiredFamilies: readonly GovernedEvent[];
    /** Extra conditions over the decoded rows for this journey. Each returns a HOLD reason, or null. */
    readonly invariants: readonly {
        readonly name: string;
        readonly check: (rows: readonly DecodedTelemetryRow[]) => string | null;
    }[];
}

/** One decoded readback row. Governed properties only — the query selects nothing else. */
export interface DecodedTelemetryRow {
    event: string;
    properties?: Record<string, unknown> | null;
}


const has = (rows: readonly DecodedTelemetryRow[], event: string) => rows.some(r => r?.event === event);
const propsOf = (rows: readonly DecodedTelemetryRow[], event: string) =>
    rows.filter(r => r?.event === event).map(r => r?.properties ?? {});

/**
 * THE THREE-MODEL BINDING.
 *
 * A down-selection is only defensible if the row proves the candidate that was CONFIGURED is the one
 * that was ACQUIRED and the one that RAN. `private_model_acquisition_success` is the only governed
 * family carrying `acquired_candidate_id`, which is why registering it was a prerequisite for this.
 *
 * A mismatch, a missing identity, or more than one identity in a single controlled row all HOLD: two
 * identities in one journey means the row describes two takes, and averaging them is exactly the
 * contamination this exists to refuse.
 */
const idsOf = (rows: readonly DecodedTelemetryRow[], event: string, field: string) =>
    new Set(propsOf(rows, event).map(p => p?.[field]).filter(v => typeof v === 'string' && v.length > 0) as string[]);

const modelIdentityIsCoherent = (rows: readonly DecodedTelemetryRow[]): string | null => {
    const acquired = idsOf(rows, 'private_model_acquisition_success', 'acquired_candidate_id');
    if (acquired.size === 0) return 'no acquired candidate identity was recorded for this journey';
    if (acquired.size > 1) return 'more than one acquired candidate identity in one journey';

    /**
     * #1421 P1 — EQUALITY, NOT MERE PRESENCE.
     *
     * This required one non-blank `acquired_candidate_id` and stopped. A run configured for one model
     * that acquired or ran another therefore satisfied the claimed three-model binding, and the
     * down-selection evidence it produced would attribute one model's results to another. Requiring a
     * value is not requiring the right value.
     *
     * Three identities, all governed and all now fetched by the readback:
     *   expected_candidate_id — what the run was CONFIGURED for, from the candidate expectation;
     *   acquired_candidate_id — what the loader actually ACQUIRED;
     *   candidate_id          — what the envelope verified as RUNNING, on every governed row.
     *
     * All three must agree. Any missing term HOLDs rather than being skipped: an absent identity is
     * exactly the state in which a mismatch cannot be ruled out.
     */
    const expected = idsOf(rows, 'private_model_acquisition_start', 'expected_candidate_id');
    if (expected.size === 0) return 'no configured (expected) candidate identity was recorded';
    if (expected.size > 1) return 'more than one configured candidate identity in one journey';

    const running = new Set(rows.map(r => r?.properties?.candidate_id)
        .filter(v => typeof v === 'string' && v.length > 0) as string[]);
    if (running.size === 0) return 'no running candidate identity was recorded for this journey';
    if (running.size > 1) return 'more than one running candidate identity in one journey';

    /**
     * AN UNIDENTIFIABLE RUNTIME HOLDS. `candidate_id` alone names the model; `engine` and
     * `runtime_version` are what make the running identity attributable to a build. The envelope
     * publishes all three together and sets them to null as a set when attribution is unverified, so a
     * row naming a candidate with no engine or runtime version is exactly the "we cannot say what ran"
     * state — which must not qualify a down-selection row.
     */
    const engines = new Set(rows.map(r => r?.properties?.engine)
        .filter(v => typeof v === 'string' && v.length > 0) as string[]);
    const runtimes = new Set(rows.map(r => r?.properties?.runtime_version)
        .filter(v => typeof v === 'string' && v.length > 0) as string[]);
    if (engines.size === 0 || runtimes.size === 0) {
        return 'the running candidate carries no verified engine or runtime version';
    }
    if (engines.size > 1 || runtimes.size > 1) {
        return 'more than one running engine or runtime version in one journey';
    }

    const [a] = [...acquired]; const [e] = [...expected]; const [r] = [...running];
    if (e !== a) return 'the configured candidate is not the one that was acquired';
    if (a !== r) return 'the acquired candidate is not the one that ran';
    return null;
};

export const QUALIFICATION_STAGES: readonly QualificationStage[] = Object.freeze([
    {
        stage: 'share_feedback',
        // Open -> field state -> submit attempted. The storage RESULT is carried on `feedback_submit`
        // itself, so a submit with no outcome cannot read as a successful one.
        requiredFamilies: ['feedback_dialog_opened', 'feedback_field', 'feedback_submit'],
        invariants: [{
            name: 'submit_has_storage_outcome',
            check: (rows) => (propsOf(rows, 'feedback_submit').some(p => p?.outcome === undefined || p?.outcome === null)
                ? 'a feedback submit was recorded with no storage outcome'
                : null),
        }],
    },
    {
        stage: 'session_during',
        requiredFamilies: [
            'recording_intent', 'recording_state', 'session_started',
            'private_model_acquisition_start', 'private_model_acquisition_success',
            'transcript_stability', 'mic_observability',
        ],
        invariants: [
            { name: 'model_identity_coherent', check: modelIdentityIsCoherent },
            {
                // An accepted intent that never reaches RECORDING is the F-01 defect: the click was
                // taken and nothing ran. A journey missing that transition has not proven a take began.
                name: 'accepted_intent_reached_recording',
                // `to_state` is what `emitRecordingState()` publishes and what the governed schema
                // declares. Reading `state` decoded null on every real row, so this invariant could
                // never find RECORDING and every honest During readback would have HELD.
                check: (rows) => (has(rows, 'recording_intent')
                    && !propsOf(rows, 'recording_state').some(p => p?.to_state === 'RECORDING')
                    ? 'an accepted recording intent never reached RECORDING'
                    : null),
            },
        ],
    },
    {
        stage: 'session_after_open_mic',
        requiredFamilies: [
            'session_saved', 'transcript_authority', 'filler_measurement',
            'retention_observation', 'practice_loop', 'stage_latency',
        ],
        invariants: [{
            // A saved session whose review has no transcript authority is the "saved count with blank
            // review" case: the count says it worked and the user sees nothing.
            name: 'saved_session_has_transcript_authority',
            check: (rows) => (has(rows, 'session_saved') && !has(rows, 'transcript_authority')
                ? 'a saved session produced no transcript authority for its review'
                : null),
        }],
    },
    {
        stage: 'session_after_focus_points',
        requiredFamilies: [
            'session_saved', 'transcript_authority', 'coverage_evaluation', 'coverage_point',
            'filler_measurement', 'retention_observation', 'practice_loop', 'stage_latency',
        ],
        invariants: [{
            // A coverage verdict with no per-position rows is a headline with nothing behind it.
            name: 'coverage_evaluation_has_points',
            check: (rows) => (has(rows, 'coverage_evaluation') && !has(rows, 'coverage_point')
                ? 'a coverage evaluation published no per-point verdicts'
                : null),
        }],
    },
]);

/** HOLD reasons for one stage, or an empty list when the stage is fully evidenced. */
export function evaluateQualificationStage(
    stage: QualificationStage,
    rows: readonly DecodedTelemetryRow[],
): string[] {
    const missing = stage.requiredFamilies.filter((family) => !has(rows, family));
    const reasons = missing.map((family) => `${stage.stage}: missing required family ${family}`);
    for (const invariant of stage.invariants) {
        const failure = invariant.check(rows);
        if (failure !== null) reasons.push(`${stage.stage}: ${failure}`);
    }
    return reasons;
}
