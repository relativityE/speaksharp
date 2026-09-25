import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    EXACT_MIGRATION_ALLOWLIST,
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    expectedAuthorizationPhrase,
    ledgerAwareConfig,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
} from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * #1471 / PR #1521 — the Progress-evaluation migration is applied through the exact allowlisted path, AFTER #1476 (whose
 * per-session obligations its evaluator settles), never through the whole-queue `supabase db push`. Allowlisting is
 * implementation, not authorization: the PO still dispatches with the derived phrase.
 * Read-only: no database, no network; the workspace is built in a temporary directory and removed.
 */
const VERSION = '20260924150000';
const FILE = `${VERSION}_progress_evaluation_filler_counts_authority_1471.sql`;
const PREVIOUS = '20260923120000'; // #1476
const ROOT = resolve(import.meta.dirname, '..', '..');
const SUPABASE = resolve(ROOT, 'backend/supabase');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: VERSION });
const ACTIVATION = EXACT_MIGRATION_ALLOWLIST.find((e) => e.classification === 'commercial-activation');

describe('#1471 migration is wired into the exact allowlisted apply path, after #1476', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, directly after #1476, before the held commercial-activation entry', () => {
        expect(entry).toMatchObject({ file: FILE, classification: 'staged' });
        const order = EXACT_MIGRATION_ALLOWLIST.map((e) => e.version);
        expect(order.indexOf(VERSION)).toBe(order.indexOf(PREVIOUS) + 1);
        expect(EXACT_MIGRATION_ALLOWLIST.indexOf(entry)).toBeLessThan(EXACT_MIGRATION_ALLOWLIST.indexOf(ACTIVATION));
    });

    it('pins the FINAL byte hash of the file in the tree', () => {
        const bytes = readFileSync(resolve(SUPABASE, 'migrations', FILE));
        expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is selectable as a dispatch target, and the phrase binds its filename, hash and the exact main SHA', () => {
        expect(WORKFLOW).toContain(`- '${VERSION}'`);
        const head = 'b'.repeat(40);
        expect(expectedAuthorizationPhrase(head, config)).toBe(`APPLY ${VERSION} ${FILE} SHA256 ${entry.sha256} AT ${head}`);
        expect(config.excludedMigrations.map(({ version }) => version)).toEqual([ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    // The real Production ledger fixture (2026-09-23), advanced to the state after #1432 and #1469 were applied (PO
    // authorization, 2026-09-23) and both #1525 and #1521 are on main: #1476 and #1471 are the pending rows.
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    const ledger = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && ['20260910193000', '20260914214307', ...applied].includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        applied.includes(PREVIOUS) ? ` ${PREVIOUS} | ${PREVIOUS} | x` : ` ${PREVIOUS} |                | x`,
        ` ${VERSION} |                | x`,
    ].join('\n');

    it('ORDERED QUEUE: REFUSED while #1476 is still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(ledger(), config)).toThrow(new RegExp(PREVIOUS));
    });

    it('EXECUTABLE once #1476 is applied: admitted; target-only; the applied activation file stays; nothing pending after', () => {
        const before = ledger([PREVIOUS]);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION], excludedVersions: [] });
        const root = mkdtempSync(join(tmpdir(), 'exact-1471-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(before, config));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(FILE);
            expect(isolated).toContain(ACTIVATION.file);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        const after = before.replace(new RegExp(`^\\s*${VERSION}\\s*\\|\\s*\\|.*$`, 'm'), ` ${VERSION} | ${VERSION} | x`);
        expect(assertAfterApply(before, after, config).pending).toEqual([]);
    });
});
