import { describe, expect, it } from 'vitest';
import { validatePairedEvidence, type PairedEvidenceIdentity } from '../pairedEvidence';

const row = (utteranceId: string, trialId = 'trial-1'): PairedEvidenceIdentity => ({
    utteranceId, trialId, clusterId: 'speaker-1', referenceSha256: 'a'.repeat(64), referenceWords: 10,
});
const manifest = [row('clip-1'), row('clip-2')];

describe('#1565 paired completeness before statistics', () => {
    it('returns every exact pair in manifest order, retaining differing outputs and outcomes', () => {
        const a = manifest.map((identity) => ({ ...identity, outcome: 'decoded', errors: 1 }));
        const b = [...manifest].reverse().map((identity) => ({ ...identity, outcome: 'timed_out', errors: null }));
        const pairs = validatePairedEvidence(manifest, a, b);
        expect(pairs.map((pair) => pair.a.utteranceId)).toEqual(['clip-1', 'clip-2']);
        expect(pairs.every((pair) => pair.b.outcome === 'timed_out' && pair.b.errors === null)).toBe(true);
        expect(pairs[0].a).toBe(a[0]);
        expect(pairs[0].b).toBe(b[1]);
    });

    it.each(['A', 'B'])('rejects duplicate sample IDs in %s rather than collapsing a map', (arm) => {
        const duplicate = [manifest[0], manifest[0]];
        expect(() => validatePairedEvidence(manifest, arm === 'A' ? duplicate : manifest,
            arm === 'B' ? duplicate : manifest)).toThrow(`paired_evidence_duplicate_sample:${arm}`);
    });

    it.each(['A', 'B'])('rejects missing, extra or substituted samples in %s', (arm) => {
        for (const damaged of [manifest.slice(0, 1), [...manifest, row('extra')], [manifest[0], row('replacement')]]) {
            expect(() => validatePairedEvidence(manifest, arm === 'A' ? damaged : manifest,
                arm === 'B' ? damaged : manifest)).toThrow(`paired_evidence_sample_set_mismatch:${arm}`);
        }
    });

    it('rejects the same missing sample in both arms against the predeclared manifest', () => {
        expect(() => validatePairedEvidence(manifest, manifest.slice(0, 1), manifest.slice(0, 1)))
            .toThrow('paired_evidence_sample_set_mismatch');
    });

    it.each(['referenceSha256', 'referenceWords', 'clusterId'] as const)('rejects %s mismatch independently in either arm', (field) => {
        const wrong = { ...manifest[0], [field]: field === 'referenceWords' ? 11 : field === 'referenceSha256' ? 'b'.repeat(64) : 'speaker-2' };
        const damaged = [wrong, manifest[1]];
        expect(() => validatePairedEvidence(manifest, damaged, manifest)).toThrow('paired_evidence_reference_or_cluster_mismatch:A');
        expect(() => validatePairedEvidence(manifest, manifest, damaged)).toThrow('paired_evidence_reference_or_cluster_mismatch:B');
        expect(() => validatePairedEvidence(manifest, damaged, damaged)).toThrow('paired_evidence_reference_or_cluster_mismatch:A');
    });

    it('requires the exact trial set while preserving valid repeats as separate rows', () => {
        const repeated = [row('clip-1', 'trial-1'), row('clip-1', 'trial-2')];
        expect(validatePairedEvidence(repeated, repeated, [...repeated].reverse())).toHaveLength(2);
        expect(() => validatePairedEvidence(repeated, repeated, [repeated[0], row('clip-1', 'trial-3')]))
            .toThrow('paired_evidence_sample_set_mismatch:B');
    });

    it('uses collision-safe compound sample keys', () => {
        const ambiguous = [row('clip:trial', 'one'), row('clip', 'trial:one')];
        expect(validatePairedEvidence(ambiguous, ambiguous, ambiguous)).toHaveLength(2);
    });

    it('preserves a valid expected-empty silence row with zero reference words', () => {
        const silence = [{ ...row('silence'), referenceWords: 0, outcome: 'expected_empty' }];
        expect(validatePairedEvidence(silence, silence, silence)[0].a.outcome).toBe('expected_empty');
    });

    it('rejects empty, duplicate or internally inconsistent manifests', () => {
        expect(() => validatePairedEvidence([], [], [])).toThrow('paired_evidence_empty_manifest');
        expect(() => validatePairedEvidence([manifest[0], manifest[0]], manifest, manifest)).toThrow('paired_evidence_duplicate_sample:manifest');
        for (const mismatch of [{ referenceWords: 9 }, { clusterId: 'speaker-2' }, { referenceSha256: 'b'.repeat(64) }]) {
            const bad = [row('clip-1', 'trial-1'), { ...row('clip-1', 'trial-2'), ...mismatch }];
            expect(() => validatePairedEvidence(bad, bad, bad)).toThrow('paired_evidence_inconsistent_manifest');
        }
    });

    it('rejects unmeasured or invalid identities rather than inventing a reference denominator', () => {
        for (const damaged of [{ referenceWords: -1 }, { referenceWords: NaN }, { referenceWords: 1.5 },
            { referenceSha256: '' }, { utteranceId: '' }, { trialId: '' }, { clusterId: '' }]) {
            const invalid = [{ ...manifest[0], ...damaged }, manifest[1]];
            expect(() => validatePairedEvidence(manifest, invalid, manifest)).toThrow('paired_evidence_invalid_identity:A');
        }
    });
});
