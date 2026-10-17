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
 * #1258 P0 — returning users' later saves failed with 42501 because the retention expiry set the superuser-only
 * `session_replication_role`. The fix (20261013120000) is applied through the exact allowlisted path, after the trial
 * capability, never through the whole-queue `supabase db push`. Its pre-apply gate proves Production still runs the
 * REVIEWED live expiry and derivation trigger (function identity, not migration-history identity), and its postflight
 * proves the reviewed bodies, ACLs and the closed grants table. Allowlisting is implementation, not authorization: the
 * PO still dispatches with the derived phrase.
 * Read-only: no database, no network; the workspace is built in a temporary directory and removed.
 */
const VERSION = '20261013120000';
const FILE = `${VERSION}_retention_expiry_without_superuser_1258.sql`;
const TARGET = FILE.replace(/\.sql$/, '');
const PREVIOUS = '20260928120000'; // Focus Points trial capability
/** #1258 P0 typed-expiry follow-up, allowlisted after the retention-expiry fix: one more later, pending entry here. */
const TYPED_FIX = '20261013140000';
const CLOSURE = '20261013180000'; // later disabled deletion schema; never apply it with this target
const DRAIN = '20261016090000'; // later drain prerequisite; excluded from this target
const ENFORCEMENT = '20261016180000'; // later guarded-runtime prerequisite; also excluded
const REJECTION_RECOVERY = '20261017200000'; // later checkout-rejection recovery; excluded from this target
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

describe('#1258 P0 retention-expiry migration is wired into the exact allowlisted apply path, after the trial capability', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, directly after the trial capability, before the held commercial-activation entry', () => {
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
        const head = 'd'.repeat(40);
        expect(expectedAuthorizationPhrase(head, config)).toBe(`APPLY ${VERSION} ${FILE} SHA256 ${entry.sha256} AT ${head}`);
        expect(config.excludedMigrations.map(({ version }) => version)).toEqual([TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    // The real Production ledger fixture (2026-09-23), advanced so every earlier queue entry is applied, with the trial
    // capability the row before this target. Whether Production's ledger matches is the dispatch's own pre-apply proof.
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    const ledger = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && ['20260910193000', '20260914214307', ...applied].includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        ` 20260923120000 | 20260923120000 | x`,
        ` 20260924150000 | 20260924150000 | x`,
        ` 20260926190000 | 20260926190000 | x`,
        applied.includes(PREVIOUS) ? ` ${PREVIOUS} | ${PREVIOUS} | x` : ` ${PREVIOUS} |                | x`,
        ` ${VERSION} |                | x`,
        ` ${TYPED_FIX} |                | x`,
        ` ${CLOSURE} |                | x`,
        ` ${DRAIN} |                | x`,
        ` ${ENFORCEMENT} |                | x`,
        ` ${REJECTION_RECOVERY} |                | x`,
    ].join('\n');

    it('ORDERED QUEUE: REFUSED while the trial capability is still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(ledger(), config)).toThrow(new RegExp(PREVIOUS));
    });

    it('EXECUTABLE once the trial capability is applied: target-only; applied activation stays and later targets remain pending', () => {
        const before = ledger([PREVIOUS]);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION, TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY], excludedVersions: [TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY] });
        const root = mkdtempSync(join(tmpdir(), 'exact-retention-expiry-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(before, config));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(FILE);
            expect(isolated).toContain(ACTIVATION.file);
            expect(isolated.some((f) => f.startsWith(CLOSURE)), 'the later disabled deletion schema is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(DRAIN)), 'the later drain prerequisite is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(ENFORCEMENT)), 'the later enforcement prerequisite is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(REJECTION_RECOVERY)), 'the later checkout-rejection recovery is excluded').toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        const after = before.replace(new RegExp(`^\\s*${VERSION}\\s*\\|\\s*\\|.*$`, 'm'), ` ${VERSION} | ${VERSION} | x`);
        expect(assertAfterApply(before, after, config).pending).toEqual([TYPED_FIX, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY]);
    });
});

