import { PGlite } from '@electric-sql/pglite';
import { it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
it('keeps one service-owned active model and rejects stale promotion', async () => {
const pg = new PGlite();
try {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await pg.exec(await readFile('./tests/db/fixtures/coaching-model-readiness.sql','utf8'));
  const one = async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
  assert.equal((await one("SELECT public.claim_coaching_model_probe_v1() AS result")).result,null);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.claim_coaching_model_probe_v1()','EXECUTE') AS result")).result,false);
  assert.equal((await one("SELECT has_table_privilege('anon','public.coaching_model_selection','SELECT') AS result")).result,false);
  await pg.exec("INSERT INTO public.coaching_model_selection (model) VALUES ('gemini-3.6-flash'); SET ROLE service_role;");
  const claim = async () => (await one<{ result: { kind: string; lease: { token: string } } }>("SELECT public.claim_coaching_model_probe_v1() AS result")).result;
  const finish = async (rev: number, token: string, valid: boolean, model: string | null, hint: number | null = null) => (await one(
   'SELECT public.finish_coaching_model_probe_v1($1,$2,$3,$4,$5) AS result',[rev,token,valid,model,hint])).result;
  const first = await claim();
  assert.equal(first.kind,'claimed');
  assert.equal((await claim()).kind,'busy');
  assert.equal(await finish(2,first.lease.token,true,'gemini-3.5-flash-lite'),false);
  assert.equal(await finish(1,first.lease.token,false,'gemini-3.5-flash-lite'),false);
  assert.equal(await finish(1,first.lease.token,true,null),true);
  assert.deepEqual(await one('SELECT model, revision FROM public.coaching_model_selection'), {model:'gemini-3.6-flash',revision:1});
  assert.equal((await claim()).kind,'cooldown');
  await pg.exec("UPDATE public.coaching_model_selection SET next_probe_at = '-infinity';");
  const second = await claim();
  assert.equal(await finish(1,first.lease.token,true,'gemini-3.5-flash-lite'),false);
  assert.equal(await finish(1,second.lease.token,true,'gemini-3.5-flash-lite'),true);
  assert.deepEqual(await one('SELECT model, revision FROM public.coaching_model_selection'), {model:'gemini-3.5-flash-lite',revision:2});
  await pg.exec("UPDATE public.coaching_model_selection SET next_probe_at = '-infinity';");
  const third = await claim();
  assert.equal(await finish(2,third.lease.token,false,null,99000),true);
  assert.equal((await one("SELECT next_probe_at > clock_timestamp() + interval '95 seconds' AS result FROM public.coaching_model_selection")).result,true);

} finally { await pg.close(); }

}, 15000);
