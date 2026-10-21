// Native, owned disposable PostgreSQL. No hosted database, provider, or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';

const candidate = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const scope = 'a'.repeat(64);
const service = text => `SET ROLE service_role; ${text}`;
const authenticated = (a,text) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;

test('inactive account completion: native readiness, journal, and concurrent claim', async t => {
  const root = mkdtempSync(join(tmpdir(),'closure-completion-'));
  const data = join(root,'data'), socket = join(root,'socket'); mkdirSync(socket);
  const env = {...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),
    PGHOST:socket, PGPORT:'5432', PGUSER:'completion_fixture_admin', PGDATABASE:'postgres'};
  const args = ['-h',socket,'-p','5432','-U',env.PGUSER,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const sql = text => execFileSync('psql',[...args,'-c',text],{env,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
  const json = text => {const value=sql(text).split('\n').at(-1);return value ? JSON.parse(value) : null;};
  const clients=[], receipts=[]; let started=false, index=0;
  const claim = a => service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`);
  const grantArgs = a => `'${a.user}','${a.request}','${a.execution}','${scope}'`;
  const inspect = a => service(`SELECT inspect_account_pending_completion_v1(${grantArgs(a)})`);
  const begin = (a,key) => service(`SELECT begin_account_completion_stage_v1(${grantArgs(a)},'${key}')`);
  const finish = (a,key,outcome='completed') => service(`SELECT finish_account_completion_stage_v1(${grantArgs(a)},'${key}','${outcome}')`);
  const complete = a => service(`SELECT complete_account_pending_completion_v1(${grantArgs(a)})`);
  function seed({coverage=true, pending=true}={}) {
    const suffix=String(++index).padStart(12,'0');
    const a={user:`b9010000-0000-4000-8000-${suffix}`,lease:`b9020000-0000-4000-8000-${suffix}`,hash:String(index).padStart(64,'a')};
    sql(`INSERT INTO auth.users VALUES('${a.user}','completion-${index}@example.test',now());
      SET ROLE service_role; SELECT issue_account_closure_pending_token('${a.user}','${a.hash}');`);
    a.request=sql(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
    if(pending)json(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    if(coverage)sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
      'synthetic fixture legacy coverage; not production proof','synthetic fixture portal settlement; not provider proof')`);
    return a;
  }
  const own = a => {const g=json(claim(a));assert.ok(g?.executionId,JSON.stringify(g));return {...a,execution:g.executionId};};
  function client(name,text,hold=false) {
    const child=spawn('psql',args,{env:{...env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
    const c={child,stdout:'',stderr:'',exited:false};clients.push(c);
    child.stdout.on('data',x=>{c.stdout+=x;}); child.stderr.on('data',x=>{c.stderr+=x;});
    c.done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{c.exited=true;resolve({code,stdout:c.stdout,stderr:c.stderr});});});
    if(hold)child.stdin.write(text+'\n');else child.stdin.end(text+'\n');return c;
  }
  async function waitFor(fn){const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await delay(20);}throw Error('required native lock barrier absent');}
  const idle = name => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='idle in transaction')`)==='t';
  const blocked = (w,h) => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${w}'
    AND (SELECT pid FROM pg_stat_activity WHERE application_name='${h}')=ANY(pg_blocking_pids(pid)))`)==='t';
  try {
    execFileSync('initdb',['-D',data,'-U',env.PGUSER,'-A','trust','--no-locale','--encoding=UTF8'],{encoding:'utf8'});
    execFileSync('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-w','start','-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=10 -c shared_buffers=16MB -c deadlock_timeout=100ms`],{encoding:'utf8'});
    started=true;assert.equal(sql("SELECT current_setting('data_directory')"),data);
    sql(completionBootstrap());
    sql(readFileSync(candidate,'utf8'));

    await t.test('disabled by default; service RPCs cannot manufacture coverage or mutate journal tables',()=>{
      const a=seed();assert.equal(json(claim(a)),null);
      assert.equal(sql('SELECT enabled FROM account_completion_configuration'),'f');
      for(const role of ['anon','authenticated','service_role'])for(const table of [
        'account_completion_configuration','account_completion_coverage','account_save_obligations','account_completion_executions','account_completion_stages','account_completion_status_capabilities']) {
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(sql(`SELECT has_table_privilege('${role}','${table}','${privilege}')`),'f');
        assert.equal(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass`),'t');
      }
      const functions=sql(`SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND (p.proname LIKE '%account%completion%v1' OR p.proname LIKE '_account_save%v1')`).split('\n');
      assert.ok(functions.length>=10);
      for(const fn of functions)for(const role of ['anon','authenticated'])
        assert.equal(sql(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`),'f',fn);
      sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);
    });
    await t.test('wrong identity, missing coverage and other-account debt never become settled booleans',()=>{
      const a=seed({coverage:false}), b=seed();
      assert.deepEqual(json(claim(a)),{outcome:'pending'});
      assert.equal(json(claim({...a,request:b.request})),null);
      sql(`INSERT INTO account_save_obligations(user_id,lease_id) VALUES('${a.user}','${a.lease}')`);
      assert.ok(own(b).execution);assert.deepEqual(json(claim(a)),{outcome:'pending'});
    });
    await t.test('checkout and unknown coaching debt hold; legacy finish cannot reopen a claimed executor',()=>{
      const a=seed({pending:false});
      const operation=sql(service(`SELECT begin_account_checkout('${a.user}')`));
      json(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
      assert.deepEqual(json(claim(a)),{outcome:'pending'});
      assert.equal(sql(service(`SELECT reconcile_rejected_account_checkout('${a.user}','${operation}','req_fixture','parameter_missing','line_items')`)),'t');
      const g=own(a);sql(service(`SELECT finish_account_closure_attempt('${a.user}','${a.request}')`));
      assert.equal(json(inspect(g)).phase,'processing');assert.equal(json(claim(a)),null);
      const b=seed();sql(`INSERT INTO account_coaching_operations(operation_id,user_id,session_id,phase)
        VALUES(gen_random_uuid(),'${b.user}',gen_random_uuid(),'unknown')`);
      assert.deepEqual(json(claim(b)),{outcome:'pending'});
    });
    await t.test('release and elapsed heartbeat cannot erase admitted save debt; actual atomic save settles it',()=>{
      const a=seed({pending:false});
      assert.equal(json(authenticated(a,`SELECT acquire_recording_lease('${a.lease}','synthetic',false)`)).acquired,true);
      const row=json(authenticated(a,`SELECT create_session_and_update_usage('{"title":"synthetic","duration":0,"lease_id":"${a.lease}"}'::jsonb,'private')`));
      a.session=row.new_session.id;
      json(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
      assert.deepEqual(json(claim(a)),{outcome:'pending'});
      assert.equal(json(authenticated(a,`SELECT release_recording_lease('${a.lease}')`)).released,true);
      assert.equal(sql(`SELECT count(*) FROM active_recording_lease WHERE user_id='${a.user}'`),'0');
      assert.deepEqual(json(claim(a)),{outcome:'pending'});
      assert.throws(()=>sql(`DELETE FROM auth.users WHERE id='${a.user}'`),/admitted save unsettled/);
      const save=authenticated(a,`SELECT complete_session_v2('${a.session}','completed',30,NULL,
        '{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take')`);
      assert.equal(json(save).success,true);assert.equal(json(save).success,true);
      assert.equal(sql(`SELECT phase FROM account_save_obligations WHERE user_id='${a.user}'`),'completed');
      assert.ok(own(a).execution);
    });
    await t.test('no-session lease debt survives release, client restart and owner-row absence',()=>{
      const a=seed({pending:false});json(authenticated(a,`SELECT acquire_recording_lease('${a.lease}')`));
      json(authenticated(a,`SELECT release_recording_lease('${a.lease}')`));
      json(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
      assert.deepEqual(json(claim(a)),{outcome:'pending'});
      assert.throws(()=>sql(`DELETE FROM auth.users WHERE id='${a.user}'`),/admitted save unsettled/);
      assert.equal(sql(`SELECT phase FROM account_save_obligations WHERE user_id='${a.user}'`),'admitted');
    });
    await t.test('stage started/unknown/completed cannot redispatch; wrong executor has no authority',()=>{
      const a=own(seed()), b=own(seed());
      assert.equal(json(inspect({...a,execution:b.execution})),null);
      assert.equal(json(begin(a,'retain_trial')).phase,'dispatch');
      assert.equal(json(begin(a,'retain_trial')).phase,'started');
      assert.equal(json(finish(a,'retain_trial','unknown')).phase,'unknown');
      assert.equal(json(finish(a,'retain_trial')).phase,'unknown');
      assert.equal(json(begin(a,'retain_trial')).phase,'unknown');
      assert.equal(json(begin(a,'remove_storage')).phase,'dispatch');
      assert.equal(json(finish(a,'remove_storage')).phase,'completed');
      assert.equal(json(begin(a,'remove_storage')).phase,'completed');assert.equal(json(complete(a)),null);
    });
    await t.test('expiry and configuration invalidation hold new effects but retain unknown intent',()=>{
      const a=own(seed());json(begin(a,'retain_trial'));
      sql(`UPDATE account_completion_executions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${a.user}'`);
      assert.equal(json(inspect(a)),null);assert.equal(json(begin(a,'remove_storage')),null);
      assert.equal(json(finish(a,'retain_trial')),null);
      assert.equal(json(finish(a,'retain_trial','unknown')).phase,'unknown');
      const b=own(seed());json(begin(b,'retain_trial'));sql('UPDATE account_completion_configuration SET enabled=false');
      assert.equal(json(inspect(b)),null);assert.equal(json(begin(b,'remove_storage')),null);
      assert.equal(json(finish(b,'retain_trial','unknown')).phase,'unknown');
      sql('UPDATE account_completion_configuration SET enabled=true');
    });
    await t.test('only exact completed stages and actual Auth/storage absence give terminal receipt',()=>{
      const a=own(seed());assert.equal(json(complete(a)),null);
      sql(`SET ROLE closure_owner; SELECT preserve_account_trial_email('${a.user}')`);
      for(const key of ['retain_trial','remove_storage','delete_auth']){json(begin(a,key));json(finish(a,key));}
      assert.equal(json(complete(a)),null);
      sql(`DELETE FROM auth.users WHERE id='${a.user}'; INSERT INTO storage.objects VALUES('synthetic','${a.user}/residue','${a.user}')`);
      assert.equal(json(complete(a)),null);
      sql(`DELETE FROM storage.objects WHERE owner_id='${a.user}'`);
      assert.equal(json(complete(a)).phase,'completed');assert.equal(json(inspect(a)),null);
      assert.equal(sql(`SELECT count(*) FROM account_billing_fences WHERE user_id='${a.user}'`),'0');
      assert.equal(json(claim(a)),null);
    });
    await t.test('status capability acknowledgment, scope and original expiry never grant effect authority',()=>{
      const a=seed(),hash='c'+a.hash.slice(1);
      const issue=(key=hash)=>json(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${key}')`));
      const ack=(key=hash)=>sql(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${key}')`));
      const read=(key=hash,binding=scope)=>json(service(`SELECT read_account_completion_status_v1('${a.request}','${key}','${binding}')`));
      const issued=issue();assert.equal(issued.requestId,a.request);assert.ok(issued.expiresAt>Date.now());
      const received='d'+a.hash.slice(1);
      assert.equal(read(),null);assert.equal(issue(received).expiresAt,issued.expiresAt);
      assert.equal(ack(),'f');assert.equal(ack(received),'t');
      assert.equal(read(received).outcome,'pending');assert.equal(read(),null);assert.equal(read(received,'d'.repeat(64)),null);
      assert.equal(issue(received).expiresAt,issued.expiresAt);assert.equal(issue(),null);
      assert.equal(sql(`SELECT count(*) FROM account_completion_executions WHERE user_id='${a.user}'`),'0');
      sql(`UPDATE account_completion_status_capabilities SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${a.user}'`);
      assert.equal(read(received),null);assert.equal(issue(received),null);
    });
    await t.test('post-Auth status reads terminal residue but cannot renew ownership or replay effects',()=>{
      const source=seed(),hash='c'+source.hash.slice(1);
      const issued=json(service(`SELECT issue_account_completion_status_v1('${source.user}','${source.request}','${scope}','${hash}')`));
      assert.equal(issued.requestId,source.request);
      assert.equal(sql(service(`SELECT acknowledge_account_completion_status_v1('${source.user}','${source.request}','${scope}','${hash}')`)),'t');
      const a=own(source);sql(`SET ROLE closure_owner; SELECT preserve_account_trial_email('${a.user}')`);
      for(const key of ['retain_trial','remove_storage','delete_auth']){json(begin(a,key));json(finish(a,key));}
      sql(`DELETE FROM auth.users WHERE id='${a.user}'`);assert.equal(json(complete(a)).phase,'completed');
      const status=json(service(`SELECT read_account_completion_status_v1('${a.request}','${hash}','${scope}')`));
      assert.equal(status.outcome,'completed');assert.equal(status.accountDeleted,true);assert.equal(status.canRetry,false);
      assert.equal(json(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${hash}')`)),null);
      assert.equal(sql(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${hash}')`)),'f');
      assert.equal(json(claim(a)),null);
    });
    for(const commit of [false,true])await t.test(`native concurrent claim: first ${commit?'commits':'rolls back'}`,async()=>{
      const a=seed(),b=seed(),hname=`claim_holder_${index}`,wname=`claim_waiter_${index}`;
      const holder=client(hname,`BEGIN; ${claim(a)};`,true);await waitFor(()=>idle(hname));
      const waiter=client(wname,claim(a)+';');await waitFor(()=>blocked(wname,hname));
      const other=client(`unrelated_${index}`,claim(b)+';');await waitFor(()=>other.exited);
      const o=await other.done;assert.equal(o.code,0,o.stderr);assert.ok(JSON.parse(o.stdout.trim()).executionId);
      holder.child.stdin.end(`${commit?'COMMIT':'ROLLBACK'};\n`);
      const h=await holder.done,w=await waiter.done;receipts.push({commit,observedBlock:true,holder:h,waiter:w,other:o});
      assert.equal(h.code,0,h.stderr);assert.equal(w.code,0,w.stderr);
      const answer=w.stdout.trim();assert.equal(Boolean(answer),!commit);
      assert.equal(sql(`SELECT count(*) FROM account_completion_executions WHERE user_id='${a.user}'`),'1');
    });
  } finally {
    for(const c of clients)if(!c.child.stdin.destroyed)c.child.stdin.end();
    if(started)execFileSync('pg_ctl',['-D',data,'-w','stop','-m','immediate'],{encoding:'utf8'});
    await Promise.allSettled(clients.map(c=>c.done));
    mkdirSync('artifacts/account-completion',{recursive:true});
    const files=[candidate,'tests/db/account-completion-realpg.mjs',...recordingChain.map(x=>'backend/supabase/migrations/'+x)];
    writeFileSync('artifacts/account-completion/receipts.json',JSON.stringify({createdAt:new Date().toISOString(),
      databaseStarted:started,qualification:'Inspect TAP exit and participant results; this artifact alone is not a PASS',
      boundary:'owned disposable PostgreSQL only; actual pending/recording/coaching/completion migrations; declared signup/storage/usage fixtures; no hosted/provider calls',
      hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')])),receipts},null,2)+'\n');
    rmSync(root,{recursive:true,force:true});
  }
});
