/**
 * #1259 T1 — per-event content-free allowlist for outcome-loop telemetry.
 *
 * WHY THIS REPLACES THE DENYLIST. `AnalyticsBuffer` applied two different policies: `private_*` events were
 * re-projected through an allowlist, and everything else went through a DENYLIST on key NAMES —
 * `/(transcript|audio|wav|blob|base64)/i`. That regex matches the key's name, not the value's nature, so a
 * field called `message`, `reason` or `error_message` reached PostHog verbatim.
 *
 * That was not hypothetical. Three live producers carried arbitrary runtime text:
 *
 *   COMPONENT_CRASH.message            <- error.message
 *   GLOBAL_UNHANDLED_REJECTION.reason  <- rejection message
 *   recording_start_failed.error_message <- err.message
 *
 * Error text is the worst possible carrier, because PostgREST and Postgres echo request material back in
 * `message`/`details`/`hint` — `lib/storage.ts` already refuses to log raw errors for exactly this reason,
 * noting that a completion request "carries the full transcript". The same error object reaching telemetry
 * undoes that care.
 *
 * Widening the denylist is not the fix: it re-opens on the next field anyone invents. An allowlist fails
 * CLOSED — an unknown key is dropped whether or not anyone anticipated it.
 *
 * SCOPE. This governs analytics property projection only. It adds no new analytics purpose, collects no
 * content, and does not activate telemetry anywhere.
 */

/**
 * ── VOCABULARIES ───────────────────────────────────────────────────────────────────────────────────────
 *
 * Every vocabulary below is DERIVED from the product type that produces it, not invented here. An earlier
 * revision declared its own values and silently dropped real ones: `session_coaching_variant` was declared
 * ['control','guided','unknown'] when the only variant assigned is 'treatment'.
 */

/** Transcription engine modes. NOT the Focus Points practice modes — see PRACTICE_MODES. */
import {
    CONVERSION_SOURCES, UTM_SOURCES, UTM_MEDIUMS, UTM_CAMPAIGNS, closedWith,
} from './conversionVocabulary';

/** The checked-in Report Issue vocabularies — the same slugs the database stores. */
const ISSUE_CATEGORIES = [
    'recording_transcription', 'analytics_sessions', 'billing_subscription', 'account_signin',
    'privacy_data', 'speed_performance', 'something_else',
] as const;
const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const STT_MODES = ['private', 'browser', 'cloud', 'native', 'unknown'] as const;
/** `PracticeMode` in practiceTelemetry.ts. The SAME property name `mode` with a DIFFERENT closed set. */
const PRACTICE_MODES = ['quick', 'objective'] as const;
/** `PracticeEntrySource` — closed at the producer, and closed again here. */
const ENTRY_SOURCES = ['landing_card', 'freeform_overview'] as const;
/** `RuntimeState` in SpeechRuntimeController.ts — UPPERCASE. A lowercase set dropped every real value. */
const RUNTIME_STATES = [
    'IDLE', 'INITIATING', 'ENGINE_INITIALIZING', 'DOWNLOAD_REQUIRED', 'READY',
    'RECORDING', 'STOPPING', 'FAILED', 'FAILED_VISIBLE', 'TERMINATED',
] as const;
/** `ClientFreshness` in staleClientGuard.ts. 'unverified' and 'local' are real and were being dropped. */
const FRESHNESS = ['fresh', 'stale', 'unverified', 'local'] as const;

/**
 * The post-session destinations. CLOSED, because F08 asks which options were OFFERED — and a free
 * string would let a producer invent an option that no user could have seen.
 */
const NAVIGATION_OPTIONS = [
    'practice_next', 'view_analytics', 'try_another_mode', 'home', 'products', 'none',
] as const;

const TIERS = ['free', 'pro', 'trial', 'unknown', 'anonymous'] as const;
const TRIAL_STATES = ['active', 'expired', 'none', 'unknown'] as const;

