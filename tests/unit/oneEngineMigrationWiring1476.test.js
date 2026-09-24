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
 * #1476 PM pre-push review — the one-account/one-engine migration must be APPLICABLE through the exact allowlisted
 * path, never through the whole-queue `supabase db push` (deploy-supabase-migrations.yml), which applies every pending
 * migration. Allowlisting is implementation, not authorization: the PO still dispatches with the derived phrase.
 * Read-only: no database, no network; the workspace is built in a temporary directory and removed.
 */
const VERSION = '20260923120000';
const FILE = `${VERSION}_one_active_engine_per_account_1476.sql`;
const ROOT = resolve(import.meta.dirname, '..', '..');
const SUPABASE = resolve(ROOT, 'backend/supabase');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: VERSION });
const ACTIVATION = EXACT_MIGRATION_ALLOWLIST.find((e) => e.classification === 'commercial-activation');

describe('#1476 migration is wired into the exact allowlisted apply path', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, third in the queue after #1432 and #1469, before the held commercial-activation entry', () => {
        expect(entry).toMatchObject({ file: FILE, classification: 'staged' });
        const order = EXACT_MIGRATION_ALLOWLIST.map((e) => e.version);
        expect(order.indexOf(VERSION)).toBe(order.indexOf('20260914214307') + 1);
        expect(order.indexOf('20260914214307')).toBe(order.indexOf('20260910193000') + 1);
        expect(EXACT_MIGRATION_ALLOWLIST.indexOf(entry)).toBeLessThan(EXACT_MIGRATION_ALLOWLIST.indexOf(ACTIVATION));
    });

    it('pins the FINAL byte hash of the file in the tree', () => {
        const bytes = readFileSync(resolve(SUPABASE, 'migrations', FILE));
        expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('is selectable as a dispatch target, and the phrase binds its filename, hash and the exact main SHA', () => {
        expect(WORKFLOW).toContain(`- '${VERSION}'`);
        const head = 'a'.repeat(40);
        expect(expectedAuthorizationPhrase(head, config)).toBe(`APPLY ${VERSION} ${FILE} SHA256 ${entry.sha256} AT ${head}`);
        expect(config.excludedMigrations.map(({ version }) => version), 'static: later allowlist entries; the real ledger decides which stay excluded').toEqual([ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    // The REAL Production ledger: read-only Migrations Preflight run 35919387314 (main@1319e8b58, 2026-09-23). Pending:
    // 20260910193000 (#1432) and 20260914214307 (#1469). Every allowlisted migration is recorded applied — INCLUDING the
    // commercial-activation entry 20260812042000 (recorded applied 2026-09-12 without executing, #1282).
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    /** The same ledger once #1525 is on main: this target appears as one more pending row. */
    const afterMerge = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && applied.includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        ` ${VERSION} |                | x`,
    ].join('\n');

    it('the fixture is the real ledger shape: two unrelated pending migrations, and the activation entry recorded APPLIED', () => {
        expect(REAL).toMatch(/^\s*20260910193000\s*\|\s*\|/m);
        expect(REAL).toMatch(/^\s*20260914214307\s*\|\s*\|/m);
        expect(REAL).toMatch(new RegExp(`^\\s*${ACTIVATION.version}\\s*\\|\\s*${ACTIVATION.version}\\s*\\|`, 'm'));
    });

    it('ORDERED QUEUE: after merge, this target is REFUSED while #1432 and #1469 are still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(afterMerge(), config)).toThrow(/refused, not selected: 20260910193000,20260914214307|not applied/);
    });

    it('EXECUTABLE once #1432 and #1469 are applied: admitted; the applied activation file stays in the workspace; target-only; nothing else pending after', () => {
        const before = afterMerge(['20260910193000', '20260914214307']);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION], excludedVersions: [] });
        const root = mkdtempSync(join(tmpdir(), 'exact-1476-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(before, config));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(FILE);
            expect(isolated, 'recorded-applied activation stays, so remote history matches the source').toContain(ACTIVATION.file);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        const after = before.replace(new RegExp(`^\\s*${VERSION}\\s*\\|\\s*\\|.*$`, 'm'), ` ${VERSION} | ${VERSION} | x`);
        expect(assertAfterApply(before, after, config).pending).toEqual([]);
    });
});
