// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { accountClosureEnforcementStages, accountClosureEnforcementQuery, assertAccountClosureEnforcement } from '../../scripts/lib/accountClosureEnforcementGate.mjs';
import { accountClosureSchemaQuery, assertAccountClosureSchema } from '../../scripts/lib/accountClosureSchemaGate.mjs';
import { accountClosureRolloutQuery, assertAccountClosureRollout } from '../../scripts/lib/accountClosureRolloutGate.mjs';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'a'.repeat(64);
const BINDING = 'b'.repeat(64);
const context = { candidateSha: 'c'.repeat(40), configDigest: 'd'.repeat(64), migrationDigest: 'e'.repeat(64),
  projectId: 'disposable-closure', environment: 'disposable' };
const dir = resolve('backend/supabase/migrations');
const source = (name: string) => readFileSync(resolve(dir, name), 'utf8');
const quote = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const grant = (id = A, generation = '0', binding = BINDING, current = context) => `'${id}',${generation},'${binding}',${quote(current)}`;
let db: PGlite;

async function service(statement: string, values: unknown[] = []) {
  // Recover a failed statement without losing the outer per-case rollback.
  await db.exec('SAVEPOINT service_call; SET LOCAL ROLE service_role');
  try { const result = await db.query(statement, values); await db.exec('RESET ROLE; RELEASE SAVEPOINT service_call'); return result; }
  catch (error) { await db.exec('ROLLBACK TO SAVEPOINT service_call; RELEASE SAVEPOINT service_call'); throw error; }
}
beforeAll(async () => {
  db = new PGlite();
  const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8')
    .match(/await db\.exec\(`\n([\s\S]*?)`\);/);
  if (!fixture) throw new Error('existing scoped closure fixture missing');
  await db.exec(fixture[1]);
  await db.exec(`SET ROLE closure_owner;
    ${source('20260812041600_trial_commercial_grant_on_conflict_1294.sql')}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();
    ${source('20261013180000_account_closure_tokens.sql')}
    ${source('20261016090000_account_closure_drain_persistence.sql')}
    ${source('20261016180000_account_closure_drain_enforcement.sql')}
    RESET ROLE;`);
}, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.exec(`INSERT INTO auth.users VALUES('${U}','user@example.test',now()),('${OTHER}','other@example.test',now())`);
  const record = { version: 1, candidateSha: context.candidateSha, mainSha: 'f'.repeat(40),
    migrationDigest: context.migrationDigest, target: { projectId: context.projectId, environment: context.environment },
    deployments: [], configDigest: context.configDigest,
    payments: { frontendEnabled: false, backendEnabled: false }, operatorId: 'fixture',
    createdAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    evidenceDigest: 'f'.repeat(64), bindingDigest: BINDING, legacyWriters: [], inventory: {} };
  const validation = { version: 1, validation: 'OFFLINE_VALID', activationAuthorized: false,
    bindingDigest: BINDING, evidenceDigest: record.evidenceDigest, quarantined: [] };
  await service(`SELECT record_account_closure_drain_attestation('${A}',0,${quote(record)},${quote(validation)})`);
  // Fixture only: the legacy body is owner-only after enforcement; production
  // service callers must use guarded issuance (tested below).
  await db.exec(`SET LOCAL ROLE closure_owner; SELECT issue_account_closure_token('${U}','${TOKEN}'); RESET ROLE`);
});
afterEach(async () => { await db.exec('ROLLBACK'); });

async function claim() {
  await db.exec(`UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}'`);
  const result = await service(`SELECT * FROM claim_account_closure_token_with_drain('${U}','${TOKEN}',${grant()})`);
  return result.rows[0] as { request_id: string };
}
const inspect = (request: string, authority = grant(), user = U) =>
  service(`SELECT inspect_account_closure_authority('${user}','${request}',${authority}) AS proof`);
