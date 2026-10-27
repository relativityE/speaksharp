import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const pendingMigration = '20261018170000_account_closure_pending_checkout.sql';
export const closureMigration = name => readFileSync(resolve('backend/supabase/migrations', name), 'utf8');
export function pendingBootstrap() {
  const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8')
    .match(/await db\.exec\(`\n([\s\S]*?)`\);/);
  if (!fixture) throw new Error('existing scoped SQL fixture missing');
  const canonical = closureMigration('20260812041500_flawless_launch_runtime_convergence_1290.sql')
    .split('-- Usage counters remain content-free telemetry.')[0];
  return `${fixture[1]}
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    SET ROLE closure_owner;
    ${closureMigration('20260812041600_trial_commercial_grant_on_conflict_1294.sql')}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();
    ${closureMigration('20260812002000_webhook_lifecycle_completeness_1282.sql')}
    ${canonical}
    ${closureMigration('20261013180000_account_closure_tokens.sql')}
    ${closureMigration('20261016090000_account_closure_drain_persistence.sql')}
    ${closureMigration('20261016180000_account_closure_drain_enforcement.sql')}
    ${closureMigration('20261017200000_checkout_rejection_recovery.sql')}
    ${closureMigration(pendingMigration)}
    RESET ROLE;`;
}
