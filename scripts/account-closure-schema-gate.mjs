// Read-only connection; no RPC invocation, provider request, or rollout activation.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { accountClosureSchemaQuery, accountClosureDisabledQuery, assertAccountClosureSchema } from './lib/accountClosureSchemaGate.mjs';

const [mode] = process.argv.slice(2);
const source = readFileSync(new URL('../backend/supabase/migrations/20261013180000_account_closure_tokens.sql', import.meta.url), 'utf8');
const query = accountClosureSchemaQuery(mode, source);
const args = process.env.DB_URL ? [process.env.DB_URL] : [];
function run(sql, stage) {
    const output = execFileSync('psql', [...args, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on` },
        // Avoid exposing a connection string or SQL failure details from the child.
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    console.log(JSON.stringify(assertAccountClosureSchema(output, stage)));
}
try {
    run(query, mode);
    if (mode === 'after') run(accountClosureDisabledQuery, 'disabled');
} catch {
    console.error('account closure schema verification failed; no activation authorized');
    process.exitCode = 1;
}
