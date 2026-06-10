import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readMigration = (name: string) =>
    readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', name), 'utf8');

describe('free tier database contract', () => {
    it('keeps new profiles on the Free baseline by default', () => {
        const migration = readMigration('20260527162000_restore_free_user_type.sql');

        expect(migration).toMatch(/ALTER COLUMN subscription_status SET DEFAULT 'free'/);
        expect(migration).toMatch(/NEW\.id,\s*'free'/);
    });

    it('prevents usage checks from mutating Free users into paid Basic', () => {
        const migration = readMigration('20260528183000_remove_free_to_basic_usage_mutation.sql');

        expect(migration).toMatch(/Usage\/read paths must not mutate/i);
        expect(migration).toMatch(/WHERE tier_name = COALESCE\(v_effective_tier, 'free'\)/);
        expect(migration).not.toMatch(/SET\s+subscription_status\s*=\s*'basic'/i);
    });

    it('replaces the soft-release Pro trial with a server-backed Private sample', () => {
        const migration = readMigration('20260610143000_private_sample_entitlement.sql');
        const fkOrderFix = readMigration('20260610210500_fix_private_sample_session_fk_order.sql');

        expect(migration).toMatch(/private_sample_limit_seconds INT NOT NULL DEFAULT 300/);
        expect(migration).toMatch(/private_sample_session_id UUID REFERENCES public\.sessions\(id\)/);
        expect(migration).toMatch(/ALTER COLUMN trial_expires_at DROP DEFAULT/);
        expect(migration).toMatch(/legacy trial timestamps do not grant Pro/i);
        expect(migration).toMatch(/public\.update_user_usage\(v_duration, p_engine_type, v_new_session_id\)/);
        expect(migration).toMatch(/public\.update_user_usage\(p_incremental_seconds, v_engine_type, p_session_id\)/);
        expect(migration.indexOf('INSERT INTO public.sessions')).toBeLessThan(
            migration.indexOf('v_usage_check := public.update_user_usage(v_duration, p_engine_type, v_new_session_id)')
        );
        expect(migration).toMatch(/DELETE FROM public\.sessions\s+WHERE id = v_new_session_id AND user_id = auth\.uid\(\)/);
        expect(migration).toMatch(/v_sample_session_id IS NOT NULL AND v_sample_session_id IS DISTINCT FROM p_session_id/);
        expect(migration).toMatch(/v_final_duration := LEAST\(v_final_duration, v_sample_limit\)/);
        expect(migration).toMatch(/private_sample_completed_at = COALESCE\(private_sample_completed_at, now\(\)\)/);
        expect(migration).toMatch(/private_sample_limit_reached/);

        expect(fkOrderFix).toMatch(/FK 23503/);
        expect(fkOrderFix.indexOf('INSERT INTO public.sessions')).toBeLessThan(
            fkOrderFix.indexOf('v_usage_check := public.update_user_usage(v_duration, p_engine_type, v_new_session_id)')
        );
        expect(fkOrderFix).toMatch(/DELETE FROM public\.sessions\s+WHERE id = v_new_session_id AND user_id = auth\.uid\(\)/);
    });

    it('normalizes legacy Basic state to Free for launch', () => {
        const migration = readMigration('20260530103000_normalize_basic_to_free_for_launch.sql');

        expect(migration).toMatch(/Basic is not an active public tier/i);
        expect(migration).toMatch(/SET subscription_status = 'free'/);
        expect(migration).toMatch(/WHERE tier_name = 'free'/);
        expect(migration).toMatch(/ELSE 'free'/);
        expect(migration).not.toMatch(/THEN 'basic'/i);
    });
});
