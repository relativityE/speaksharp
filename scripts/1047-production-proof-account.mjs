import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const [command] = process.argv.slice(2);
const url = process.env.SUPABASE_URL ?? '';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const runId = (process.env.PROOF_RUN_ID ?? '').trim();
const evidenceDir = process.env.PROOF_EVIDENCE_DIR ?? 'test-results/1047-production-proof';
const recoveryFile = process.env.PROOF_RECOVERY_FILE ?? `${evidenceDir}/account-recovery.json`;

if (!url || !serviceRole) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!/^[a-z0-9-]{8,80}$/i.test(runId)) throw new Error('PROOF_RUN_ID must be a bounded opaque token');

const email = `u3-${runId}@proof.invalid`;
const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
// Every table a proof account can own on the deployed Progress path. The CASCADE-FK tables it also
// populates (usage_checkpoints, active_recording_lease, user_goals, custom_vocabulary) are removed
// automatically by deleteUser() and so are gone-by-construction; only tables that survive a user delete
// need explicit teardown + residue readback here.
//   - `ownerColumn` drives the explicit DELETE (always keyed on user_id/id, run BEFORE deleteUser).
//   - `residueColumn`/`residueValue`, when present, drive the zero-residue COUNT for a table whose FK is
//     ON DELETE SET NULL: deleteUser() only NULLs the column and leaves the row, so counting by user_id
//     afterwards would falsely read clean — the surviving row must be verified by its stable key instead.
const tables = [
  { name: 'progress_recommendation_attempts', ownerColumn: 'user_id' },
  { name: 'progress_recommendations', ownerColumn: 'user_id' },
  { name: 'session_progress_evaluations', ownerColumn: 'user_id' },
  { name: 'sessions', ownerColumn: 'user_id' },
  { name: 'user_profiles', ownerColumn: 'id' },
  // trial_entitlements: the on_auth_user_created_trial_profile trigger inserts one row per created account,
  // and its user_id FK is ON DELETE SET NULL — deleteUser() orphans (does not remove) the row. Delete it by
  // user_id before deleteUser, and verify residue by the deterministic email PK.
  { name: 'trial_entitlements', ownerColumn: 'user_id', residueColumn: 'email', residueValue: email },
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

async function count(table, column, value) {
  const { count: cnt, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
  if (error) throw new Error(`${table}.${column} count failed: ${error.message}`);
  return cnt ?? 0;
}

async function create() {
  const password = `U3!${randomBytes(24).toString('base64url')}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { proof_run: runId, purpose: '1047-production-proof' },
  });
  if (error || !data.user) throw new Error(`disposable user creation failed: ${error?.message ?? 'no user'}`);
  // Persist the recovery handle before any later operation can fail. Cleanup also searches by the deterministic
  // run-owned email, covering interruption between the remote create response and this local write.
  mkdirSync(dirname(recoveryFile), { recursive: true });
  writeFileSync(recoveryFile, `${JSON.stringify({ runId, email, userId: data.user.id })}\n`, { mode: 0o600 });
  appendEnv('FREE_TEST_EMAIL', email);
  appendEnv('FREE_TEST_PASSWORD', password);
  appendEnv('PROOF_USER_ID', data.user.id);
  process.stdout.write(`::add-mask::${password}\n`);
  persistEvidence({ schema: 'speaksharp.1047-proof.v1', runId, userCreated: true, userDeleted: false });
  console.log(`PROOF_ACCOUNT_CREATED run=${runId} user=${data.user.id.slice(0, 8)}…`);
}

async function cleanup() {
  let userId = (process.env.PROOF_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    for (let page = 1; page <= 10 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`auth recovery lookup failed: ${error.message}`);
      userId = data.users.find((user) => user.email === email && user.user_metadata?.proof_run === runId)?.id ?? '';
      if (data.users.length < 200) break;
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error(`run-owned proof account not found for ${runId}`);

  // Residue is verified by the stable key: user_id for CASCADE/NOT-NULL owners, or residueColumn (email)
  // for SET-NULL owners whose row survives deleteUser().
  const residueCol = (t) => t.residueColumn ?? t.ownerColumn;
  const residueVal = (t) => t.residueValue ?? userId;
  const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t.name, await count(t.name, residueCol(t), residueVal(t))])));
  for (const { name, ownerColumn } of tables) {
    const { error } = await admin.from(name).delete().eq(ownerColumn, userId);
    if (error) throw new Error(`${name} cleanup failed: ${error.message}`);
  }
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteUserError) throw new Error(`auth cleanup failed: ${deleteUserError.message}`);

  const after = Object.fromEntries(await Promise.all(tables.map(async (t) => [t.name, await count(t.name, residueCol(t), residueVal(t))])));
  if (Object.values(after).some((value) => value !== 0)) throw new Error(`zero-residue check failed: ${JSON.stringify(after)}`);
  const { data: deletedAuth, error: authReadError } = await admin.auth.admin.getUserById(userId);
  if (authReadError && !/not found/i.test(authReadError.message)) throw new Error(`auth zero-residue readback failed: ${authReadError.message}`);
  if (deletedAuth?.user) throw new Error('auth zero-residue check failed: disposable user still exists');
  persistEvidence({ schema: 'speaksharp.1047-proof.v1', runId, userCreated: true, userDeleted: true, rowsBeforeCleanup: before, rowsAfterCleanup: after });
  console.log(`PROOF_ACCOUNT_CLEANUP run=${runId} zero_residue=true`);
}

if (command === 'create') await create();
else if (command === 'cleanup') await cleanup();
else throw new Error('usage: node scripts/1047-production-proof-account.mjs create|cleanup');
