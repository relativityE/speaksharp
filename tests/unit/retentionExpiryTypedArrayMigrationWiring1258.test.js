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
 * #1258 P0 follow-up — 20261013120000's Production apply (run 38428832342) deployed the reviewed definitions but failed
 * the lint-delta gate on one plpgsql_check 42804 warning (an untyped empty-array literal). 20261013140000 types the two
 * literals and is applied through the same exact allowlisted path, directly after 20261013120000. Its pre-apply gate
 * refuses anything but the deployed 20261013120000 bodies; its postflight proves the typed expiry, the unchanged trigger,
 * ACLs and the closed grants table. Allowlisting is implementation, not authorization.
 * Read-only: no database, no network; the workspace is built in a temporary directory and removed.
 */
const VERSION = '20261013140000';
const FILE = `${VERSION}_retention_expiry_typed_empty_array_1258.sql`;
const TARGET = FILE.replace(/\.sql$/, '');
const PREVIOUS = '20261013120000'; // the retention-expiry fix it corrects
const CLOSURE = '20261013180000'; // later disabled deletion schema; never apply it with this target
const DRAIN = '20261016090000'; // later drain prerequisite; excluded from this target
const ENFORCEMENT = '20261016180000'; // later guarded-runtime prerequisite; also excluded
const REJECTION_RECOVERY = '20261017200000'; // later checkout-rejection recovery; excluded from this target
/** The six reviewed T2 targets, allowlisted after checkout-rejection recovery in their reviewed order: Analytics, pending
 *  checkout, U1 heartbeat, recording admission, coaching admission, completion journal. All later; excluded from this target. */
const T2_TARGETS = ['20261018090000', '20261018170000', '20261019010000', '20261019055102', '20261019202856', '20261020230653'];
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

