// @vitest-environment node
// #1643 UNKNOWN-coaching fence — closure contract in PostgreSQL WASM (actual completion chain + M6), not native concurrency,
// not effective production ACLs (both are proven in account-coaching-fence.realpg.mjs) and not hosted/provider acceptance.
// A1 authority: the fence binds a VERIFIED, CONFIRMED owner closure — the pending closure attempt plus the owner's
// acknowledged, unexpired status capability for exactly that request and scope — never two pending rows alone
// (Sam 1792827650.089379). The request and scope are explicit arguments; the operation triple alone is never authority
// (Sam 1792829599.283729). Until the fence migration exists every case fails as a recorded CAPABILITY gap.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';
import { createAccountCompletionStatus } from '../../backend/supabase/functions/_shared/accountClosureCompletionStatus.ts';

const completionMigration = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
// A production predecessor the fence requires (its definer purge is an admitted ai_suggestions writer); not in the chain fixture.
const retentionPurgeMigration = 'backend/supabase/migrations/20260810120000_retention_purge_ai_suggestions.sql';
const fenceFile = readdirSync('backend/supabase/migrations').find(f => f.endsWith('_account_coaching_unknown_fence_1643.sql')) ?? null;
const model = JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json', 'utf8')).model as string;
const payload = '{"version":"gemini_coaching_v1","what_worked":"Synthetic control","what_to_try_next":"Synthetic next step"}';
const scope = 'a'.repeat(64);
const FENCE_RPC = 'public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text)';
let db: PGlite, index = 0;
type Account = { user: string; session: string; operation: string; hash: string; request: string };

const sql = async (text: string) => { await db.exec('RESET ROLE'); return db.exec(text); };
const value = async <T = unknown>(text: string): Promise<T> => {
  const result = await sql(text); const rows = result.at(-1)?.rows;
  return Object.values(rows?.[0] ?? {})[0] as T;
};
const failure = async (text: string): Promise<string | null> => { try { await sql(text); return null; } catch (error) { return String((error as Error).message ?? error); } };
const service = (text: string) => `SET ROLE service_role; ${text}`;
const as = (a: Account, text: string) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
const phase = (a: Account) => value<string>(`SELECT phase FROM account_coaching_operations WHERE operation_id='${a.operation}'`);
const fence = (a: Account, evidence = 'e'.repeat(64), request: string | null = a.request, scopeDigest = scope) =>
  service(`SELECT ${FENCE_RPC.split('(')[0]}('${a.operation}','${a.user}','${a.session}',${request ? `'${request}'` : 'NULL'},'${scopeDigest}','${evidence}')`);
