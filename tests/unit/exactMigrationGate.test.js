// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {C1_VERSIONS,c1Contract,c1CatalogQuery,assertC1Catalog,functionDefinitions} from '../../scripts/lib/c1MigrationPostflight.mjs';
import {bootstrapSql} from '../db/content-free-retention-evidence.realpg.mjs';
import {proveC1CatalogStages} from '../db/c1CatalogStages.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    assertNoNewLint,
    assertTerminalOutcome,
    EXACT_MIGRATION_ALLOWLIST,
    expectedAuthorizationPhrase,
    HELD_FILE,
    TARGET_FILE,
    TARGET_SHA256,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
    validateExactMigrationAllowlist,
    verifyMigrationSourceIdentity,
    verifyExactMigrationWorkspace,
    TARGET_POSTFLIGHT_GATES,
} from '../../scripts/lib/exactMigrationGate.mjs';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';

const matched = ' 20260810120000 | 20260810120000 | 2026-08-10 12:00:00';
const heldPending = ' 20260811143000 |                | 2026-08-11 14:30:00';
const targetPending = ' 20260812002000 |                | 2026-08-12 00:20:00';
const targetApplied = ' 20260812002000 | 20260812002000 | 2026-08-12 00:20:00';
const PRIOR_FILE = '20260810120000_prior.sql';
const TARGET_BYTES = '-- target\n';
const PRIOR_BYTES = '-- prior\n';

const t2Versions = ['20261018090000','20261018170000','20261019010000',
    '20261019055102','20261019202856','20261020230653'];
const c1Versions = ['20261024083000','20261025021046'];
describe('C1 ordered exact-operation enforcement', () => {
    const workflow = yaml.load(readFileSync('.github/workflows/apply-exact-allowlisted-migration.yml', 'utf8'));
    const job = workflow.jobs['apply-one-allowlisted-migration'];
    const guardName = 'Require existing C1 database password before linked CLI setup';

    it('requires the existing C1 password after authorization and before setup or any Supabase invocation', () => {
        const index = job.steps.findIndex(step => step.name === guardName);
        expect(index).toBeGreaterThan(job.steps.findIndex(step => step.name === 'Validate exact main identity and authorization phrase'));
        expect(index).toBeLessThan(job.steps.findIndex(step => step.uses?.startsWith('supabase/setup-cli@')));
        expect(index).toBeLessThan(job.steps.findIndex(step => /\bsupabase\s/.test(step.run ?? '')));
        const guard = job.steps[index];
        expect(guard.if).toBe("${{ inputs.target_version == '20261024083000' || inputs.target_version == '20261025021046' }}");
        expect(guard['continue-on-error']).toBeUndefined();
        expect(guard.env).toBeUndefined();
        expect(job.env.SUPABASE_DB_PASSWORD).toBe('${{ secrets.SUPABASE_DB_PASSWORD }}');
        expect(guard.run).not.toMatch(/\b(?:supabase|curl|wget)\s|set\s+-x/);
    });

    it.each(['absent', 'empty', 'present'])('executes the YAML shell with %s synthetic injection before the downstream sentinel', state => {
        const guard = job.steps.find(step => step.name === guardName);
        expect(guard?.run).toEqual(expect.any(String));
        const syntheticPassword = 'synthetic-only-not-a-credential-guard-control';
        // Deliberately do not inherit real database credentials, tokens or user shell configuration.
        const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
        if (state !== 'absent') env.SUPABASE_DB_PASSWORD = state === 'empty' ? '' : syntheticPassword;
        const child = spawnSync('bash', ['--noprofile', '--norc', '-c', `${guard.run}\nprintf 'DOWNSTREAM_SENTINEL\\n'`], {
            env, encoding: 'utf8', timeout: 5_000,
        });
        expect(child.error).toBeUndefined();
        expect(child.signal).toBeNull();
        const output = `${child.stdout}${child.stderr}`;
        expect(output).not.toContain(syntheticPassword);
        expect(child.status).toBe(state === 'present' ? 0 : 1);
        expect(output.includes('C1 existing database password injection present')).toBe(state === 'present');
        expect(output.includes('DOWNSTREAM_SENTINEL')).toBe(state === 'present');
        expect(output.includes('refusing credential setup')).toBe(state !== 'present');
    });

    it.each(c1Versions)('cannot finish %s using generic or another target postflight', version => {
        const targetFile = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version).file;
        const outcomes = Object.fromEntries(TARGET_POSTFLIGHT_GATES.map(gate => [gate.id, 'skipped']));
        const base = { apply: 'success', verify: 'success', lint: 'success', targetFile };
        const key = `postflight_${version}`;
        for (const value of [undefined, '', 'skipped', 'failure', 'cancelled']) {
            expect(() => assertTerminalOutcome({ ...base, postflights: { ...outcomes, [key]: value } })).toThrow();
        }
        expect(assertTerminalOutcome({ ...base, postflights: { ...outcomes, [key]: 'success' } }).enforcedPostflights).toEqual([key]);
    });
    it('requires the C1 read-only preimage before apply and machine-enforced target checks after', () => {
        const workflow = yaml.load(readFileSync('.github/workflows/apply-exact-allowlisted-migration.yml', 'utf8'));
        const steps = Object.values(workflow.jobs).find(job => job.steps?.some(step => step.id === 'apply')).steps;
        const before = steps.findIndex(step => step.run?.includes('node scripts/c1-migration-postflight.mjs before'));
        const apply = steps.findIndex(step => step.id === 'apply');
        const connectivity = steps.findIndex(step => step.id === 'connectivity_preflight');
        expect(connectivity).toBeLessThan(before);
        expect(before).toBeGreaterThan(-1);
        expect(before).toBeLessThan(apply);
        expect(steps[before]['continue-on-error']).not.toBe(true);
        const terminal = steps.find(step => step.id === 'terminal').run;
        for (const version of c1Versions) {
            expect(workflow.on.workflow_dispatch.inputs.target_version.options).toContain(version);
            expect(steps[connectivity].if).toContain(version);
            expect(steps[before].if).toContain(version);
            const after = steps.find(step => step.id === `postflight_${version}`);
            expect(after.if).toContain("steps.apply.outcome == 'success'");
            expect(after.if).toContain(version);
            expect(after.run).toContain(`node scripts/c1-migration-postflight.mjs after '${version}'`);
            expect(after.run).toContain('$RUNNER_TEMP/c1-before.json');
            expect(after['continue-on-error']).not.toBe(true);
            expect(terminal).toContain(`postflight_${version}=`);
        }
    });
});
describe('six-target T2 exact-operation enforcement', () => {
    it.each(t2Versions)('requires the named %s postflight and refuses missing/skipped/wrong evidence', version => {
        const targetFile = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version).file;
        const outcomes = Object.fromEntries(TARGET_POSTFLIGHT_GATES.map(gate => [gate.id,'skipped']));
        const base = { apply:'success',verify:'success',lint:'success',targetFile };
        const key = `postflight_${version}`;
        for (const value of [undefined, '', 'skipped', 'failure', 'cancelled']) {
            expect(() => assertTerminalOutcome({ ...base, postflights:{ ...outcomes,[key]:value } })).toThrow();
        }
        expect(() => assertTerminalOutcome({ ...base,postflights:{ ...outcomes,[key]:'success' } })).not.toThrow();
        const wrong = t2Versions.find(other => other !== version);
        expect(() => assertTerminalOutcome({ ...base,postflights:{ ...outcomes,[key]:'success',[`postflight_${wrong}`]:'success' } })).toThrow();
    });
    it('wires all exact targets through pre-apply catalog checks, named after checks, and terminal outcomes', () => {
        const workflow = yaml.load(readFileSync('.github/workflows/apply-exact-allowlisted-migration.yml','utf8'));
        const steps = Object.values(workflow.jobs).find(job => job.steps?.some(step => step.id === 'apply')).steps;
        const before = steps.findIndex(step => step.run?.includes('node scripts/t2-migration-postflight.mjs before'));
        expect(before).toBeGreaterThan(-1);
        expect(before).toBeLessThan(steps.findIndex(step => step.id === 'apply'));
        expect(steps[before]['continue-on-error']).not.toBe(true);
        const terminal = steps.find(step => step.id === 'terminal').run;
        for (const version of t2Versions) {
            expect(workflow.on.workflow_dispatch.inputs.target_version.options).toContain(version);
            const after = steps.find(step => step.id === `postflight_${version}`);
            expect(after.run).toContain(`node scripts/t2-migration-postflight.mjs after '${version}'`);
            expect(after.if).toContain("steps.apply.outcome == 'success'");
            expect(terminal).toContain(`postflight_${version}=`);
        }
    });
});

