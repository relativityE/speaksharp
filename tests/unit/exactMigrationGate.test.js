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
} from '../../scripts/lib/exactMigrationGate.mjs';

const matched = ' 20260810120000 | 20260810120000 | 2026-08-10 12:00:00';
const heldPending = ' 20260811143000 |                | 2026-08-11 14:30:00';
const targetPending = ' 20260812002000 |                | 2026-08-12 00:20:00';
const targetApplied = ' 20260812002000 | 20260812002000 | 2026-08-12 00:20:00';

describe('exact migration gate', () => {
    it('preserves the Supabase CLI workdir shape while removing only the held migration', () => {
        const fixture = mkdtempSync(join(tmpdir(), 'exact-migration-workspace-'));
        try {
            const source = join(fixture, 'source-supabase');
            const migrations = join(source, 'migrations');
            const isolatedRoot = join(fixture, 'runner-temp');
            mkdirSync(migrations, { recursive: true });
            mkdirSync(isolatedRoot);
            writeFileSync(join(source, 'config.toml'), 'project_id = "fixture"\n');
            writeFileSync(join(migrations, TARGET_FILE), '-- target\n');
            writeFileSync(join(migrations, HELD_FILE), '-- held\n');
            writeFileSync(join(migrations, '20260810120000_prior.sql'), '-- prior\n');

            const result = prepareExactMigrationWorkspace(source, isolatedRoot);

            expect(result.workdir).toBe(join(isolatedRoot, 'exact-backend'));
            expect(existsSync(join(result.workdir, 'supabase', 'config.toml'))).toBe(true);
            expect(existsSync(join(result.workdir, 'supabase', 'migrations', TARGET_FILE))).toBe(true);
            expect(existsSync(join(result.workdir, 'supabase', 'migrations', '20260810120000_prior.sql'))).toBe(true);
            expect(existsSync(join(result.workdir, 'supabase', 'migrations', HELD_FILE))).toBe(false);
            expect(existsSync(join(result.heldDir, HELD_FILE))).toBe(true);
            expect(() => prepareExactMigrationWorkspace(source, isolatedRoot)).toThrow(/already exists/);
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
});
