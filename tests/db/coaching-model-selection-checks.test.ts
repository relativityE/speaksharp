import { PGlite } from '@electric-sql/pglite';
import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

it('serializes a configurable check window, one extra Start, and admin override on the serving selection', async () => {
  const base = 'backend/supabase/migrations/20261126005433_coaching_model_readiness.sql';
  const fixture = 'backend/supabase/migrations/20261127144500_coaching_model_selection_checks.sql';
  const bytes = await readFile(fixture);
  const sha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await pg.exec(await readFile(base, 'utf8'));
    await pg.exec(bytes.toString('utf8'));
    const one = async <T extends Record<string, unknown>>(sql: string, values: unknown[] = []) => (await pg.query<T>(sql, values)).rows[0];
    const claim = async (admin = false) => (await one<{ v: { kind: string; lease: { token: string } } }>(
      'SELECT public.claim_coaching_model_probe_v2($1,$2) AS v', ['gemini-3.6-flash', admin])).v;
    const finish = async (token: string, outcome: string, verified: boolean | null = null, promote: string | null = null, wait: number | null = null) =>
      (await one('SELECT public.finish_coaching_model_probe_v2(1,$1,$2,$3,$4,$5) AS v', [token, verified, promote, wait, outcome])).v;

    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one("SELECT has_function_privilege($1,'public.claim_coaching_model_probe_v2(text,boolean)','EXECUTE') AS v", [role])).v, false);
      assert.equal((await one("SELECT has_function_privilege($1,'public.finish_coaching_model_probe_v2(integer,uuid,boolean,text,integer,text)','EXECUTE') AS v", [role])).v, false);
    }
    await pg.exec('SET ROLE service_role');
    // Known deployed v1 state: this must not become the v2 interval or stop first eligibility.
    await pg.exec(`INSERT INTO public.coaching_model_selection (model, checked, verified, next_probe_at)
      VALUES ('gemini-3.6-flash',true,false,clock_timestamp() + interval '19 hours')`);
    const first = await claim();
    assert.equal(first.kind, 'claimed');
    const shared = await claim(true);
    assert.equal(shared.kind, 'busy');
    assert.equal((shared as unknown as { checkId: string }).checkId, first.lease.token);
    assert.equal((await claim()).kind, 'busy');
    assert.equal((await one('SELECT user_check_interval_seconds AS v FROM public.coaching_model_selection')).v, 3600);
    assert.equal(await finish(first.lease.token, 'inconclusive'), true);
    const extra = await claim();
    assert.equal(extra.kind, 'claimed');
    assert.equal(await finish(first.lease.token, 'healthy', true), false);
    assert.equal(await finish(extra.lease.token, 'provider_limited', null, null, 50_000), true);
    assert.equal((await claim()).kind, 'cooldown');
    const admin = await claim(true);
    assert.equal(admin.kind, 'claimed'); // Bypasses the interval AND prior project-wide retry-after.
    assert.equal((await claim(true)).kind, 'busy');
    assert.equal(await finish(admin.lease.token, 'promoted', true, 'gemini-3.5-flash-lite'), true);
    assert.deepEqual(await one("SELECT model,revision,verified,user_retry_pending,provider_check_after='-infinity' AS provider_wait_clear FROM public.coaching_model_selection"),
      {model:'gemini-3.5-flash-lite', revision:2, verified:true, user_retry_pending:false, provider_wait_clear:true});
    assert.equal((await claim()).kind, 'cooldown');
    await pg.exec("UPDATE public.coaching_model_selection SET user_next_check_at='-infinity', user_check_interval_seconds=120");
    const configured = await claim();
    assert.equal(configured.kind, 'claimed');
    assert.equal((await one("SELECT user_next_check_at < clock_timestamp() + interval '121 seconds' AND user_next_check_at > clock_timestamp() + interval '110 seconds' AS v FROM public.coaching_model_selection")).v,true);
    await pg.exec("UPDATE public.coaching_model_selection SET probe_deadline = clock_timestamp() - interval '1 second'");
    assert.equal((await one('SELECT public.finish_coaching_model_probe_v2(2,$1,true,NULL,NULL,\'healthy\') AS v',
      [configured.lease.token])).v,false);
    assert.equal((await claim()).kind, 'cooldown'); // Expired worker cannot trigger an unbounded retry loop.
  } finally { await pg.close(); }
  const afterSha256 = sha(await readFile(fixture));
  const beforeSha256 = sha(bytes);
  assert.equal(afterSha256, beforeSha256);
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
  if (binding?.sql) await writeFile(binding.sql.witnessFile, JSON.stringify({
    schemaVersion: 1, phaseId: binding.phaseId, bindingSha256: sha(JSON.stringify(binding)),
    consumer: 'tests/db/coaching-model-selection-checks.test.ts',
    consumed: [{ file: fixture, sha256: beforeSha256, beforeSha256, afterSha256 }],
  }));
}, 15_000);