function createWorkspaceFixture() {
    const fixture = mkdtempSync(join(tmpdir(), 'exact-migration-workspace-'));
    const source = join(fixture, 'source-supabase');
    const migrations = join(source, 'migrations');
    const isolatedRoot = join(fixture, 'runner-temp');
    mkdirSync(migrations, { recursive: true });
    mkdirSync(isolatedRoot);
    writeFileSync(join(source, 'config.toml'), 'project_id = "fixture"\n');
    writeFileSync(join(migrations, TARGET_FILE), TARGET_BYTES);
    writeFileSync(join(migrations, HELD_FILE), '-- held\n');
    writeFileSync(join(migrations, PRIOR_FILE), PRIOR_BYTES);
    return { fixture, source, migrations, isolatedRoot };
}

describe('exact migration gate', () => {
    it('pins corrected v2 bytes and rejects the old hash through the legacy source-check interface', () => {
        const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: '20260819120000' });
        expect(config.targetSha256).toBe('da6392389dc74ab1d7cf06ca9326a089d565eff497745473ab61379d7dd5c41e');
        expect(() => verifyMigrationSourceIdentity(resolve(process.cwd(), 'backend/supabase'), {
            ...config, allowlisted: false, targetSha256: 'b70efd30a0ee0f5806ef9484f5c9eb3ca889d4122eaf4773d22f47486d9c7584',
        })).toThrow(/hash/);
    });
    it('accepts a workflow-pinned target while preserving the webhook contract as the default', () => {
        expect(resolveExactMigrationConfig({})).toEqual({
            targetVersion: '20260812002000',
            targetFile: '20260812002000_webhook_lifecycle_completeness_1282.sql',
            targetSha256: TARGET_SHA256,
            classification: 'legacy-webhook-prerequisite',
            requiresIncludeAll: false,
            requiredAppliedVersions: [],
            excludedMigrations: [{ version: '20260811143000', file: HELD_FILE }],
            allowlisted: false,
        });
        expect(resolveExactMigrationConfig({
            TARGET_VERSION: '20260812030000',
            TARGET_FILE: '20260812030000_progress_cohort_mode_separation_1265.sql',
            TARGET_SHA256: 'progress-hash',
            EXCLUDED_VERSIONS: '20260811143000 20260812039500',
            EXCLUDED_FILES: `${HELD_FILE} 20260812039500_webhook_duplicate_snapshot_convergence_1282.sql`,
        })).toEqual({
            targetVersion: '20260812030000',
            targetFile: '20260812030000_progress_cohort_mode_separation_1265.sql',
            targetSha256: 'progress-hash',
            classification: 'legacy-webhook-prerequisite',
            requiresIncludeAll: false,
            requiredAppliedVersions: [],
            excludedMigrations: [
                { version: '20260811143000', file: HELD_FILE },
                { version: '20260812039500', file: '20260812039500_webhook_duplicate_snapshot_convergence_1282.sql' },
            ],
            allowlisted: false,
        });
        expect(() => resolveExactMigrationConfig({
            TARGET_VERSION: '20260812030000',
            TARGET_FILE: 'target.sql',
            EXCLUDED_VERSIONS: '20260811143000 20260812039500',
            EXCLUDED_FILES: HELD_FILE,
        })).toThrow(/paired lists/);
    });

    it('preserves the full byte-identical Supabase inventory while removing only the held migration', () => {
        const { fixture, source, isolatedRoot } = createWorkspaceFixture();
        try {
            const result = prepareExactMigrationWorkspace(source, isolatedRoot);

            expect(result.workdir).toBe(join(isolatedRoot, 'exact-backend'));
            expect(existsSync(join(result.workdir, 'supabase', 'config.toml'))).toBe(true);
            expect(existsSync(join(result.workdir, 'supabase', 'migrations', TARGET_FILE))).toBe(true);
            expect(existsSync(join(result.workdir, 'supabase', 'migrations', PRIOR_FILE))).toBe(true);
            expect(existsSync(join(result.workdir, 'supabase', 'migrations', HELD_FILE))).toBe(false);
            expect(existsSync(join(result.heldDir, HELD_FILE))).toBe(true);
            expect(result.isolatedInventory).toEqual(
                result.sourceInventory.filter(({ path }) => path !== `migrations/${HELD_FILE}`),
            );
            expect(readFileSync(join(result.supabaseDir, 'migrations', TARGET_FILE)))
                .toEqual(readFileSync(join(source, 'migrations', TARGET_FILE)));
            expect(readFileSync(join(result.supabaseDir, 'migrations', PRIOR_FILE)))
                .toEqual(readFileSync(join(source, 'migrations', PRIOR_FILE)));
            expect(() => prepareExactMigrationWorkspace(source, isolatedRoot)).toThrow(/already exists/);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    it('fails before copying when the source target or held migration is missing', () => {
        const targetFixture = createWorkspaceFixture();
        try {
            rmSync(join(targetFixture.migrations, TARGET_FILE));
            expect(() => prepareExactMigrationWorkspace(targetFixture.source, targetFixture.isolatedRoot))
                .toThrow(/source target migration is missing/);
        } finally {
            rmSync(targetFixture.fixture, { recursive: true, force: true });
        }

        const heldFixture = createWorkspaceFixture();
        try {
            rmSync(join(heldFixture.migrations, HELD_FILE));
            expect(() => prepareExactMigrationWorkspace(heldFixture.source, heldFixture.isolatedRoot))
                .toThrow(/source excluded migration .* is missing/);
        } finally {
            rmSync(heldFixture.fixture, { recursive: true, force: true });
        }
    });

    it('rejects a workspace outside exact-backend/supabase and missing required layout entries', () => {
        const { fixture, source, isolatedRoot } = createWorkspaceFixture();
        try {
            const result = prepareExactMigrationWorkspace(source, isolatedRoot);
            expect(() => verifyExactMigrationWorkspace(source, result.supabaseDir, result.sourceInventory))
                .toThrow(/must be named exact-backend/);
            rmSync(join(result.supabaseDir, 'config.toml'));
            expect(() => verifyExactMigrationWorkspace(source, result.workdir, result.sourceInventory))
                .toThrow(/isolated supabase\/config.toml is missing/);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    it('rejects any removed or byte-changed retained file', () => {
        const { fixture, source, isolatedRoot } = createWorkspaceFixture();
        try {
            const result = prepareExactMigrationWorkspace(source, isolatedRoot);
            const isolatedPrior = join(result.supabaseDir, 'migrations', PRIOR_FILE);
            rmSync(isolatedPrior);
            expect(() => verifyExactMigrationWorkspace(source, result.workdir, result.sourceInventory))
                .toThrow(/isolated Supabase inventory or bytes differ/);

            writeFileSync(isolatedPrior, PRIOR_BYTES);
            writeFileSync(join(result.supabaseDir, 'migrations', TARGET_FILE), '-- changed target\n');
            expect(() => verifyExactMigrationWorkspace(source, result.workdir, result.sourceInventory))
                .toThrow(/isolated Supabase inventory or bytes differ/);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    it('rejects source-tree mutation after the inventory snapshot', () => {
        const { fixture, source, migrations, isolatedRoot } = createWorkspaceFixture();
        try {
            const result = prepareExactMigrationWorkspace(source, isolatedRoot);
            writeFileSync(join(migrations, PRIOR_FILE), '-- changed source\n');
            expect(() => verifyExactMigrationWorkspace(source, result.workdir, result.sourceInventory))
                .toThrow(/source Supabase inventory or bytes differ/);
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });

    it('accepts only the observed two-migration pre-apply state', () => {
        expect(assertBeforeApply([matched, heldPending, targetPending].join('\n'))).toEqual({
            pending: ['20260811143000', '20260812002000'],
            excludedVersions: ['20260811143000'],
        });
        expect(() => assertBeforeApply([matched, targetPending].join('\n'))).toThrow(/unexpected pending/);
        expect(() => assertBeforeApply([matched, heldPending, targetPending, ' 20260813000000 | | x'].join('\n')))
            .toThrow(/unexpected pending/);
    });

    it('requires a dry-run containing exactly the webhook prerequisite', () => {
        const exact = `Would push these migrations:\n • ${TARGET_FILE}\nFinished supabase db push.`;
        expect(assertExactDryRun(exact)).toEqual({ files: [TARGET_FILE] });
        expect(() => assertExactDryRun(`Would push these migrations:\n • ${HELD_FILE}\n • ${TARGET_FILE}`))
            .toThrow(/not target-only/);
        expect(() => assertExactDryRun('Remote database is up to date.')).toThrow(/did not advertise/);
    });

    it('proves only the target moved to remote history after apply', () => {
        const before = [matched, heldPending, targetPending].join('\n');
        expect(assertAfterApply(before, [matched, heldPending, targetApplied].join('\n'))).toEqual({
            pending: ['20260811143000'],
            appliedDelta: '20260812002000:pending->applied',
        });
        expect(() => assertAfterApply(before, [matched, targetApplied].join('\n'))).toThrow(/added, removed/);
        expect(() => assertAfterApply(before, [matched, targetApplied, ' 20260811143000 | 20260811143000 | x'].join('\n')))
            .toThrow(/unexpected migration history delta/);
        expect(() => assertAfterApply(before, [matched, heldPending, targetPending].join('\n')))
            .toThrow(/unexpected migration history delta/);
        expect(() => assertAfterApply(before, [matched, heldPending, targetApplied, ' | 20260813000000 | x'].join('\n')))
            .toThrow(/remote migration history/);
        expect(() => assertAfterApply(before, [matched, heldPending, targetApplied, ' 20260813000000 | 20260813000000 | x'].join('\n')))
            .toThrow(/added, removed/);
    });

    it('allows lint cleanup while rejecting additions, changes, and increased duplicate counts', () => {
        const baseline = 'Connecting to remote database\nwarning: existing issue\nwarning: duplicate issue\nwarning: duplicate issue\n';
        expect(assertNoNewLint(baseline, baseline)).toEqual({ baselineFindings: 3, postFindings: 3 });
        expect(assertNoNewLint(baseline, 'warning: existing issue\n')).toEqual({ baselineFindings: 3, postFindings: 1 });
        expect(() => assertNoNewLint(baseline, `${baseline}warning: new issue\n`)).toThrow(/adds or increases/);
        expect(() => assertNoNewLint(baseline, 'warning: changed issue\n')).toThrow(/adds or increases/);
        expect(() => assertNoNewLint(baseline, `${baseline}warning: duplicate issue\n`)).toThrow(/adds or increases/);
    });

    it('requires an unambiguous successful terminal outcome', () => {
        // Named fields: a dropped positional argument is what let a failed postflight report success.
        const t = (o) => assertTerminalOutcome({
            apply: 'success', verify: 'success', lint: 'success',
            targetFile: '20260819120000_complete_session_v2_atomic_retention_1314.sql',
            postflights: { postflight_1314: 'success' }, ...o,
        });
        expect(t({})).toEqual({ terminal: 'success', enforcedPostflights: ['postflight_1314'], postflightCoverage: 'target_specific' });
        expect(() => t({ apply: 'failure' })).toThrow(/apply command outcome/);
        expect(() => t({ verify: 'failure' })).toThrow(/history verification/);
        expect(() => t({ lint: 'failure' })).toThrow(/lint verification/);
    });

    it('fails closed on unparsable or remote-only migration state', () => {
        expect(() => assertBeforeApply('not a migration table')).toThrow(/no parseable rows/);
        expect(() => assertBeforeApply([
            matched,
            heldPending,
            targetPending,
            '                | 20260809000000 | 2026-08-09 00:00:00',
        ].join('\n'))).toThrow(/remote migration history/);
    });

    it('pins the reviewed migration bytes and a non-generic production workflow', () => {
        const root = process.cwd();
        const migration = readFileSync(resolve(root, 'backend/supabase/migrations', TARGET_FILE));
        expect(createHash('sha256').update(migration).digest('hex')).toBe(TARGET_SHA256);

        const workflow = readFileSync(resolve(root, '.github/workflows/apply-webhook-db-prerequisite.yml'), 'utf8');
        expect(workflow).toContain(TARGET_SHA256);
        expect(workflow).toMatch(/permissions:\s*\n\s+actions: read\s*\n\s+contents: read/);
        expect(workflow).toContain('environment: production-db');
        expect(workflow).toContain('group: production-database-migrations');
        expect(workflow).toContain('default branch advanced after dry-run');
        expect(workflow).toContain('another migration-capable or migration-preflight workflow is active or pending');
        expect(workflow).toContain('for status in in_progress queued waiting pending requested');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs before');
        expect(workflow).toContain('node "$GITHUB_WORKSPACE/scripts/exact-migration-gate.mjs" dry-run');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs after "$RUNNER_TEMP/migrations-before.txt" "$RUNNER_TEMP/migrations-after.txt"');
        expect(workflow).toContain('continue-on-error: true');
        expect(workflow).toContain("if: ${{ always() && steps.apply.outcome != 'skipped' }}");
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs lint-delta');
        expect(workflow).toContain('node scripts/exact-migration-gate.mjs final');
        expect(workflow).toContain('prepare-workspace backend/supabase "$RUNNER_TEMP"');
        expect(workflow.match(/working-directory: \$\{\{ runner\.temp \}\}\/exact-backend/g)).toHaveLength(2);
        expect(workflow).not.toContain('exact-supabase');
        expect(workflow).not.toMatch(/^\s+supabase migration repair/m);
        expect(workflow).not.toMatch(/^\s+supabase db push .*--include-all/m);

        const legacyWorkflow = readFileSync(resolve(root, '.github/workflows/deploy-supabase-migrations.yml'), 'utf8');
        expect(legacyWorkflow).toContain('group: production-database-migrations');
    });

    it('pins the reusable one-target workflow to the checked-in allowlist and fail-closed controls', () => {
        const root = process.cwd();
        const workflow = readFileSync(resolve(root, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
        expect(workflow).toContain('name: Apply one allowlisted migration (exact)');
        for (const { version } of EXACT_MIGRATION_ALLOWLIST) expect(workflow).toContain(`- '${version}'`);
        expect(workflow).toContain('SELECTED_TARGET_VERSION: ${{ inputs.target_version }}');
        expect(workflow).toContain('exact-migration-gate.mjs phrase "$EXPECTED_HEAD_SHA"');
        expect(workflow).toContain('exact-migration-gate.mjs source .');
        expect(workflow).toContain('exact allowlist-derived authorization phrase missing');
        expect(workflow).toMatch(/permissions:\s*\n\s+actions: read\s*\n\s+contents: read/);
        expect(workflow).toContain('environment: production-db');
        expect(workflow).toContain('group: production-database-migrations');
        expect(workflow).toContain('default branch advanced after dry-run');
        expect(workflow).toContain('Apply one allowlisted migration (exact)');
        expect(workflow).toContain('prepare-workspace backend/supabase "$RUNNER_TEMP"');
        expect(workflow).toContain('continue-on-error: true');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs after');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs lint-delta');
        expect(workflow).toContain('node scripts/exact-migration-gate.mjs final');
        expect(workflow).toContain("if [ '${{ steps.contract.outputs.requires_include_all }}' = 'true' ]; then");
        expect(workflow.match(/push_args\+=\(--include-all\)/g)).toHaveLength(2);
        expect(workflow).not.toMatch(/^\s+supabase migration repair/m);
    });

    it('pins every allowlisted source byte and gives commercial activation a distinct phrase', () => {
        const source = resolve(process.cwd(), 'backend/supabase');
        const sha = 'a'.repeat(40);
        const actualPhrases = [];
        const expectedPhrases = [];
        for (const target of EXACT_MIGRATION_ALLOWLIST) {
            const migration = readFileSync(resolve(source, 'migrations', target.file));
            expect(createHash('sha256').update(migration).digest('hex')).toBe(target.sha256);
            const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: target.version });
            expect(verifyMigrationSourceIdentity(source, config).targetSha256).toBe(target.sha256);
            actualPhrases.push(expectedAuthorizationPhrase(sha, config));
            const prefix = target.classification === 'commercial-activation' ? 'ACTIVATE COMMERCIAL TRIAL WITH' : 'APPLY';
            const outOfOrderDisclosure = target.version === '20260811143000' ? ' USING ISOLATED --include-all' : '';
            expectedPhrases.push(`${prefix} ${target.version} ${target.file} SHA256 ${target.sha256}${outOfOrderDisclosure} AT ${sha}`);
        }
        expect(actualPhrases).toEqual(expectedPhrases);
        expect(() => resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: '20260812999999' }))
            .toThrow(/not in the checked-in allowlist/);
        expect(() => expectedAuthorizationPhrase('short', resolveExactMigrationConfig({
            SELECTED_TARGET_VERSION: '20260812030000',
        }))).toThrow(/full lowercase hex/);
        expect(validateExactMigrationAllowlist()).toBe(EXACT_MIGRATION_ALLOWLIST);
        // #1314: the allowlist is ordered by OPERATIONAL PREREQUISITE, not version chronology, so a
        // non-version-monotonic order is intentionally NOT rejected (the #1314 entry, a later version,
        // deliberately precedes the earlier-versioned commercial-activation entry). Swapping two staged
        // entries therefore does not throw; uniqueness and activation-last remain enforced (below).
        expect(() => validateExactMigrationAllowlist([
            EXACT_MIGRATION_ALLOWLIST[1],
            EXACT_MIGRATION_ALLOWLIST[0],
            ...EXACT_MIGRATION_ALLOWLIST.slice(2),
        ])).not.toThrow();
        expect(() => validateExactMigrationAllowlist([
            EXACT_MIGRATION_ALLOWLIST[0], EXACT_MIGRATION_ALLOWLIST[0],
            ...EXACT_MIGRATION_ALLOWLIST.slice(1),
        ])).toThrow(/duplicate/);
        expect(() => validateExactMigrationAllowlist([
            { ...EXACT_MIGRATION_ALLOWLIST[0], classification: 'commercial-activation' },
            ...EXACT_MIGRATION_ALLOWLIST.slice(1),
        ])).toThrow(/must be the final/);
    });

    it('uses isolated --include-all only for #1276 when newer webhook history already exists', () => {
        const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: '20260811143000' });
        const before = [
            matched,
            ' 20260811143000 |                | pending',
            ' 20260812002000 | 20260812002000 | applied',
            ...EXACT_MIGRATION_ALLOWLIST.slice(1).map(({ version }) => ` ${version} |                | pending`),
        ].join('\n');
        const after = before.replace(
            ' 20260811143000 |                | pending',
            ' 20260811143000 | 20260811143000 | applied',
        );

        expect(config.requiresIncludeAll).toBe(true);
        expect(config.requiredAppliedVersions).toEqual(['20260812002000']);
        expect(expectedAuthorizationPhrase('a'.repeat(40), config)).toContain('USING ISOLATED --include-all');
        expect(assertBeforeApply(before, config).pending).toEqual(EXACT_MIGRATION_ALLOWLIST.map(({ version }) => version));
        expect(assertExactDryRun(`Would push these migrations:\n • ${config.targetFile}`, config))
            .toEqual({ files: [config.targetFile] });
        expect(assertAfterApply(before, after, config)).toEqual({
            pending: EXACT_MIGRATION_ALLOWLIST.slice(1).map(({ version }) => version),
            appliedDelta: '20260811143000:pending->applied',
        });
    });

    it('enforces staged dependency order, one-row history delta, and target-only visibility for every allowlisted target', () => {
        const appliedWebhook = ' 20260812002000 | 20260812002000 | applied';
        const dependencyViolations = [];
        for (const [targetIndex, target] of EXACT_MIGRATION_ALLOWLIST.entries()) {
            const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: target.version });
            expect(config.requiresIncludeAll).toBe(targetIndex === 0);
            expect(config.requiredAppliedVersions).toEqual([
                '20260812002000',
                ...EXACT_MIGRATION_ALLOWLIST.slice(0, targetIndex).map(({ version }) => version),
            ]);
            expect(config.excludedMigrations).toEqual(
                EXACT_MIGRATION_ALLOWLIST.slice(targetIndex + 1).map(({ version, file }) => ({ version, file })),
            );

            const fixture = mkdtempSync(join(tmpdir(), `allowlisted-${target.version}-`));
            try {
                const source = join(fixture, 'source-supabase');
                const migrations = join(source, 'migrations');
                const isolatedRoot = join(fixture, 'runner-temp');
                mkdirSync(migrations, { recursive: true });
                mkdirSync(isolatedRoot);
                writeFileSync(join(source, 'config.toml'), 'project_id = "fixture"\n');
                writeFileSync(join(migrations, PRIOR_FILE), PRIOR_BYTES);
                for (const entry of EXACT_MIGRATION_ALLOWLIST) {
                    writeFileSync(join(migrations, entry.file), `-- ${entry.version}\n`);
                }

                const result = prepareExactMigrationWorkspace(source, isolatedRoot, config);
                const visible = EXACT_MIGRATION_ALLOWLIST
                    .filter((entry) => existsSync(join(result.supabaseDir, 'migrations', entry.file)))
                    .map(({ version }) => version);
                const held = EXACT_MIGRATION_ALLOWLIST
                    .filter((entry) => existsSync(join(result.heldDir, entry.file)))
                    .map(({ version }) => version);
                expect(visible).toEqual(EXACT_MIGRATION_ALLOWLIST.slice(0, targetIndex + 1).map(({ version }) => version));
                expect(held).toEqual(EXACT_MIGRATION_ALLOWLIST.slice(targetIndex + 1).map(({ version }) => version));

                const beforeRows = [matched, appliedWebhook];
                const afterRows = [matched, appliedWebhook];
                for (const [index, entry] of EXACT_MIGRATION_ALLOWLIST.entries()) {
                    const wasApplied = index < targetIndex;
                    beforeRows.push(wasApplied
                        ? ` ${entry.version} | ${entry.version} | applied`
                        : ` ${entry.version} |                | pending`);
                    afterRows.push(index <= targetIndex
                        ? ` ${entry.version} | ${entry.version} | applied`
                        : ` ${entry.version} |                | pending`);
                }
                const before = beforeRows.join('\n');
                const after = afterRows.join('\n');
                expect(assertBeforeApply(before, config).pending).toEqual(
                    EXACT_MIGRATION_ALLOWLIST.slice(targetIndex).map(({ version }) => version),
                );
                expect(assertExactDryRun(`Would push these migrations:\n • ${target.file}`, config))
                    .toEqual({ files: [target.file] });
                expect(assertAfterApply(before, after, config)).toEqual({
                    pending: EXACT_MIGRATION_ALLOWLIST.slice(targetIndex + 1).map(({ version }) => version),
                    appliedDelta: `${target.version}:pending->applied`,
                });

                if (targetIndex > 0) {
                    const outOfOrder = before.replace(
                        ` ${EXACT_MIGRATION_ALLOWLIST[targetIndex - 1].version} | ${EXACT_MIGRATION_ALLOWLIST[targetIndex - 1].version} | applied`,
                        ` ${EXACT_MIGRATION_ALLOWLIST[targetIndex - 1].version} |                | pending`,
                    );
                    dependencyViolations.push(() => assertBeforeApply(outOfOrder, config));
                }
            } finally {
                rmSync(fixture, { recursive: true, force: true });
            }
        }
        expect(dependencyViolations).toHaveLength(EXACT_MIGRATION_ALLOWLIST.length - 1);
        for (const violation of dependencyViolations) expect(violation).toThrow(/unexpected pending/);
    });
});

const root=process.cwd();
const witness=contract=>({checks:c1CatalogQuery(contract).names.map(name=>({name,ok:true})),
  activation:[{policy_version:'newest_one_v1',activated_at:'2026-09-20T16:29:29.114Z'}]});

describe('C1 exact source/catalog postflight',()=>{
  it('executes the native runner\'s actual catalog hook through a real PGlite SQL connection',async()=>{
    const db=new PGlite();
    try {
      const exec=async sql=>{
        if(sql.startsWith('WITH checks AS'))return (await db.query(sql)).rows[0].jsonb_build_object;
        await db.exec(sql);return '';
      };
      const checks=await proveC1CatalogStages(exec);
      expect(checks.map(row=>[row.phase,row.version,row.checks,row.passed])).toEqual([
        ['before',C1_VERSIONS[0],32,true],['after',C1_VERSIONS[0],36,true],
        ['before',C1_VERSIONS[1],36,true],['after',C1_VERSIONS[1],38,true],
      ]);
    } finally {await db.close();}
  },60000);
  it('executes all three real disposable catalog states and refuses body, ACL and trigger drift',async()=>{
    const sql=version=>readFileSync(`backend/supabase/migrations/${EXACT_MIGRATION_ALLOWLIST.find(row=>row.version===version).file}`,'utf8');
    const bootstrap=bootstrapSql(),fence=sql(C1_VERSIONS[0]);
    expect(bootstrap.split(fence)).toHaveLength(2);
    const db=new PGlite();
    try {
      await db.exec(bootstrap.replace(fence,''));
      const catalog=async contract=>JSON.parse((await db.query(c1CatalogQuery(contract).sql)).rows[0].jsonb_build_object);
      let prior;
      for(const version of C1_VERSIONS) {
        const before=c1Contract(root,'before',version),after=c1Contract(root,'after',version);
        const preimage=await catalog(before);
        expect(assertC1Catalog(preimage,before).passed).toBe(true);
        prior={version,targetSha256:before.targetSha256,catalog:preimage};
        await db.exec(`SET ROLE closure_owner; ${sql(version)} RESET ROLE;`);
        expect(assertC1Catalog(await catalog(after),after,prior).passed).toBe(true);
        const drift=version===C1_VERSIONS[0]?[
          ['127 WHEN(false)',`DROP TRIGGER a_guard_account_coaching_ai_suggestions_insert ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_insert BEFORE INSERT ON public.sessions
              FOR EACH ROW WHEN(false) EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()`],
          ['127 wrong function',`CREATE FUNCTION public.fixture_wrong_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
            DROP TRIGGER a_guard_account_coaching_ai_suggestions_insert ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_insert BEFORE INSERT ON public.sessions
              FOR EACH ROW WHEN(NEW.ai_suggestions IS NOT NULL) EXECUTE FUNCTION public.fixture_wrong_guard()`],
          ['127 wrong UPDATE columns',`DROP TRIGGER a_guard_account_coaching_ai_suggestions_update ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_update BEFORE UPDATE OF total_words ON public.sessions
              FOR EACH ROW WHEN(NEW.ai_suggestions IS DISTINCT FROM OLD.ai_suggestions)
              EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()`],
          ['127 wrong timing',`DROP TRIGGER a_guard_account_coaching_ai_suggestions_update ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_update AFTER UPDATE OF ai_suggestions ON public.sessions
              FOR EACH ROW WHEN(NEW.ai_suggestions IS DISTINCT FROM OLD.ai_suggestions)
              EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()`],
          ['127 inner writer exposed','GRANT EXECUTE ON FUNCTION public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer) TO service_role'],
          ['127 receipt table write restored','GRANT INSERT,UPDATE ON public.ai_suggestion_authority_receipts TO service_role'],
          ['127 receipt column write restored','GRANT INSERT(session_id) ON public.ai_suggestion_authority_receipts TO service_role'],
          ['127 intended fence execution removed','REVOKE EXECUTE ON FUNCTION public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text) FROM service_role'],
          ['127 cache execution exposed','GRANT EXECUTE ON FUNCTION public.record_ai_suggestion_cache_read_v1(uuid,uuid) TO authenticated'],
        ]:[
          ['128 WHEN(false)',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript,transcript_state,user_id,status,created_at,engine,engine_version,model_name,product ON public.sessions
              FOR EACH ROW WHEN(false) EXECUTE FUNCTION public._ss_retention_content_row_guard()`],
          ['128 wrong function',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript,transcript_state,user_id,status,created_at,engine,engine_version,model_name,product ON public.sessions
              FOR EACH ROW EXECUTE FUNCTION public._ss_retention_expired_derived_guard()`],
          ['128 wrong UPDATE columns',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript ON public.sessions
              FOR EACH ROW EXECUTE FUNCTION public._ss_retention_content_row_guard()`],
          ['128 wrong row mode',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript,transcript_state,user_id,status,created_at,engine,engine_version,model_name,product ON public.sessions
              FOR EACH STATEMENT EXECUTE FUNCTION public._ss_retention_content_row_guard()`],
          ['128 expiry grants exposed','GRANT SELECT ON public.transcript_retention_expiry_grants TO service_role'],
          ['128 expiry column exposed','GRANT SELECT(capture_id) ON public.transcript_retention_expiry_grants TO authenticated'],
        ];
        for(const [name,mutation] of drift) {
          await db.exec(`BEGIN; SET ROLE closure_owner; ${mutation};`);
          try {
            const actual=await catalog(after);
            expect(()=>assertC1Catalog(actual,after,prior)).toThrow(/C1 catalog mismatch/);
            console.info(JSON.stringify({c1CatalogDrift:name,version,status:'REFUSED'}));
          }
          finally {await db.exec('ROLLBACK; RESET ROLE;');}
        }
        expect(assertC1Catalog(await catalog(after),after,prior).passed).toBe(true);
      }
      const contract=c1Contract(root,'after',C1_VERSIONS[1]);
      for(const mutation of [
        'ALTER FUNCTION public.complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text) SECURITY INVOKER',
        'GRANT SELECT ON public.session_progress_content_evidence TO service_role',
        'ALTER TABLE public.sessions DISABLE TRIGGER aa_retention_content_row_guard',
      ]) {
        await db.exec(`BEGIN; SET ROLE closure_owner; ${mutation};`);
        try {const actual=await catalog(contract);expect(()=>assertC1Catalog(actual,contract,prior)).toThrow(/C1 catalog mismatch/);}
        finally {await db.exec('ROLLBACK; RESET ROLE;');}
      }
      expect(assertC1Catalog(await catalog(contract),contract,prior).passed).toBe(true);
    } finally {await db.close();}
  },60000);
  it('pins both source files and parses every declared target function',()=>{
    for(const [index,version] of C1_VERSIONS.entries()) {
      const pin=EXACT_MIGRATION_ALLOWLIST.find(row=>row.version===version);
      const source=readFileSync(`backend/supabase/migrations/${pin.file}`,'utf8');
      expect(createHash('sha256').update(source).digest('hex')).toBe(pin.sha256);
      expect(functionDefinitions(source)).toHaveLength(index===0?7:14);
    }
  });
  it('requires reviewed predecessor bodies, absence of future objects, and ordered127→128 states',()=>{
    const before127=c1Contract(root,'before',C1_VERSIONS[0]);
    const after127=c1Contract(root,'after',C1_VERSIONS[0]);
    const before128=c1Contract(root,'before',C1_VERSIONS[1]);
    const after128=c1Contract(root,'after',C1_VERSIONS[1]);
    expect(before127.stage).toBe(0);expect(after127.stage).toBe(1);expect(after128.stage).toBe(2);
    expect(after127.functions).toEqual(before128.functions);
    expect(before127.functions.some(row=>row.expected===null)).toBe(true);
    expect(after128.functions.every(row=>row.expected!==null)).toBe(true);
    // The signature must be checked for absence; the not-yet-installed function must never be called.
    expect(c1CatalogQuery(before127).sql).toContain("to_regprocedure('public.retention_content_free_compatible()') IS NULL");
    expect(c1CatalogQuery(before127).sql).not.toMatch(/(?:AND|SELECT)\s+public\.retention_content_free_compatible\(\)/);
    expect(c1CatalogQuery(after128).sql).toContain("'retention-pins'");
  });
  it('accepts complete boolean catalog proof but refuses missing/duplicated/false/null rows and changed activation',()=>{
    for(const version of C1_VERSIONS) {
      const before=c1Contract(root,'before',version),after=c1Contract(root,'after',version);
      const prior={version,targetSha256:before.targetSha256,catalog:witness(before)};
      const current=witness(after);
      expect(assertC1Catalog(current,after,prior).passed).toBe(true);
      for(const mutate of [value=>value.checks.pop(),value=>value.checks.push(value.checks[0]),
        value=>{value.checks[0].ok=false;},value=>{value.checks[0].ok=null;},
        value=>{value.activation[0].activated_at=null;},value=>{delete value.activation[0].activated_at;}]) {
        const changed=structuredClone(current);mutate(changed);
        expect(()=>assertC1Catalog(changed,after,prior)).toThrow();
      }
      expect(()=>assertC1Catalog(current,after,{...prior,targetSha256:'0'.repeat(64)})).toThrow();
      for(const missing of [undefined,null,{}, {...prior,catalog:null}])expect(()=>assertC1Catalog(current,after,missing)).toThrow();
      expect(()=>c1Contract(root,'after','unselected')).toThrow();
    }
  });
});
