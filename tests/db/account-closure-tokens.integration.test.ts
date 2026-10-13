// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
const MIG = resolve(process.cwd(), 'backend/supabase/migrations');
const candidate = readFileSync(resolve(MIG, '20261013180000_account_closure_tokens.sql'), 'utf8');
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE closure_owner NOSUPERUSER;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth AUTHORIZATION closure_owner;
    CREATE SCHEMA storage AUTHORIZATION closure_owner;
    GRANT CREATE, USAGE ON SCHEMA public TO closure_owner;
    GRANT USAGE ON SCHEMA public, auth TO service_role, anon, authenticated;
    SET ROLE closure_owner;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      subscription_status text DEFAULT 'free', stripe_customer_id text, stripe_subscription_id text,
      subscription_id text, stripe_cancel_at_period_end boolean, updated_at timestamptz DEFAULT now(),
      private_sample_limit_seconds int, private_sample_seconds_used int, trial_started_at timestamptz,
      trial_expires_at timestamptz, commercial_trial_granted_at timestamptz);
    CREATE TABLE public.trial_entitlements(email text PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, trial_started_at timestamptz NOT NULL DEFAULT now(),
      trial_expires_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE public.stripe_subscription_tombstones(subscription_id text PRIMARY KEY,
      customer_id text NOT NULL, terminal_status text NOT NULL, tombstoned_at timestamptz DEFAULT now(), event_id text);
    CREATE TABLE public.processed_webhook_events(event_id text PRIMARY KEY,event_type text,processed_at timestamptz);
    CREATE TABLE public.sessions(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TABLE public.user_issue_reports(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL);
    CREATE TABLE storage.objects(bucket_id text, name text, owner_id text);
    RESET ROLE;
  `);
  // Execute the current signup trigger verbatim before the candidate, so the repeat-trial RED is real source.
  await db.exec(`SET ROLE closure_owner; ${readFileSync(resolve(MIG, '20260812041600_trial_commercial_grant_on_conflict_1294.sql'), 'utf8')}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user(); RESET ROLE;`);
  await db.exec(`INSERT INTO auth.users VALUES ('${U}','user@example.test',now()), ('${OTHER}','other@example.test',now());`);
});
afterEach(async () => { await db.close(); });

async function apply(drained = true) {
  await db.exec('SET ROLE closure_owner');
  try {
    await db.exec(candidate);
    if (drained) await db.exec("UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='offline-fixture-only'");
  } finally { await db.exec('RESET ROLE'); }
}
async function service(sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); return tx.query(sql, args); });
}
const issue = () => service('SELECT * FROM public.issue_account_closure_token($1,$2)', [U, HASH]);
const claim = (id = U, hash = HASH) => service('SELECT * FROM public.claim_account_closure_token($1,$2)', [id, hash]);

describe('account deletion — actual SQL grants, durable claims and retained-trial behavior', () => {
  it('rollout without drained legacy checkout writers refuses deletion', async () => {
    await apply(false); await issue();
    await expect(claim()).rejects.toThrow('checkout reconciliation required');
  });
  it.each(['issuing','open','unknown'])('customer-null checkout %s is durable and excludes closure', async (phase) => {
    await apply(); await issue();
    const operation = (await service('SELECT begin_account_checkout($1) AS id',[U])).rows[0] as { id: string };
    if (phase==='open') await service('SELECT record_account_checkout($1,$2,$3)',[U,operation.id,'cs_open']);
    if (phase==='unknown') await db.query("UPDATE account_checkout_operations SET phase='unknown' WHERE operation_id=$1",[operation.id]);
    await expect(claim()).rejects.toThrow('checkout reconciliation required');
    await expect(service('SELECT begin_account_checkout($1)',[U])).rejects.toThrow('billing operation pending');
    expect((await db.query('SELECT stripe_customer_id FROM user_profiles WHERE id=$1',[U])).rows).toEqual([{stripe_customer_id:null}]);
  });
  it('closure winning the interleaving fences new checkout and late webhook attachment', async () => {
    await db.exec(`SET ROLE closure_owner; ${readFileSync(resolve(MIG,'20260812002000_webhook_lifecycle_completeness_1282.sql'),'utf8')} RESET ROLE;`);
    await apply(); await issue(); await claim();
    await expect(service('SELECT begin_account_checkout($1)',[U])).rejects.toThrow('billing operation pending');
    await expect(db.query("UPDATE user_profiles SET stripe_customer_id='cus_late',stripe_subscription_id='sub_late',subscription_status='pro' WHERE id=$1",[U]))
      .rejects.toThrow('account closure fences billing');
    expect((await db.query('SELECT stripe_customer_id FROM user_profiles WHERE id=$1',[U])).rows).toEqual([{stripe_customer_id:null}]);
    const result=await service('SELECT apply_stripe_subscription_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
      ['late_event','sub_late','cus_late','active',true,false,null,U,null]);
    expect(result.rows[0]).toMatchObject({result:{success:false,error:'account closure fences billing'}});
    expect((await db.query("SELECT * FROM processed_webhook_events WHERE event_id='late_event'")).rows).toEqual([]);
  });
  it('completed checkout cannot release its hold before canonical customer/subscription attachment', async () => {
    await apply(); await issue();
    const operation = (await service('SELECT begin_account_checkout($1) AS id',[U])).rows[0] as {id:string};
    await service('SELECT record_account_checkout($1,$2,$3)',[U,operation.id,'cs_done']);
    await expect(service('SELECT settle_account_checkout($1,$2,$3,$4)',[U,'cs_done','cus','sub'])).rejects.toThrow('checkout not attached');
    await db.query("UPDATE user_profiles SET stripe_customer_id='cus',stripe_subscription_id='sub',subscription_status='pro' WHERE id=$1",[U]);
    await service('SELECT settle_account_checkout($1,$2,$3,$4)',[U,'cs_done','cus','sub']);
    expect((await claim()).rows[0]).toMatchObject({customer_id:'cus'});
  });
  it('completion before checkout URL delivery settles the exact reservation without reopening it', async () => {
    await apply();
    const operation=(await service('SELECT begin_account_checkout($1) AS id',[U])).rows[0] as {id:string};
    await db.query("UPDATE user_profiles SET stripe_customer_id='cus',stripe_subscription_id='sub',subscription_status='pro' WHERE id=$1",[U]);
    await service('SELECT settle_account_checkout($1,$2,$3,$4,$5)',[U,'cs','cus','sub',operation.id]);
    await service('SELECT record_account_checkout($1,$2,$3)',[U,operation.id,'cs']);
    expect((await db.query('SELECT phase,session_id FROM account_checkout_operations')).rows).toEqual([{phase:'settled',session_id:'cs'}]);
  });
  it('confirmed checkout expiry releases only the exact tracked operation, never a guessed issuance', async () => {
    await apply(); await issue();
    const operation=(await service('SELECT begin_account_checkout($1) AS id',[U])).rows[0] as {id:string};
    await expect(service('SELECT reconcile_expired_account_checkout($1,$2,$3,$4)',[U,HASH,operation.id,'guessed'])).rejects.toThrow('checkout ownership mismatch');
    await service('SELECT record_account_checkout($1,$2,$3)',[U,operation.id,'cs']);
    await service('SELECT reconcile_expired_account_checkout($1,$2,$3,$4)',[U,HASH,operation.id,'cs']);
    expect((await claim()).rows).toHaveLength(1);
  });
  it('auth uncertainty survives cascade and cannot be released or replaced by a new link', async () => {
    await apply(); await issue();
    const row = (await claim()).rows[0] as { request_id: string };
    await service('SELECT record_account_closure_auth_state($1,$2,$3)', [U, row.request_id, 'auth_unknown']);
    await service('SELECT finish_account_closure_attempt($1,$2)', [U, row.request_id]);
    expect((await db.query('SELECT phase FROM account_closure_attempts')).rows).toEqual([{ phase: 'auth_unknown' }]);
    await db.exec(`UPDATE account_closure_tokens SET issued_at=now()-interval '1 hour' WHERE user_id='${U}'`);
    expect((await issue()).rows).toEqual([]);
    await db.exec(`DELETE FROM auth.users WHERE id='${U}'`);
    expect((await db.query('SELECT phase FROM account_closure_attempts')).rows).toEqual([{ phase: 'auth_unknown' }]);
    await service('SELECT record_account_closure_auth_state($1,$2,$3)', [U, row.request_id, 'auth_deleted']);
    expect((await db.query('SELECT phase FROM account_closure_attempts')).rows).toEqual([{ phase: 'auth_deleted' }]);
  });
  it('RED: current signup source gives a deleted/recreated email another 30-day trial', async () => {
    await db.exec(`INSERT INTO trial_entitlements VALUES ('user@example.test','${U}',now()-interval '60 days',now()-interval '30 days',now());
      DELETE FROM auth.users WHERE id='${U}';
      INSERT INTO auth.users VALUES ('${U}','user@example.test',now());`);
    expect((await db.query<{ live: boolean }>(`SELECT trial_expires_at > now() AS live FROM user_profiles WHERE id='${U}'`)).rows[0].live).toBe(true);
  });
  it('GREEN: retained email reuses the original expired window, including normalized email spelling', async () => {
    await db.exec(`INSERT INTO trial_entitlements VALUES ('user@example.test','${U}',now()-interval '60 days',now()-interval '30 days',now());`);
    await apply();
    await db.exec(`DELETE FROM auth.users WHERE id='${U}'; INSERT INTO auth.users VALUES ('${U}',' User@Example.Test ',now());`);
    const row = (await db.query<{ live: boolean; matches: boolean }>(`SELECT p.trial_expires_at > now() AS live,
      p.trial_expires_at = t.trial_expires_at AS matches FROM user_profiles p
      JOIN trial_entitlements t ON t.user_id=p.id WHERE p.id='${U}'`)).rows[0];
    expect(row).toEqual({ live: false, matches: true });
  });
  it('a genuinely new email still gets the ordinary 30-day window', async () => {
    await apply();
    const id = '33333333-3333-4333-8333-333333333333';
    await db.exec(`INSERT INTO auth.users VALUES ('${id}','fresh@example.test',now());`);
    const row = (await db.query<{ days: number }>(`SELECT extract(day FROM trial_expires_at-trial_started_at)::int AS days
      FROM user_profiles WHERE id='${id}'`)).rows[0];
    expect(row.days).toBe(30);
  });
  it('client roles cannot read/write tokens or invoke the privileged issue/claim functions', async () => {
    await apply();
    for (const role of ['anon', 'authenticated']) {
      for (const sql of [`SELECT * FROM account_closure_tokens`, `SELECT * FROM issue_account_closure_token('${U}','${HASH}')`,
        `SELECT * FROM claim_account_closure_token('${U}','${HASH}')`]) {
        await expect(db.transaction(async (tx) => { await tx.exec(`SET LOCAL ROLE ${role}`); await tx.exec(sql); })).rejects.toMatchObject({ code: '42501' });
      }
    }
  });
  it('service role gets one durable claim; replay and concurrent duplicate claims return nothing', async () => {
    await apply(); await issue();
    const results = await Promise.all([claim(), claim()]);
    expect(results.map((r) => r.rows.length).sort()).toEqual([0, 1]);
    expect((await claim()).rows).toEqual([]);
    await expect(service('SELECT * FROM account_closure_tokens')).rejects.toMatchObject({ code: '42501' });
  });
  it('wrong account/hash, expired tokens and changed email never authorize closure', async () => {
    await apply(); await issue();
    expect((await claim(OTHER)).rows).toEqual([]);
    expect((await claim(U, 'b'.repeat(64))).rows).toEqual([]);
    await db.exec(`UPDATE account_closure_tokens SET expires_at=now()-interval '1 second' WHERE user_id='${U}'`);
    expect((await claim()).rows).toEqual([]);
    await db.exec(`UPDATE account_closure_tokens SET expires_at=now()+interval '1 minute' WHERE user_id='${U}';
      UPDATE auth.users SET email='changed@example.test' WHERE id='${U}'`);
    expect((await claim()).rows).toEqual([]);
  });
  it('rate limiting and processing ownership prevent a new issue from replacing active work', async () => {
    await apply(); await issue();
    expect((await service('SELECT * FROM issue_account_closure_token($1,$2)', [U, 'b'.repeat(64)])).rows).toEqual([]);
    await claim();
    await db.exec(`UPDATE account_closure_tokens SET issued_at=now()-interval '1 hour',expires_at=now()-interval '1 second' WHERE user_id='${U}'`);
    expect((await service('SELECT * FROM issue_account_closure_token($1,$2)', [U, 'b'.repeat(64)])).rows).toEqual([]);
  });
  it('a failed terminal attempt keeps the old token consumed; only its own request can release the hold', async () => {
    await apply(); await issue();
    const row = (await claim()).rows[0] as { request_id: string };
    await service('SELECT finish_account_closure_attempt($1,$2)', [U, OTHER]);
    expect((await db.query<{ phase: string }>('SELECT phase FROM account_closure_tokens')).rows[0].phase).toBe('processing');
    await service('SELECT finish_account_closure_attempt($1,$2)', [U, row.request_id]);
    expect((await claim()).rows).toEqual([]);
    expect((await db.query<{ phase: string }>('SELECT phase FROM account_closure_tokens')).rows[0].phase).toBe('failed');
  });
  it('billing settlement rejects nonterminal/missing/wrong-customer snapshots before modifying entitlement', async () => {
    await apply();
    await db.exec(`UPDATE user_profiles SET subscription_status='pro',stripe_customer_id='cus',stripe_subscription_id='sub' WHERE id='${U}'`);
    await issue(); const row = (await claim()).rows[0] as { request_id: string };
    for (const [customer, subs] of [['wrong', [{ id: 'sub', status: 'canceled' }]], ['cus', []], ['cus', [{ id: 'sub', status: 'active' }]]] as const) {
      await expect(service('SELECT settle_account_closure_billing($1,$2,$3,$4)', [U, row.request_id, customer, JSON.stringify(subs)])).rejects.toThrow();
    }
    expect((await db.query<{ status: string }>(`SELECT subscription_status AS status FROM user_profiles WHERE id='${U}'`)).rows[0].status).toBe('pro');
    await service('SELECT settle_account_closure_billing($1,$2,$3,$4)', [U, row.request_id, 'cus', JSON.stringify([{ id: 'sub', status: 'canceled' }])]);
    expect((await db.query('SELECT * FROM stripe_subscription_tombstones')).rows).toHaveLength(1);
  });
  it('auth deletion cascades account data/tokens while retaining only unlinked trial/support rows; storage residue is detected', async () => {
    await apply(); await issue();
    await service('SELECT preserve_account_trial_email($1)', [U]);
    await db.exec(`INSERT INTO sessions VALUES ('${U}','${U}'); INSERT INTO user_issue_reports VALUES ('${U}','${U}');
      INSERT INTO storage.objects VALUES ('bucket','owned/file','${U}'); DELETE FROM auth.users WHERE id='${U}'`);
    expect((await db.query('SELECT * FROM account_closure_tokens')).rows).toEqual([]);
    expect((await service('SELECT verify_account_closure_residue($1,$2) AS clean', [U, 'user@example.test'])).rows[0]).toEqual({ clean: false });
    await db.exec(`DELETE FROM storage.objects WHERE owner_id='${U}'`);
    expect((await service('SELECT verify_account_closure_residue($1,$2) AS clean', [U, 'user@example.test'])).rows[0]).toEqual({ clean: true });
    expect((await db.query('SELECT user_id FROM trial_entitlements')).rows).toEqual([{ user_id: null }]);
    expect((await db.query('SELECT user_id FROM user_issue_reports')).rows).toEqual([{ user_id: null }]);
  });
  it('legacy storage owners remain discoverable and conflicting ownership never authorizes removal', async () => {
    await apply();
    await db.exec(`ALTER TABLE storage.objects ADD COLUMN owner uuid;
      INSERT INTO storage.objects VALUES ('bucket','legacy',NULL,'${U}');`);
    expect((await service('SELECT * FROM list_account_closure_storage($1)', [U])).rows).toEqual([{ bucket_id: 'bucket', name: 'legacy' }]);
    await db.exec(`UPDATE storage.objects SET owner_id='${OTHER}' WHERE name='legacy'`);
    await expect(service('SELECT * FROM list_account_closure_storage($1)', [U])).rejects.toThrow('ambiguous storage ownership');
  });
});
