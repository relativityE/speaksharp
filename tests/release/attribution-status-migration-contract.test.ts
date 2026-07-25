import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = '20260724220000_sessions_attribution_status.sql';
const migration = readFileSync(
    resolve(process.cwd(), 'backend', 'supabase', 'migrations', MIGRATION),
    'utf8',
);

describe('#1033 sessions.attribution_status migration contract', () => {
    it('adds the column additively with a pending default so the deployed app keeps working', () => {
        expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS attribution_status TEXT/);
        expect(migration).toMatch(/ALTER COLUMN attribution_status SET DEFAULT 'pending'/);
        expect(migration).toMatch(/ALTER COLUMN attribution_status SET NOT NULL/);
    });

    it('backfills existing rows to legacy_unknown and never infers verified from engine_version', () => {
        expect(migration).toMatch(/SET attribution_status = 'legacy_unknown'\s*\n?\s*WHERE attribution_status IS NULL/);
        // No heuristic promotion of historical rows to a verified/attributed state.
        expect(migration).not.toMatch(/SET\s+attribution_status\s*=\s*'verified'/i);
        expect(migration).not.toMatch(/engine_version\s+(?:I?LIKE|~)/i);
    });

    it('scopes the CHECK-constraint existence probe to public.sessions (conrelid), not the name alone', () => {
        // A same-named constraint on ANOTHER relation must not cause the sessions CHECK to be skipped.
        const guard = migration.slice(
            migration.indexOf('FROM pg_constraint'),
            migration.indexOf('ADD CONSTRAINT sessions_attribution_status_check'),
        );
        expect(guard).toMatch(/conname = 'sessions_attribution_status_check'/);
        expect(guard).toMatch(/conrelid = 'public\.sessions'::regclass/);
        expect(guard).toMatch(/contype = 'c'/);
    });

    it('constrains the column to exactly the four lifecycle values', () => {
        expect(migration).toMatch(
            /CHECK \(attribution_status IN \('pending', 'verified', 'unverified', 'legacy_unknown'\)\)/,
        );
    });

    it('adds the verified-only partial index used by engine-evidence queries', () => {
        expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS idx_sessions_attribution_verified/);
        expect(migration).toMatch(/WHERE attribution_status = 'verified'/);
    });

    it('documents that it is not applied to production by this PR', () => {
        expect(migration).toMatch(/NOT APPLIED TO PRODUCTION BY THIS PR/i);
    });
});
