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
    COMPONENT_CRASH: ['component', 'isolationKey'],
    // `reason` ABSENT: a rejection reason is arbitrary runtime text. The event's OCCURRENCE is the signal.
    GLOBAL_UNHANDLED_REJECTION: [],

    // ── identity ────────────────────────────────────────────────────────────
    account_identified: ['source'],
});

/** Envelope keys the buffer itself adds; never caller-supplied. */
export const ENVELOPE_KEYS = Object.freeze(['$priority', '$ts']);

/**
 * Values that may survive projection.
 *
 * An allowlisted KEY is not sufficient — a nested object or array can smuggle free text under an approved
 * name. Only primitives pass, and strings are length-capped so an approved field cannot become a payload.
 */
const MAX_STRING = 120;

export function isContentFreeValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (typeof value === 'string') return value.length <= MAX_STRING;
    return false;   // objects, arrays, functions, symbols — never
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
        if (!allowed || !allowed.includes(key) || !isContentFreeValue(props[key])) {
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
