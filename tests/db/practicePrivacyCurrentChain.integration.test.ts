import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { test } from 'vitest';
import { bootstrapSql, candidate, seed } from './content-free-retention-evidence.realpg.mjs';

// The actual migrations and save RPCs execute on the repository's bounded test schema.
test('#1835 current save chain preserves metrics and refuses new transcript text until opt-in', async () => {
  const db = new PGlite();
  const migration = (name: string) => readFileSync('backend/supabase/migrations/'+name,'utf8');
  type Result = { success?: boolean; new_session?: { id: string }; error?: string };
  type Row = { r: Result; n?: number; status?: string; transcript?: string | null };
  const rows = async (sql: string, params?: unknown[]) => (await db.query<Row>(sql, params)).rows;
  const action = {reasonCode:'ON_TRACK',actionCode:'MAINTAIN',metric:'wpm',value:100,comparator:'within_target',templateVersion:'rec_v1'};
  const owner = (uid: string) => db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    await db.exec(bootstrapSql());
    await db.exec('SET ROLE closure_owner;'+candidate()+'\nRESET ROLE;');
    const person = await seed(db);
    const optedPerson = await seed(db);
    await db.exec('RESET ROLE; ALTER ROLE closure_owner BYPASSRLS;');
    await db.exec('SET ROLE closure_owner;'+migration('20261110173548_account_coaching_local_retirement.sql')+'\nRESET ROLE;');
    await db.exec('SET ROLE closure_owner;'+migration('20261117105700_practice_privacy_choices_1835.sql')+'\nRESET ROLE;');
    await owner(person.user);
    assert.equal((await rows("SELECT count(*)::int AS n FROM practice_privacy_choices"))[0].n,0);
    const create = async () => (await rows("SELECT create_session_and_update_usage($1::jsonb,'private') AS r", [JSON.stringify({title:'offline fixture',duration:0,product:'open_mic'})]))[0].r;
    const a = await create();
    assert.ok(a.new_session?.id, JSON.stringify(a));
    const complete = async (id: string, transcript: string | null) => (await rows("SELECT complete_session_v2($1,'completed',60,NULL,$2::jsonb,100,NULL,100,'{}',NULL,$3) AS r", [id,JSON.stringify(action),transcript]))[0].r;
    await assert.rejects(complete(a.new_session.id,'synthetic transcript'),/transcript_consent_required/);
    const m = await complete(a.new_session.id,null);
    assert.equal(m.success,true,JSON.stringify(m));
    await db.exec('RESET ROLE');
    assert.deepEqual(await rows('SELECT status, transcript FROM sessions WHERE id=$1',[a.new_session.id]),[{status:'completed',transcript:null}]);
    assert.ok((await rows('SELECT transcript FROM sessions WHERE id=$1',[person.ids[0]]))[0].transcript);
    await owner(optedPerson.user);
    await rows('SELECT * FROM set_practice_privacy_choices_v1(true,true)');
    const b = await create();
    assert.ok(b.new_session?.id, JSON.stringify(b));
    const yes = await complete(b.new_session.id,'allowed synthetic transcript');
    assert.equal(yes.success,true,JSON.stringify(yes));
    await db.exec('RESET ROLE');
    assert.equal((await rows('SELECT transcript FROM sessions WHERE id=$1',[b.new_session.id]))[0].transcript,'allowed synthetic transcript');

  } finally {
    await db.close();
  }
});
