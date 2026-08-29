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

/** Experiment context, content-free by construction: a flag name and two enum-ish assignment labels. */
const EXPERIMENT_PROPS = [
    'session_coaching_experiment',
    'session_coaching_variant',
    'session_coaching_assignment_source',
] as const;

/** Conversion funnel context. `route` is an in-app path, never a URL with query material. */
const CONVERSION_PROPS = ['source', 'plan', 'route', 'tier', 'trial_state', ...EXPERIMENT_PROPS] as const;

/**
 * Approved fields per event. Anything absent here is DROPPED at the capture boundary.
 *
 * Every field is a number, boolean, or a value drawn from a bounded set. No field is free text.
 */
export const EVENT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
    // ── session outcome loop ────────────────────────────────────────────────
    session_started: ['mode', 'requested_mode', 'user_tier', ...EXPERIMENT_PROPS],
    session_saved: [
        'mode', 'duration_seconds', 'word_count', 'wpm', 'filler_count', 'clarity_score',
        'is_new_streak_day', 'streak_count', ...EXPERIMENT_PROPS,
    ],
    // `error_message` is deliberately ABSENT. `error_name` is a constructor name (bounded); the message is not.
    recording_start_failed: [
        'mode', 'requested_mode', 'runtime_state', 'user_tier', 'error_name', 'start_leaf_name',
        ...EXPERIMENT_PROPS,
    ],
    recording_blocked_stale_client: ['status', 'running_release', 'deployed_release', 'attempts'],

    // ── conversion funnel ───────────────────────────────────────────────────
    conversion_cta_viewed: CONVERSION_PROPS,
    conversion_cta_clicked: CONVERSION_PROPS,
    checkout_started: CONVERSION_PROPS,
    checkout_returned_success: ['conversion_source', 'utm_source', 'utm_medium', 'utm_campaign'],
    checkout_returned_cancelled: ['conversion_source', 'utm_source', 'utm_medium', 'utm_campaign'],
    landing_preview_clicked: CONVERSION_PROPS,

    // ── practice funnel ─────────────────────────────────────────────────────
    practice_entry_viewed: ['returning_user', 'release_sha'],
    practice_mode_selected: ['mode', 'entry_source', 'release_sha'],
    practice_overview_expanded: ['mode', 'release_sha'],

    // ── reliability ─────────────────────────────────────────────────────────
    // `message` ABSENT: error.message is arbitrary runtime text.
    // ── live-coaching experiment (was UNGOVERNED: both events shipped zero properties) ───────────────
    // `target_label` is deliberately ABSENT. It is generated copy (`Next target 7.5` / `Hold consistency`),
    // not a dimension, so it is dropped rather than governed. A numeric target field would be the right
    // shape if the analysis ever needs it; that is a producer change, not an allowlist widening.
    session_live_coaching_card_viewed: [
        'experiment', 'variant', 'assignment_source', 'model_version', 'confidence', 'score_band',
        'numeric_score_visible', 'action_count', 'weakest_categories', 'transcription_engine',
        'transcription_confidence',
    ],
    session_live_coaching_numeric_score_shown: [
        'experiment', 'variant', 'assignment_source', 'model_version', 'confidence', 'score_band',
        'action_count', 'weakest_categories',
    ],

    COMPONENT_CRASH: ['component', 'isolationKey'],
    // `reason` ABSENT: a rejection reason is arbitrary runtime text. The event's OCCURRENCE is the signal.
    GLOBAL_UNHANDLED_REJECTION: [],

    // ── identity ────────────────────────────────────────────────────────────
    account_identified: ['source'],
});

/** Envelope keys the buffer itself adds; never caller-supplied. */
export const ENVELOPE_KEYS = Object.freeze(['$priority', '$ts']);

/**
 * PER-FIELD VALIDATION — an allowlisted key is not a licence to carry arbitrary text.
 *
 * The first version accepted any string up to 120 characters under an approved key, so
 * `session_saved{ mode: "um here is my private quarterly discussion" }` passed: `mode` is allowlisted
 * and the value is short. A length cap is not a content control — it bounds the size of a leak, not its
 * existence.
 *
 * Every approved field now declares the SHAPE of value it may carry. Anything else is dropped, whether
 * or not it is short and whether or not its key is approved.
 */
type FieldRule =
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

const MODES = ['private', 'browser', 'cloud', 'native', 'unknown'] as const;
const TIERS = ['free', 'pro', 'trial', 'unknown', 'anonymous'] as const;
const TRIAL_STATES = ['active', 'expired', 'none', 'unknown'] as const;
/**
 * Bounded vocabularies for the live-coaching experiment.
 *
 * These are EXPORTED and the producer derives its types from them (`sessionCoachingExperiment.ts`), so a new
 * variant cannot be shipped without appearing here. The previous values were invented rather than derived —
 * `['control','guided','unknown']` did not contain the only variant the code actually assigns
 * (`'treatment'`), so the variant would have been dropped from every governed event and the experiment would
 * have reported no variant dimension at all. Silent loss of an analysis dimension, not a leak — which is
 * exactly why the vocabulary must be bound to the producer instead of maintained by hand.
 */
export const SESSION_COACHING_VARIANTS = ['treatment'] as const;
export const SESSION_COACHING_ASSIGNMENT_SOURCES = ['default'] as const;

