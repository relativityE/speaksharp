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
    HELD_FILE,
    TARGET_FILE,
    TARGET_SHA256,
    prepareExactMigrationWorkspace,
    resolveExactMigrationConfig,
    verifyExactMigrationWorkspace,
} from '../../scripts/lib/exactMigrationGate.mjs';

const matched = ' 20260810120000 | 20260810120000 | 2026-08-10 12:00:00';
const heldPending = ' 20260811143000 |                | 2026-08-11 14:30:00';
const targetPending = ' 20260812002000 |                | 2026-08-12 00:20:00';
const targetApplied = ' 20260812002000 | 20260812002000 | 2026-08-12 00:20:00';
const PRIOR_FILE = '20260810120000_prior.sql';
const TARGET_BYTES = '-- target\n';
const PRIOR_BYTES = '-- prior\n';

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
    it('accepts a workflow-pinned target while preserving the webhook contract as the default', () => {
        expect(resolveExactMigrationConfig({})).toEqual({
            targetVersion: '20260812002000',
            targetFile: '20260812002000_webhook_lifecycle_completeness_1282.sql',
            targetSha256: TARGET_SHA256,
            excludedMigrations: [{ version: '20260811143000', file: HELD_FILE }],
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
            excludedMigrations: [
                { version: '20260811143000', file: HELD_FILE },
                { version: '20260812039500', file: '20260812039500_webhook_duplicate_snapshot_convergence_1282.sql' },
            ],
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

    it('requires baseline-relative lint and an unambiguous successful terminal outcome', () => {
        const baseline = 'Connecting to remote database\nwarning: existing issue\n';
        expect(assertNoNewLint(baseline, 'Connecting to remote database\nwarning: existing issue\n'))
            .toEqual({ baselineFindings: 1, postFindings: 1 });
        expect(() => assertNoNewLint(baseline, `${baseline}warning: new issue\n`)).toThrow(/differs/);
        expect(assertTerminalOutcome('success', 'success', 'success')).toEqual({ terminal: 'success' });
        expect(() => assertTerminalOutcome('failure', 'success', 'success')).toThrow(/apply command outcome/);
        expect(() => assertTerminalOutcome('success', 'failure', 'success')).toThrow(/history verification/);
        expect(() => assertTerminalOutcome('success', 'success', 'failure')).toThrow(/lint verification/);
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

    it('pins a separate exact Progress gate that excludes #1276 and every unselected #1282 migration', () => {
        const root = process.cwd();
        const targetFile = '20260812030000_progress_cohort_mode_separation_1265.sql';
        const targetHash = 'deeb6845ff26a1bafbfdb3751727eea723625a00ff29d4829618e4b58106f5fa';
        const migration = readFileSync(resolve(root, 'backend/supabase/migrations', targetFile));
        expect(createHash('sha256').update(migration).digest('hex')).toBe(targetHash);

        const workflow = readFileSync(resolve(root, '.github/workflows/apply-progress-mode-separation.yml'), 'utf8');
        expect(workflow).toContain("TARGET_VERSION: '20260812030000'");
        expect(workflow).toContain(`TARGET_FILE: '${targetFile}'`);
        expect(workflow).toContain(`TARGET_SHA256: '${targetHash}'`);
        expect(workflow).toContain("EXCLUDED_VERSIONS: '20260811143000 20260812039500 20260812040000 20260812041000 20260812042000'");
        for (const file of [
            '20260811143000_harden_exposed_security_definer_acl.sql',
            '20260812039500_webhook_duplicate_snapshot_convergence_1282.sql',
            '20260812040000_thirty_day_trial_lifecycle_1282.sql',
            '20260812041000_trial_expiry_fail_closed_1282.sql',
            '20260812042000_trial_activation_stamp_1282.sql',
        ]) expect(workflow).toContain(file);
        expect(workflow).toMatch(/permissions:\s*\n\s+actions: read\s*\n\s+contents: read/);
        expect(workflow).toContain('environment: production-db');
        expect(workflow).toContain('group: production-database-migrations');
        expect(workflow).toContain('APPLY $TARGET_VERSION AT $EXPECTED_HEAD_SHA');
        expect(workflow).toContain('default branch advanced after dry-run');
        expect(workflow).toContain('Apply Progress mode separation (exact migration)');
        expect(workflow).toContain('prepare-workspace backend/supabase "$RUNNER_TEMP"');
        expect(workflow).toContain('continue-on-error: true');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs after');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs lint-delta');
        expect(workflow).toContain('node scripts/exact-migration-gate.mjs final');
        expect(workflow).not.toMatch(/^\s+supabase migration repair/m);
        expect(workflow).not.toMatch(/^\s+supabase db push .*--include-all/m);
    });

    it('makes only #1286 apply-visible with the current-main pending set', () => {
        const excluded = [
            ['20260811143000', '20260811143000_harden_exposed_security_definer_acl.sql'],
            ['20260812039500', '20260812039500_webhook_duplicate_snapshot_convergence_1282.sql'],
            ['20260812040000', '20260812040000_thirty_day_trial_lifecycle_1282.sql'],
            ['20260812041000', '20260812041000_trial_expiry_fail_closed_1282.sql'],
            ['20260812042000', '20260812042000_trial_activation_stamp_1282.sql'],
        ];
        const progressConfig = resolveExactMigrationConfig({
            TARGET_VERSION: '20260812030000',
            TARGET_FILE: '20260812030000_progress_cohort_mode_separation_1265.sql',
            TARGET_SHA256: 'progress-hash',
            EXCLUDED_VERSIONS: excluded.map(([version]) => version).join(' '),
            EXCLUDED_FILES: excluded.map(([, file]) => file).join(' '),
        });
        const fixture = mkdtempSync(join(tmpdir(), 'progress-exact-migration-workspace-'));
        try {
            const source = join(fixture, 'source-supabase');
            const migrations = join(source, 'migrations');
            const isolatedRoot = join(fixture, 'runner-temp');
            mkdirSync(migrations, { recursive: true });
            mkdirSync(isolatedRoot);
            writeFileSync(join(source, 'config.toml'), 'project_id = "fixture"\n');
            writeFileSync(join(migrations, PRIOR_FILE), PRIOR_BYTES);
            writeFileSync(join(migrations, progressConfig.targetFile), '-- progress target\n');
            for (const [, file] of excluded) writeFileSync(join(migrations, file), `-- excluded ${file}\n`);

            const result = prepareExactMigrationWorkspace(source, isolatedRoot, progressConfig);
            expect(existsSync(join(result.supabaseDir, 'migrations', progressConfig.targetFile))).toBe(true);
            for (const [, file] of excluded) {
                expect(existsSync(join(result.supabaseDir, 'migrations', file))).toBe(false);
                expect(existsSync(join(result.heldDir, file))).toBe(true);
            }

            const excludedPending = excluded.map(([version]) => ` ${version} |                | pending`);
            const progressPending = ' 20260812030000 |                | pending';
            const progressApplied = ' 20260812030000 | 20260812030000 | applied';
            const before = [matched, ...excludedPending, progressPending].join('\n');
            const after = [matched, ...excludedPending, progressApplied].join('\n');
            expect(assertBeforeApply(before, progressConfig).pending).toHaveLength(6);
            expect(assertExactDryRun(`Would push these migrations:\n • ${progressConfig.targetFile}`, progressConfig))
                .toEqual({ files: [progressConfig.targetFile] });
            expect(() => assertExactDryRun(
                `Would push these migrations:\n • ${progressConfig.targetFile}\n • ${excluded[1][1]}`,
                progressConfig,
            )).toThrow(/not target-only/);
            expect(assertAfterApply(before, after, progressConfig)).toEqual({
                pending: excluded.map(([version]) => version),
                appliedDelta: '20260812030000:pending->applied',
            });
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    });
});
