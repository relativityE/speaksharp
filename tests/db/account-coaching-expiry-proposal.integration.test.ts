// @vitest-environment node
// Isolated SQL proposal against the real migration chain in PostgreSQL WASM.
// This is not native concurrency, hosted ACL, provider, deletion, or AHT-01 evidence.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { completionBootstrap } from './account-completion-fixture.mjs';

const scope = 'a'.repeat(64);
const evidence = 'e'.repeat(64);
const payload = '{"version":"gemini_coaching_v1","what_worked":"Synthetic control","what_to_try_next":"Synthetic next step"}';
const model = JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json', 'utf8')).model as string;
const proposalFile = 'backend/supabase/migrations/20261110173548_account_coaching_local_retirement.sql';
const consumed: { file: string; sha256: string; beforeSha256: string; afterSha256: string }[] = [];
const rpc = 'public.fence_account_coaching_expired_v1(uuid,uuid,uuid,uuid,text,text)';
let db: PGlite, index = 0;
type Account = { user: string; session: string; operation: string; hash: string; request: string; status: string };
const sql = async (text: string) => { await db.exec('RESET ROLE'); return db.exec(text); };
const value = async <T = unknown>(text: string): Promise<T> => {
  const result = await sql(text);
  return Object.values(result.at(-1)?.rows?.[0] ?? {})[0] as T;
};
const failure = async (text: string) => {
  try { await sql(text); return null; } catch (error) { return String((error as Error).message); }
};
const service = (text: string) => `SET ROLE service_role; ${text}`;
const phase = (a: Account) => value<string>(`SELECT phase FROM account_coaching_operations WHERE operation_id='${a.operation}'`);
const fence = (a: Account, changes: Partial<Account> = {}, digest = evidence, scopeDigest = scope) => {
  const b = { ...a, ...changes };
  return service(`SELECT fence_account_coaching_expired_v1('${b.operation}','${b.user}','${b.session}',
    '${b.request}','${scopeDigest}','${digest}')`);
};
const persist = (a: Account, settled = true) => service(`SELECT persist_account_coaching_v1('${a.operation}',${settled},
  '${a.session}','${a.user}','${payload}'::jsonb,'google_gemini','${model}','user_utc_day',CURRENT_DATE,3,1)`);
const finish = (a: Account, outcome = 'unknown') => service(`SELECT finish_account_coaching_failure_v1(
  '${a.user}','${a.session}','${a.operation}','${outcome}')`);
const retire = (a: Account) => service(`SELECT finish_account_coaching_local_v1('${a.user}','${a.session}','${a.operation}')`);
const claim = (a: Account) => value<Record<string, unknown> | null>(service(`SELECT claim_account_pending_completion_v1(
  '${a.user}','${a.request}','${scope}')`));
const status = (a: Account) => value<Record<string, unknown>>(service(`SELECT read_account_completion_status_v1(
  '${a.request}','${a.status}','${scope}')-'expiresAt'`));
const age = (a: Account) => sql(`UPDATE account_coaching_operations
  SET admitted_at=clock_timestamp()-interval '16 minutes',updated_at=clock_timestamp()-interval '16 minutes'
  WHERE operation_id='${a.operation}'`);
const audit = (a: Account) => value<Record<string, unknown>>(`SELECT to_jsonb(f) FROM account_coaching_expiry_fences f WHERE operation_id='${a.operation}'`);

