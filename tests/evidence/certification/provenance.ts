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
    /** Fields carrying a placeholder such as `unknown`, which is an absent value that reads as answered. */
    placeholder: string[];
}

/**
 * Values that LOOK like provenance and carry none. `runtime: { version: 'unknown' }` passed every
 * emptiness check while saying precisely as much as an absent field — and worse, it said it in a shape
 * that reads as answered. A placeholder is a missing value wearing a value's clothes.
 */
const PLACEHOLDERS = new Set([
    'unknown', 'unpinned', 'n/a', 'na', 'none', 'null', 'undefined', 'tbd', 'todo',
    'placeholder', 'default', '-', '?', 'xxx', 'foo', 'bar', 'test',
]);

export const isPlaceholder = (v: unknown): boolean =>
    typeof v === 'string' && PLACEHOLDERS.has(v.trim().toLowerCase());

const isBlank = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0);

/** A record that exists but holds nothing tells you as little as one that is absent. */
const isEmptyRecord = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;

export function checkProvenance(provenance: ArmProvenance | null | undefined): ProvenanceCheck {
    const missing: RequiredProvenanceField[] = [];
    const empty: string[] = [];
    const placeholder: string[] = [];

    if (!provenance) {
        return { ok: false, missing: [...CERTIFICATION_RULES.requiredProvenance], empty, placeholder };
    }

    for (const field of CERTIFICATION_RULES.requiredProvenance) {
        const value = (provenance as unknown as Record<string, unknown>)[field];
        if (value === null || value === undefined) { missing.push(field); continue; }
        if (isEmptyRecord(value)) { empty.push(field); continue; }

        // One level down: a `model` whose `id` is blank is not a model, and a `filesSha256` with no
        // entries is a promise of digests rather than digests.
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            // An explicit `null` on a NULLABLE resource field means "not observable here" and is
            // honest. Everywhere else null is absence, and absence is a gap.
            if (inner === null && field === 'resources') continue;
            if (isBlank(inner) || isEmptyRecord(inner)) { empty.push(`${field}.${key}`); continue; }
            if (isPlaceholder(inner)) { placeholder.push(`${field}.${key}`); continue; }
            // A digest map whose values are placeholders is a map of nothing.
            if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
                for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
                    if (isBlank(v) || isPlaceholder(v)) placeholder.push(`${field}.${key}.${k}`);
                }
            }
        }
    }

    return {
        ok: missing.length === 0 && empty.length === 0 && placeholder.length === 0,
        missing,
        empty,
        placeholder,
    };
}
