import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    expectedAuthorizationPhrase,
    ledgerAwareConfig,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
} from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * The exact-apply route against the REAL Production ledger — read-only Migrations Preflight run 35919387314
 * (main@1319e8b58, 2026-09-23): pending 20260910193000 (#1432) and 20260914214307 (#1469); every allowlisted entry,
 * including the commercial-activation entry 20260812042000, recorded applied. Before the ledger-aware exclusion fix
 * the gate required that applied activation entry to be PENDING, so no target could pass against this ledger.
 * Read-only: no database or network; the workspace is built in a temp dir and removed.
 */
const ROOT = resolve(import.meta.dirname, '..', '..');
const SUPABASE = resolve(ROOT, 'backend/supabase');
const LEDGER = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
const RECEIPT_1432 = '20260910193000';
const ELIGIBILITY_1469 = '20260914214307';
const ACTIVATION = '20260812042000';
const cfg = (version) => resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: version });
/** The ledger after the given versions were applied. */
const appliedLedger = (...versions) => LEDGER.split('\n').map((line) => {
    const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
    return m && versions.includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
}).join('\n');
const fileOf = (version) => readdirSync(resolve(SUPABASE, 'migrations')).find((f) => f.startsWith(`${version}_`));

describe('exact apply route — the ordered queue against the real 2026-09-23 ledger', () => {
    it('the fixture is the real shape: #1432 and #1469 pending, activation recorded APPLIED', () => {
        expect(LEDGER).toMatch(new RegExp(`^\\s*${RECEIPT_1432}\\s*\\|\\s*\\|`, 'm'));
        expect(LEDGER).toMatch(new RegExp(`^\\s*${ELIGIBILITY_1469}\\s*\\|\\s*\\|`, 'm'));
        expect(LEDGER).toMatch(new RegExp(`^\\s*${ACTIVATION}\\s*\\|\\s*${ACTIVATION}\\s*\\|`, 'm'));
    });

    it('STEP 1 (#1432): admitted; #1469 stays pending and excluded; the applied activation entry is KEPT, not excluded', () => {
        const c = cfg(RECEIPT_1432);
        expect(assertBeforeApply(LEDGER, c)).toEqual({ pending: [RECEIPT_1432, ELIGIBILITY_1469], excludedVersions: [ELIGIBILITY_1469] });
        const root = mkdtempSync(join(tmpdir(), 'exact-ledger-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(LEDGER, c));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(fileOf(RECEIPT_1432));
            expect(isolated, 'the still-pending later entry is invisible to the push').not.toContain(fileOf(ELIGIBILITY_1469));
            expect(isolated, 'the applied activation file stays, so remote history matches the source').toContain(fileOf(ACTIVATION));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        expect(assertExactDryRun(`Would push these migrations:\n • ${fileOf(RECEIPT_1432)}\n`, c).files).toEqual([fileOf(RECEIPT_1432)]);
        expect(assertAfterApply(LEDGER, appliedLedger(RECEIPT_1432), c).pending).toEqual([ELIGIBILITY_1469]);
        expect(() => assertAfterApply(LEDGER, appliedLedger(RECEIPT_1432, ELIGIBILITY_1469), c), 'the push must not apply #1469 too').toThrow();
    });

    it('STEP 2 (#1469), after #1432 is applied: admitted with nothing else pending', () => {
        const c = cfg(ELIGIBILITY_1469);
        const before = appliedLedger(RECEIPT_1432);
        expect(assertBeforeApply(before, c)).toEqual({ pending: [ELIGIBILITY_1469], excludedVersions: [] });
        expect(assertAfterApply(before, appliedLedger(RECEIPT_1432, ELIGIBILITY_1469), c).pending).toEqual([]);
    });

    it('ORDER is enforced: #1469 cannot be applied while #1432 is still pending — refused by name', () => {
        expect(() => assertBeforeApply(LEDGER, cfg(ELIGIBILITY_1469))).toThrow(/refused, not selected: 20260910193000|not applied/);
    });

    it('nothing is hidden: an unlisted pending migration is refused by name', () => {
        const extra = `${LEDGER}\n 20260920000000 |                | x`;
        expect(() => assertBeforeApply(extra, cfg(RECEIPT_1432))).toThrow(/refused, not selected: 20260920000000/);
    });

    it('each phrase binds its own file, hash and the exact main SHA', () => {
        const head = 'b'.repeat(40);
        const c1 = cfg(RECEIPT_1432);
        const c2 = cfg(ELIGIBILITY_1469);
        expect(expectedAuthorizationPhrase(head, c1)).toBe(`APPLY ${RECEIPT_1432} ${c1.targetFile} SHA256 ${c1.targetSha256} AT ${head}`);
        expect(expectedAuthorizationPhrase(head, c2)).toBe(`APPLY ${ELIGIBILITY_1469} ${c2.targetFile} SHA256 ${c2.targetSha256} AT ${head}`);
    });
});
