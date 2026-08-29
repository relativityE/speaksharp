/**
 * #1304 — an artifact must account for EVERY arm, or it is not evidence.
 *
 * THE DEFECT THIS CLOSES. A `--pins-only` run pushed no result for a successfully loaded arm, so the
 * retained JSON carried a single row — the rejected `no-conditioning` arm — while its log showed
 * fourteen arms loading. Anyone reading the artifact alone would have concluded that one arm was
 * examined and it was rejected.
 *
 * I then claimed the artifact "stands on its own" while the generator that produced it existed only in
 * my working tree, so the merged code could not have produced it. The check below is what makes that
 * claim verifiable rather than asserted: the runner calls it BEFORE writing, so an incomplete artifact
 * cannot be written and later described as complete.
 */
export interface ArtifactRow {
    id: string;
    skipped?: string;
    loaded?: boolean;
}

export type CompletenessFailure =
    | { reason: 'missing_admitted_arms'; detail: string }
    | { reason: 'missing_rejected_arms'; detail: string }
    | { reason: 'unknown_rows'; detail: string }
    | { reason: 'duplicate_rows'; detail: string };

/**
 * Every admitted arm must appear, and every arm excluded by the registry must appear AS excluded.
 *
 * Both halves matter. Omitting admitted arms hides work that was done; omitting rejected ones hides
 * candidates that were considered, and a reader cannot tell "not run" from "never proposed".
 */
export function checkArtifactCompleteness(
    rows: readonly ArtifactRow[],
    expected: { admitted: readonly string[]; excluded: readonly string[] },
): { ok: true } | ({ ok: false } & CompletenessFailure) {
    const seen = rows.map((r) => r.id);
    const duplicates = seen.filter((id, i) => seen.indexOf(id) !== i);
    if (duplicates.length > 0) {
        return { ok: false, reason: 'duplicate_rows', detail: [...new Set(duplicates)].join(', ') };
    }

    const present = new Set(seen);
    const missingAdmitted = expected.admitted.filter((id) => !present.has(id));
    if (missingAdmitted.length > 0) {
        return { ok: false, reason: 'missing_admitted_arms', detail: missingAdmitted.join(', ') };
    }

    const missingExcluded = expected.excluded.filter((id) => !present.has(id));
    if (missingExcluded.length > 0) {
        return { ok: false, reason: 'missing_rejected_arms', detail: missingExcluded.join(', ') };
    }

    const known = new Set([...expected.admitted, ...expected.excluded]);
    const unknown = seen.filter((id) => !known.has(id));
    if (unknown.length > 0) return { ok: false, reason: 'unknown_rows', detail: unknown.join(', ') };

    return { ok: true };
}