const transition = (request: string, phase: string, authority = grant()) =>
  service(`SELECT record_account_closure_auth_state_with_drain('${U}','${request}','${phase}',${authority})`);
async function deletedFixture() {
  const { request_id: request } = await claim();
  await service(`SELECT preserve_account_trial_email('${U}')`);
  await transition(request, 'auth_unknown');
  await db.exec(`DELETE FROM auth.users WHERE id='${U}'`);
  await transition(request, 'auth_deleted');
  return request;
}

describe('current drain authority — actual SQL boundaries', () => {
  it('private controller reads only canonical generation without broad table access', async () => {
    expect((await service('SELECT inspect_account_closure_drain_generation() AS generation')).rows).toEqual([{ generation: '0' }]);
    expect((await db.query(`SELECT has_function_privilege('anon','inspect_account_closure_drain_generation()','EXECUTE') AS anon,
      has_function_privilege('authenticated','inspect_account_closure_drain_generation()','EXECUTE') AS authenticated`)).rows)
      .toEqual([{ anon: false, authenticated: false }]);
  });
  it('verifies the exact enforced catalog without weakening original schema/rollout modes', async () => {
    const inputs = { closure: source('20261013180000_account_closure_tokens.sql'),
      baseline: source('20260812041600_trial_commercial_grant_on_conflict_1294.sql'),
      drain: source('20261016090000_account_closure_drain_persistence.sql'),
      enforcement: source('20261016180000_account_closure_drain_enforcement.sql') };
    for (const [query, verify] of accountClosureEnforcementStages('after', inputs)) {
      const result = await db.query<{ json_build_object: string }>(query);
      expect(verify(result.rows[0].json_build_object)).toMatchObject({ passed: true });
    }
    const core = await db.query<{ json_build_object: string }>(accountClosureSchemaQuery('after', inputs.closure));
    expect(() => assertAccountClosureSchema(core.rows[0].json_build_object, 'after')).toThrow();
    const rollout = await db.query<{ json_build_object: string }>(accountClosureRolloutQuery('after', inputs.baseline));
    expect(() => assertAccountClosureRollout(rollout.rows[0].json_build_object, 'after')).toThrow();
    expect(() => accountClosureSchemaQuery('enforced', inputs.closure)).toThrow();
    expect(() => accountClosureRolloutQuery('enforced', inputs.baseline, `${inputs.enforcement}\n`)).toThrow();
  });

  it.each([
    'GRANT EXECUTE ON FUNCTION issue_account_closure_token(uuid,text) TO service_role',
    'GRANT EXECUTE ON FUNCTION reconcile_expired_account_checkout(uuid,text,uuid,text) TO service_role',
    'GRANT EXECUTE ON FUNCTION require_account_closure_drain(uuid,bigint,text,jsonb) TO service_role',
    'GRANT EXECUTE ON FUNCTION inspect_account_closure_authority(uuid,uuid,uuid,bigint,text,jsonb) TO PUBLIC',
    'REVOKE EXECUTE ON FUNCTION issue_account_closure_token_with_drain(uuid,text,uuid,bigint,text,jsonb) FROM service_role',
    'ALTER FUNCTION require_account_closure_drain(uuid,bigint,text,jsonb) SECURITY INVOKER',
    'ALTER FUNCTION require_account_closure_drain(uuid,bigint,text,jsonb) SET search_path=public',
    'GRANT SELECT(drain_context) ON account_closure_attempts TO authenticated',
    'CREATE FUNCTION require_account_closure_drain(integer) RETURNS integer LANGUAGE sql AS $$SELECT 1$$',
  ])('exact enforcement gate rejects catalog drift: %s', async (mutation) => {
    const query = accountClosureEnforcementQuery('after', source('20261016180000_account_closure_drain_enforcement.sql'));
    const healthy = await db.query<{ json_build_object: string }>(query);
    expect(assertAccountClosureEnforcement(healthy.rows[0].json_build_object, 'after')).toMatchObject({ passed: true });
    await db.exec(mutation);
    const changed = await db.query<{ json_build_object: string }>(query);
    expect(() => assertAccountClosureEnforcement(changed.rows[0].json_build_object, 'after')).toThrow();
  });
  it('guarded email issuance requires enabled exact current authority', async () => {
    await expect(service(`SELECT * FROM issue_account_closure_token_with_drain('${U}','${'f'.repeat(64)}',${grant()})`))
      .rejects.toThrow('deletion not enabled');
    await db.exec(`DELETE FROM account_closure_tokens;
      UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}'`);
    expect((await service(`SELECT * FROM issue_account_closure_token_with_drain('${U}','${'f'.repeat(64)}',${grant()})`)).rows).toHaveLength(1);
    expect((await db.query('SELECT token_hash,phase FROM account_closure_tokens')).rows)
      .toEqual([{ token_hash: 'f'.repeat(64), phase: 'issued' }]);
  });

  it('expired authority cannot issue an email token or change pending checkout state', async () => {
    await db.exec(`UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}';
      UPDATE account_closure_drain_attestations SET expires_at=clock_timestamp()-interval '1 second'`);
    await expect(service(`SELECT * FROM issue_account_closure_token_with_drain('${U}','${'f'.repeat(64)}',${grant()})`))
      .rejects.toThrow('stale drain authority');
    expect((await db.query('SELECT token_hash FROM account_closure_tokens')).rows).toEqual([{ token_hash: TOKEN }]);
  });

  it.each(['issuing', 'unknown', 'open'])('never clears a mismatched/uncertain %s checkout from local timeout', async (phase) => {
    await db.exec(`UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}';
      INSERT INTO account_checkout_operations(user_id,operation_id,phase,session_id) VALUES('${U}','${OTHER}','${phase}',NULL)`);
    await expect(service(`SELECT reconcile_account_closure_checkout_with_drain('${U}','${TOKEN}','${OTHER}','unverified',NULL,NULL,${grant()})`))
      .rejects.toThrow('checkout ownership mismatch');
    expect((await db.query('SELECT phase,session_id FROM account_checkout_operations')).rows).toEqual([{ phase, session_id: null }]);
  });

  it('guarded verified expiry settles only the exact known checkout and preserves the issued token', async () => {
    await db.exec(`UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}';
      INSERT INTO account_checkout_operations(user_id,operation_id,phase,session_id) VALUES('${U}','${OTHER}','open','cs_owned')`);
    await service(`SELECT reconcile_account_closure_checkout_with_drain('${U}','${TOKEN}','${OTHER}','cs_owned',NULL,NULL,${grant()})`);
    expect((await db.query('SELECT phase FROM account_checkout_operations')).rows).toEqual([{ phase: 'settled' }]);
    expect((await db.query('SELECT phase FROM account_closure_tokens')).rows).toEqual([{ phase: 'issued' }]);
  });

  it('guarded completion requires the canonical customer/subscription binding', async () => {
    await db.exec(`UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}';
      INSERT INTO account_checkout_operations(user_id,operation_id,phase,session_id) VALUES('${U}','${OTHER}','open','cs_owned')`);
    await expect(service(`SELECT reconcile_account_closure_checkout_with_drain('${U}','${TOKEN}','${OTHER}','cs_owned','cus','sub',${grant()})`))
      .rejects.toThrow('checkout not attached');
    await db.exec(`UPDATE user_profiles SET stripe_customer_id='cus',stripe_subscription_id='sub' WHERE id='${U}'`);
    await service(`SELECT reconcile_account_closure_checkout_with_drain('${U}','${TOKEN}','${OTHER}','cs_owned','cus','sub',${grant()})`);
    expect((await db.query('SELECT phase FROM account_checkout_operations')).rows).toEqual([{ phase: 'settled' }]);
  });

  it('expired emailed proof refuses checkout reconciliation even with valid drain', async () => {
    await db.exec(`UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='${A}';
      UPDATE account_closure_tokens SET expires_at=clock_timestamp()-interval '1 second';
      INSERT INTO account_checkout_operations(user_id,operation_id,phase,session_id) VALUES('${U}','${OTHER}','open','cs_owned')`);
    await expect(service(`SELECT reconcile_account_closure_checkout_with_drain('${U}','${TOKEN}','${OTHER}','cs_owned',NULL,NULL,${grant()})`))
      .rejects.toThrow('closure token expired');
    expect((await db.query('SELECT phase FROM account_checkout_operations')).rows).toEqual([{ phase: 'open' }]);
  });

  it('applying and registering never enables deletion', async () => {
    expect((await db.query('SELECT checkout_workers_drained,evidence_reference FROM account_billing_coordination')).rows)
      .toEqual([{ checkout_workers_drained: false, evidence_reference: null }]);
    await expect(service(`SELECT * FROM claim_account_closure_token_with_drain('${U}','${TOKEN}',${grant()})`))
      .rejects.toThrow('deletion not enabled');
    expect((await db.query('SELECT * FROM account_closure_attempts')).rows).toEqual([]);
  });

  it('claims exactly once, persists exact authority, and returns the immutable stored request', async () => {
    const { request_id } = await claim();
    const read = (await inspect(request_id)).rows[0] as { proof: { attempt: unknown; authority: Record<string, unknown> } };
    expect(read.proof.attempt).toEqual({ userId: U, requestId: request_id, email: 'user@example.test', phase: 'processing' });
    expect(read.proof.authority).toMatchObject({ userId: U, requestId: request_id, generation: '0', bindingDigest: BINDING });
    expect(typeof read.proof.authority.expiresAt).toBe('number');
    expect((await service(`SELECT * FROM claim_account_closure_token_with_drain('${U}','${TOKEN}',${grant()})`)).rows).toEqual([]);
  });

  it.each([
    ['claim_account_closure_token', `('${U}','${TOKEN}')`],
    ['issue_account_closure_token', `('${U}','${TOKEN}')`],
    ['reconcile_expired_account_checkout', `('${U}','${TOKEN}','${OTHER}','cs')`],
    ['record_account_closure_auth_state', `('${U}','${OTHER}','auth_unknown')`],
    ['settle_account_closure_billing', `('${U}','${OTHER}','cus','[]')`],
    ['require_account_closure_drain', `(${grant()})`],
    ['require_account_closure_request_authority', `('${U}','${OTHER}',${grant()})`],
  ])('service role cannot bypass guarded wrappers through %s', async (name, args) => {
    await expect(service(`SELECT ${name}${args}`)).rejects.toThrow('permission denied');
  });

  it.each(['anon', 'authenticated'])('%s cannot execute a wrapper or read journal/attestation data', async (role) => {
    const result = await db.query(`SELECT has_function_privilege('${role}',
      'inspect_account_closure_authority(uuid,uuid,uuid,bigint,text,jsonb)','EXECUTE') AS execute,
      has_table_privilege('${role}','account_closure_attempts','SELECT') AS journal,
      has_table_privilege('${role}','account_closure_drain_attestations','SELECT') AS attestation`);
    expect(result.rows).toEqual([{ execute: false, journal: false, attestation: false }]);
  });

  it('trusted recovery inspection adds no broad table or private-column read grants', async () => {
    expect((await db.query(`SELECT has_table_privilege('service_role','account_closure_attempts','SELECT') AS journal,
      has_column_privilege('service_role','account_closure_attempts','claimed_email','SELECT') AS email,
      has_table_privilege('service_role','account_closure_drain_attestations','SELECT') AS attestation`)).rows)
      .toEqual([{ journal: false, email: false, attestation: false }]);
    const rows = (await db.query(`SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
      'claim_account_closure_token_with_drain','inspect_account_closure_authority',
      'bind_account_closure_recovery_authority','record_account_closure_auth_state_with_drain',
      'settle_account_closure_billing_with_drain','verify_account_closure_residue_with_drain',
      'issue_account_closure_token_with_drain','reconcile_account_closure_checkout_with_drain')`)).rows;
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => !row.anon && !row.authenticated)).toBe(true);
  });

  it.each(['candidateSha', 'configDigest', 'migrationDigest', 'projectId', 'environment'] as const)('rejects current %s mismatch', async (field) => {
    const { request_id } = await claim();
    await expect(inspect(request_id, grant(A, '0', BINDING, { ...context, [field]: field === 'environment' ? 'production' : 'changed' })))
      .rejects.toThrow('drain context mismatch');
  });

  it('rejects a wrong user, request, attestation, generation or binding', async () => {
    const { request_id } = await claim();
    await expect(inspect(request_id, grant(), OTHER)).rejects.toThrow('request drain authority mismatch');
    await expect(inspect(OTHER)).rejects.toThrow('request drain authority mismatch');
    await expect(inspect(request_id, grant(OTHER))).rejects.toThrow('drain authority unavailable');
    await expect(inspect(request_id, grant(A, '1'))).rejects.toThrow('stale drain authority');
    await expect(inspect(request_id, grant(A, '0', 'c'.repeat(64)))).rejects.toThrow('stale drain authority');
  });

  it('expired or explicitly invalidated grants cannot advance the journal', async () => {
    const { request_id } = await claim();
    await db.exec(`UPDATE account_closure_drain_attestations SET expires_at=clock_timestamp()-interval '1 second'`);
    await expect(transition(request_id, 'auth_unknown')).rejects.toThrow('stale drain authority');
    await db.exec(`UPDATE account_closure_drain_attestations SET expires_at=clock_timestamp()+interval '5 minutes'`);
    await service(`SELECT invalidate_account_closure_drain_attestations(0,'rollback','${'e'.repeat(64)}')`);
    await expect(transition(request_id, 'auth_unknown')).rejects.toThrow('stale drain authority');
    expect((await db.query('SELECT phase FROM account_closure_attempts')).rows).toEqual([{ phase: 'processing' }]);
  });

  it.each(['token', 'fence', 'activation'])('a released %s refuses further processing', async (part) => {
    const { request_id } = await claim();
    if (part === 'token') await db.exec(`UPDATE account_closure_tokens SET phase='failed' WHERE user_id='${U}'`);
    else if (part === 'fence') await db.exec(`UPDATE account_billing_fences SET phase='open' WHERE user_id='${U}'`);
    else await db.exec('UPDATE account_billing_coordination SET checkout_workers_drained=false');
    await expect(transition(request_id, 'auth_unknown')).rejects.toThrow('active closure authority missing');
  });

  it('recovery cannot adopt a processing request or report Auth absent while present', async () => {
    const { request_id } = await claim();
    await expect(service(`SELECT bind_account_closure_recovery_authority('${U}','${request_id}',${grant()})`))
      .rejects.toThrow('recovery request unavailable');
    await transition(request_id, 'auth_unknown');
    await expect(transition(request_id, 'auth_deleted')).rejects.toThrow('auth absence unconfirmed');
    expect((await db.query('SELECT phase FROM account_closure_attempts')).rows).toEqual([{ phase: 'auth_unknown' }]);
  });

  it('disabled rollout still permits exact post-Auth reconciliation without enabling new deletion', async () => {
    const request = await deletedFixture();
    await db.exec('UPDATE account_billing_coordination SET checkout_workers_drained=false,evidence_reference=NULL');
    await service(`SELECT bind_account_closure_recovery_authority('${U}','${request}',${grant()})`);
    await transition(request, 'completed');
    expect(((await inspect(request)).rows[0] as { proof: { attempt: { phase: string } } }).proof.attempt.phase).toBe('completed');
    expect((await db.query('SELECT checkout_workers_drained FROM account_billing_coordination')).rows).toEqual([{ checkout_workers_drained: false }]);
    await expect(transition(request, 'auth_unknown')).rejects.toThrow('invalid closure transition');
  });

  it('a fresh generation must be explicitly bound to the exact post-Auth request before recovery', async () => {
    const request = await deletedFixture();
    const prior = (await db.query('SELECT record,validation FROM account_closure_drain_attestations')).rows[0] as {
      record: Record<string, unknown>; validation: unknown;
    };
    await service(`SELECT invalidate_account_closure_drain_attestations(0,'deployment_changed','${'e'.repeat(64)}')`);
    const record = { ...prior.record, createdAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() };
    await service(`SELECT record_account_closure_drain_attestation('${OTHER}',1,${quote(record)},${quote(prior.validation)})`);
    const renewed = grant(OTHER, '1');
    await expect(inspect(request)).rejects.toThrow('stale drain authority');
    await expect(inspect(request, renewed)).rejects.toThrow('request drain authority mismatch');
    await expect(service(`SELECT bind_account_closure_recovery_authority('${U}','${OTHER}',${renewed})`))
      .rejects.toThrow('recovery request unavailable');
    await service(`SELECT bind_account_closure_recovery_authority('${U}','${request}',${renewed})`);
    await transition(request, 'completed', renewed);
    const proof = (await inspect(request, renewed)).rows[0] as { proof: { authority: { generation: string }; attempt: { email: string; phase: string } } };
    expect(proof.proof.authority.generation).toBe('1');
    expect(proof.proof.attempt).toMatchObject({ email: 'user@example.test', phase: 'completed' });
    expect((await db.query('SELECT checkout_workers_drained FROM account_billing_coordination')).rows).toEqual([{ checkout_workers_drained: false }]);
  });

  it.each(['storage', 'checkout', 'fence', 'trial'])('full %s residue prevents completion and rolls back', async (kind) => {
    const request = await deletedFixture();
    if (kind === 'storage') await db.exec(`INSERT INTO storage.objects VALUES('audio','owned','${U}')`);
    else if (kind === 'checkout') await db.exec(`INSERT INTO account_checkout_operations(user_id,phase) VALUES('${U}','unknown')`);
    else if (kind === 'fence') await db.exec(`INSERT INTO account_billing_fences(user_id,phase,request_id) VALUES('${U}','closing','${request}')`);
    else await db.exec("DELETE FROM trial_entitlements WHERE email='user@example.test'");
    await expect(transition(request, 'completed')).rejects.toThrow('account residue remains');
    expect((await db.query(`SELECT phase,claimed_email FROM account_closure_attempts WHERE user_id='${U}'`)).rows)
      .toEqual([{ phase: 'auth_deleted', claimed_email: 'user@example.test' }]);
    expect((await service(`SELECT verify_account_closure_residue_with_drain('${U}','${request}',${grant()}) AS clean`)).rows)
      .toEqual([{ clean: false }]);
  });

  it('valid billing settlement retains snapshot/customer checks inside the drain wrapper', async () => {
    await db.exec(`UPDATE user_profiles SET stripe_customer_id='cus',stripe_subscription_id='sub',subscription_id='sub',subscription_status='pro' WHERE id='${U}'`);
    const { request_id } = await claim();
    await expect(service(`SELECT settle_account_closure_billing_with_drain('${U}','${request_id}','other','[]',${grant()})`))
      .rejects.toThrow('billing identity mismatch');
    await service(`SELECT settle_account_closure_billing_with_drain('${U}','${request_id}','cus','[{"id":"sub","status":"canceled"}]',${grant()})`);
    expect((await db.query(`SELECT subscription_status,stripe_subscription_id FROM user_profiles WHERE id='${U}'`)).rows)
      .toEqual([{ subscription_status: 'free', stripe_subscription_id: null }]);
    expect((await db.query('SELECT * FROM account_closure_billing_permits')).rows).toEqual([]);
  });

});
