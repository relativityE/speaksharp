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
/** #1258 — the product-marker migration, allowlisted after this target: a later, pending entry here. */
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
// C1 follows the T2 queue; these later targets must remain pending and isolated.
const C1_TARGETS = ['20261024083000', '20261025021046'];
const ROOT = resolve(import.meta.dirname, '..', '..');
const SUPABASE = resolve(ROOT, 'backend/supabase');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: VERSION });
const ACTIVATION = EXACT_MIGRATION_ALLOWLIST.find((e) => e.classification === 'commercial-activation');

describe('#1471 migration is wired into the exact allowlisted apply path, after #1476', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it.each(C1_TARGETS)('refuses an earlier-target ledger missing later C1 migration %s', (version) => {
        const incomplete = ledger([PREVIOUS]).split('\n').filter((line) => !line.includes(version)).join('\n');
        expect(() => assertBeforeApply(incomplete, config)).toThrow(`later allowlisted migration ${version} is absent`);
    });

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
        expect(config.excludedMigrations.map(({ version }) => version), 'static: later targets include disabled deletion before held activation').toEqual([MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS, ...C1_TARGETS, ACTIVATION.version]);
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
        ` ${MARKER} |                | x`,
        ` ${TRIAL} |                | x`,
        ` ${EXPIRY_FIX} |                | x`,
        ` ${TYPED_FIX} |                | x`,
        ` ${CLOSURE} |                | x`,
        ` ${DRAIN} |                | x`,
        ` ${ENFORCEMENT} |                | x`,
        ` ${REJECTION_RECOVERY} |                | x`,
        ...T2_TARGETS.map((v) => ` ${v} |                | x`),
        ...C1_TARGETS.map((v) => ` ${v} |                | x`),
    ].join('\n');

    it('ORDERED QUEUE: REFUSED while #1476 is still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(ledger(), config)).toThrow(new RegExp(PREVIOUS));
    });

    it('EXECUTABLE once #1476 is applied: target-only; applied activation stays and all later targets remain pending', () => {
        const before = ledger([PREVIOUS]);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION, MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS, ...C1_TARGETS], excludedVersions: [MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS, ...C1_TARGETS] });
        const root = mkdtempSync(join(tmpdir(), 'exact-1471-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(before, config));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(FILE);
            expect(isolated).toContain(ACTIVATION.file);
            expect(isolated.some((f) => f.startsWith(MARKER)), 'the later #1258 marker migration is NOT applied with this target').toBe(false);
            expect(isolated.some((f) => f.startsWith(TRIAL)), 'nor the later trial-capability migration').toBe(false);
            expect(isolated.some((f) => f.startsWith(EXPIRY_FIX)), 'nor the later retention-expiry fix').toBe(false);
            expect(isolated.some((f) => f.startsWith(TYPED_FIX)), 'nor the later typed-expiry follow-up').toBe(false);
            expect(isolated.some((f) => f.startsWith(CLOSURE)), 'nor the later disabled deletion schema').toBe(false);
            expect(isolated.some((f) => f.startsWith(DRAIN)), 'nor the later drain prerequisite').toBe(false);
            expect(isolated.some((f) => f.startsWith(ENFORCEMENT)), 'the later enforcement prerequisite is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(REJECTION_RECOVERY)), 'the later checkout-rejection recovery is excluded').toBe(false);
            for (const v of T2_TARGETS) expect(isolated.some((f) => f.startsWith(v)), `the later T2 target ${v} is excluded`).toBe(false);
            for (const v of C1_TARGETS) expect(isolated.some((f) => f.startsWith(v)), `the later C1 target ${v} is excluded`).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        const after = before.replace(new RegExp(`^\\s*${VERSION}\\s*\\|\\s*\\|.*$`, 'm'), ` ${VERSION} | ${VERSION} | x`);
        expect(assertAfterApply(before, after, config).pending).toEqual([MARKER, TRIAL, EXPIRY_FIX, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS, ...C1_TARGETS]);
    });
});