export const SESSION_COACHING_VARIANTS = ['treatment'] as const;
export const SESSION_COACHING_ASSIGNMENT_SOURCES = ['default'] as const;
const SCORE_BANDS = [
    'Polished Presenter', 'Confident Speaker', 'Clear Communicator', 'Building Control', 'Getting Started',
] as const;
const SCORE_CONFIDENCE = ['warming-up', 'directional', 'usable'] as const;
const TRANSCRIPTION_CONFIDENCE = ['low', 'medium', 'high'] as const;
const SCORE_CATEGORIES = [
    'messageStructure', 'deliveryControl', 'languageClarity', 'audienceImpact',
] as const;

export type FieldRule =
    | { kind: 'enum'; values: readonly string[] }
    | { kind: 'int'; min: number; max: number }
    | { kind: 'number'; min: number; max: number }
    | { kind: 'bool' }
    /** Constrained token: no spaces, no query strings, no control characters, no prose. */
    | { kind: 'slug'; maxLength: number }
    /** In-app path such as `/analytics`. Rejects query strings and fragments, which carry data. */
    | { kind: 'route'; maxLength: number }
    /**
     * A bounded LIST of enum members. The only non-primitive shape allowed, and only because every element
     * must itself be drawn from a closed set — an array of free strings stays rejected.
     */
    | { kind: 'enum[]'; values: readonly string[]; maxLength: number };

const enumOf = (values: readonly string[]): FieldRule => ({ kind: 'enum', values });
const slug = (maxLength = 64): FieldRule => ({ kind: 'slug', maxLength });

/** Shared fragments. Composed per event — never a global name→rule map. */
const EXPERIMENT_FIELDS = {
    session_coaching_experiment: slug(),
    session_coaching_variant: enumOf(SESSION_COACHING_VARIANTS),
    session_coaching_assignment_source: enumOf(SESSION_COACHING_ASSIGNMENT_SOURCES),
} as const;

const CONVERSION_FIELDS = {
    source: slug(),
    plan: enumOf(['pro', 'free', 'unknown']),
    route: { kind: 'route', maxLength: 96 } as FieldRule,
    tier: enumOf(TIERS),
    trial_state: enumOf(TRIAL_STATES),
    ...EXPERIMENT_FIELDS,
} as const;

/**
 * Checkout return attribution is read from the visitor-controlled URL query, so these are CLOSED
 * vocabularies rather than `slug()`. A slug rule constrains shape, not origin — it accepted any
 * slug-shaped string a visitor put in `?conversion_source=`. The producer collapses anything we did
 * not emit to `unknown`, and this rule is what makes that collapse enforceable at the seam.
 */
const CHECKOUT_RETURN_FIELDS = {
    conversion_source: enumOf(closedWith(CONVERSION_SOURCES)),
    utm_source: enumOf(closedWith(UTM_SOURCES)),
    utm_medium: enumOf(closedWith(UTM_MEDIUMS)),
    utm_campaign: enumOf(closedWith(UTM_CAMPAIGNS)),
} as const;

/**
 * Report Issue. Governed rather than free-form because this is the ONE surface where a user types
 * prose: the title and description are real user content and belong in the database row, never in an
 * analytics payload. Only the closed classification and a LINK BOOLEAN ride the wire.
 *
 * `report_linked_to_session` replaces the raw session UUID that used to travel here. The database keeps
 * the relationship; the browser only needs to answer whether one exists.
 */
const REPORT_ISSUE_FIELDS = {
    issue_category: enumOf(ISSUE_CATEGORIES),
    issue_severity: enumOf(ISSUE_SEVERITIES),
    report_linked_to_session: { kind: 'bool' } as FieldRule,
    // Whether the arm below belongs to the session this report is LINKED to, rather than to whatever
    // engine last resolved in the tab. A null arm and a borrowed arm are otherwise indistinguishable.
    model_attribution_verified: { kind: 'bool' } as FieldRule,
    // `private_moonshine`, matching the EngineVariant union. This read `moonshine_streaming` — a value
    // the app never produces — so a Moonshine report's arm failed the enum and was DROPPED, leaving
    // exactly the Moonshine reports unattributed while every other arm carried its label.
    engine_variant: enumOf(['private_v2', 'private_v4', 'private_moonshine']),
    release_sha: slug(64),
} as const;

