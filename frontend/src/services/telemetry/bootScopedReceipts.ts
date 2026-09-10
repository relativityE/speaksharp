/**
 * #1421 P1 — pre-journey receipts must belong to the BOOT that produced the selected journey.
 *
 * `account_identified` and `telemetry_positive_control` are emitted at sign-in, before the product
 * journey exists, so they cannot be journey-scoped. Scoping them only by identity, release, traffic
 * class and a 24-hour window let the SELECTED journey be missing both of its own receipts and still
 * qualify on another boot's.
 *
 * TWO EARLIER ATTEMPTS INFERRED THE BOOT FROM POSITION, AND BOTH WERE WRONG.
 *
 * The boot was identified as "after any earlier journey by the same identity, at or before this
 * journey begins". That premise does not hold: `ensureJourneyBoundary()` starts a NEW journey on every
 * non-product -> product transition, so one boot legitimately contains several journeys, while the
 * receipts are emitted once per boot. The position rule therefore either admitted another boot's
 * receipts (when the boundary rows were not fetched at all) or rejected the boot's OWN receipts
 * (once they were, because an earlier journey of the same boot became the lower bound). Ordering
 * cannot separate "new boot" from "re-entered the product", because that fact was not in the data.
 *
 * It is now. `boot_id` is minted once per page bootstrap and attached by the envelope, so a receipt
 * and a journey belong to the same boot iff they carry the same value. This is an equality check
 * against a declared authority, not an inference from timing — there is no window left to get wrong.
 *
 * FAILS CLOSED. Missing, malformed or conflicting boot authority HOLDs rather than guessing: a
 * qualification that cannot establish which boot produced the evidence has not qualified anything.
 *
 * This lives in a checked module, not in the query string, because the refusal is the whole point and
 * a rule expressed only in SQL cannot be driven by a casualty — which is exactly what the previous
 * version of this comment claimed while leaving the scope rule in SQL.
 */

export interface TimestampedEvent {
    event: string;
    /** Carried for diagnostics only. Nothing in this module infers a boundary from it any more. */
    timestamp?: string | number | null;
    journeyId?: string | null;
    /** The boot that emitted this row. Absent/blank is unusable authority, never a wildcard. */
    bootId?: string | null;
}


/**
 * The BOOT AUTHORITY for `journeyId`: the single `boot_id` its rows agree on, or a refusal.
 *
 * A journey whose rows carry no boot id, or disagree about it, has no authority to bind receipts to
 * and HOLDs — the same rule `resolveQualifyingIdentity` applies to identity, and for the same reason:
 * falling back to an unbound match is how a receipt from somewhere else becomes evidence.
 */
export function resolveBootAuthority(
    events: readonly TimestampedEvent[],
    journeyId: string,
): { ok: true; bootId: string } | { ok: false; reason: string } {
    const declared = new Set<string>();
    let sawSelectedRow = false;

    for (const row of events) {
        if (row?.journeyId !== journeyId) continue;
        sawSelectedRow = true;
        const bootId = typeof row.bootId === 'string' ? row.bootId.trim() : '';
        // A blank or absent id is UNUSABLE AUTHORITY, not an absent constraint. Skipping it here and
        // accepting the remaining rows would let one well-formed row speak for a journey whose other
        // rows disagree, which is the conflict case this is supposed to refuse.
        if (bootId.length === 0) {
            return {
                ok: false,
                reason: 'the selected journey has a row with no boot identity, so its boot cannot be established',
            };
        }
        declared.add(bootId);
    }

    if (!sawSelectedRow) {
        return {
            ok: false,
            reason: 'the selected journey produced no readable events, so there is no boot to bind its receipts to',
        };
    }
    if (declared.size > 1) {
        return {
            ok: false,
            reason: 'the selected journey reports more than one boot identity, so its boot is ambiguous',
        };
    }
    return { ok: true, bootId: [...declared][0] };
}

/** Whether a receipt row was emitted by the boot that produced the selected journey. */
export function receiptBelongsToBoot(row: TimestampedEvent, bootId: string): boolean {
    const declared = typeof row?.bootId === 'string' ? row.bootId.trim() : '';
    return declared.length > 0 && declared === bootId;
}

/** The pre-journey receipt families this boot actually produced. */
export function bootScopedReceiptFamilies(
    events: readonly TimestampedEvent[],
    bootId: string,
    preJourneyFamilies: readonly string[],
): string[] {
    const families = new Set(preJourneyFamilies);
    const found = new Set<string>();
    for (const row of events) {
        if (!families.has(row?.event)) continue;
        if (receiptBelongsToBoot(row, bootId)) found.add(row.event);
    }
    return [...found];
}

/**
 * #1421 P1 — THE READBACK MUST FETCH THE ROWS THE BOOT AUTHORITY IS CARRIED ON.
 *
 * The query restricted rows to `journey_id = <selected> OR event IN <pre-journey families>`. The
 * receipts are emitted under the PRE-PRODUCT journey, and the boot authority now has to be read off
 * BOTH the selected journey's rows and the receipt rows, so a query scoped to the selected journey id
 * cannot return what the qualification needs.
 *
 * The scope is every governed event for the bound identity in the release, traffic class and window.
 * That is safe: journey-scoped families are still selected by `journeyId === journeyId`, and receipts
 * are still admitted only by an exact `boot_id` match, so the extra rows can carry authority but
 * cannot become evidence.
 *
 * It is built here, as a value, so the scope is a contract a casualty can drive. The version this
 * replaces carried a comment claiming "a rule expressed only in SQL cannot be driven by a casualty"
 * and then left the rule in SQL, where two successive defects hid.
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
    /**
     * #1421 P1 — SELECT WHAT THE QUALIFICATION READS, AND ONLY THAT.
     *
     * The boot id is the authority: without it the decoder reads undefined and every journey HOLDs.
     * The three property fields feed the stage invariants. They are named individually rather than
     * selecting the whole property bag, so the readback cannot carry transcript, feedback prose,
     * audio, a URL, a token or a free-form error even by accident — each field here is a closed-set
     * value or a governed opaque identifier.
     */
    return `
        SELECT event, timestamp, properties.journey_id AS journey_id, properties.boot_id AS boot_id,
               properties.outcome AS outcome, properties.to_state AS to_state,
               properties.acquired_candidate_id AS acquired_candidate_id,
               properties.expected_candidate_id AS expected_candidate_id,
               properties.candidate_id AS candidate_id,
               properties.engine AS engine, properties.runtime_version AS runtime_version
        FROM events
        WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
          AND properties.release_sha = ${quote(releaseSha)}
          AND properties.traffic_type = ${quote(trafficType)}
          AND distinct_id = ${quote(qualifyingIdentity)}
          AND event IN (${governedList})
    `;
}
