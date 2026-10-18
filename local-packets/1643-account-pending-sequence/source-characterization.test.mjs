import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Offline characterization of the existing SQL, NOT the proposed pending policy.
// Schema fixture follows tests/db/account-closure-tokens.integration.test.ts.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
const migration = name => readFileSync(resolve('backend/supabase/migrations', name), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE closure_owner NOSUPERUSER;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth AUTHORIZATION closure_owner;
    CREATE SCHEMA storage AUTHORIZATION closure_owner;
    GRANT CREATE, USAGE ON SCHEMA public TO closure_owner;
    GRANT USAGE ON SCHEMA public, auth TO service_role, anon, authenticated;
    SET ROLE closure_owner;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      subscription_status text DEFAULT 'free',stripe_customer_id text,stripe_subscription_id text,
      subscription_id text,stripe_cancel_at_period_end boolean,updated_at timestamptz DEFAULT now(),
      private_sample_limit_seconds int,private_sample_seconds_used int,trial_started_at timestamptz,
      trial_expires_at timestamptz,commercial_trial_granted_at timestamptz);
    CREATE TABLE public.trial_entitlements(email text PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,trial_started_at timestamptz NOT NULL DEFAULT now(),
      trial_expires_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE public.stripe_subscription_tombstones(subscription_id text PRIMARY KEY,
      customer_id text NOT NULL,terminal_status text NOT NULL,tombstoned_at timestamptz DEFAULT now(),event_id text);
    CREATE TABLE public.processed_webhook_events(event_id text PRIMARY KEY,event_type text,processed_at timestamptz);
    CREATE TABLE public.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TABLE public.user_issue_reports(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL);
    CREATE TABLE storage.objects(bucket_id text,name text,owner_id text);
    ${migration('20260812041600_trial_commercial_grant_on_conflict_1294.sql')}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();
    RESET ROLE;
    INSERT INTO auth.users VALUES ('${A}','a@example.test',now()),('${B}','b@example.test',now());
    SET ROLE closure_owner;
    ${migration('20261013180000_account_closure_tokens.sql')}
    UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='offline-fixture-only';
    RESET ROLE;
  `);
  const service = (sql, args = []) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE service_role');
    return tx.query(sql, args);
  });
  return { db, service };
}
const issue = s => s('SELECT * FROM issue_account_closure_token($1,$2)', [A, HASH]);
const claim = s => s('SELECT * FROM claim_account_closure_token($1,$2)', [A, HASH]);
const begin = async (s, user = A) => (await s('SELECT begin_account_checkout($1) AS id', [user])).rows[0].id;

test('email issuance alone neither closes the account nor creates a closure attempt', async () => {
  const { db, service: s } = await fixture();
  try {
    await issue(s);
    assert.equal((await db.query('SELECT * FROM account_billing_fences')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM account_closure_attempts')).rows.length, 0);
    assert.equal((await db.query('SELECT phase FROM account_closure_tokens')).rows[0].phase, 'issued');
    assert.ok(await begin(s));
  } finally { await db.close(); }
});

test('busy checkout refuses claim BEFORE durable pending; verification remains unconsumed', async () => {
  const { db, service: s } = await fixture();
  try {
    await issue(s); await begin(s);
    await assert.rejects(claim(s), /checkout reconciliation required/);
    assert.deepEqual((await db.query('SELECT phase,request_id FROM account_billing_fences WHERE user_id=$1', [A])).rows,
      [{ phase: 'open', request_id: null }]);
    assert.equal((await db.query('SELECT * FROM account_closure_attempts')).rows.length, 0);
    assert.deepEqual((await db.query('SELECT phase,consumed_at FROM account_closure_tokens')).rows,
      [{ phase: 'issued', consumed_at: null }]);
  } finally { await db.close(); }
});

test('settled checkout permits claim; A is fenced and B still admits checkout', async () => {
  const { db, service: s } = await fixture();
  try {
    await issue(s);
    const op = await begin(s);
    await s('SELECT record_account_checkout($1,$2,$3)', [A, op, 'cs_offline']);
    await s('SELECT reconcile_account_checkout_expiry($1,$2,$3)', [A, op, 'cs_offline']);
    assert.equal((await claim(s)).rows.length, 1);
    await assert.rejects(begin(s), /billing operation pending/);
    assert.ok(await begin(s, B));
    assert.equal((await db.query('SELECT phase FROM account_billing_fences WHERE user_id=$1', [A])).rows[0].phase, 'closing');
  } finally { await db.close(); }
});

test('current pre-irreversible finish marks failed and reopens admission', async () => {
  const { db, service: s } = await fixture();
  try {
    await issue(s);
    const proof = (await claim(s)).rows[0];
    await s('SELECT finish_account_closure_attempt($1,$2)', [A, proof.request_id]);
    assert.equal((await db.query('SELECT phase FROM account_closure_attempts')).rows[0].phase, 'failed');
    assert.equal((await db.query('SELECT phase FROM account_billing_fences')).rows[0].phase, 'open');
    assert.ok(await begin(s));
  } finally { await db.close(); }
});

test('merely moving the current closing fence earlier would also block admitted expiry settlement', async () => {
  const { db, service: s } = await fixture();
  try {
    const op = await begin(s);
    await s('SELECT record_account_checkout($1,$2,$3)', [A, op, 'cs_offline']);
    // Deliberate offline counterfactual: this is not a supported production transition.
    await db.query("UPDATE account_billing_fences SET phase='closing' WHERE user_id=$1", [A]);
    await assert.rejects(s('SELECT reconcile_account_checkout_expiry($1,$2,$3)', [A, op, 'cs_offline']), /account closure pending/);
    assert.equal((await db.query('SELECT phase FROM account_checkout_operations WHERE operation_id=$1', [op])).rows[0].phase, 'open');
    assert.ok(await begin(s, B));
  } finally { await db.close(); }
});
