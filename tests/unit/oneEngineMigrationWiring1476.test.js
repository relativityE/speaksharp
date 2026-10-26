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
/** #1471 / PR #1521, allowlisted after this target: on main it is one more local, pending, LATER entry. */
const NEXT = '20260924150000';
/** #1258 — the product-marker migration, allowlisted after #1471: one more later, pending entry here. */
const MARKER = '20260926190000';
/** Focus Points trial capability, allowlisted after #1258: one more later, pending entry here. */
const TRIAL = '20260928120000';
/** #1258 P0 retention-expiry fix, allowlisted after the trial capability: one more later, pending entry here. */
const EXPIRY_FIX = '20261013120000';
/** #1258 P0 typed-expiry follow-up, allowlisted after the retention-expiry fix: one more later, pending entry here. */
const TYPED_FIX = '20261013140000';
const CLOSURE = '20261013180000'; // later disabled deletion schema; never apply it with this target
const DRAIN = '20261016090000'; // later drain prerequisite; excluded from this target
const ENFORCEMENT = '20261016180000'; // later guarded-runtime prerequisite; also excluded
const REJECTION_RECOVERY = '20261017200000'; // later checkout-rejection recovery; excluded from this target
/** The six reviewed T2 targets, allowlisted after checkout-rejection recovery in their reviewed order: Analytics, pending
 *  checkout, U1 heartbeat, recording admission, coaching admission, completion journal. All later; excluded from this target. */
const T2_TARGETS = ['20261018090000', '20261018170000', '20261019010000', '20261019055102', '20261019202856', '20261020230653'];

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
        expect(config.excludedMigrations.map(({ version }) => version), 'static: later allowlist entries; the real ledger decides which stay excluded').toEqual([NEXT, MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS, ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    // The REAL Production ledger: read-only Migrations Preflight run 35919387314 (main@1319e8b58, 2026-09-23). Pending:
    // 20260910193000 (#1432) and 20260914214307 (#1469). Every allowlisted migration is recorded applied — INCLUDING the
    // commercial-activation entry 20260812042000 (recorded applied 2026-09-12 without executing, #1282).
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    /** The same ledger once #1525 (and #1521 after it) is on main: this target and #1521's appear as pending rows. */
    const afterMerge = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && applied.includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        ` ${VERSION} |                | x`,
        ` ${NEXT} |                | x`,
        ` ${MARKER} |                | x`,
        ` ${TRIAL} |                | x`,
        ` ${EXPIRY_FIX} |                | x`,
        ` ${TYPED_FIX} |                | x`,
        ` ${CLOSURE} |                | x`,
        ` ${DRAIN} |                | x`,
        ` ${ENFORCEMENT} |                | x`,
        ` ${REJECTION_RECOVERY} |                | x`,
        ...T2_TARGETS.map((v) => ` ${v} |                | x`),
    ].join('\n');

    it('the fixture is the real ledger shape: two unrelated pending migrations, and the activation entry recorded APPLIED', () => {
        expect(REAL).toMatch(/^\s*20260910193000\s*\|\s*\|/m);
        expect(REAL).toMatch(/^\s*20260914214307\s*\|\s*\|/m);
        expect(REAL).toMatch(new RegExp(`^\\s*${ACTIVATION.version}\\s*\\|\\s*${ACTIVATION.version}\\s*\\|`, 'm'));
    });

    it('ORDERED QUEUE: after merge, this target is REFUSED while #1432 and #1469 are still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(afterMerge(), config)).toThrow(/refused, not selected: 20260910193000,20260914214307|not applied/);
    });

    it('EXECUTABLE once #1432 and #1469 are applied: target-only; applied activation stays and all later targets remain pending', () => {
        const before = afterMerge(['20260910193000', '20260914214307']);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION, NEXT, MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS], excludedVersions: [NEXT, MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS] });
        const root = mkdtempSync(join(tmpdir(), 'exact-1476-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(before, config));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(FILE);
            expect(isolated, 'recorded-applied activation stays, so remote history matches the source').toContain(ACTIVATION.file);
            expect(isolated.some((f) => f.startsWith(NEXT)), 'the later, still-pending #1521 migration is NOT applied with this target').toBe(false);
            expect(isolated.some((f) => f.startsWith(MARKER)), 'nor the later #1258 marker migration').toBe(false);
            expect(isolated.some((f) => f.startsWith(TRIAL)), 'nor the later trial-capability migration').toBe(false);
            expect(isolated.some((f) => f.startsWith(EXPIRY_FIX)), 'nor the later retention-expiry fix').toBe(false);
            expect(isolated.some((f) => f.startsWith(TYPED_FIX)), 'nor the later typed-expiry follow-up').toBe(false);
            expect(isolated.some((f) => f.startsWith(CLOSURE)), 'nor the later disabled deletion schema').toBe(false);
            expect(isolated.some((f) => f.startsWith(DRAIN)), 'nor the later drain prerequisite').toBe(false);
            expect(isolated.some((f) => f.startsWith(ENFORCEMENT)), 'the later enforcement prerequisite is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(REJECTION_RECOVERY)), 'the later checkout-rejection recovery is excluded').toBe(false);
            for (const v of T2_TARGETS) expect(isolated.some((f) => f.startsWith(v)), `the later T2 target ${v} is excluded`).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        const after = before.replace(new RegExp(`^\\s*${VERSION}\\s*\\|\\s*\\|.*$`, 'm'), ` ${VERSION} | ${VERSION} | x`);
        expect(assertAfterApply(before, after, config).pending).toEqual([NEXT, MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS]);
    });
});
