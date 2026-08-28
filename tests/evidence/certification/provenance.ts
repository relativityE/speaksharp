/**
 * #1304 Task 3C — provenance completeness.
 *
 * A WER without provenance is a number, not evidence: it cannot be reproduced, compared, or argued
 * with. Every one of the seven fields is REQUIRED, and a missing or empty one produces NO SELECTION
 * ROW rather than a row with a gap in it — a row with holes gets compared anyway, and by the time
 * anyone notices, the down-select has already happened.
 */
import { CERTIFICATION_RULES, type RequiredProvenanceField } from './rules';
import type { ArmProvenance } from './engineArm';

export interface ProvenanceCheck {
    ok: boolean;
    missing: RequiredProvenanceField[];
    /** Fields present in shape but carrying nothing — an empty digest map is not provenance. */
    empty: string[];
}

const isBlank = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0);

/** A record that exists but holds nothing tells you as little as one that is absent. */
const isEmptyRecord = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;

export function checkProvenance(provenance: ArmProvenance | null | undefined): ProvenanceCheck {
    const missing: RequiredProvenanceField[] = [];
    const empty: string[] = [];

    if (!provenance) {
        return { ok: false, missing: [...CERTIFICATION_RULES.requiredProvenance], empty };
    }

    for (const field of CERTIFICATION_RULES.requiredProvenance) {
        const value = (provenance as unknown as Record<string, unknown>)[field];
        if (value === null || value === undefined) { missing.push(field); continue; }
        if (isEmptyRecord(value)) { empty.push(field); continue; }

        // One level down: a `model` whose `id` is blank is not a model, and a `filesSha256` with no
        // entries is a promise of digests rather than digests.
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            if (isBlank(inner) || isEmptyRecord(inner)) empty.push(`${field}.${key}`);
        }
    }

    return { ok: missing.length === 0 && empty.length === 0, missing, empty };
}