describe('#1258 P0 typed-expiry follow-up is wired into the exact allowlisted apply path, after 20261013120000', () => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === VERSION);

    it('is allowlisted as staged, directly after 20261013120000, before the held commercial-activation entry', () => {
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
        const head = 'e'.repeat(40);
        expect(expectedAuthorizationPhrase(head, config)).toBe(`APPLY ${VERSION} ${FILE} SHA256 ${entry.sha256} AT ${head}`);
        expect(config.excludedMigrations.map(({ version }) => version)).toEqual([CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS, ACTIVATION.version]);
    });

    it('a dry-run is accepted only when it would push this target alone', () => {
        expect(assertExactDryRun(`Would push these migrations:\n • ${FILE}\nFinished supabase db push.`, config).files).toEqual([FILE]);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${ACTIVATION.file}\n`, config)).toThrow(/target-only/);
    });

    // The real Production ledger fixture (2026-09-23), advanced so every earlier queue entry is applied, with 20261013120000
    // the row before this target (applied by run 38428832342). Production's ledger is the dispatch's own pre-apply proof.
    const REAL = readFileSync(resolve(ROOT, 'tests/fixtures/production-migration-ledger-2026-09-23.txt'), 'utf8');
    const ledger = (applied = []) => [
        ...REAL.split('\n').map((line) => {
            const m = line.match(/^\s*(\d{14})\s*\|\s*\|/);
            return m && ['20260910193000', '20260914214307', ...applied].includes(m[1]) ? ` ${m[1]} | ${m[1]} | x` : line;
        }),
        ` 20260923120000 | 20260923120000 | x`,
        ` 20260924150000 | 20260924150000 | x`,
        ` 20260926190000 | 20260926190000 | x`,
        ` 20260928120000 | 20260928120000 | x`,
        applied.includes(PREVIOUS) ? ` ${PREVIOUS} | ${PREVIOUS} | x` : ` ${PREVIOUS} |                | x`,
        ` ${VERSION} |                | x`,
        ` ${CLOSURE} |                | x`,
        ` ${DRAIN} |                | x`,
        ` ${ENFORCEMENT} |                | x`,
        ` ${REJECTION_RECOVERY} |                | x`,
        ...T2_TARGETS.map((v) => ` ${v} |                | x`),
    ].join('\n');

    it('ORDERED QUEUE: REFUSED while 20261013120000 is still pending — named, not hidden', () => {
        expect(() => assertBeforeApply(ledger(), config)).toThrow(new RegExp(PREVIOUS));
    });

    it('EXECUTABLE once 20261013120000 is applied: target-only; applied activation stays and deletion remains pending', () => {
        const before = ledger([PREVIOUS]);
        expect(assertBeforeApply(before, config)).toEqual({ pending: [VERSION, CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS], excludedVersions: [CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS] });
        const root = mkdtempSync(join(tmpdir(), 'exact-typed-expiry-'));
        try {
            prepareExactMigrationWorkspace(SUPABASE, root, ledgerAwareConfig(before, config));
            const isolated = readdirSync(join(root, 'exact-backend', 'supabase', 'migrations'));
            expect(isolated).toContain(FILE);
            expect(isolated).toContain(ACTIVATION.file);
            expect(isolated.some((f) => f.startsWith(CLOSURE)), 'the later disabled deletion schema is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(DRAIN)), 'the later drain prerequisite is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(ENFORCEMENT)), 'the later enforcement prerequisite is excluded').toBe(false);
            expect(isolated.some((f) => f.startsWith(REJECTION_RECOVERY)), 'the later checkout-rejection recovery is excluded').toBe(false);
            for (const v of T2_TARGETS) expect(isolated.some((f) => f.startsWith(v)), `the later T2 target ${v} is excluded`).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        const after = before.replace(new RegExp(`^\\s*${VERSION}\\s*\\|\\s*\\|.*$`, 'm'), ` ${VERSION} | ${VERSION} | x`);
        expect(assertAfterApply(before, after, config).pending).toEqual([CLOSURE, DRAIN, ENFORCEMENT, REJECTION_RECOVERY, ...T2_TARGETS]);
    });

    it('refuses a ledger that omits the later deletion schema rather than silently hiding it', () => {
        const incomplete = ledger([PREVIOUS]).split('\n').filter((line) => !line.includes(CLOSURE)).join('\n');
        expect(() => assertBeforeApply(incomplete, config)).toThrow(`later allowlisted migration ${CLOSURE} is absent`);
    });

    it('refuses a dry-run that would apply deletion together with the selected typed-expiry target', () => {
        const closure = EXACT_MIGRATION_ALLOWLIST.find((item) => item.version === CLOSURE);
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${FILE}\n • ${closure.file}\n`, config)).toThrow(/target-only/);
    });
});

