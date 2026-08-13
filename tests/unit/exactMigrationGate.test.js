import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    assertAfterApply,
    assertBeforeApply,
    assertExactDryRun,
    HELD_FILE,
    TARGET_FILE,
    TARGET_SHA256,
} from '../../scripts/lib/exactMigrationGate.mjs';

const matched = ' 20260810120000 | 20260810120000 | 2026-08-10 12:00:00';
const heldPending = ' 20260811143000 |                | 2026-08-11 14:30:00';
const targetPending = ' 20260812002000 |                | 2026-08-12 00:20:00';
const targetApplied = ' 20260812002000 | 20260812002000 | 2026-08-12 00:20:00';

describe('exact migration gate', () => {
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
        expect(assertAfterApply([matched, heldPending, targetApplied].join('\n'))).toEqual({
            pending: ['20260811143000'],
        });
        expect(() => assertAfterApply([matched, targetApplied].join('\n'))).toThrow(/held migration/);
        expect(() => assertAfterApply([matched, targetApplied, ' 20260811143000 | 20260811143000 | x'].join('\n')))
            .toThrow(/unexpectedly applied/);
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
        expect(workflow).toContain('environment: production-db');
        expect(workflow).toContain('group: production-database-migrations');
        expect(workflow).toContain('default branch advanced after dry-run');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs before');
        expect(workflow).toContain('node "$GITHUB_WORKSPACE/scripts/exact-migration-gate.mjs" dry-run');
        expect(workflow).toContain('node ../../scripts/exact-migration-gate.mjs after');
        expect(workflow).not.toMatch(/^\s+supabase migration repair/m);
        expect(workflow).not.toMatch(/^\s+supabase db push .*--include-all/m);

        const legacyWorkflow = readFileSync(resolve(root, '.github/workflows/deploy-supabase-migrations.yml'), 'utf8');
        expect(legacyWorkflow).toContain('group: production-database-migrations');
    });
});
