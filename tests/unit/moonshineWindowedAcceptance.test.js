import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    evaluateMoonshineWindowedRepeatability,
    MAX_REPEATABILITY_WORD_DRIFT,
} from '../../scripts/human-test/moonshineWindowedAcceptance.mjs';

const prefix = Array.from({ length: 37 }, (_, index) => `word${index}`).join(' ');
const retained = (name) => JSON.parse(readFileSync(
    `product_release/evidence/retained/${name}`,
    'utf8',
));

describe('#1432 Moonshine windowed real-runtime acceptance', () => {
    it('accepts the observed one-tail-token variance without calling it cross-session state', () => {
        const result = evaluateMoonshineWindowedRepeatability(
            `${prefix} truck`,
            `${prefix} child`,
            `${prefix} child`,
        );

        expect(result.sameInstanceWordEdits).toBe(1);
        expect(result.sameInstanceDrift).toBeCloseTo(1 / 38);
        expect(result.sameInstanceWithinFreshVariation).toBe(true);
        expect(result.allRunsWithinCeiling).toBe(true);
    });

    it.each(['moonshine-windowed-ef.json', 'moonshine-windowed-ef-run2.json'])(
        're-evaluates the unedited real-runtime observations in %s as comparison-ready',
        (name) => {
            const artifact = retained(name);
            const result = evaluateMoonshineWindowedRepeatability(
                artifact.outcome.sessionA.final,
                artifact.outcome.sessionB.final,
                artifact.outcome.sessionC.final,
            );

            expect(result.maximumPairwiseDrift).toBeCloseTo(1 / 38);
            expect(result.sameInstanceWithinFreshVariation).toBe(true);
            expect(result.allRunsWithinCeiling).toBe(true);
        },
    );

    it('fails when reuse compounds output that a fresh engine does not', () => {
        const clean = `${prefix} town`;
        const compounded = `${clean} ${clean}`;
        const result = evaluateMoonshineWindowedRepeatability(clean, compounded, clean);

        expect(result.sameInstanceWithinFreshVariation).toBe(false);
        expect(result.allRunsWithinCeiling).toBe(false);
    });

    it('fails material instance-dependent drift even when same-instance output is stable', () => {
        const stable = `${prefix} town`;
        const unrelated = 'this fresh instance produced a materially different transcript';
        const result = evaluateMoonshineWindowedRepeatability(stable, stable, unrelated);

        expect(result.sameInstanceWithinFreshVariation).toBe(true);
        expect(result.maximumPairwiseDrift).toBeGreaterThan(MAX_REPEATABILITY_WORD_DRIFT);
        expect(result.allRunsWithinCeiling).toBe(false);
    });
});
