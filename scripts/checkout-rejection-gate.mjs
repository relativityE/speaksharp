// SELECT-only exact120 verifier. Does not reconcile, activate or call a provider.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { accountClosureEnforcementStages } from './lib/accountClosureEnforcementGate.mjs';
import { checkoutRejectionQuery, assertCheckoutRejection } from './lib/checkoutRejectionGate.mjs';

try {
  const mode = process.argv[2];
  const source = (name) => readFileSync(new URL(`../backend/supabase/migrations/${name}`, import.meta.url), 'utf8');
  const stages = accountClosureEnforcementStages('verify', {
    closure: source('20261013180000_account_closure_tokens.sql'), baseline: source('20260812041600_trial_commercial_grant_on_conflict_1294.sql'),
    drain: source('20261016090000_account_closure_drain_persistence.sql'), enforcement: source('20261016180000_account_closure_drain_enforcement.sql'),
  });
  stages.push([checkoutRejectionQuery(mode, source('20261017200000_checkout_rejection_recovery.sql')), (value) => assertCheckoutRejection(value, mode)]);
  const args = process.env.DB_URL ? [process.env.DB_URL] : [];
  const output = execFileSync('psql', [...args, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
    `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${stages.map(([query]) => query).join('\n')}\nCOMMIT;`], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore','pipe','ignore'],
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on` },
  }).trim().split('\n');
  if (output.length !== stages.length) throw new Error('incomplete recovery verification');
  const verified = stages.map(([, verify], index) => verify(output[index]));
  console.log(JSON.stringify({ mode, passed: true, stages: verified }));
} catch {
  console.error('checkout rejection verification failed; application/release must remain held');
  process.exitCode = 1;
}
