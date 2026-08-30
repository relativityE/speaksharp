import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #1304 — structural guards on the runner for defects that are only visible in its source.
 *
 * These are deliberately source-level: the runner drives a real browser over a 600-clip corpus, so the
 * behaviours below cannot be exercised in a unit test. Each pins a specific defect that shipped.
 */
const SRC = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');

describe('product baseline is not inferred from HEAD', () => {
    it('productBaseline and executionSha are NOT both headSha()', () => {
        // They were. The artifact then asserted an identity it had never established.
        expect(SRC).not.toMatch(/productBaseline:\s*headSha\(\)/);
        expect(SRC).toMatch(/executionSha:\s*headSha\(\)/);
    });

    it('the baseline must be STATED, and the run refuses without it', () => {
        expect(SRC).toMatch(/--product-baseline=/);
        expect(SRC).toMatch(/PRODUCT_BASELINE/);
        expect(SRC).toMatch(/REFUSING to run: the product baseline was not stated/);
    });
});

describe('decodedClips is a measured outcome, not clips offered', () => {
    it('decodedClips comes from the reliability record', () => {
        // `decodedClips: utterances.length` let a 148-throw run serialize 600 decoded clips.
        expect(SRC).not.toMatch(/decodedClips:\s*utterances\.length/);
        expect(SRC).toMatch(/decodedClips:\s*verdict\.reliability\.decoded/);
        expect(SRC).toMatch(/expectedClips:\s*verdict\.reliability\.expectedClips/);
    });

    it('clips OFFERED is retained under its own name, not conflated with success', () => {
        expect(SRC).toMatch(/clipsOffered:\s*utterances\.length/);
    });

    it('the reliability record travels WITH the row, so counts can be cross-checked', () => {
        expect(SRC).toMatch(/reliability:\s*\{/);
        for (const f of ['threw', 'emptyOutput', 'missing']) expect(SRC).toContain(`${f}: verdict.reliability.${f}`);
    });
});

describe('the asset gate constrains eligibility', () => {
    it('reconciliation is computed BEFORE selectionEligible, not ~100 lines after it', () => {
        const recon = SRC.indexOf('const assetReconciliation = reconcileAssets(');
        const eligible = SRC.indexOf('const selectionEligible = backendProven');
        expect(recon).toBeGreaterThan(-1);
        expect(eligible).toBeGreaterThan(-1);
        expect(recon).toBeLessThan(eligible);
    });

    it('selectionEligible actually REQUIRES reconciliation to have passed', () => {
        const clause = SRC.slice(SRC.indexOf('const selectionEligible = backendProven'), SRC.indexOf('const ineligible'));
        expect(clause).toContain('assetReconciliation.ok');
    });

    it('the inventory is reconciled against the OBSERVED ledger, not against itself', () => {
        expect(SRC).not.toMatch(/assetInventory:\s*buildAssetInventory\(allArmAssets,\s*\(verdict\.footprint/);
        expect(SRC).toMatch(/reconcileAssets\(\s*\w+,\s*Object\.fromEntries\(observedRequests\)/);
    });

    it('the observed ledger is built from the page responses, independently of the harness capture', () => {
        expect(SRC).toMatch(/observedRequests\.set\(/);
        expect(SRC).toMatch(/page\.on\('response'/);
    });
});

describe('load-only rows retain the footprint evidence they exist to produce', () => {
    it('the arm inventory is built BEFORE the load-only early return', () => {
        const build = SRC.indexOf('const allArmAssets:');
        const pinsOnly = SRC.indexOf('if (pinsOnly) {');
        expect(build).toBeGreaterThan(-1);
        expect(pinsOnly).toBeGreaterThan(-1);
        expect(build).toBeLessThan(pinsOnly);
    });

    it('the load-only row carries inventory, reconciliation and a TYPED disposition', () => {
        const row = SRC.slice(SRC.indexOf('if (pinsOnly) {'), SRC.indexOf('const route = (seconds: number)'));
        expect(row).toContain('assetInventory: loadOnlyInventory');
        expect(row).toContain('assetReconciliation');
        expect(row).toContain("disposition: 'load_only'");
    });
});