/** Score bands from `getScoreLabel`. Bounded copy labels — they contain spaces, so `slug` cannot carry them. */
const SCORE_BANDS = [
    'Polished Presenter', 'Confident Speaker', 'Clear Communicator', 'Building Control', 'Getting Started',
] as const;
/** Score confidence and transcription confidence are separate scales; they are NOT interchangeable. */
const SCORE_CONFIDENCE = ['warming-up', 'directional', 'usable'] as const;
const TRANSCRIPTION_CONFIDENCE = ['low', 'medium', 'high'] as const;
/** Keys of `SpeakingScoreBreakdown` — a closed set of category identifiers, never user text. */
const SCORE_CATEGORIES = [
    'messageStructure', 'deliveryControl', 'languageClarity', 'audienceImpact',
] as const;
const RUNTIME_STATES = ['idle', 'ready', 'starting', 'recording', 'stopping', 'error', 'unknown'] as const;
const FRESHNESS = ['fresh', 'stale', 'unknown'] as const;

/** The shape each approved property may take. A field with no rule here can never be emitted. */
const FIELD_RULES: Readonly<Record<string, FieldRule>> = Object.freeze({
    mode: { kind: 'enum', values: MODES },
    requested_mode: { kind: 'enum', values: MODES },
    user_tier: { kind: 'enum', values: TIERS },
    tier: { kind: 'enum', values: TIERS },
    trial_state: { kind: 'enum', values: TRIAL_STATES },
    plan: { kind: 'enum', values: ['pro', 'free', 'unknown'] },
    runtime_state: { kind: 'enum', values: RUNTIME_STATES },
    status: { kind: 'enum', values: FRESHNESS },
    session_coaching_variant: { kind: 'enum', values: SESSION_COACHING_VARIANTS },
    session_coaching_assignment_source: { kind: 'enum', values: SESSION_COACHING_ASSIGNMENT_SOURCES },
    session_coaching_experiment: { kind: 'slug', maxLength: 64 },

    // ── live-coaching experiment card ───────────────────────────────────────
    // The producer uses short key names (`variant`, not `session_coaching_variant`); both spellings are
    // governed because both are emitted, by different producers.
    experiment: { kind: 'slug', maxLength: 64 },
    variant: { kind: 'enum', values: SESSION_COACHING_VARIANTS },
    assignment_source: { kind: 'enum', values: SESSION_COACHING_ASSIGNMENT_SOURCES },
    model_version: { kind: 'slug', maxLength: 64 },
    confidence: { kind: 'enum', values: SCORE_CONFIDENCE },
    transcription_confidence: { kind: 'enum', values: TRANSCRIPTION_CONFIDENCE },
    score_band: { kind: 'enum', values: SCORE_BANDS },
    numeric_score_visible: { kind: 'bool' },
    action_count: { kind: 'int', min: 0, max: 1_000 },
    weakest_categories: { kind: 'enum[]', values: SCORE_CATEGORIES, maxLength: 8 },
    transcription_engine: { kind: 'slug', maxLength: 64 },

    duration_seconds: { kind: 'int', min: 0, max: 86_400 },
    word_count: { kind: 'int', min: 0, max: 1_000_000 },
    filler_count: { kind: 'int', min: 0, max: 1_000_000 },
    streak_count: { kind: 'int', min: 0, max: 100_000 },
    attempts: { kind: 'int', min: 0, max: 10_000 },
    wpm: { kind: 'number', min: 0, max: 1_000 },
    clarity_score: { kind: 'number', min: 0, max: 100 },

    is_new_streak_day: { kind: 'bool' },
    returning_user: { kind: 'bool' },

    // Bounded identifiers. `error_name` is a constructor name, never a message.
    error_name: { kind: 'slug', maxLength: 64 },
    start_leaf_name: { kind: 'slug', maxLength: 64 },
    component: { kind: 'slug', maxLength: 64 },
    isolationKey: { kind: 'slug', maxLength: 64 },
    source: { kind: 'slug', maxLength: 64 },
    conversion_source: { kind: 'slug', maxLength: 64 },
    entry_source: { kind: 'slug', maxLength: 64 },
    utm_source: { kind: 'slug', maxLength: 64 },
    utm_medium: { kind: 'slug', maxLength: 64 },
    utm_campaign: { kind: 'slug', maxLength: 64 },
    release_sha: { kind: 'slug', maxLength: 64 },
    running_release: { kind: 'slug', maxLength: 64 },
    deployed_release: { kind: 'slug', maxLength: 64 },

    route: { kind: 'route', maxLength: 96 },
});

/** No spaces, no punctuation that carries prose, no control characters, no query material. */
const SLUG = /^[A-Za-z0-9._:-]+$/;
const ROUTE = /^\/[A-Za-z0-9/_-]*$/;

export function isValidForField(field: string, value: unknown): boolean {
    const rule = FIELD_RULES[field];
    if (!rule) return false;                     // no declared shape -> never emitted
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
                && value.every(v => typeof v === 'string' && rule.values.includes(v));
    }
}

/** Retained for callers that only need the coarse check; per-field validation is the authority. */
export function isContentFreeValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    return false;                                 // strings must go through isValidForField
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
        if (!allowed || !allowed.includes(key) || !isValidForField(key, props[key])) {
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