const COACHING_CORE = {
    experiment: slug(),
    variant: enumOf(SESSION_COACHING_VARIANTS),
    assignment_source: enumOf(SESSION_COACHING_ASSIGNMENT_SOURCES),
    model_version: slug(),
    confidence: enumOf(SCORE_CONFIDENCE),
    score_band: enumOf(SCORE_BANDS),
    action_count: { kind: 'int', min: 0, max: 1_000 } as FieldRule,
    weakest_categories: { kind: 'enum[]', values: SCORE_CATEGORIES, maxLength: 8 } as FieldRule,
} as const;

/**
 * ── PER-EVENT SCHEMAS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Each event owns its own field→rule map. This is the fix for a global name→rule table: `mode` means
 * `PracticeMode` on the Practice events and `STT mode` on the session events, and a single global rule for
 * `mode` silently DROPPED the Focus Points values from every Practice event.
 *
 * An event absent from this object is UNGOVERNED and ships no properties at all.
 */
export const EVENT_SCHEMAS = Object.freeze({
    // ── session outcome loop ────────────────────────────────────────────────
    session_started: {
        mode: enumOf(STT_MODES), requested_mode: enumOf(STT_MODES), user_tier: enumOf(TIERS),
        ...EXPERIMENT_FIELDS,
    },
    session_saved: {
        mode: enumOf(STT_MODES), user_tier: enumOf(TIERS),
        duration_seconds: { kind: 'int', min: 0, max: 86_400 } as FieldRule,
        word_count: { kind: 'int', min: 0, max: 1_000_000 } as FieldRule,
        filler_count: { kind: 'int', min: 0, max: 1_000_000 } as FieldRule,
        wpm: { kind: 'number', min: 0, max: 1_000 } as FieldRule,
        clarity_score: { kind: 'number', min: 0, max: 100 } as FieldRule,
        streak_count: { kind: 'int', min: 0, max: 100_000 } as FieldRule,
        is_new_streak_day: { kind: 'bool' } as FieldRule,
        ...EXPERIMENT_FIELDS,
    },
    recording_start_failed: {
        mode: enumOf(STT_MODES),
        // UPPERCASE, from RuntimeState. The lowercase set dropped every real value this event carries.
        runtime_state: enumOf(RUNTIME_STATES),
        error_name: slug(), start_leaf_name: slug(),
    },
    recording_blocked_stale_client: {
        status: enumOf(FRESHNESS),
        running_release: slug(), deployed_release: slug(),
        attempts: { kind: 'int', min: 0, max: 10_000 } as FieldRule,
    },

    // ── F01 / F16: recording intent, state, and per-stage latency ───────────
    /**
     * THE CLICK, not the success. `session_started` is pushed only after `startRecording()` resolves,
     * so a refused click emits nothing and is indistinguishable from a click never made. Every path in
     * `handleStartStop` that returns early now reports its reason here.
     */
    recording_intent: {
        intent_kind: enumOf(['start', 'stop']),
        intent_outcome: enumOf([
            'accepted', 'suppressed_in_flight', 'suppressed_finalizing',
            'blocked_usage_limit', 'blocked_stale_client', 'blocked_lock_held', 'failed',
        ]),
        runtime_state_at_intent: enumOf(RUNTIME_STATES),
        model_ready: { kind: 'bool' } as FieldRule,
        ms_since_ready: { kind: 'int', min: 0, max: 86_400_000 } as FieldRule,
    },
    /** Transitions only. A poll of unchanged state is the noise this deliberately does not emit. */
    recording_state: {
        from_state: enumOf(RUNTIME_STATES),
        to_state: enumOf(RUNTIME_STATES),
        transition_cause: slug(),
        ms_since_intent: { kind: 'int', min: 0, max: 86_400_000 } as FieldRule,
    },
    /** One stage per row. A single stop-to-review total answers none of F16's six questions. */
    stage_latency: {
        stage: enumOf([
            'model_acquisition', 'ready_to_intent', 'intent_to_recording',
            'recording_to_stop_intent', 'stop_intent_to_termination',
        ]),
        duration_ms: { kind: 'int', min: 0, max: 86_400_000 } as FieldRule,
    },

    /**
     * F05 — a word count and a rendered surface are DIFFERENT FACTS. Production already carries
     * `session_saved.word_count`; nothing records whether the user could see those words. This pairs
     * them at each stage that can lose the transcript. No text, ever — a digest, two counts, booleans.
     */
    transcript_authority: {
        stage: enumOf(['finalize', 'save', 'teardown', 'review_rendered']),
        transcript_digest: slug(16),
        authoritative_word_count: { kind: 'int', min: 0, max: 1_000_000 } as FieldRule,
        rendered_word_count: { kind: 'int', min: 0, max: 1_000_000 } as FieldRule,
        transcript_visibly_present: { kind: 'bool' } as FieldRule,
        digests_match: { kind: 'bool' } as FieldRule,
        persisted: { kind: 'bool' } as FieldRule,
        session_id_present: { kind: 'bool' } as FieldRule,
        teardown_state: enumOf(RUNTIME_STATES),
    },

    /**
     * F03 / F08 — the control's IDENTITY beside what it actually did, and the options a finished
     * session offered. `options_shown` is a bounded closed list so an empty offering is a recorded
     * measurement rather than a missing event.
     */
    journey_step: {
        step: enumOf(['route_change', 'cta_click', 'setup_submitted', 'post_session_options', 'option_selected']),
        from_route: { kind: 'route', maxLength: 96 } as FieldRule,
        to_route: { kind: 'route', maxLength: 96 } as FieldRule,
        product_mode: enumOf([...PRACTICE_MODES, 'none']),
        cta_id: slug(),
        cta_action: enumOf(['navigate', 'start_recording', 'submit', 'none']),
        runtime_state_on_arrival: enumOf(RUNTIME_STATES),
        options_shown: { kind: 'enum[]', values: NAVIGATION_OPTIONS, maxLength: 8 } as FieldRule,
        option_selected: enumOf(NAVIGATION_OPTIONS),
        points_entered: { kind: 'int', min: 0, max: 100 } as FieldRule,
    },

    /**
     * F06 / F14 / F18 — the evaluator's verdict beside the numbers that produced it. `session_saved`
     * carries no coverage at all today, so the product's judgement and the transcript that
     * contradicts it have never been comparable. No label, topic, or matched quote — positions only.
     */
    coverage_evaluation: {
        evaluator_version: slug(),
        points_supplied: { kind: 'int', min: 0, max: 100 } as FieldRule,
        points_evaluated: { kind: 'int', min: 0, max: 100 } as FieldRule,
        covered_threshold: { kind: 'number', min: 0, max: 1 } as FieldRule,
        partial_threshold: { kind: 'number', min: 0, max: 1 } as FieldRule,
        covered_count: { kind: 'int', min: 0, max: 100 } as FieldRule,
        partial_count: { kind: 'int', min: 0, max: 100 } as FieldRule,
        retry_target_count: { kind: 'int', min: 0, max: 100 } as FieldRule,
        transcript_word_count: { kind: 'int', min: 0, max: 1_000_000 } as FieldRule,
    },
    /** One row per point, identified by POSITION. A label here would be user content. */
    coverage_point: {
        evaluator_version: slug(),
        point_position: { kind: 'int', min: 0, max: 100 } as FieldRule,
        match_ratio: { kind: 'number', min: 0, max: 1 } as FieldRule,
        keyword_count: { kind: 'int', min: 0, max: 1_000 } as FieldRule,
        verdict: enumOf(['covered', 'partial', 'missing']),
        latched: { kind: 'bool' } as FieldRule,
    },

    /**
     * F07 — GENERATED vs FALLBACK, which the rendered screen cannot distinguish.
     *
     * `verdictFromSuggestions` ALWAYS returns a verdict: with no AI suggestions it substitutes
     * "Session saved — nice work." and a generic fix. So a session with no practice loop renders
     * copy that looks like one, and "I did not see the practice loop" and "the loop said something
     * bland" are the same screen. Recording the SOURCE of each half separates them.
     */
    practice_loop: {
        suggestions_present: { kind: 'bool' } as FieldRule,
        what_went_well_source: enumOf(['generated', 'fallback']),
        what_to_improve_source: enumOf(['generated', 'fallback']),
        rendered: { kind: 'bool' } as FieldRule,
        next_action_persisted: { kind: 'bool' } as FieldRule,
        suppression_reason: enumOf(['none', 'no_suggestions', 'not_in_review_state']),
    },

    // ── conversion funnel ───────────────────────────────────────────────────
    conversion_cta_viewed: CONVERSION_FIELDS,
    conversion_cta_clicked: CONVERSION_FIELDS,
    checkout_started: CONVERSION_FIELDS,
    // Report Issue. The DIALOG's title and description are real user prose and stay in the database
    // row; only the closed classification and a link boolean travel here.
    report_issue_submitted: REPORT_ISSUE_FIELDS,
    checkout_returned_success: CHECKOUT_RETURN_FIELDS,
    checkout_returned_cancelled: CHECKOUT_RETURN_FIELDS,
    landing_preview_clicked: CONVERSION_FIELDS,

    // ── Focus Points / practice entry ───────────────────────────────────────
    // `mode` here is PracticeMode ('quick' | 'objective'), NOT an STT mode.
    practice_entry_viewed: { returning_user: { kind: 'bool' } as FieldRule, release_sha: slug() },
    practice_mode_selected: {
        mode: enumOf(PRACTICE_MODES), entry_source: enumOf(ENTRY_SOURCES), release_sha: slug(),
    },
    practice_overview_expanded: { mode: enumOf(PRACTICE_MODES), release_sha: slug() },
    // Was entirely UNGOVERNED: a real producer whose properties were all dropped.
    freeform_practice_started: {
        mode: enumOf(PRACTICE_MODES), entry_source: enumOf(ENTRY_SOURCES), release_sha: slug(),
    },

    // ── live-coaching experiment ────────────────────────────────────────────
    // `target_label` is deliberately ABSENT: generated copy ("Next target 7.5"), not a dimension.
    session_live_coaching_card_viewed: {
        ...COACHING_CORE,
        numeric_score_visible: { kind: 'bool' } as FieldRule,
        transcription_engine: slug(),
        transcription_confidence: enumOf(TRANSCRIPTION_CONFIDENCE),
    },
    session_live_coaching_numeric_score_shown: { ...COACHING_CORE },

    // ── error surfaces: bounded identifiers only, never messages ────────────
    COMPONENT_CRASH: { component: slug(), isolationKey: slug() },
    /**
     * #1259 F12 — this schema was `{}`. Every unhandled rejection in Production shipped with NO
     * properties at all: the event could say something failed and nothing else. The producer was still
     * passing the raw `reason` message and a comment claimed analytics kept it; the allowlist had been
     * dropping it silently. Restoring the message is not the fix — error text is the worst carrier,
     * since PostgREST and Postgres echo request material back through message/details/hint. These are
     * DERIVED instead: class name, a digest that groups identical failures, and a length band.
     */
    GLOBAL_UNHANDLED_REJECTION: {
        reason_kind: enumOf(['error', 'string', 'object', 'nullish', 'unknown']),
        error_name: slug(),
        error_fingerprint: slug(16),
        message_length_band: enumOf(['0', '1-64', '65-256', '257-1024', '1024+']),
    },

    account_identified: { source: slug() },

    // ── F12: telemetry about telemetry ──────────────────────────────────────
    /**
     * The event that is DECODED AT THE WIRE. There is deliberately no `boundary_accepted` field:
     * `posthog.capture` is fire-and-forget, so any client-side acceptance flag would be a guess
     * wearing a measurement's clothes. The nonce is what makes external verification possible.
     */
    telemetry_positive_control: {
        control_nonce: slug(48),
        instrumentation_version: slug(),
        transport_initialized: { kind: 'bool' } as FieldRule,
    },
    /** What the client genuinely knows about its own boundary. Never reports on a health event. */
    telemetry_health: {
        instrumentation_version: slug(),
        source_event: slug(),
        schema_validation_result: enumOf(['ok', 'dropped_fields', 'ungoverned']),
        dropped_count: { kind: 'int', min: 0, max: 10_000 } as FieldRule,
        flush_outcome: enumOf(['drained', 'backpressure_dropped', 'pagehide_drained']),
        queue_depth_band: enumOf(['0', '1-10', '11-100', '101-500', '500+']),
        suppressed_health_events: { kind: 'int', min: 0, max: 1_000_000 } as FieldRule,
    },
} as const satisfies Record<string, Record<string, FieldRule>>);

