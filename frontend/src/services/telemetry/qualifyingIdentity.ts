/**
 * #1421 P2 — resolve THE ONE identity a journey's receipts may be bound to.
 *
 * Lives here rather than inside `scripts/telemetry-readback-qualification.mts` because the refusal in
 * it is the whole point, and a refusal reached only through a CLI's `process.exit` cannot be driven by
 * a casualty. The script keeps the policy — what to do about a refusal — and this owns the reading.
 */

export type QualifyingIdentity =
    | { ok: true; distinctId: string }
    | { ok: false; reason: string };

/**
 * A readback row as the query client hands it back: either a single-column array or a bare value.
 * Deliberately `unknown` — the shape is what is in question.
 */
export type IdentityRow = unknown;

/**
 * EVERY ROW IS VALIDATED BEFORE ANY OF THEM IS COUNTED.
 *
 * The previous implementation filtered malformed entries away and then checked the cardinality of what
 * survived, so one valid identity beside one null, one empty string, or one unexpected row shape
 * qualified as "exactly one identity". The discarded rows were the ones most worth stopping for: a
 * readback that cannot parse part of its own answer does not know how many identities the journey
 * spans, and an unreadable row is indistinguishable from a second person.
 *
 * A row that cannot be read is therefore a refusal, never a filter.
 */
export function resolveQualifyingIdentity(rows: readonly IdentityRow[]): QualifyingIdentity {
    const read: string[] = [];
    for (const [index, row] of rows.entries()) {
        const cell = Array.isArray(row) ? row[0] : row;
        if (typeof cell !== 'string' || cell.length === 0) {
            const described = cell === null ? 'null' : (typeof cell === 'string' ? 'an empty string' : typeof cell);
            return {
                ok: false,
                reason: `the qualifying identity lookup returned a row this readback cannot parse `
                    + `(row ${index} is ${described}) — a row that cannot be read cannot be ruled out `
                    + 'as a second identity',
            };
        }
        read.push(cell);
    }

    const distinct = [...new Set(read)];
    if (distinct.length === 0) {
        return {
            ok: false,
            // Kept as ONE literal: `completenessGateWiring` scans for this exact refusal phrase, and a
            // string split across source lines is invisible to that scan.
            reason: 'the journey produced no events for this release and traffic class — there is no identity to bind its receipts to',
        };
    }
    if (distinct.length > 1) {
        // One journey belongs to one person. More than one identity means the journey id is not the
        // discriminator we believe it is, and every conclusion drawn from it is suspect.
        return {
            ok: false,
            reason: `the journey spans ${distinct.length} distinct identities — a journey belongs to exactly one`,
        };
    }
    return { ok: true, distinctId: distinct[0] };
}
