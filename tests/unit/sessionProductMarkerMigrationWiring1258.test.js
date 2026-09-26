import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    EXACT_MIGRATION_ALLOWLIST,
    TARGET_POSTFLIGHT_GATES,
    assertAfterApply,
    assertTerminalOutcome,
    assertBeforeApply,
    assertExactDryRun,
    expectedAuthorizationPhrase,
    ledgerAwareConfig,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
} from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * #1258 — the durable session product marker is applied through the exact allowlisted path, AFTER #1471, never through the
 * whole-queue `supabase db push`, and before any client that reads `sessions.product` ships. Allowlisting is
 * implementation, not authorization: the PO still dispatches with the derived phrase.
 * Read-only: no database, no network; the workspace is built in a temporary directory and removed.
 */
const VERSION = '20260926190000';
const FILE = `${VERSION}_session_product_marker_1258.sql`;
const PREVIOUS = '20260924150000'; // #1471 (itself after #1476)
const ROOT = resolve(import.meta.dirname, '..', '..');
const SUPABASE = resolve(ROOT, 'backend/supabase');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: VERSION });
const ACTIVATION = EXACT_MIGRATION_ALLOWLIST.find((e) => e.classification === 'commercial-activation');

describe('#1258 product-marker migration is wired into the exact allowlisted apply path, after #1471', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, directly after #1471, before the held commercial-activation entry', () => {
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

    // The real Production ledger fixture (2026-09-23), advanced to the state after #1432, #1469 and #1476 were applied;
    // #1471 is the row before this target.
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    const ledger = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && ['20260910193000', '20260914214307', ...applied].includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        ` 20260923120000 | 20260923120000 | x`,
        applied.includes(PREVIOUS) ? ` ${PREVIOUS} | ${PREVIOUS} | x` : ` ${PREVIOUS} |                | x`,
        ` ${VERSION} |                | x`,
    ].join('\n');

    it('ORDERED QUEUE: REFUSED while #1471 is still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(ledger(), config)).toThrow(new RegExp(PREVIOUS));
    });

    it('EXECUTABLE once #1471 is applied: admitted; target-only; the applied activation file stays; nothing pending after', () => {
        const before = ledger([PREVIOUS]);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION], excludedVersions: [] });
        const root = mkdtempSync(join(tmpdir(), 'exact-1258-'));
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

/**
 * #1537 (Codex P1 r4112619095, PM RETURN 5849624832) — generic history + lint can report success while PostgREST still
 * cannot serve `sessions.product`, and the #1535 reader would then silently fall back to the legacy read. So this target
 * carries a MANDATORY postflight: credentials and the DB path proven BEFORE the irreversible apply; after it, a PostgREST
 * reload and a bounded, no-row, fail-closed read of `sessions.product` through the client's REST API; and the outcome
 * passed BY NAME to the terminal authority, so a missing, skipped or failed postflight can never read as success.
 */
describe('#1537 product-marker target has a mandatory PostgREST postflight', () => {
    const GATE = 'postflight_20260926190000';
    const base = { apply: 'success', verify: 'success', lint: 'success', targetFile: FILE };
    const step = (marker) => {
        const start = WORKFLOW.indexOf(marker);
        if (start === -1) throw new Error(`workflow step not found: ${marker}`);
        const next = WORKFLOW.indexOf('\n      - name:', start + 1);
        return WORKFLOW.slice(start, next === -1 ? undefined : next);
    };

    it('CASUALTY (missing registration): the gate is registered for exactly this target file', () => {
        expect(TARGET_POSTFLIGHT_GATES.filter((g) => g.id === GATE)).toEqual([{ id: GATE, targetFile: FILE.replace(/\.sql$/, '') }]);
    });

    it.each([['missing', {}], ['skipped', { [GATE]: 'skipped' }], ['failure', { [GATE]: 'failure' }], ['cancelled', { [GATE]: 'cancelled' }]])(
        'CASUALTY: a %s postflight can never yield terminal success', (_label, postflights) => {
            expect(() => assertTerminalOutcome({ ...base, postflights })).toThrow(new RegExp(GATE));
        });

    it('POSITIVE CONTROL: a successful postflight is reported as target-specific coverage', () => {
        expect(assertTerminalOutcome({ ...base, postflights: { [GATE]: 'success', postflight_1314: 'skipped' } })).toEqual({
            terminal: 'success', enforcedPostflights: [GATE], postflightCoverage: 'target_specific',
        });
    });

    it('the gate never applies to another target (drift is an error, absence is not)', () => {
        const other = { ...base, targetFile: '20260924150000_progress_evaluation_1471.sql' };
        expect(() => assertTerminalOutcome({ ...other, postflights: { [GATE]: 'success' } })).toThrow(/does not verify/);
        expect(assertTerminalOutcome({ ...other, postflights: { [GATE]: 'skipped' } }).terminal).toBe('success');
    });

    it('BEFORE the apply: credentials are required and the DB path is proven reachable for this target', () => {
        const pre = step(`Preflight ${VERSION} product-marker postflight`);
        expect(pre).toContain(`contains(steps.contract.outputs.target_file, '${FILE.replace(/\.sql$/, '')}')`);
        for (const name of ['SUPABASE_DB_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_PROJECT_ID']) expect(pre).toContain(name);
        expect(pre).toContain('refusing to apply');
        // The API path the postflight reads through is proven BEFORE the apply, with a column that already exists.
        expect(pre).toContain('select=id&id=eq.00000000-0000-0000-0000-000000000000&limit=0');
        expect(pre).toContain('scripts/postgrest-column-readable.sh');
        const reach = step('id: connectivity_preflight');
        expect(reach).toContain(FILE.replace(/\.sql$/, ''));
        expect(WORKFLOW.indexOf(`Preflight ${VERSION} product-marker postflight`)).toBeLessThan(WORKFLOW.indexOf('- name: Apply the exact reviewed migration'));
    });

    it('AFTER the apply: reloads PostgREST, then a bounded no-row read of sessions.product decided fail-closed', () => {
        const post = step(`id: ${GATE}`);
        expect(post).toContain("steps.apply.outcome == 'success'");
        expect(post).toContain("NOTIFY pgrst, 'reload schema';");
        expect(post).toContain('export PGPASSWORD="${SUPABASE_DB_PASSWORD}"');
        expect(post).toContain('unset DB_URL');
        expect(post).toContain('/rest/v1/sessions?select=id,product&id=eq.00000000-0000-0000-0000-000000000000&limit=0');
        expect(post).toMatch(/for i in \$\(seq 1 \d+\)/);
        expect(post).toContain('--max-time');
        expect(post).toContain('bash scripts/postgrest-column-readable.sh');
        // Never logs a response body: only the HTTP status and an error code are reported on failure.
        expect(post).not.toMatch(/head -c|cat \/tmp|\$\(cat/);
        expect(post.indexOf('NOTIFY pgrst')).toBeLessThan(post.indexOf('/rest/v1/sessions'));
    });

    it('a Require step enforces it, and the terminal step and the summary receive it BY NAME', () => {
        const req = step(`Require ${VERSION} product-marker postflight when applicable`);
        expect(req).toContain(`steps.${GATE}.outcome`);
        expect(req).toContain("!= 'success'");
        expect(WORKFLOW).toContain(`"${GATE}=\${{ steps.${GATE}.outcome }}"`);
        expect(WORKFLOW.slice(WORKFLOW.indexOf('- name: Publish sanitized result'))).toContain(`steps.${GATE}.outcome`);
    });
});