describe('retention-expiry target has a mandatory function-identity postflight', () => {
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
        const other = { ...base, targetFile: '20260928120000_focus_points_trial_capability.sql' };
        expect(() => assertTerminalOutcome({ ...other, postflights: { [GATE]: 'success', postflight_20260928120000: 'success' } })).toThrow(/does not verify/);
        expect(assertTerminalOutcome({ ...other, postflights: { [GATE]: 'skipped', postflight_20260928120000: 'success' } }).terminal).toBe('success');
    });

    it('BEFORE the apply: credentials required, the DB path proven reachable, and the reviewed LIVE bodies asserted', () => {
        const pre = step(`Preflight ${VERSION} retention-expiry credentials`);
        expect(pre).toContain(`contains(steps.contract.outputs.target_file, '${TARGET}')`);
        for (const name of ['SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID']) expect(pre).toContain(name);
        expect(pre).toContain('refusing to apply');
        expect(pre).toContain(`bash scripts/postflight-gate-${VERSION}.sh before`);
        expect(pre).toContain('unset DB_URL');
        expect(step('id: connectivity_preflight')).toContain(TARGET);
        expect(WORKFLOW.indexOf(`Preflight ${VERSION} retention-expiry credentials`)).toBeLessThan(WORKFLOW.indexOf('- name: Apply the exact reviewed migration'));
    });

    it('AFTER the apply: the reviewed bodies, ACLs and grants table, plus no unrelated history change', () => {
        const post = step(`id: ${GATE}`);
        expect(post).toContain("steps.apply.outcome == 'success'");
        expect(post).toContain(`bash scripts/postflight-gate-${VERSION}.sh after`);
        expect(post).toContain('scripts/exact-migration-gate.mjs" after');
        expect(post).toContain('[ -f "$RUNNER_TEMP/pooler.env" ]');
    });

    it('a Require step enforces it, and the terminal step and the summary receive it BY NAME', () => {
        const req = step(`Require ${VERSION} retention-expiry postflight when applicable`);
        expect(req).toContain(`steps.${GATE}.outcome`);
        expect(req).toContain("!= 'success'");
        expect(WORKFLOW).toContain(`"${GATE}=\${{ steps.${GATE}.outcome }}"`);
        expect(WORKFLOW.slice(WORKFLOW.indexOf('- name: Publish sanitized result'))).toContain(`steps.${GATE}.outcome`);
    });
});

describe('the postflight script is read-only and pins the digests the integration test derives', () => {
    const code = SCRIPT.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const test = readFileSync(resolve(ROOT, 'tests/db/retention-expiry-no-superuser-1258.integration.test.ts'), 'utf8');

    it('its before/after digests are exactly the ones recomputed on real Postgres by the integration test', () => {
        const pinned = (src, name) => src.match(new RegExp(`${name}\\s*=\\s*'?([0-9a-f]{32})`))?.[1];
        for (const name of ['EXPIRE_BEFORE_MD5', 'TRIGGER_BEFORE_MD5', 'EXPIRE_AFTER_MD5', 'TRIGGER_AFTER_MD5']) {
            expect(pinned(code, name)).toMatch(/^[0-9a-f]{32}$/);
            expect(pinned(code, name)).toBe(pinned(test, `const ${name}`));
        }
    });

    it('reads only: every statement it sends is a SELECT — no write, DDL, function call or session read', () => {
        // The SQL actually sent: every argument of the script's q "…" helper, and nothing reaches psql any other way.
        const sql = [...code.matchAll(/\bq "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
        expect(sql.length).toBeGreaterThanOrEqual(16); // existence, two digests, grants presence, the before ownership check and the eleven after-mode checks
        for (const statement of sql) {
            expect(statement.trim()).toMatch(/^SELECT\b/i);
            expect(statement).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|NOTIFY|COPY|SET)\b|;/i);
            expect(statement).not.toMatch(/public\.(expire_transcripts_newest_one|sessions_set_transcript_state)\([^)]*\)\s*(?!')/);
            expect(statement).not.toMatch(/FROM public\.(sessions|transcript_retention_tombstones)\b/);
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
