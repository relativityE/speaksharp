// Micro-controls only: real upstream guard in PGlite, NOT the native126/Supabase proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require=createRequire(join(process.cwd(),'package.json'));
const {PGlite}=require('@electric-sql/pglite');
const fixture=readFileSync('tests/db/account-completion-full-chain-invariants.sql','utf8');
const start=fixture.indexOf('  -- Synthetic metadata cleanup only');
const end=fixture.indexOf("  UPDATE public.trial_entitlements SET email='completion-chain-unrelated",start);
assert(start>0&&end>start);
const cleanup=fixture.slice(start,end);
const upstream=readFileSync(new URL('./cli-storage-upstream-0055-c6ff8c2.sql',import.meta.url),'utf8');
const id='b9110000-0000-4000-8000-000000000003';
const direct="DELETE FROM storage.objects WHERE bucket_id='closure-completion-proof'";
const denied='Direct deletion from storage tables is not allowed. Use the Storage API instead.';
const wrap=body=>`DO $$ DECLARE c uuid:='${id}'; storage_delete_prior text; storage_guard_hint text; deleted_objects bigint; BEGIN ${body} END $$;`;
async function setup(body=upstream) {
  const db=new PGlite();
  await db.exec(`CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text);
    CREATE TABLE storage.objects(bucket_id text,name text,UNIQUE(bucket_id,name));
    ${body}
    INSERT INTO storage.buckets VALUES('closure-completion-proof','closure-completion-proof');
    INSERT INTO storage.objects VALUES('closure-completion-proof','${id}/residue');`);
  return db;
}
async function using(fn,body=upstream){const db=await setup(body);try{await fn(db);}finally{await db.close();}}
test('RED: historical broad DELETE is rejected by the unmodified upstream42501 guard',async()=>using(async db=>{
  await assert.rejects(db.exec(direct),error=>error.code==='42501'&&error.message===denied);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM storage.objects')).rows[0].n,1);
}));
test('GREEN: exact production cleanup block removes target, retains neighbor and restores denial',async()=>using(async db=>{
  await db.exec(wrap(cleanup));
  assert.deepEqual((await db.query('SELECT name FROM storage.objects')).rows,[{name:'untouched-control/residue'}]);
  assert.notEqual((await db.query("SELECT current_setting('storage.allow_delete_query',true) AS setting")).rows[0].setting,'true');
  await assert.rejects(db.exec(direct),error=>error.code==='42501'&&error.message===denied);
}));
for(const prior of ['false','off',''])test('preserves explicit fail-closed prior setting '+JSON.stringify(prior),async()=>using(async db=>{
  await db.query("SELECT set_config('storage.allow_delete_query',$1,false)",[prior]);
  await db.exec(wrap(cleanup));
  assert.equal((await db.query("SELECT current_setting('storage.allow_delete_query',true) AS setting")).rows[0].setting,prior);
}));
test('rejects a pre-enabled delete setting rather than claiming a guard negative',async()=>using(async db=>{
  await db.exec("SET storage.allow_delete_query='true'");
  await assert.rejects(db.exec(wrap(cleanup)),/requires a fail-closed prior/);
}));
test('broad-cleanup mutation is caught by exact row-count and retained-neighbor assertions',async()=>using(async db=>{
  const changed=cleanup.replace("PERFORM set_config('storage.allow_delete_query','true',true);\n  "+direct+" AND name=c::text||'/residue';",
    "PERFORM set_config('storage.allow_delete_query','true',true);\n  "+direct+';');
  assert.notEqual(changed,cleanup);
  await assert.rejects(db.exec(wrap(changed)),/escaped the exact object/);
}));
test('setting-leak mutation is rejected before account completion could continue',async()=>using(async db=>{
  const changed=cleanup.replace("set_config('storage.allow_delete_query',coalesce(storage_delete_prior,''),true)","set_config('storage.allow_delete_query','true',true)");
  assert.notEqual(changed,cleanup);
  await assert.rejects(db.exec(wrap(changed)),/did not restore/);
}));
test('another42501 message is rethrown, not mistaken for the expected Storage guard',async()=>using(async db=>{
  await assert.rejects(db.exec(wrap(cleanup)),error=>error.code==='42501'&&error.message==='different guard failure');
},upstream.replaceAll(denied,'different guard failure')));