/**
 * The set of event names telemetry will carry properties for.
 *
 * Producers type their event parameter as `GovernedEvent`, so a dynamically-computed name that is not in
 * `EVENT_SCHEMAS` fails COMPILATION. A regex over `analyticsBuffer.push('literal')` could never do this:
 * the Practice producers call `emit(event, …)` through a wrapper, so every one of them was invisible to
 * that scan — which is exactly how `freeform_practice_started` shipped ungoverned.
 */
export type GovernedEvent = keyof typeof EVENT_SCHEMAS;

/** Runtime view of the same registry, for tests and for the drop counter. */
export const GOVERNED_EVENTS: readonly string[] = Object.freeze(Object.keys(EVENT_SCHEMAS));

/** Back-compat view: event → approved field NAMES. Shape validation is the authority. */
export const EVENT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze(
    Object.fromEntries(Object.entries(EVENT_SCHEMAS).map(([e, f]) => [e, Object.freeze(Object.keys(f))])),
);

/** No spaces, no punctuation that carries prose, no control characters, no query material. */
const SLUG = /^[A-Za-z0-9._:-]+$/;
const ROUTE = /^\/[A-Za-z0-9/_-]*$/;

function matchesRule(rule: FieldRule, value: unknown): boolean {
    if (value === null || value === undefined) return true;   // absence is content-free
    switch (rule.kind) {
        case 'enum':
            return typeof value === 'string' && rule.values.includes(value);
        case 'int':
            return typeof value === 'number' && Number.isInteger(value)
                && value >= rule.min && value <= rule.max;
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
                && value >= rule.min && value <= rule.max;
        case 'bool':
            return typeof value === 'boolean';
        case 'slug':
            return typeof value === 'string' && value.length > 0
                && value.length <= rule.maxLength && SLUG.test(value);
        case 'route':
            return typeof value === 'string' && value.length > 0
                && value.length <= rule.maxLength && ROUTE.test(value);
        case 'enum[]':
            return Array.isArray(value) && value.length <= rule.maxLength
                && value.every((v) => typeof v === 'string' && rule.values.includes(v));
    }
}

