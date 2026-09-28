import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    EXACT_MIGRATION_ALLOWLIST,
    TARGET_POSTFLIGHT_GATES,
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    assertTerminalOutcome,
    expectedAuthorizationPhrase,
    ledgerAwareConfig,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
} from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * Focus Points is included in the active 30-day trial (PO 2026-09-28; PM 5869975833). The trial-aware
 * has_objective_capability() is applied through the exact allowlisted path, after #1258, never through the whole-queue
 * `supabase db push`. Its pre-apply gate proves Production still runs the REVIEWED live body (function identity, not
 * migration-history identity), and its postflight proves the reviewed trial-aware body and ACL are deployed. Allowlisting is
 * implementation, not authorization: the PO still dispatches with the derived phrase.
 * Read-only: no database, no network; the workspace is built in a temporary directory and removed.
 */
const VERSION = '20260928120000';
const FILE = `${VERSION}_focus_points_trial_capability.sql`;
const TARGET = FILE.replace(/\.sql$/, '');
const PREVIOUS = '20260926190000'; // #1258 product marker
const GATE = `postflight_${VERSION}`;
const ROOT = resolve(import.meta.dirname, '..', '..');
const SUPABASE = resolve(ROOT, 'backend/supabase');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const SCRIPT = readFileSync(resolve(ROOT, `scripts/postflight-gate-${VERSION}.sh`), 'utf8');
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: VERSION });
const ACTIVATION = EXACT_MIGRATION_ALLOWLIST.find((e) => e.classification === 'commercial-activation');
const step = (marker) => {
    const start = WORKFLOW.indexOf(marker);
    if (start === -1) throw new Error(`workflow step not found: ${marker}`);
    const next = WORKFLOW.indexOf('\n      - name:', start + 1);
    return WORKFLOW.slice(start, next === -1 ? undefined : next);
};

describe('trial-capability migration is wired into the exact allowlisted apply path, after #1258', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, directly after #1258, before the held commercial-activation entry', () => {
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
        const head = 'c'.repeat(40);
        expect(expectedAuthorizationPhrase(head, config)).toBe(`APPLY ${VERSION} ${FILE} SHA256 ${entry.sha256} AT ${head}`);
        expect(config.excludedMigrations.map(({ version }) => version)).toEqual([ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    // The real Production ledger fixture (2026-09-23), advanced to today's state (every earlier queue entry applied;
    // Local = Remote for all 113 rows on d60de8a37), with #1258 the row before this target.
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    const ledger = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && ['20260910193000', '20260914214307', ...applied].includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        ` 20260923120000 | 20260923120000 | x`,
        ` 20260924150000 | 20260924150000 | x`,
        applied.includes(PREVIOUS) ? ` ${PREVIOUS} | ${PREVIOUS} | x` : ` ${PREVIOUS} |                | x`,
        ` ${VERSION} |                | x`,
    ].join('\n');

    it('ORDERED QUEUE: REFUSED while #1258 is still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(ledger(), config)).toThrow(new RegExp(PREVIOUS));
    });

    it('EXECUTABLE once #1258 is applied: admitted; target-only; the applied activation file stays; nothing pending after', () => {
        const before = ledger([PREVIOUS]);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION], excludedVersions: [] });
        const root = mkdtempSync(join(tmpdir(), 'exact-trial-capability-'));
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

