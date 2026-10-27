// Composed read-only gate for the exact-apply workflow; no activation/provider RPC.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { accountClosureSchemaQuery, accountClosureDisabledQuery, assertAccountClosureTerminal } from './lib/accountClosureSchemaGate.mjs';
import { accountClosureRolloutQuery, assertAccountClosureRollout } from './lib/accountClosureRolloutGate.mjs';

try {
    const mode = process.argv[2];
    const migration = readFileSync(new URL('../backend/supabase/migrations/20261013180000_account_closure_tokens.sql', import.meta.url), 'utf8');
    const baseline = readFileSync(new URL('../backend/supabase/migrations/20260812041600_trial_commercial_grant_on_conflict_1294.sql', import.meta.url), 'utf8');
    const queries = [accountClosureSchemaQuery(mode, migration)];
    if (mode === 'after') queries.push(accountClosureDisabledQuery);
    queries.push(accountClosureRolloutQuery(mode, baseline));
    const args = process.env.DB_URL ? [process.env.DB_URL] : [];
    const output = execFileSync('psql', [...args, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
        `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${queries.join('\n')}\nCOMMIT;`], {
        encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on` },
    }).trim().split('\n');
    if (output.length !== queries.length) throw new Error('incomplete rollout verification');
    const schema = assertAccountClosureTerminal(output.slice(0, -1), mode);
    const rollout = assertAccountClosureRollout(output.at(-1), mode);
    console.log(JSON.stringify({ mode, passed: true, stages: [...schema.stages, rollout] }));
} catch {
    console.error('account closure rollout verification failed; no activation authorized'); process.exitCode = 1;
}
