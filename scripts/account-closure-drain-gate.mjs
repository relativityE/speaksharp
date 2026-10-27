// Exact-apply verifier only. No activation, registration or provider RPC.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { accountClosureSchemaQuery, accountClosureDisabledQuery, assertAccountClosureSchema } from './lib/accountClosureSchemaGate.mjs';
import { accountClosureRolloutQuery, assertAccountClosureRollout } from './lib/accountClosureRolloutGate.mjs';
import { accountClosureDrainQuery, accountClosureDrainInitialQuery, assertAccountClosureDrain } from './lib/accountClosureDrainGate.mjs';

try {
    const mode = process.argv[2];
    const source = (file) => readFileSync(new URL(`../backend/supabase/migrations/${file}`, import.meta.url), 'utf8');
    const closure = source('20261013180000_account_closure_tokens.sql');
    const baseline = source('20260812041600_trial_commercial_grant_on_conflict_1294.sql');
    const drain = source('20261016090000_account_closure_drain_persistence.sql');
    const stages = [
        [accountClosureSchemaQuery('after', closure), (r) => assertAccountClosureSchema(r, 'after')],
        [accountClosureRolloutQuery('after', baseline), (r) => assertAccountClosureRollout(r, 'after')],
        [accountClosureDisabledQuery, (r) => assertAccountClosureSchema(r, 'disabled')],
        [accountClosureDrainQuery(mode, drain), (r) => assertAccountClosureDrain(r, mode)],
    ];
    if (mode === 'after') stages.push([accountClosureDrainInitialQuery, (r) => assertAccountClosureDrain(r, 'initial')]);
    const args = process.env.DB_URL ? [process.env.DB_URL] : [];
    const output = execFileSync('psql', [...args, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
        `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${stages.map(([query]) => query).join('\n')}\nCOMMIT;`], {
        encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on` },
    }).trim().split('\n');
    if (output.length !== stages.length) throw new Error('incomplete drain verification');
    const verified = stages.map(([, verify], index) => verify(output[index]));
    console.log(JSON.stringify({ mode, passed: true, stages: verified }));
} catch {
    console.error('drain persistence verification failed; deletion must remain disabled');
    process.exitCode = 1;
}
