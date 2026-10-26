/**
 * #1539 F1 (PM ACCEPT 5873315750) — THE READBACK'S COLUMN CONTRACT, DECODED BY NAME.
 *
 * The qualifier decoded PostHog rows by POSITION (`cells[0]` … `cells[27]`), kept in step with the SELECT only by a
 * convention ("appended, never inserted") restated across three review findings. A column inserted or reordered in the
 * SELECT would silently hand one property's value to another: a mis-mapped `phase` or `digests_match` could satisfy a
 * stage invariant, and a swapped `download_ms` / `init_ms` would report the wrong first-download time. Every unit test
 * would stay green, because none executed the decode.
 *
 * Now each query names its columns (every select item carries an alias), the HogQL response's `columns` metadata is
 * required, and rows are decoded BY NAME against the declared list. A reorder is harmless (names still match); a missing,
 * extra, duplicated or renamed column is a named refusal (HOLD), never a silent re-mapping.
 */

/** The readback SELECT in `buildReadbackQuery`, by alias, in its current order. A test pins the two together. */
export const READBACK_COLUMNS = Object.freeze([
    'event', 'timestamp', 'journey_id', 'boot_id',
    'outcome', 'to_state', 'acquired_candidate_id', 'expected_candidate_id', 'candidate_id', 'engine',
    'runtime_version', 'attempt_id', 'attempt_seq', 'subject_boot_id', 'subject_journey_id', 'subject_attempt_id',
    'subject_attempt_seq', 'attribution_status', 'stage', 'transcript_visibly_present', 'digests_match',
    'transport_initialized', 'flush_outcome', 'dropped_count', 'comparison_evidence_document_id', 'review_surface',
    'phase', 'suggestions_present',
    'action', 'action_seq', 'intended_route', 'route_class', 'link_state', 'submit_seq', 'error_category',
    'producer_ts', 'persisted', 'diagnostic_request_id', 'origin_attempt_id', 'end_reason', 'origin_boot_id',
    'intent_kind', 'intent_outcome', 'step', 'option_selected',
] as const);

/** The four row-identity columns; every other readback column is a property the stage evaluation reads. */
export const READBACK_ROW_COLUMNS = Object.freeze(['event', 'timestamp', 'journey_id', 'boot_id'] as const);

/** The first-download acquisition receipt SELECT, by alias. */
export const ACQUISITION_COLUMNS = Object.freeze([
    'model_identity', 'acquired_candidate_id', 'cache_result', 'measurement_completeness', 'measurement_reason_code',
    'network_used', 'download_ms', 'init_ms', 'total_ms', 'network_bytes', 'partial_download_ms',
] as const);

/** Every query has an independent, explicit response schema. */
export const USER_STAGE_COLUMNS = Object.freeze(['event', 'received'] as const);
export const IDENTITY_COLUMNS = Object.freeze(['distinct_id'] as const);
export const COACHING_COLUMNS = Object.freeze([
    'event', 'diagnostic_request_id', 'diagnostic_attempt_id', 'outcome', 'product', 'configured_model',
    'observed_model', 'status', 'provider_status', 'client_release_id', 'coaching_diagnostic_id', 'source',
    'provider_attempts', 'uuid', 'client_attempt',
] as const);

export type DecodedRow<C extends string> = Record<C, unknown>;
export type ColumnDecode<C extends string> =
    | { ok: true; rows: DecodedRow<C>[] }
    | { ok: false; reason: string };

/**
 * Decode HogQL `results` by the response's own `columns`, against the declared set. Values are passed through
 * unsanitised (the evaluators' contract is to see whatever arrived, junk included); only the STRUCTURE is refused.
 */
export function decodeByColumns<C extends string>(
    expected: readonly C[],
    columns: unknown,
    rows: readonly unknown[],
): ColumnDecode<C> {
    if (!Array.isArray(columns) || columns.some((c) => typeof c !== 'string')) {
        return { ok: false, reason: 'the response carried no column names, so rows cannot be decoded by name' };
    }
    const names = columns as string[];
    const duplicate = names.find((name, i) => names.indexOf(name) !== i);
    if (duplicate !== undefined) return { ok: false, reason: 'the response names a column twice' };
    const missing = expected.filter((name) => !names.includes(name));
    const unexpected = names.filter((name) => !(expected as readonly string[]).includes(name));
    if (missing.length > 0 || unexpected.length > 0) {
        return {
            ok: false,
            // Response metadata is untrusted too: only expected governed names and counts may be logged.
            reason: `the response columns do not match the declared contract (missing: ${missing.join(',') || 'none'}; unexpected count: ${unexpected.length})`,
        };
    }
    const index = new Map(names.map((name, i) => [name, i] as const));
    const decoded: DecodedRow<C>[] = [];
    for (const [n, row] of rows.entries()) {
        if (!Array.isArray(row) || row.length !== names.length) {
            return { ok: false, reason: `row ${n} does not have exactly ${names.length} cells` };
        }
        const out = {} as DecodedRow<C>;
        for (const name of expected) out[name] = row[index.get(name)!] ?? null;
        decoded.push(out);
    }
    return { ok: true, rows: decoded };
}

/** A readback row as the qualification reads it: row identity at the top level, every other column a property. */
export interface ReadbackRow {
    event: string;
    timestamp: string;
    journeyId: string | null;
    bootId: string | null;
    properties: Record<string, unknown>;
}

/** Shared by the real entrypoint and retained round-trip consumers; all later fields pass through. */
export function readbackRowsFromNamed(rows: readonly Record<string, unknown>[]): ReadbackRow[] {
    return rows.map(({ event, timestamp, journey_id, boot_id, ...properties }) => ({
        event: event as string,
        timestamp: timestamp as string,
        journeyId: (journey_id ?? null) as string | null,
        bootId: (boot_id ?? null) as string | null,
        properties,
    }));
}

/**
 * THE one readback decoder: the qualifier and its tests both call this, so a test that round-trips rows exercises the
 * decoder production runs, not a re-implementation parsed out of source text.
 */
export function readbackRowsByName(columns: unknown, rows: readonly unknown[]): { ok: true; rows: ReadbackRow[] } | { ok: false; reason: string } {
    const decoded = decodeByColumns(READBACK_COLUMNS, columns, rows);
    if (!decoded.ok) return decoded;
    return {
        ok: true,
        rows: readbackRowsFromNamed(decoded.rows),
    };
}

/** The select-item aliases of a HogQL SELECT, in order (every item must be `… AS alias`, or a bare identifier). */
export function selectAliases(hogql: string): string[] {
    const m = /SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(hogql);
    if (!m) return [];
    return m[1].split(',').map((item) => {
        const t = item.trim();
        const alias = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(t);
        return alias ? alias[1] : t;
    });
}
