// Own disposable PostgreSQL, real pending/quota/authority/admission SQL; no provider or hosted calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pendingBootstrap, closureMigration } from './account-closure-pending-fixture.mjs';

const source='backend/supabase/migrations/20261019202856_account_coaching_admission_1643.sql';
const quotaMigration='20260530170000_ai_suggestion_daily_quota.sql';
const authorityMigration='20260910193000_ai_suggestion_authority_receipt.sql';
const model=JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json','utf8')).model;
const payload='{"version":"gemini_coaching_v1","what_worked":"Synthetic control","what_to_try_next":"Synthetic next step"}';

test('account coaching admission and definitive/unknown completion: native causal controls', async t=>{
  const root=mkdtempSync(join(tmpdir(),'closure-coaching-')); const data=join(root,'data');
  const socket=join(root,'socket'); mkdirSync(socket);
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),
    PGHOST:socket,PGPORT:'5432',PGUSER:'coaching_test_admin',PGDATABASE:'postgres'};
  const args=['-h',socket,'-p','5432','-U',env.PGUSER,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const sql=text=>execFileSync('psql',[...args,'-c',text],{env,encoding:'utf8',timeout:10_000}).trim();
  const json=text=>JSON.parse(sql(text).split('\n').at(-1));
  const clients=[]; const receipts=[]; let started=false; let index=0; let advisors=null;
  const service=text=>`SET ROLE service_role; ${text}`;
  const authenticated=(a,text)=>`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
  const quota=a=>authenticated(a,'SELECT consume_ai_suggestion_quota(3)');
  const begin=a=>service(`SELECT begin_account_coaching_v1('${a.user}','${a.session}','${a.operation}')`);
  const pending=a=>service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`);
  const outcome=(a,value)=>service(`SELECT finish_account_coaching_failure_v1('${a.user}','${a.session}','${a.operation}','${value}')`);
  const phase=a=>sql(`SELECT phase FROM account_coaching_operations WHERE operation_id='${a.operation}'`);
  const persist=(a,settled=true,text=payload,ordinal=1)=>service(`SELECT persist_account_coaching_v1(
    '${a.operation}',${settled},'${a.session}','${a.user}','${text}'::jsonb,'google_gemini','${model}',
    'user_utc_day',CURRENT_DATE,3,${ordinal})`);
  const remove=a=>`SET ROLE fixture_auth_admin; DELETE FROM auth.users WHERE id='${a.user}'`;
  const remaining=a=>Object.fromEntries(['auth.users','user_profiles','sessions','account_coaching_operations',
    'ai_suggestion_usage_daily','ai_suggestion_authority_receipts'].map(table=>[table,Number(sql(
      `SELECT count(*) FROM ${table} WHERE ${['auth.users','user_profiles'].includes(table)?'id':'user_id'}='${a.user}'`))]));
  function seed(warm=false){
    index++;const suffix=String(index).padStart(12,'0');
    const a={user:`b8010000-0000-4000-8000-${suffix}`,session:`b8020000-0000-4000-8000-${suffix}`,
      operation:`b8030000-0000-4000-8000-${suffix}`,hash:String(index).padStart(64,'a')};
    sql(`INSERT INTO auth.users VALUES('${a.user}','coaching-${index}@example.test',now());
      INSERT INTO sessions(id,user_id) VALUES('${a.session}','${a.user}');
      SET ROLE service_role; SELECT issue_account_closure_pending_token('${a.user}','${a.hash}');`);
    if(warm)sql(`INSERT INTO ai_suggestion_usage_daily(user_id,usage_date,request_count) VALUES('${a.user}',CURRENT_DATE,0)`);
    return a;
  }
  function client(name,text,hold=false){
    const child=spawn('psql',args,{env:{...env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
    const state={child,stdout:'',stderr:'',exited:false}; clients.push(state);
    child.stdout.on('data',s=>{state.stdout+=s;});child.stderr.on('data',s=>{state.stderr+=s;});
    state.done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{
      state.exited=true;resolve({code,stdout:state.stdout,stderr:state.stderr});});});
    if(hold)child.stdin.write(text+'\n');else child.stdin.end(text+'\n');return state;
  }
  async function waitFor(fn){const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await delay(20);}throw Error('native barrier missing');}
  const idle=name=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='idle in transaction')`)==='t';
  const blocked=(waiter,holder)=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${waiter}'
    AND (SELECT pid FROM pg_stat_activity WHERE application_name='${holder}')=ANY(pg_blocking_pids(pid)))`)==='t';
  try{
    execFileSync('initdb',['-D',data,'-U',env.PGUSER,'-A','trust','--no-locale','--encoding=UTF8'],{encoding:'utf8'});
    execFileSync('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-w','start','-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=10 -c shared_buffers=16MB -c work_mem=1MB -c deadlock_timeout=100ms`],{encoding:'utf8'});
    started=true;assert.equal(sql("SELECT current_setting('data_directory')"),data);
    sql(pendingBootstrap());
    // Auth principal can delete only Auth rows, with no direct ledger/profile/session privileges.
    sql(`CREATE ROLE fixture_auth_admin NOINHERIT;
      GRANT USAGE ON SCHEMA auth TO fixture_auth_admin;
      GRANT SELECT,DELETE ON auth.users TO fixture_auth_admin;
      CREATE FUNCTION auth.coaching_delete_barrier() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
      BEGIN
        IF nullif(current_setting('coaching_test.delete_barrier',true),'') IS NOT NULL THEN
          PERFORM pg_advisory_xact_lock(current_setting('coaching_test.delete_barrier')::bigint);
        END IF;
        RETURN OLD;
      END $$;
      CREATE TRIGGER coaching_delete_barrier BEFORE DELETE ON auth.users
        FOR EACH ROW EXECUTE FUNCTION auth.coaching_delete_barrier();`);
    sql(`ALTER TABLE sessions ADD COLUMN ai_suggestions jsonb,ADD COLUMN title text,ADD COLUMN duration int,
      ADD COLUMN total_words int,ADD COLUMN filler_words jsonb,ADD COLUMN custom_words jsonb,ADD COLUMN accuracy numeric,
      ADD COLUMN ground_truth text,ADD COLUMN transcript text,ADD COLUMN clarity_score numeric,ADD COLUMN wpm numeric,
      ADD COLUMN status text,ADD COLUMN status_reason text,ADD COLUMN pause_metrics jsonb,ADD COLUMN transcript_state text,
      ADD COLUMN updated_at timestamptz;`);
    sql(closureMigration(quotaMigration));sql(closureMigration(authorityMigration));sql(readFileSync(source,'utf8'));
    sql(readFileSync('tests/db/account-coaching-admission-invariants.sql','utf8'));
    if(process.env.COACHING_SKIP_ADVISORS!=='1'){
      // Explicitly scoped to this disposable Unix-socket database; never use a linked project.
      const url=`postgresql://${env.PGUSER}@localhost/postgres?host=${encodeURIComponent(socket)}&port=5432`;
      const result=spawnSync('supabase',['db','advisors','--db-url',url,'--type','security',
        '--level','warn','--fail-on','none','--output-format','json'],{
        env:{...env,SUPABASE_TELEMETRY_DISABLED:'1'},encoding:'utf8',timeout:20_000,maxBuffer:2*1024*1024,
      });
      advisors={scope:'owned disposable database only; review new objects separately from fixture baseline',
        code:result.status,error:result.error?.message??null,stdout:result.stdout,stderr:result.stderr};
    }
    for(const fixed of [false,true])for(const warm of [false,true])for(const winner of ['pending','admission']){
      await t.test(`${fixed?'new admission':'actual old quota boundary'}/${warm?'existing quota row':'first quota insert'}: ${winner} wins`,async()=>{
        const a=seed(warm);const hname=`coaching_holder_${index}`;const wname=`coaching_waiter_${index}`;
        const admit=fixed?begin(a):quota(a);const holder=client(hname,`BEGIN; ${winner==='pending'?pending(a):admit};`,true);
        await waitFor(()=>idle(hname));const waiter=client(wname,(winner==='pending'?admit:pending(a))+';');
        await waitFor(()=>waiter.exited||blocked(wname,hname));const observedBlock=blocked(wname,hname);
        holder.child.stdin.end('COMMIT;\n');const h=await holder.done;const w=await waiter.done;
        receipts.push({fixed,warm,winner,observedBlock,holder:h,waiter:w});
        assert.equal(h.code,0,h.stderr);assert.equal(w.code,0,w.stderr);
        // A FIRST quota insert has an incidental FK key-share lock on the profile. An existing
        // quota-row UPDATE does not. Neither old path CHECKS pending, so both still admit after it.
        assert.equal(observedBlock,fixed||!warm);
        const answer=JSON.parse(w.stdout.trim().split('\n').at(-1));
        if(winner==='pending')assert.equal(fixed?answer.admitted:answer.allowed,!fixed);
        else assert.equal(answer.phase,'pending');
        if(fixed&&winner==='admission')assert.equal(phase(a),'admitted');
      });
    }
    await t.test('admitted A completes atomically after pending while B still admits',()=>{
      const a=seed(),b=seed();assert.equal(json(begin(a)).admitted,true);assert.equal(json(quota(a)).allowed,true);
      assert.equal(json(pending(a)).phase,'pending');assert.equal(json(begin(b)).admitted,true);
      assert.deepEqual(json(persist(a)),JSON.parse(payload));assert.equal(phase(a),'completed');
      assert.equal(sql(`SELECT phase FROM account_closure_attempts WHERE user_id='${a.user}'`),'pending');
      assert.equal(sql(`SELECT count(*) FROM ai_suggestion_authority_receipts WHERE user_id='${a.user}'`),'1');
      assert.deepEqual(json(persist(a)),JSON.parse(payload)); // lost-reply recovery, no second mutation/provider
      assert.throws(()=>sql(persist(a,true,payload,2)),/replay differs/);
    });
    await t.test('ambiguous attempts stay unknown even when a later usable answer is persisted',()=>{
      const a=seed();json(begin(a));json(quota(a));json(pending(a));
      assert.deepEqual(json(persist(a,false)),JSON.parse(payload));assert.equal(phase(a),'unknown');
      assert.deepEqual(json(persist(a,true)),JSON.parse(payload));assert.equal(phase(a),'unknown');
      assert.equal(sql(outcome(a,'refused')),'f');assert.equal(phase(a),'unknown');
      assert.throws(()=>sql(remove(a)),/foreign key constraint|coaching operation unsettled/);
    });
    await t.test('definitive refusal, unknown transport and duplicated identities cannot reopen or replay',()=>{
      for(const value of ['refused','unknown']){
        const a=seed();json(begin(a));assert.equal(sql(outcome(a,value)),'t');
        assert.equal(sql(outcome(a,value)),'t');assert.equal(phase(a),value);
        assert.equal(json(begin(a)).admitted,false);
        assert.equal(sql(outcome(a,value==='unknown'?'refused':'unknown')),'f');
      }
    });
    await t.test('wrong account/session/operation and unbacked quota cannot settle a take',()=>{
      const a=seed(),b=seed();json(begin(a));json(quota(a));
      assert.equal(sql(outcome({...a,user:b.user},'refused')),'f');
      assert.equal(sql(outcome({...a,session:b.session},'unknown')),'f');
      assert.throws(()=>sql(persist({...a,operation:b.operation})),/unadmitted/);
      assert.throws(()=>sql(persist(a,true,payload,2)),/quota receipt/);
      assert.equal(phase(a),'admitted');assert.equal(sql(`SELECT ai_suggestions IS NULL FROM sessions WHERE id='${a.session}'`),'t');
      assert.equal(sql(`SELECT count(*) FROM ai_suggestion_authority_receipts WHERE user_id='${a.user}'`),'0');
    });
    await t.test('terminal-only Auth cleanup cascades every owned row with zero ledger residue',()=>{
      for(const terminal of ['completed','refused']){
        const a=seed();json(begin(a));
        if(terminal==='completed'){json(quota(a));json(persist(a));}else sql(outcome(a,'refused'));
        assert.equal(phase(a),terminal);sql(remove(a));
        assert.ok(Object.values(remaining(a)).every(count=>count===0));
      }
    });
    await t.test('unsettled and mixed rows abort the WHOLE parent deletion, including saved unknown',()=>{
      for(const unsettled of ['admitted','unknown','unknown_saved'])for(const mixed of [false,true]){
        const a=seed();json(begin(a));
        if(unsettled==='unknown')sql(outcome(a,'unknown'));
        if(unsettled==='unknown_saved'){json(quota(a));json(persist(a,false));}
        if(mixed){
          const terminal={...a,operation:`b8040000-0000-4000-8000-${String(index).padStart(12,'0')}`};
          json(begin(terminal));sql(outcome(terminal,'refused'));
        }
        const before=remaining(a);const saved=sql(`SELECT ai_suggestions FROM sessions WHERE id='${a.session}'`);
        assert.throws(()=>sql(remove(a)),/coaching operation unsettled/);
        assert.deepEqual(remaining(a),before);
        assert.equal(sql(`SELECT ai_suggestions FROM sessions WHERE id='${a.session}'`),saved);
        assert.equal(phase(a),unsettled==='admitted'?'admitted':'unknown');
      }
    });
    for(const operation of ['admission','settlement'])for(const commit of [false,true]){
      await t.test(`${operation} first versus Auth deletion: ${commit?'commit':'rollback'}`,async()=>{
        const a=seed();if(operation==='settlement'){json(begin(a));json(quota(a));}
        const name=`coaching_operation_first_${index}`;const other=`coaching_delete_wait_${index}`;
        const holder=client(name,`BEGIN; ${operation==='admission'?begin(a):persist(a)};`,true);
        await waitFor(()=>idle(name));const waiter=client(other,remove(a)+';');
        await waitFor(()=>waiter.exited||blocked(other,name));const observedBlock=blocked(other,name);
        holder.child.stdin.end(`${commit?'COMMIT':'ROLLBACK'};\n`);
        const h=await holder.done,w=await waiter.done;
        receipts.push({race:'operation-first-vs-auth',operation,commit,observedBlock,holder:h,waiter:w});
        assert.equal(h.code,0,h.stderr);assert.equal(observedBlock,true);
        const shouldDelete=operation==='settlement'?commit:!commit;
        if(shouldDelete){assert.equal(w.code,0,w.stderr);assert.ok(Object.values(remaining(a)).every(n=>n===0));}
        else {assert.notEqual(w.code,0);assert.match(w.stderr,/55000:.*coaching operation unsettled/);
          assert.equal(remaining(a)['auth.users'],1);assert.equal(remaining(a).sessions,1);assert.equal(phase(a),'admitted');}
      });
    }
    for(const commit of [false,true]){
      await t.test(`Auth deletion first versus admission: ${commit?'commit':'rollback'}`,async()=>{
        const a=seed(),name=`coaching_auth_first_${index}`,other=`coaching_admit_wait_${index}`;
        const holder=client(name,`BEGIN; ${remove(a)};`,true);await waitFor(()=>idle(name));
        const waiter=client(other,begin(a)+';');await waitFor(()=>waiter.exited||blocked(other,name));
        const observedBlock=blocked(other,name);holder.child.stdin.end(`${commit?'COMMIT':'ROLLBACK'};\n`);
        const h=await holder.done,w=await waiter.done;
        receipts.push({race:'auth-deletion-first-vs-admission',commit,observedBlock,holder:h,waiter:w});
        assert.equal(h.code,0,h.stderr);assert.equal(w.code,0,w.stderr);assert.equal(observedBlock,true);
        const result=JSON.parse(w.stdout.trim().split('\n').at(-1));assert.equal(result.admitted,!commit);
        if(commit)assert.ok(Object.values(remaining(a)).every(n=>n===0));else assert.equal(phase(a),'admitted');
      });
    }
    for(const operation of ['admission'])for(const release of ['rollback','delete']){
      await t.test(`Auth row lock first versus ${operation}: ${release}, record actual cross-order aborts`,async()=>{
        const a=seed();if(operation==='settlement'){json(begin(a));json(quota(a));}
        const name=`coaching_auth_lock_${index}`,other=`coaching_cross_wait_${index}`;
        // This is the real parent-row lock taken by Auth deletion, stopped BEFORE its cascades.
        const holder=client(name,`BEGIN; SELECT id FROM auth.users WHERE id='${a.user}' FOR UPDATE;`,true);
        await waitFor(()=>idle(name));const waiter=client(other,(operation==='admission'?begin(a):persist(a))+';');
        await waitFor(()=>waiter.exited||blocked(other,name));const observedBlock=blocked(other,name);
        holder.child.stdin.end(release==='rollback'?'ROLLBACK;\n':`${remove(a)}; COMMIT;\n`);
        const h=await holder.done,w=await waiter.done;
        receipts.push({race:'auth-parent-lock-first',operation,release,observedBlock,holder:h,waiter:w});
        assert.equal(observedBlock,true);
        if(release==='rollback'){
          assert.equal(h.code,0,h.stderr);assert.equal(w.code,0,w.stderr);
          assert.equal(phase(a),operation==='admission'?'admitted':'completed');
        }else{
          // Parent-first Auth deletion and profile-first RPC can deadlock. Permit only the
          // documented deadlock victim and unsettled guard errors, never an unclassified failure.
          assert.match(h.stderr+w.stderr,/40P01:/);
          for(const result of [h,w])if(result.code!==0)assert.match(result.stderr,/40P01:|55000:.*coaching operation unsettled/);
          const left=remaining(a);
          if(left['auth.users']===0){assert.equal(operation,'admission');assert.notEqual(w.code,0);
            assert.ok(Object.values(left).every(n=>n===0));}
          else {assert.equal(left['auth.users'],1);assert.equal(left.sessions,1);
            if(operation==='admission'){assert.equal(w.code,0,w.stderr);assert.equal(phase(a),'admitted');}
            else assert.equal(phase(a),w.code===0?'completed':'admitted');}
        }
      });
    }
    for(const commit of [false,true]){
      await t.test(`actual Auth deletion starts before settlement: ${commit?'commit':'rollback'}, cascade barrier`,async()=>{
        const a=seed();json(begin(a));json(quota(a));const key=900000+index;
        const gateName=`coaching_gate_${index}`,authName=`coaching_deleting_${index}`,settleName=`coaching_settling_${index}`;
        const gate=client(gateName,`BEGIN; SELECT pg_advisory_xact_lock(${key});`,true);await waitFor(()=>idle(gateName));
        // Actual DELETE has started and holds its Auth row; the fixture-only trigger stops it
        // before cascades, allowing the real settlement RPC to reach its own transaction barrier.
        const auth=client(authName,`BEGIN; SET LOCAL coaching_test.delete_barrier='${key}'; ${remove(a)}; COMMIT;`);
        await waitFor(()=>blocked(authName,gateName));
        const settler=client(settleName,`BEGIN; ${persist(a)};`,true);await waitFor(()=>idle(settleName));
        gate.child.stdin.end('COMMIT;\n');const g=await gate.done;
        await waitFor(()=>auth.exited||blocked(authName,settleName));const observedBlock=blocked(authName,settleName);
        settler.child.stdin.end(`${commit?'COMMIT':'ROLLBACK'};\n`);
        const s=await settler.done,h=await auth.done;
        receipts.push({race:'actual-auth-delete-first-vs-settlement',commit,observedBlock,gate:g,settler:s,auth:h});
        assert.equal(g.code,0,g.stderr);assert.equal(s.code,0,s.stderr);assert.equal(observedBlock,true);
        if(commit){assert.equal(h.code,0,h.stderr);assert.ok(Object.values(remaining(a)).every(n=>n===0));}
        else {assert.notEqual(h.code,0);assert.match(h.stderr,/55000:.*coaching operation unsettled/);
          assert.equal(remaining(a)['auth.users'],1);assert.equal(remaining(a).sessions,1);assert.equal(phase(a),'admitted');}
      });
    }
    await t.test('rollback releases the account boundary without orphaned admission',async()=>{
      const a=seed();const holder=client('coaching_rollback',`BEGIN; ${begin(a)};`,true);
      await waitFor(()=>idle('coaching_rollback'));const waiter=client('coaching_rollback_pending',pending(a)+';');
      await waitFor(()=>blocked('coaching_rollback_pending','coaching_rollback'));
      holder.child.stdin.end('ROLLBACK;\n');assert.equal((await holder.done).code,0);
      const result=await waiter.done;assert.equal(result.code,0,result.stderr);
      assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).phase,'pending');assert.equal(phase(a),'');
    });
  }finally{
    for(const c of clients)if(!c.child.stdin.destroyed)c.child.stdin.end();
    if(started)execFileSync('pg_ctl',['-D',data,'-w','stop','-m','immediate'],{encoding:'utf8'});
    await Promise.allSettled(clients.map(c=>c.done));
    mkdirSync('artifacts/account-coaching-admission',{recursive:true});
    const files=[source,'tests/db/account-coaching-admission-realpg.mjs','tests/db/account-coaching-admission-invariants.sql',
      `backend/supabase/migrations/${quotaMigration}`,`backend/supabase/migrations/${authorityMigration}`];
    writeFileSync('artifacts/account-coaching-admission/receipts.json',JSON.stringify({createdAt:new Date().toISOString(),
      boundary:'native PostgreSQL; actual pending/quota/authority SQL; fixture Auth/signup; zero hosted/provider calls',
      hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')])),advisors,receipts},null,2)+'\n');
    rmSync(root,{recursive:true,force:true});
  }
});