async function seed(kind: 'admitted' | 'unknown' | 'committed' | 'completed' = 'unknown', options: { old?: boolean; confirmed?: boolean; acknowledged?: boolean } = {}) {
  const { old = true, confirmed = true, acknowledged = true } = options;
  const suffix = String(++index).padStart(12, '0');
  const a: Account = { user: `b8110000-0000-4000-8000-${suffix}`, session: `b8120000-0000-4000-8000-${suffix}`,
    operation: `b8130000-0000-4000-8000-${suffix}`, hash: String(index).padStart(64, 'b'), request: '', status: String(index).padStart(64, 'c') };
  await sql(`INSERT INTO auth.users VALUES('${a.user}','expiry-${index}@example.test',now());
    INSERT INTO sessions(id,user_id,status) VALUES('${a.session}','${a.user}','completed');`);
  await sql(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); SELECT consume_ai_suggestion_quota(3);`);
  expect(await value(service(`SELECT begin_account_coaching_v1('${a.user}','${a.session}','${a.operation}')`))).toMatchObject({ admitted: true });
  if (kind === 'unknown') expect(await value(finish(a))).toBe(true);
  if (kind === 'committed' || kind === 'completed') expect(await value(persist(a, kind === 'completed'))).toEqual(JSON.parse(payload));
  if (old) await age(a);
  await sql(service(`SELECT issue_account_closure_pending_token('${a.user}','${a.hash}')`));
  a.request = await value<string>(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
  if (confirmed) {
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    await sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
      'synthetic expiry fixture coverage','synthetic expiry fixture portal')`);
    expect(await value(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${a.status}')`))).not.toBeNull();
    if (acknowledged) expect(await value(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${a.status}')`))).toBe(true);
  }
  return a;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(completionBootstrap());
  // Match the existing native fixture's hosted-owner role: a non-superuser definer
  // owner with BYPASSRLS, needed for the FORCE-RLS authority receipt table.
  // This is this test's disposable in-memory role only, never a production change.
  await db.exec('ALTER ROLE closure_owner BYPASSRLS');
  for (const name of ['20261020230653_account_pending_completion_journal_1643.sql',
    '20260810120000_retention_purge_ai_suggestions.sql', '20261024083000_account_coaching_unknown_fence_1643.sql']) {
    await db.exec(`SET ROLE closure_owner; ${readFileSync(`backend/supabase/migrations/${name}`, 'utf8')} RESET ROLE;`);
  }
  // Baseline reproduction before the proposal: old admitted and old committed-unknown remain held.
  await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);
  for (const kind of ['admitted', 'committed'] as const) {
    const a = await seed(kind);
    assert.equal((await status(a)).reason, 'coaching_unsettled');
    assert.deepEqual(await claim(a), { outcome: 'pending' });
  }
  const before = await value<string>('SELECT jsonb_agg(to_jsonb(o) ORDER BY operation_id)::text FROM account_coaching_operations o');
  const proposal = readFileSync(proposalFile);
  const beforeSha256 = createHash('sha256').update(proposal).digest('hex');
  await db.exec(`SET ROLE closure_owner; ${proposal.toString('utf8')} RESET ROLE;`);
  const afterSha256 = createHash('sha256').update(readFileSync(proposalFile)).digest('hex');
  assert.equal(afterSha256, beforeSha256, 'SQL bytes remain unchanged across actual execution');
  consumed.push({ file: proposalFile, sha256: beforeSha256, beforeSha256, afterSha256 });
  assert.equal(await value('SELECT jsonb_agg(to_jsonb(o) ORDER BY operation_id)::text FROM account_coaching_operations o'), before);
}, 30000);
beforeEach(async () => { await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`); });
afterAll(async () => {
  await db?.close();
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
  if (binding?.sql) writeFileSync(binding.sql.witnessFile, JSON.stringify({ schemaVersion: 1,
    phaseId: binding.phaseId, bindingSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    consumer: 'tests/db/account-coaching-expiry-proposal.integration.test.ts', consumed }));
});

describe('stale coaching local-write fence proposal', () => {
  it.each(['admitted', 'unknown', 'committed'] as const)('retires finished handler %s without fabricating provider settlement or requiring owner closure', async kind => {
    const a = await seed(kind, { old: false, confirmed: false });
    expect(await value(retire(a))).toBe(true);
    expect(await phase(a)).toBe('fenced_local');
    expect(await value(`SELECT to_jsonb(f) FROM account_coaching_local_fences f WHERE operation_id='${a.operation}'`))
      .toMatchObject({ authority: 'edge_handler_finished', provider_outcome: 'unknown',
        local_persistence: kind === 'committed' ? 'committed' : 'uncommitted' });
    expect(await failure(persist(a))).toEqual(expect.stringMatching(/fenced/));
    expect(await value(finish(a))).toBe(false);
    expect(await value(retire(a))).toBe(true);
    await sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
    expect(await value(`SELECT count(*)::int FROM account_coaching_operations WHERE user_id='${a.user}'`)).toBe(0);
    expect(await value(retire(a))).toBe(true);
    expect(await value(retire({ ...a, session: 'b8120000-0000-4000-8000-999999999999' }))).toBe(false);
  });

  it('reconciles a persistence commit that wins before local retirement and preserves known terminal outcomes', async () => {
    const a = await seed('admitted', { old: false, confirmed: false });
    expect(await value(persist(a, false))).toEqual(JSON.parse(payload));
    expect(await value(retire(a))).toBe(true);
    expect(await phase(a)).toBe('fenced_local');
    const known = await seed('completed', { old: false, confirmed: false });
    expect(await value(retire(known))).toBe(true); expect(await phase(known)).toBe('completed');
    const refused = await seed('admitted', { old: false, confirmed: false });
    expect(await value(finish(refused, 'refused'))).toBe(true);
    expect(await value(retire(refused))).toBe(true); expect(await phase(refused)).toBe('refused');
  });

  it('local retirement satisfies only the coaching barrier and remains service-only', async () => {
    const a = await seed();
    expect(await value(retire(a))).toBe(true);
    expect(await status(a)).toMatchObject({ reason: 'ready' });
    expect((await claim(a))?.executionId).toEqual(expect.any(String));
    for (const role of ['anon', 'authenticated']) {
      expect(await value(`SELECT has_function_privilege('${role}','public.finish_account_coaching_local_v1(uuid,uuid,uuid)','EXECUTE')`)).toBe(false);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(await value(`SELECT has_table_privilege('${role}','public.account_coaching_local_fences','SELECT,INSERT,UPDATE,DELETE')`)).toBe(false);
    }
  });

  it.each(['admitted', 'unknown', 'committed'] as const)('fences stale %s while retaining provider uncertainty and exact digests', async kind => {
    const a = await seed(kind);
    const prior = await value<Record<string, unknown>>(`SELECT to_jsonb(o) FROM account_coaching_operations o WHERE operation_id='${a.operation}'`);
    expect(await value(fence(a))).toBe(true);
    expect(await phase(a)).toBe('fenced_expired');
    expect(await audit(a)).toMatchObject({ previous_phase: prior.phase, provider_outcome: 'unknown',
      local_persistence: kind === 'committed' ? 'committed' : 'uncommitted',
      suggestion_sha256: prior.suggestion_sha256, completion_sha256: prior.completion_sha256 });
    expect(await status(a)).toEqual({ outcome: 'pending', requestId: a.request, reason: 'ready', canRetry: false });
    expect((await claim(a))?.executionId).toEqual(expect.any(String));
  });

  it('refuses recent admission, recent update, terminal completion, and inconsistent digest pairs', async () => {
    const recent = await seed('admitted', { old: false });
    const updated = await seed('unknown');
    await sql(`UPDATE account_coaching_operations SET updated_at=clock_timestamp() WHERE operation_id='${updated.operation}'`);
    const complete = await seed('completed');
    const malformed = await seed('unknown');
    await sql(`UPDATE account_coaching_operations SET suggestion_sha256='${'a'.repeat(64)}' WHERE operation_id='${malformed.operation}'`);
    for (const a of [recent, updated, complete, malformed]) {
      expect(await failure(fence(a))).toEqual(expect.stringMatching(/not expired or not fenceable/));
      expect(await phase(a)).not.toBe('fenced_expired');
    }
  });

  it('requires confirmed owner, consumed processing token, acknowledged live capability, and enabled matching scope', async () => {
    const noClosure = await seed('unknown', { confirmed: false });
    const noAck = await seed('unknown', { acknowledged: false });
    const expired = await seed();
    await sql(`UPDATE account_completion_status_capabilities SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${expired.user}'`);
    const wrongToken = await seed();
    await sql(`UPDATE account_closure_tokens SET consumed_at=NULL WHERE user_id='${wrongToken.user}'`);
    const owner = await seed(), other = await seed();
    for (const a of [noClosure, noAck, expired, wrongToken]) expect(await failure(fence(a))).toEqual(expect.stringMatching(/confirmed account closure/));
    expect(await failure(fence(owner, { request: other.request }))).toEqual(expect.stringMatching(/confirmed account closure/));
    expect(await failure(fence(owner, {}, evidence, 'b'.repeat(64)))).toEqual(expect.stringMatching(/confirmed account closure/));
    await sql('UPDATE account_completion_configuration SET enabled=false');
    expect(await failure(fence(owner))).toEqual(expect.stringMatching(/confirmed account closure/));
  });

  it('rejects exact identity mismatches and malformed evidence without touching another account', async () => {
    const a = await seed(), b = await seed();
    for (const changes of [{ user: b.user }, { session: b.session }, { operation: b.operation }]) {
      expect(await failure(fence(a, changes))).toEqual(expect.stringMatching(/not found/));
    }
    expect(await failure(fence(a, {}, ''))).toEqual(expect.stringMatching(/identity and evidence/));
    expect(await phase(a)).toBe('unknown'); expect(await phase(b)).toBe('unknown');
  });

  it.each(['admitted', 'committed'] as const)('refuses late persistence before digest replay for %s, and failure cannot rewrite the fence', async kind => {
    const a = await seed(kind);
    const oldValue = await value(`SELECT ai_suggestions FROM sessions WHERE id='${a.session}'`);
    expect(await value(fence(a))).toBe(true);
    expect(await failure(persist(a))).toEqual(expect.stringMatching(/fenced/));
    expect(await value(finish(a, 'refused'))).toBe(false);
    expect(await value(finish(a, 'unknown'))).toBe(false);
    expect(await value(`SELECT ai_suggestions FROM sessions WHERE id='${a.session}'`)).toEqual(oldValue);
    expect(await phase(a)).toBe('fenced_expired');
  });

  it('persistence winning first refreshes age and prevents stale reconciliation; no fake settled provider claim', async () => {
    const a = await seed('admitted');
    expect(await value(persist(a, false))).toEqual(JSON.parse(payload));
    expect(await phase(a)).toBe('unknown');
    expect(await failure(fence(a))).toEqual(expect.stringMatching(/not expired/));
    expect(await status(a)).toMatchObject({ reason: 'coaching_unsettled' });
    await age(a);
    expect(await value(fence(a))).toBe(true);
    expect(await audit(a)).toMatchObject({ local_persistence: 'committed', provider_outcome: 'unknown' });
  });

  it('replays only exact evidence, survives Auth cascade, and does not expose personal identifiers in audit', async () => {
    const a = await seed('committed');
    expect(await value(fence(a))).toBe(true); expect(await value(fence(a))).toBe(true);
    expect(await failure(fence(a, {}, 'f'.repeat(64)))).toEqual(expect.stringMatching(/evidence differs/));
    const row = await audit(a);
    expect(JSON.stringify(row)).not.toContain(a.user); expect(JSON.stringify(row)).not.toContain(a.session);
    await sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
    expect(await value(`SELECT count(*)::int FROM account_coaching_operations WHERE user_id='${a.user}'`)).toBe(0);
    expect(await value(fence(a))).toBe(true);
    expect(await failure(fence(a, { session: 'b8120000-0000-4000-8000-999999999999' }))).toEqual(expect.stringMatching(/not found/));
    expect(await failure(fence(a, { user: 'b8110000-0000-4000-8000-999999999999' }))).toEqual(expect.stringMatching(/not found/));
    expect(await value(`SELECT count(*)::int FROM account_coaching_expiry_fences WHERE operation_id='${a.operation}'`)).toBe(1);
  });

  it('keeps unresolved coaching deletion blocked and preserves unrelated closure prerequisites', async () => {
    const a = await seed();
    expect(await failure(`DELETE FROM auth.users WHERE id='${a.user}'`)).toEqual(expect.stringMatching(/unsettled/));
    expect(await value(fence(a))).toBe(true);
    await sql(`DELETE FROM account_completion_coverage WHERE user_id='${a.user}'`);
    expect(await status(a)).toMatchObject({ reason: 'coverage_unverified' });
    expect(await claim(a)).toEqual({ outcome: 'pending' });
  });

  it('keeps RPC service-only and audit table non-public in the actual schema', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await value(`SELECT has_function_privilege('${role}','${rpc}','EXECUTE')`)).toBe(false);
    }
    expect(await value(`SELECT has_function_privilege('service_role','${rpc}','EXECUTE')`)).toBe(true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(await value(`SELECT has_table_privilege('${role}','public.account_coaching_expiry_fences','SELECT,INSERT,UPDATE,DELETE')`)).toBe(false);
    }
    expect(await value(`SELECT relrowsecurity FROM pg_class WHERE oid='public.account_coaching_expiry_fences'::regclass`)).toBe(true);
  });
});
