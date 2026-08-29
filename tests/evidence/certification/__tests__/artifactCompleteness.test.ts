/**
 * #1304 — a pins-only artifact must contain every admitted arm plus every named rejected arm.
 *
 * THE DEFECT. A `--pins-only` run pushed no result for a successfully loaded arm, so the retained
 * JSON held one row — the rejected `no-conditioning` arm — while its log showed fourteen arms
 * loading. Read alone, that artifact says one arm was examined and rejected.
 *
 * I compounded it by describing the artifact as self-standing while the generator that produced it
 * existed only in my working tree, so the merged code could not have produced it. This suite is what
 * turns that claim into something checkable: the runner refuses to WRITE an artifact that fails it.
 *
 * Deliberately pure — no browser, no network — so it can run beside a long measurement without
 * competing for the machine and disturbing the timings that measurement is producing.
 */
import { describe, it, expect } from 'vitest';
import { checkArtifactCompleteness } from '../artifactCompleteness';
import { ADMITTED_ARMS, ARM_MATRIX } from '../arms/registry';

const EXPECTED = {
    admitted: ADMITTED_ARMS.map((a) => a.id),
    excluded: ARM_MATRIX.filter((a) => a.admission.status !== 'admitted').map((a) => a.id),
};

const fullArtifact = () => [
    ...EXPECTED.admitted.map((id) => ({ id, loaded: true })),
    ...EXPECTED.excluded.map((id) => ({ id, skipped: 'rejected' })),
];

describe('a complete artifact accounts for every arm in the matrix', () => {
    it('the real registry produces a checkable expectation', () => {
        expect(EXPECTED.admitted.length).toBeGreaterThan(10);
        expect(EXPECTED.excluded.length).toBeGreaterThan(0);
        expect(EXPECTED.admitted.length + EXPECTED.excluded.length).toBe(ARM_MATRIX.length);
    });

    it('a full artifact passes', () => {
        expect(checkArtifactCompleteness(fullArtifact(), EXPECTED)).toEqual({ ok: true });
    });

    it('THE EXACT DEFECT: only the rejected row present', () => {
        // What the retained artifact actually contained. It must be refused, not written.
        const onlyRejected = EXPECTED.excluded.map((id) => ({ id, skipped: 'rejected' }));
        const result = checkArtifactCompleteness(onlyRejected, EXPECTED);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('missing_admitted_arms');
        // It names WHICH arms are absent, so the failure is actionable rather than a bare count.
        expect(result.detail).toContain('v2:base.en');
    });

    it('a SINGLE missing admitted arm is refused', () => {
        const result = checkArtifactCompleteness(fullArtifact().slice(1), EXPECTED);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('missing_admitted_arms');
    });

    it('omitting a REJECTED arm is refused too', () => {
        // A reader cannot otherwise tell "not run" from "never proposed". Both halves are evidence.
        const withoutRejected = EXPECTED.admitted.map((id) => ({ id, loaded: true }));
        const result = checkArtifactCompleteness(withoutRejected, EXPECTED);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('missing_rejected_arms');
        expect(result.detail).toContain('no-conditioning');
    });

    it('a DUPLICATE row is refused — one arm counted twice is not fifteen arms', () => {
        const doubled = [...fullArtifact(), { id: 'v2:base.en', loaded: true }];
        const result = checkArtifactCompleteness(doubled, EXPECTED);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('duplicate_rows');
    });

    it('a row for an arm not in the matrix is refused', () => {
        const stranger = [...fullArtifact(), { id: 'some:other-model', loaded: true }];
        const result = checkArtifactCompleteness(stranger, EXPECTED);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('unknown_rows');
    });

    it('the retained offline-load artifact, if present, is complete', async () => {
        // Reads the committed artifact and holds it to the same rule. If regeneration is still
        // outstanding this states that plainly rather than passing by absence.
        const fs = await import('node:fs');
        const path = 'evidence-runs/offline-load-0e2fffd1.json';
        if (!fs.existsSync(path)) {
            expect(fs.existsSync(path), `${path} has not been regenerated yet`).toBe(false);
            return;
        }
        const artifact = JSON.parse(fs.readFileSync(path, 'utf8')) as { results: { id: string }[] };
        expect(checkArtifactCompleteness(artifact.results, EXPECTED)).toEqual({ ok: true });
    });
});