/** Is `value` acceptable for `field` ON THIS EVENT? Field shape is always event-scoped. */
export function isValidForEventField(event: string, field: string, value: unknown): boolean {
    const schema = (EVENT_SCHEMAS as Record<string, Record<string, FieldRule>>)[event];
    if (!schema) return false;
    const rule = schema[field];
    if (!rule) return false;                     // no declared shape on this event -> never emitted
    return matchesRule(rule, value);
}

/** Retained for callers that only need the coarse check; per-field validation is the authority. */
export function isContentFreeValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    return false;                                 // strings must go through isValidForEventField
}

export interface ProjectionResult {
    props: Record<string, unknown>;
    /** Keys removed, for tests and for the drop counter. Never the VALUES — that would re-leak them. */
    dropped: string[];
}

/**
 * Project an event's properties onto its approved schema.
 *
 * An event with NO entry in the allowlist yields NO properties. That is deliberate: a new event ships with
 * an empty payload until its schema is reviewed, rather than shipping whatever its author happened to pass.
 */
export function projectEventProps(
    event: string,
    props: Record<string, unknown> | undefined,
): ProjectionResult {
    const allowed = EVENT_ALLOWLIST[event];
    if (!props) return { props: {}, dropped: [] };

    const out: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const key of Object.keys(props)) {
        // BOTH gates: the key must be approved FOR THIS EVENT, and the value must match the shape that
        // field may carry. Either alone is insufficient — an approved key with prose is the leak.
        if (!allowed || !allowed.includes(key) || !isValidForEventField(event, key, props[key])) {
            dropped.push(key);
            continue;
        }
        out[key] = props[key];
    }
    return { props: out, dropped };
}

/** Is this event schema-governed? Used to report unknown events without shipping their payload. */
export function isGovernedEvent(event: string): boolean {
    return Object.prototype.hasOwnProperty.call(EVENT_ALLOWLIST, event);
}
