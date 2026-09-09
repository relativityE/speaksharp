/**
 * #1421 P1 — pre-journey receipts must belong to the BOOT that produced the selected journey.
 *
 * `account_identified` and `telemetry_positive_control` are emitted at sign-in, before the product
 * journey exists, so they cannot be journey-scoped. Scoping them only by identity, release, traffic
 * class and a 24-hour window re-opened the union the journey filter was added to close: when the
 * controlled account boots twice in that window, the SELECTED journey can be missing both of its own
 * receipts and still qualify on the other boot's.
 *
 * There is no boot identifier in the telemetry vocabulary, and adding one is instrumentation change.
 * The boot is instead identified by position: the receipts belonging to this journey's boot are the
 * ones emitted after any earlier journey by the same identity and at or before this journey begins.
 * A receipt from a later boot is after this journey's start; a receipt from an earlier boot is behind
 * an intervening journey. Both are excluded.
 *
 * This lives in a checked module, not in the query string, because the refusal is the whole point and
 * a rule expressed only in SQL cannot be driven by a casualty.
 */

export interface TimestampedEvent {
    event: string;
    /** ISO instant or epoch millis; anything unparseable is treated as unusable, never as in-window. */
    timestamp: string | number | null | undefined;
    journeyId?: string | null;
}

export interface BootWindow {
    /** Exclusive lower bound: the end of the most recent EARLIER journey, or null when none exists. */
    after: number | null;
    /** Inclusive upper bound: the selected journey's first event. */
    atOrBefore: number;
}

const instant = (value: TimestampedEvent['timestamp']): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length === 0) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The window bounding the boot that produced `journeyId`, or a refusal reason.
 *
 * A journey with no readable events has no boot to bind to, and holds rather than falling back to an
 * unbounded match — the same rule `resolveQualifyingIdentity` applies to identity.
 */
export function resolveBootWindow(
    events: readonly TimestampedEvent[],
    journeyId: string,
    preJourneyFamilies: readonly string[] = [],
): { ok: true; window: BootWindow } | { ok: false; reason: string } {
    const selected: number[] = [];
    const otherJourneys: number[] = [];

    for (const row of events) {
        const at = instant(row?.timestamp);
        if (at === null) continue;
        if (row.journeyId === journeyId) { selected.push(at); continue; }
        /**
         * PRE-JOURNEY RECEIPTS ARE NOT A JOURNEY BOUNDARY — and my first version made them one.
         *
         * In production `account_identified` and `telemetry_positive_control` carry the PRE-PRODUCT
         * `journey_id` that exists before `ensureJourneyBoundary()` mints the selected journey. Treating
         * any non-matching journey id as an earlier journey therefore filed the receipts themselves
         * into `otherJourneys`; their own timestamp became `window.after`, and the window then excluded
         * them. Every complete, legitimate run would have HELD.
         *
         * My casualty missed it because it gave the receipts `journeyId: null`, which is not the
         * production envelope — the fixture, not the rule, was wrong.
         *
         * A receipt cannot bound the boot it belongs to, so the pre-journey families never contribute
         * to the lower bound. Only genuine product journeys do.
         */
        if (preJourneyFamilies.includes(row.event)) continue;
        if (typeof row.journeyId === 'string' && row.journeyId.length > 0) otherJourneys.push(at);
    }

    if (selected.length === 0) {
        return {
            ok: false,
            reason: 'the selected journey produced no readable events, so there is no boot to bind its receipts to',
        };
    }

    const atOrBefore = Math.min(...selected);
    const earlier = otherJourneys.filter(at => at < atOrBefore);
    return {
        ok: true,
        window: { after: earlier.length > 0 ? Math.max(...earlier) : null, atOrBefore },
    };
}

/** True only for a receipt emitted by the boot that produced the selected journey. */
export function receiptBelongsToBoot(row: TimestampedEvent, window: BootWindow): boolean {
    const at = instant(row?.timestamp);
    if (at === null) return false;
    if (at > window.atOrBefore) return false;
    if (window.after !== null && at <= window.after) return false;
    return true;
}

/** The pre-journey receipt families this boot actually produced. */
export function bootScopedReceiptFamilies(
    events: readonly TimestampedEvent[],
    window: BootWindow,
    preJourneyFamilies: readonly string[],
): string[] {
    const families = new Set(preJourneyFamilies);
    const found = new Set<string>();
    for (const row of events) {
        if (!families.has(row?.event)) continue;
        if (receiptBelongsToBoot(row, window)) found.add(row.event);
    }
    return [...found];
}

/**
 * #1421 P1 — THE READBACK MUST FETCH WHAT `resolveBootWindow` DEPENDS ON.
 *
 * The query restricted rows to `journey_id = <selected> OR event IN <pre-journey families>`. Those are
 * the only two things the resolver is NOT allowed to use as a boundary: the selected journey supplies
 * `atOrBefore`, and the receipt families are the subject being scoped and are skipped outright. The
 * one input that produces `window.after` — an EARLIER product journey by the same identity — was
 * therefore never fetched. `otherJourneys` was always empty, the lower bound was always `null`, and an
 * earlier boot's receipts still qualified the later journey. The binding was inert in production while
 * the unit casualty, which is handed rows directly, went green.
 *
 * The scope is widened to every governed event for the bound identity in the release, traffic class
 * and window. That is safe downstream: journey-scoped families are still selected by
 * `journeyId === journeyId`, and receipts are still admitted only by `receiptBelongsToBoot`, so the
 * extra rows can supply a boundary but cannot supply evidence.
 *
 * It is built here, as a value, so the scope is a contract a casualty can drive — the previous comment
 * claimed "a rule expressed only in SQL cannot be driven by a casualty" and then left this rule in SQL.
 */
export function buildReadbackQuery(params: {
    windowHours: number;
    releaseSha: string;
    trafficType: string;
    qualifyingIdentity: string;
    governedEvents: readonly string[];
    quote: (value: string) => string;
}): string {
    const { windowHours, releaseSha, trafficType, qualifyingIdentity, governedEvents, quote } = params;
    const governedList = governedEvents.map(quote).join(', ');
    return `
        SELECT event, timestamp, properties.journey_id AS journey_id
        FROM events
        WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
          AND properties.release_sha = ${quote(releaseSha)}
          AND properties.traffic_type = ${quote(trafficType)}
          AND distinct_id = ${quote(qualifyingIdentity)}
          AND event IN (${governedList})
    `;
}