const claim = (a: Account) => value<Record<string, unknown> | null>(service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`));
const persist = (a: Account) => service(`SELECT persist_account_coaching_v1('${a.operation}',true,'${a.session}','${a.user}','${payload}'::jsonb,
  'google_gemini','${model}','user_utc_day',CURRENT_DATE,3,1)`);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** The owner's raw status capability; only its hash is stored, exactly as the Edge issuer does. */
const statusToken = (a: Account) => sha256(`fence-status-token:${a.hash}`);
const statusHash = (a: Account) => sha256(statusToken(a));
const edgeBinding = { projectId: 'fence-fixture', environment: 'disposable' as const, url: 'http://localhost/', scopeDigest: scope };
/**
 * The DEPLOYED Edge status reader (accountClosureCompletionStatus.ts), fed the real RPC reply from this database
 * (Sam 1792830500.895509). `alter` injects a negative control between the database and the parser.
 */
const edgeRead = (a: Account, alter: (data: unknown) => unknown = data => data) => createAccountCompletionStatus(edgeBinding, {
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'read_account_completion_status_v1') throw new Error(`unexpected RPC ${name}`);
      const data = await value(service(`SELECT read_account_completion_status_v1('${args.p_request_id}','${args.p_token_hash}','${args.p_scope_digest}')`));
      return { data: alter(data), error: null };
    },
  }),
  currentBinding: async () => ({ ...edgeBinding }),
  authenticate: async () => { throw new Error('a status read never authenticates'); },
}).read({ requestId: a.request, token: statusToken(a) });
const readStatus = (a: Account) => value<Record<string, unknown> | null>(service(`SELECT read_account_completion_status_v1('${a.request}','${statusHash(a)}','${scope}')-'expiresAt'`));
const requireFence = async () => {
  if (await value<boolean>(`SELECT to_regprocedure('${FENCE_RPC}') IS NOT NULL`) !== true) {
    throw new Error(`CAPABILITY: ${FENCE_RPC} is absent (fence migration ${fenceFile ?? 'not present'}); setup failure, not semantic proof`);
  }
};

/**
 * An account with one UNKNOWN coaching operation that never committed, then (optionally) a confirmed owner closure.
 * Coaching is admitted BEFORE closure begins: M5 refuses new admissions once closure is pending (M5 L56–57).
 */
async function seed(options: { pending?: boolean; acknowledged?: boolean } = {}): Promise<Account> {
  const { pending = true, acknowledged = true } = options; const suffix = String(++index).padStart(12, '0');
  const a: Account = { user: `b7110000-0000-4000-8000-${suffix}`, session: `b7120000-0000-4000-8000-${suffix}`,
    operation: `b7130000-0000-4000-8000-${suffix}`, hash: String(index).padStart(64, 'a'), request: '' };
  await sql(`INSERT INTO auth.users VALUES('${a.user}','fence-wasm-${index}@example.test',now());
    INSERT INTO sessions(id,user_id,status) VALUES('${a.session}','${a.user}','completed');`);
  await sql(as(a, 'SELECT consume_ai_suggestion_quota(3)'));
  expect(await value<Record<string, unknown>>(service(`SELECT begin_account_coaching_v1('${a.user}','${a.session}','${a.operation}')`))).toMatchObject({ admitted: true });
  expect(await value<boolean>(service(`SELECT finish_account_coaching_failure_v1('${a.user}','${a.session}','${a.operation}','unknown')`))).toBe(true);
  await sql(service(`SELECT issue_account_closure_pending_token('${a.user}','${a.hash}')`));
  a.request = await value<string>(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
  if (pending) {
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    await sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
      'synthetic WASM fixture legacy coverage','synthetic WASM fixture portal settlement')`);
    expect(await value(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${statusHash(a)}')`))).not.toBeNull();
    if (acknowledged) expect(await value<boolean>(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${statusHash(a)}')`))).toBe(true);
  }
  return a;
}

beforeAll(async () => {
  // Owner context (Sam 1792830367.408419): M6, the purge predecessor and the fence migration run as closure_owner (the
  // non-superuser stand-in for hosted `postgres`), never as the WASM superuser.
  db = new PGlite(); await db.exec(completionBootstrap());
  await db.exec(`SET ROLE closure_owner; ${readFileSync(completionMigration, 'utf8')} RESET ROLE;`);
  await db.exec(`SET ROLE closure_owner; ${readFileSync(retentionPurgeMigration, 'utf8')} RESET ROLE;`);
  if (fenceFile) await db.exec(`SET ROLE closure_owner; ${readFileSync(`backend/supabase/migrations/${fenceFile}`, 'utf8')} RESET ROLE;`);
}, 30000);
beforeEach(async () => { await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`); });
afterAll(async () => {
  await db?.close();
  // Bind the bootstrap/full-chain SQL and helper dependencies this proof read (Sam 1792829650.580399), not only this file.
  const helpers = ['tests/db/account-closure-pending-fixture.mjs', 'tests/db/account-completion-fixture.mjs', 'tests/db/account-closure-tokens.integration.test.ts'];
  const migrations = [...new Set([...helpers.slice(0, 2).flatMap(f => [...readFileSync(f, 'utf8').matchAll(/'(\d{14}_[a-z0-9_]+\.sql)'/g)].map(m => m[1])),
    ...recordingChain])].map(f => `backend/supabase/migrations/${f}`);
  const files = ['tests/db/account-coaching-fence.integration.test.ts', ...helpers, ...migrations, completionMigration, retentionPurgeMigration,
    'backend/supabase/functions/get-ai-suggestions/contract.json', ...(fenceFile ? [`backend/supabase/migrations/${fenceFile}`] : [])]
    .filter((f, i, all) => all.indexOf(f) === i);
  mkdirSync('artifacts/account-coaching-fence', { recursive: true });
  writeFileSync('artifacts/account-coaching-fence/pglite-dependencies.json', JSON.stringify({
    boundary: 'PostgreSQL WASM; actual completion chain + M6; closure contract only (no ACLs, no concurrency)',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fenceMigration: fenceFile,
    hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])) }, null, 2) + '\n');
});

describe('#1643 UNKNOWN-coaching fence: closure contract (actual completion SQL)', () => {
  it('BASELINE: an UNKNOWN operation holds owner closure at coaching_unsettled', async () => {
    const a = await seed();
    expect(await phase(a)).toBe('unknown');
    expect(await readStatus(a)).toMatchObject({ outcome: 'pending', reason: 'coaching_unsettled' });
    expect(await claim(a)).toEqual({ outcome: 'pending' });
  });

  it('A1: fences only under a verified, confirmed owner closure for exactly this request and scope', async () => {
    await requireFence();
    const refusal = /confirmed account closure/;
    const noClosure = await seed({ pending: false });
    expect(await failure(fence(noClosure))).toMatch(refusal);
    expect(await failure(fence(noClosure, 'e'.repeat(64), null))).toMatch(refusal);
    const unacknowledged = await seed({ acknowledged: false });
    expect(await failure(fence(unacknowledged))).toMatch(refusal);
    const expired = await seed();
    await sql(`UPDATE account_completion_status_capabilities SET expires_at=now()-interval '1 second' WHERE user_id='${expired.user}'`);
    expect(await failure(fence(expired))).toMatch(refusal);
    const owner = await seed(), other = await seed();
    expect(await failure(fence(owner, 'e'.repeat(64), other.request))).toMatch(refusal);
    expect(await failure(fence(owner, 'e'.repeat(64), owner.request, 'b'.repeat(64)))).toMatch(refusal);
    for (const x of [noClosure, unacknowledged, expired, owner, other]) expect(await phase(x)).toBe('unknown');
    expect(await value<boolean>(fence(owner))).toBe(true); expect(await phase(owner)).toBe('fenced_unknown');
  });

  it('M6: the real claim and status treat fenced_unknown as terminal and report the provider outcome unknown', async () => {
    await requireFence();
    const a = await seed();
    expect(await claim(a)).toEqual({ outcome: 'pending' });
    expect(await value<boolean>(fence(a))).toBe(true);
    // Option A (Sam decision pending, 1792830189.964259): the reply keeps the EXACT closed key set the deployed Edge parser
    // accepts (any extra key maps to `unavailable`); the unknown provider outcome is recorded in the audit row instead.
    expect(await readStatus(a)).toEqual({ outcome: 'pending', requestId: a.request, reason: 'ready', canRetry: false });
    expect(await value<string>(`SELECT provider_outcome FROM account_coaching_fences WHERE operation_id='${a.operation}'`)).toBe('unknown');
    const grant = await claim(a);
    expect(grant?.executionId).toEqual(expect.any(String)); expect(grant?.requestId).toBe(a.request);
    expect(await readStatus(a)).toMatchObject({ outcome: 'processing' });
  });

  it('EDGE: the deployed status parser accepts the fenced reply and still rejects an extra key or an unknown reason', async () => {
    await requireFence();
    const a = await seed();
    expect(await edgeRead(a)).toEqual({ outcome: 'pending', requestId: a.request, reason: 'coaching_unsettled', canRetry: false });
    expect(await value<boolean>(fence(a))).toBe(true);
    // Readiness after an authorized fence is account-closure readiness, not coaching success.
    expect(await edgeRead(a)).toEqual({ outcome: 'pending', requestId: a.request, reason: 'ready', canRetry: false });
    const unavailable = { outcome: 'unavailable', canRetry: false };
    expect(await edgeRead(a, data => ({ ...(data as object), providerOutcomeUnknown: 1 }))).toEqual(unavailable);
    expect(await edgeRead(a, data => ({ ...(data as object), reason: 'coaching_outcome_unknown' }))).toEqual(unavailable);
    expect((await claim(a))?.executionId).toEqual(expect.any(String));
    expect(await edgeRead(a)).toEqual({ outcome: 'processing', requestId: a.request, canRetry: false });
  });

  it('WRITERS: after the fence a late W1 is refused with 55000 and the failure path cannot rewrite it', async () => {
    await requireFence();
    const a = await seed(); expect(await value<boolean>(fence(a))).toBe(true);
    expect(await failure(persist(a))).toMatch(/55000|fenced/);
    expect(await value<string | null>(`SELECT ai_suggestions::text FROM sessions WHERE id='${a.session}'`)).toBeNull();
    expect(await value<boolean>(service(`SELECT finish_account_coaching_failure_v1('${a.user}','${a.session}','${a.operation}','refused')`))).toBe(false);
    expect(await phase(a)).toBe('fenced_unknown');
  });

  it('AUDIT: exactly one content-free audit row; idempotent for the same evidence, refused for different evidence', async () => {
    await requireFence();
    const a = await seed();
    expect(await value<boolean>(fence(a))).toBe(true); expect(await value<boolean>(fence(a))).toBe(true);
    expect(await failure(fence(a, 'f'.repeat(64)))).not.toBeNull();
    expect(await value<number>(`SELECT count(*)::int FROM account_coaching_fences WHERE operation_id='${a.operation}'`)).toBe(1);
    expect(await value<number>(`SELECT count(*)::int FROM account_coaching_fences f
      WHERE f::text LIKE '%${a.user}%' OR f::text LIKE '%${a.user.replaceAll('-', '')}%'`)).toBe(0);
  });
});