describe('typed-expiry target has a mandatory function-identity postflight', () => {
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
        const other = { ...base, targetFile: '20261013120000_retention_expiry_without_superuser_1258.sql' };
        expect(() => assertTerminalOutcome({ ...other, postflights: { [GATE]: 'success', postflight_20261013120000: 'success' } })).toThrow(/does not verify/);
        expect(assertTerminalOutcome({ ...other, postflights: { [GATE]: 'skipped', postflight_20261013120000: 'success' } }).terminal).toBe('success');
    });

    it('BEFORE the apply: credentials required, the DB path proven reachable, and the reviewed LIVE bodies asserted', () => {
        const pre = step(`Preflight ${VERSION} typed-expiry credentials`);
        expect(pre).toContain(`contains(steps.contract.outputs.target_file, '${TARGET}')`);
        for (const name of ['SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID']) expect(pre).toContain(name);
        expect(pre).toContain('refusing to apply');
        expect(pre).toContain(`bash scripts/postflight-gate-${VERSION}.sh before`);
        expect(pre).toContain('unset DB_URL');
        expect(step('id: connectivity_preflight')).toContain(TARGET);
        expect(WORKFLOW.indexOf(`Preflight ${VERSION} typed-expiry credentials`)).toBeLessThan(WORKFLOW.indexOf('- name: Apply the exact reviewed migration'));
    });

    it('AFTER the apply: the reviewed bodies, ACLs and grants table, plus no unrelated history change', () => {
        const post = step(`id: ${GATE}`);
        expect(post).toContain("steps.apply.outcome == 'success'");
        expect(post).toContain(`bash scripts/postflight-gate-${VERSION}.sh after`);
        expect(post).toContain('scripts/exact-migration-gate.mjs" after');
        expect(post).toContain('[ -f "$RUNNER_TEMP/pooler.env" ]');
    });

    it('a Require step enforces it, and the terminal step and the summary receive it BY NAME', () => {
        const req = step(`Require ${VERSION} typed-expiry postflight when applicable`);
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
        // This gate's BEFORE state is 20261013120000's AFTER state; its AFTER expiry is the typed body.
        const map = { EXPIRE_BEFORE_MD5: 'EXPIRE_AFTER_MD5', TRIGGER_BEFORE_MD5: 'TRIGGER_AFTER_MD5', EXPIRE_AFTER_MD5: 'EXPIRE_TYPED_MD5', TRIGGER_AFTER_MD5: 'TRIGGER_AFTER_MD5' };
        for (const [name, constant] of Object.entries(map)) {
            expect(pinned(code, name)).toMatch(/^[0-9a-f]{32}$/);
            expect({ name, digest: pinned(code, name) }).toEqual({ name, digest: pinned(test, `const ${constant}`) });
        }
    });

    it('reads only: every statement it sends is a SELECT — no write, DDL, function call or session read', () => {
        // The SQL actually sent: every argument of the script's q "…" helper, and nothing reaches psql any other way.
        const sql = [...code.matchAll(/\bq "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
        expect(sql.length).toBeGreaterThanOrEqual(16); // existence, two digests, grants presence, the before ownership check and the after-mode checks
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

describe('the Production lint finding is reproduced and eliminated by the same checker in CI (PM 6150068041)', () => {
    const LINT_WF = readFileSync(resolve(ROOT, '.github/workflows/retention-expiry-lint-proof.yml'), 'utf8');
    const PROOF = readFileSync(resolve(ROOT, 'tests/db/run-retention-expiry-lint-proof.sh'), 'utf8');

    it('a PR touching either migration, the proof or the schema it reads runs the job', () => {
        const paths = LINT_WF.slice(LINT_WF.indexOf('paths:'), LINT_WF.indexOf('permissions:'));
        for (const p of ['backend/supabase/migrations/20261013120000_retention_expiry_without_superuser_1258.sql', `backend/supabase/migrations/${FILE}`,
            'tests/db/run-retention-expiry-lint-proof.sh', 'tests/db/retention-expiry-no-superuser-1258.integration.test.ts']) {
            expect({ p, triggers: paths.includes(`- '${p}'`) }).toEqual({ p, triggers: true });
        }
    });

    it('the job installs plpgsql_check (bounded) and fails on any FAIL', () => {
        expect(LINT_WF).toContain('postgresql-17-plpgsql-check');
        expect(LINT_WF).toMatch(/timeout \d+ sudo apt-get install -y -qq postgresql-17 postgresql-17-plpgsql-check/);
        expect(LINT_WF).toContain('set -o pipefail');
        expect(LINT_WF).toContain('bash tests/db/run-retention-expiry-lint-proof.sh | tee lint-proof.txt');
    });

    it('the proof demands the 42804 finding BEFORE the fix, its absence AFTER, and no new finding — never just "it runs"', () => {
        expect(PROOF).toContain("plpgsql_check_function_tb('public.expire_transcripts_newest_one(uuid, integer)'::regprocedure)");
        expect(PROOF).toMatch(/echo "\$BEFORE" \| grep -q '\|42804\|' && pass "RED/);
        expect(PROOF).toMatch(/echo "\$AFTER" \| grep -q '\|42804\|' && fail /);
        expect(PROOF).toContain('comm -13');
        expect(PROOF.indexOf('qf "$SHIPPED"')).toBeLessThan(PROOF.indexOf('BEFORE=$(findings)'));
        expect(PROOF.indexOf('BEFORE=$(findings)')).toBeLessThan(PROOF.indexOf('qf "$FIX"'));
        expect(PROOF).toMatch(/FAIL plpgsql_check is not available on this server/);
    });
});