describe('trial-capability target has a mandatory function-identity postflight', () => {
    const base = { apply: 'success', verify: 'success', lint: 'success', targetFile: FILE };

    it('CASUALTY (missing registration): the gate is registered for exactly this target file', () => {
        expect(TARGET_POSTFLIGHT_GATES.filter((g) => g.id === GATE)).toEqual([{ id: GATE, targetFile: TARGET }]);
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
        const other = { ...base, targetFile: '20260926190000_session_product_marker_1258.sql' };
        expect(() => assertTerminalOutcome({ ...other, postflights: { [GATE]: 'success', postflight_20260926190000: 'success' } })).toThrow(/does not verify/);
        expect(assertTerminalOutcome({ ...other, postflights: { [GATE]: 'skipped', postflight_20260926190000: 'success' } }).terminal).toBe('success');
    });

    it('BEFORE the apply: credentials required, the DB path proven reachable, and the reviewed LIVE body asserted', () => {
        const pre = step(`Preflight ${VERSION} trial-capability credentials`);
        expect(pre).toContain(`contains(steps.contract.outputs.target_file, '${TARGET}')`);
        for (const name of ['SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID']) expect(pre).toContain(name);
        expect(pre).toContain('refusing to apply');
        expect(pre).toContain(`bash scripts/postflight-gate-${VERSION}.sh before`);
        expect(pre).toContain('unset DB_URL');
        expect(step('id: connectivity_preflight')).toContain(TARGET);
        expect(WORKFLOW.indexOf(`Preflight ${VERSION} trial-capability credentials`)).toBeLessThan(WORKFLOW.indexOf('- name: Apply the exact reviewed migration'));
    });

    it('AFTER the apply: the reviewed trial-aware body and ACL, plus no unrelated history change', () => {
        const post = step(`id: ${GATE}`);
        expect(post).toContain("steps.apply.outcome == 'success'");
        expect(post).toContain(`bash scripts/postflight-gate-${VERSION}.sh after`);
        expect(post).toContain('scripts/exact-migration-gate.mjs" after');
        expect(post).toContain('[ -f "$RUNNER_TEMP/pooler.env" ]');
    });

    it('a Require step enforces it, and the terminal step and the summary receive it BY NAME', () => {
        const req = step(`Require ${VERSION} trial-capability postflight when applicable`);
        expect(req).toContain(`steps.${GATE}.outcome`);
        expect(req).toContain("!= 'success'");
        expect(WORKFLOW).toContain(`"${GATE}=\${{ steps.${GATE}.outcome }}"`);
        expect(WORKFLOW.slice(WORKFLOW.indexOf('- name: Publish sanitized result'))).toContain(`steps.${GATE}.outcome`);
    });
});

describe('the postflight script is read-only and pins the digests the integration test derives', () => {
    const code = SCRIPT.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const test = readFileSync(resolve(ROOT, 'tests/db/focus-points-trial-capability.integration.test.ts'), 'utf8');

    it('its before/after digests are exactly the ones recomputed on real Postgres by the integration test', () => {
        const pinned = (src, name) => src.match(new RegExp(`${name}\\s*=\\s*'?([0-9a-f]{32})`))?.[1];
        expect(pinned(code, 'BEFORE_MD5')).toBe(pinned(test, 'const BEFORE_MD5'));
        expect(pinned(code, 'AFTER_MD5')).toBe(pinned(test, 'const AFTER_MD5'));
        expect(pinned(code, 'BEFORE_MD5')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('reads only the catalog: every statement it sends is a SELECT — no write, DDL, function call or profile read', () => {
        // The SQL actually sent: every argument of the script's q "…" helper, and nothing reaches psql any other way.
        const sql = [...code.matchAll(/\bq "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
        expect(sql.length).toBeGreaterThanOrEqual(9); // existence, digest, and the seven after-mode shape and ACL checks
        for (const statement of sql) {
            expect(statement.trim()).toMatch(/^SELECT\b/i);
            expect(statement).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|NOTIFY|COPY|SET)\b|;/i);
            expect(statement).not.toMatch(/public\.has_objective_capability\(\)\s*(?!')/);
            expect(statement).not.toMatch(/user_profiles|objective_account_capability/);
        }
        expect(code.match(/"\$\{PSQL\[@\]\}"/g)).toHaveLength(1); // psql is invoked only inside q()
        expect(code).toContain('md5(pg_get_functiondef(');
    });

    it('fails closed: both modes exit non-zero on any failed check', () => {
        expect(code).toContain('if [ "$fails" -ne 0 ]; then echo "RESULT: FAIL ($MODE)');
        expect(code).toContain('exit 1');
        expect(code).toContain('set -euo pipefail');
    });
});
