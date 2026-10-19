/** Identity/completeness prerequisite for #1565, independent of statistical policy. */
export interface PairedEvidenceIdentity {
    utteranceId: string;
    trialId: string;
    clusterId: string;
    referenceSha256: string;
    referenceWords: number;
}

function sampleKey(row: PairedEvidenceIdentity): string {
    // A delimiter-concatenated key can alias otherwise different sample/trial IDs.
    return JSON.stringify([row.utteranceId, row.trialId]);
}

function identityIsValid(row: PairedEvidenceIdentity): boolean {
    return row !== null && typeof row === 'object'
        && [row.utteranceId, row.trialId, row.clusterId].every((id) => typeof id === 'string' && id.trim().length > 0)
        && typeof row.referenceSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.referenceSha256)
        && Number.isSafeInteger(row.referenceWords) && row.referenceWords >= 0;
}

function indexRows<T extends PairedEvidenceIdentity>(rows: readonly T[], label: string): Map<string, T> {
    const indexed = new Map<string, T>();
    for (const row of rows) {
        if (!identityIsValid(row)) throw new Error(`paired_evidence_invalid_identity:${label}`);
        const key = sampleKey(row);
        if (indexed.has(key)) throw new Error(`paired_evidence_duplicate_sample:${label}`);
        indexed.set(key, row);
    }
    return indexed;
}

/**
 * Require BOTH arms to cover exactly the predeclared manifest × trials. Do not intersect,
 * deduplicate, infer denominators from one arm, or use model output to repair identity.
 *
 * Preserve each complete row, including execution failures: this check does not score,
 * remove reliability failures, aggregate trials, or approve a confidence-interval policy.
 * The caller must retain the returned full population for those separate decisions.
 */
export function validatePairedEvidence<A extends PairedEvidenceIdentity, B extends PairedEvidenceIdentity>(
    expected: readonly PairedEvidenceIdentity[],
    armA: readonly A[],
    armB: readonly B[],
): readonly { expected: PairedEvidenceIdentity; a: A; b: B }[] {
    if (expected.length === 0) throw new Error('paired_evidence_empty_manifest');
    const manifest = indexRows(expected, 'manifest');
    const clipIdentities = new Map<string, PairedEvidenceIdentity>();
    for (const row of expected) {
        const prior = clipIdentities.get(row.utteranceId);
        if (prior && (prior.clusterId !== row.clusterId || prior.referenceSha256 !== row.referenceSha256
            || prior.referenceWords !== row.referenceWords)) throw new Error('paired_evidence_inconsistent_manifest');
        clipIdentities.set(row.utteranceId, row);
    }
    const a = indexRows(armA, 'A');
    const b = indexRows(armB, 'B');
    const matches = (row: PairedEvidenceIdentity, reference: PairedEvidenceIdentity) =>
        row.clusterId === reference.clusterId && row.referenceSha256 === reference.referenceSha256
        && row.referenceWords === reference.referenceWords;
    for (const [label, rows] of [['A', a], ['B', b]] as const) {
        if (rows.size !== manifest.size || [...rows.keys()].some((key) => !manifest.has(key))) {
            throw new Error(`paired_evidence_sample_set_mismatch:${label}`);
        }
        for (const [key, row] of rows) {
            if (!matches(row, manifest.get(key)!)) throw new Error(`paired_evidence_reference_or_cluster_mismatch:${label}`);
        }
    }
    // A canonical manifest order makes input arrival order irrelevant without discarding rows.
    return [...manifest].map(([key, reference]) => ({ expected: reference, a: a.get(key)!, b: b.get(key)! }));
}
