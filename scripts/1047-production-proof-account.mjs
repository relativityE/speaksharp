import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [command] = process.argv.slice(2);
const url = process.env.SUPABASE_URL ?? '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const runId = (process.env.PROOF_RUN_ID ?? '').trim();
const evidenceDir = process.env.PROOF_EVIDENCE_DIR ?? 'test-results/1047-production-proof';

if (!url || !serviceRole) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!/^[a-z0-9-]{8,80}$/i.test(runId)) throw new Error('PROOF_RUN_ID must be a bounded opaque token');

const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
const tables = [
  'progress_recommendation_attempts',
  'progress_recommendations',
  'session_progress_evaluations',
  'sessions',
];

function appendEnv(name, value) {
  const envFile = process.env.GITHUB_ENV;
  if (!envFile) throw new Error('GITHUB_ENV is required');
  appendFileSync(envFile, `${name}=${value}\n`, { encoding: 'utf8' });
}

function persistEvidence(payload) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(`${evidenceDir}/account-lifecycle.json`, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

async function count(table, userId) {
  const { count: value, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return value ?? 0;
}

async function create() {
  const email = `u3-${runId}@proof.invalid`;
  const password = `U3!${randomBytes(24).toString('base64url')}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { proof_run: runId, purpose: '1047-production-proof' },
  });
  if (error || !data.user) throw new Error(`disposable user creation failed: ${error?.message ?? 'no user'}`);
  appendEnv('FREE_TEST_EMAIL', email);
  appendEnv('FREE_TEST_PASSWORD', password);
  appendEnv('PROOF_USER_ID', data.user.id);
  process.stdout.write(`::add-mask::${password}\n`);
  persistEvidence({ schema: 'speaksharp.1047-proof.v1', runId, userCreated: true, userDeleted: false });
  console.log(`PROOF_ACCOUNT_CREATED run=${runId} user=${data.user.id.slice(0, 8)}…`);
}

async function cleanup() {
  const userId = (process.env.PROOF_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('PROOF_USER_ID is required for cleanup');

  const before = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await count(table, userId)])));
  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq('user_id', userId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteUserError) throw new Error(`auth cleanup failed: ${deleteUserError.message}`);

  const after = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await count(table, userId)])));
  if (Object.values(after).some((value) => value !== 0)) throw new Error(`zero-residue check failed: ${JSON.stringify(after)}`);
  persistEvidence({ schema: 'speaksharp.1047-proof.v1', runId, userCreated: true, userDeleted: true, rowsBeforeCleanup: before, rowsAfterCleanup: after });
  console.log(`PROOF_ACCOUNT_CLEANUP run=${runId} zero_residue=true`);
}

if (command === 'create') await create();
else if (command === 'cleanup') await cleanup();
else throw new Error('usage: node scripts/1047-production-proof-account.mjs create|cleanup');
