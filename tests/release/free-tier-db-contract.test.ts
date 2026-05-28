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
});
