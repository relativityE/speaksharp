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
): { ok: true; window: BootWindow } | { ok: false; reason: string } {
    const selected: number[] = [];
    const otherJourneys: number[] = [];

    for (const row of events) {
        const at = instant(row?.timestamp);
        if (at === null) continue;
        if (row.journeyId === journeyId) selected.push(at);
        else if (typeof row.journeyId === 'string' && row.journeyId.length > 0) otherJourneys.push(at);
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
