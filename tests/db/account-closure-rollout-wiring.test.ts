// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { accountClosureRolloutQuery, assertAccountClosureRollout } from '../../scripts/lib/accountClosureRolloutGate.mjs';
import { resolveExactMigrationConfig, assertTerminalOutcome, verifyMigrationSourceIdentity } from '../../scripts/lib/exactMigrationGate.mjs';
import { closureRolloutDependencyMutations as dependencyMutations } from './accountClosureRolloutMutations.mjs';

const baseline = readFileSync('backend/supabase/migrations/20260812041600_trial_commercial_grant_on_conflict_1294.sql', 'utf8');
const source = readFileSync('backend/supabase/migrations/20261013180000_account_closure_tokens.sql', 'utf8');
const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8').match(/await db\.exec\(`\n([\s\S]*?)`\);/)![1];
const target = '20261013180000_account_closure_tokens.sql';
const workflow = parse(readFileSync('.github/workflows/apply-exact-allowlisted-migration.yml', 'utf8'));
let db: PGlite;
beforeEach(async () => { db = new PGlite(); await db.exec(fixture); await db.exec(`SET ROLE closure_owner; ${baseline}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user(); RESET ROLE;`); });
afterEach(async () => { await db.close(); });
async function check(mode: string) {
    const result = await db.query<{ json_build_object: string }>(accountClosureRolloutQuery(mode, baseline));
    return assertAccountClosureRollout(result.rows[0].json_build_object, mode);
}
describe('account closure rollout schema — no application/activation', () => {
    it.each(['before', 'after'])('rejects dependency drift throughout the %s catalog matrix', async (mode) => {
        if (mode === 'after') await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`);
        await check(mode);
        await db.exec('BEGIN');
        try {
            for (const mutation of dependencyMutations) {
                await db.exec('SAVEPOINT dependency_case');
                await db.exec(mutation);
                await expect(check(mode)).rejects.toThrow('rollout schema check failed');
                await db.exec('ROLLBACK TO SAVEPOINT dependency_case; RELEASE SAVEPOINT dependency_case');
                await check(mode);
            }
        } finally { await db.exec('ROLLBACK'); }
    });
    it.each(['before', 'after'])('uses catalog attribute identities and usable included-column email indexes in %s', async (mode) => {
        if (mode === 'after') await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`);
        await db.exec(`DROP TABLE trial_entitlements;
          CREATE TABLE trial_entitlements(user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
            trial_expires_at timestamptz NOT NULL DEFAULT now(), email text NOT NULL,
            updated_at timestamptz DEFAULT now(),trial_started_at timestamptz NOT NULL DEFAULT now());
          CREATE UNIQUE INDEX differently_named_email ON trial_entitlements(email) INCLUDE(trial_started_at)`);
        await expect(check(mode)).resolves.toMatchObject({ passed: true });
    });
    it.each(['before', 'after'])('requires every exact output check name in %s', async (mode) => {
        if (mode === 'after') await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`);
        const result = await check(mode);
        for (const name of Object.keys(result.checks)) {
            const broken = structuredClone(result); delete broken.checks[name];
            expect(() => assertAccountClosureRollout(broken, mode)).toThrow();
        }
        expect(() => assertAccountClosureRollout({ ...result, checks: { ...result.checks, unexpected: true } }, mode)).toThrow();
    });
    it.each(['before', 'after'])('rejects missing signup trigger in %s rollout', async (mode) => {
        if (mode === 'after') await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`);
        await check(mode);
        await db.exec('DROP TRIGGER on_auth_user_created_trial_profile ON auth.users');
        await expect(check(mode)).rejects.toThrow('rollout schema check failed');
    });
    it.each(['before', 'after'])('rejects missing email arbiter and wrong owner FK in %s rollout', async (mode) => {
        if (mode === 'after') await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`);
        await check(mode);
        await db.exec('ALTER TABLE trial_entitlements DROP CONSTRAINT trial_entitlements_pkey');
        await expect(check(mode)).rejects.toThrow('rollout schema check failed');
        await db.exec(`ALTER TABLE trial_entitlements ADD PRIMARY KEY(email);
          ALTER TABLE trial_entitlements DROP CONSTRAINT trial_entitlements_user_id_fkey;
          ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE`);
        await expect(check(mode)).rejects.toThrow('rollout schema check failed');
    });
    it('accepts only the reviewed baseline before, and the exact logical tables after', async () => {
        await check('before'); await expect(check('after')).rejects.toThrow();
        await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`);
        await check('after'); await expect(check('before')).rejects.toThrow();
    });
    it('rejects unknown existing signup behavior rather than overwriting it', async () => {
        await db.exec("CREATE OR REPLACE FUNCTION ensure_trial_profile_for_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN NEW; END; $$");
        await expect(check('before')).rejects.toThrow();
    });
    it('rejects missing dependent baseline columns', async () => {
        await db.exec('ALTER TABLE user_profiles DROP COLUMN stripe_customer_id');
        await expect(check('before')).rejects.toThrow();
    });
    it('accepts Supabase Auth varchar email and rejects incompatible email types', async () => {
        await db.exec('ALTER TABLE auth.users ALTER COLUMN email TYPE varchar(255)');
        await check('before');
        await db.exec('ALTER TABLE auth.users ALTER COLUMN email TYPE integer USING email::integer');
        await expect(check('before')).rejects.toThrow();
    });
    it.each([
        'ALTER TABLE account_closure_tokens RENAME COLUMN token_hash TO wrong_hash',
        'ALTER TABLE account_closure_tokens ALTER COLUMN expires_at SET DEFAULT now()',
        'ALTER TABLE account_checkout_operations DROP CONSTRAINT account_checkout_operations_phase_check',
        'ALTER TABLE account_closure_tokens DROP CONSTRAINT account_closure_tokens_user_id_fkey',
        'ALTER TABLE account_closure_billing_permits ALTER COLUMN transaction_id DROP NOT NULL',
        'ALTER TABLE account_closure_attempts ALTER COLUMN claimed_email DROP NOT NULL',
        'ALTER TABLE account_closure_attempts DROP CONSTRAINT account_closure_attempts_claimed_email_check',
    ])('rejects changed table identity: %s', async (mutation) => {
        await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`); await check('after');
        await db.exec(mutation); await expect(check('after')).rejects.toThrow();
    });
    it('rejects changed baseline bytes and malformed verification output', () => {
        expect(() => accountClosureRolloutQuery('before', `${baseline}\n`)).toThrow('checksum');
        expect(() => assertAccountClosureRollout({ mode: 'rollout-after', passed: true, checks: {} }, 'after')).toThrow();
    });
});
describe('exact-apply workflow composition', () => {
    it('binds the reviewed closure checksum and leaves commercial activation held', () => {
        const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: '20261013180000' });
        expect(config.targetFile).toBe(target);
        expect(config.targetSha256).toBe('150879ed64cd5ded4b1d6a7c6111e69ebe9042b59a706fa6757ec4d8e1a43100');
        expect(config.requiredAppliedVersions).toContain('20260812041600');
        expect(config.requiredAppliedVersions).not.toContain('20260812042000');
        expect(config.excludedMigrations.map((item: { version: string }) => item.version)).toContain('20260812042000');
        expect(() => verifyMigrationSourceIdentity('backend/supabase', config)).not.toThrow();
    });
    it.each([undefined, 'skipped', 'failure', 'cancelled'])('cannot report operation success with %s closure postflight', (outcome) => {
        expect(() => assertTerminalOutcome({ apply: 'success', verify: 'success', lint: 'success', targetFile: target,
            postflights: outcome ? { postflight_20261013180000: outcome } : {} })).toThrow('postflight');
    });
    it('permits terminal success only with the required named closure postflight', () => {
        expect(assertTerminalOutcome({ apply: 'success', verify: 'success', lint: 'success', targetFile: target,
            postflights: { postflight_20261013180000: 'success' } }).enforcedPostflights).toEqual(['postflight_20261013180000']);
    });
    it('keeps dispatch manual and connects checked preflight → apply → postflight → terminal', () => {
        expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
        expect(workflow.on.workflow_dispatch.inputs.target_version.options).toContain('20261013180000');
        const steps = workflow.jobs['apply-one-allowlisted-migration'].steps;
        const before = steps.findIndex((step: { run?: string }) => step.run?.includes('account-closure-rollout-gate.mjs before'));
        const apply = steps.findIndex((step: { id?: string }) => step.id === 'apply');
        const after = steps.findIndex((step: { id?: string }) => step.id === 'postflight_20261013180000');
        const terminal = steps.findIndex((step: { id?: string }) => step.id === 'terminal');
        expect(before).toBeGreaterThan(-1); expect(apply).toBeGreaterThan(before);
        expect(after).toBeGreaterThan(apply); expect(terminal).toBeGreaterThan(after);
        expect(steps.find((step: { id?: string }) => step.id === 'connectivity_preflight').if).toContain('20261013180000_account_closure_tokens');
        expect(steps[after].if).toContain("steps.apply.outcome == 'success'");
        expect(steps[after].run).toContain('account-closure-rollout-gate.mjs after');
        expect(steps[terminal].run).toContain('postflight_20261013180000=${{ steps.postflight_20261013180000.outcome }}');
        for (const index of [before, after]) expect(steps[index].run).toContain('"$RUNNER_TEMP/pooler.env"');
    });
});
