// @vitest-environment node
// PostgreSQL WASM execution, not native concurrency or hosted/provider acceptance.
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { completionBootstrap } from './account-completion-fixture.mjs';
import { completePendingAccount, type CompletionPorts } from '../../backend/supabase/functions/_shared/accountClosureCompletion';
import { createAccountCompletionRpc, type CompletionBinding } from '../../backend/supabase/functions/_shared/accountClosureCompletionAdapter';
import { createAccountCompletionStatus } from '../../backend/supabase/functions/_shared/accountClosureCompletionStatus';

const migration='backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const scope='a'.repeat(64);
let db:PGlite, index=0, initialEnabled:unknown;
type Account={user:string;lease:string;hash:string;request:string;execution?:string};
const sql=async(text:string)=>{await db.exec('RESET ROLE');return db.exec(text);};
const value=async<T=unknown>(text:string):Promise<T>=>{
  const result=await sql(text);const rows=result.at(-1)?.rows;
  return Object.values(rows?.[0]??{})[0] as T;
};
const service=(text:string)=>`SET ROLE service_role; ${text}`;
const as=(a:Account,text:string)=>`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
const claim=(a:Account)=>value<Record<string,unknown>|null>(service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`));
const args=(a:Account)=>`'${a.user}','${a.request}','${a.execution}','${scope}'`;
const inspect=(a:Account)=>value<{phase:string}|null>(service(`SELECT inspect_account_pending_completion_v1(${args(a)})`));
const begin=(a:Account,key:string)=>value<{phase:string}|null>(service(`SELECT begin_account_completion_stage_v1(${args(a)},'${key}')`));
const finish=(a:Account,key:string,outcome='completed')=>value<{phase:string}|null>(service(`SELECT finish_account_completion_stage_v1(${args(a)},'${key}','${outcome}')`));
const complete=(a:Account)=>value<{phase:string}|null>(service(`SELECT complete_account_pending_completion_v1(${args(a)})`));
const statusHash=(a:Account)=>'c'+a.hash.slice(1);
const issueStatus=async(a:Account,hash=statusHash(a))=>{
  const issued=await value<{requestId:string;expiresAt:number}|null>(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${hash}')`));
  return issued!==null&&issued.requestId===a.request&&issued.expiresAt>Date.now();
};
const ackStatus=(a:Account,hash=statusHash(a))=>value<boolean>(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${hash}')`));
const readStatus=(a:Account,hash=statusHash(a),binding=scope)=>value<Record<string,unknown>|null>(service(`SELECT read_account_completion_status_v1('${a.request}','${hash}','${binding}')-'expiresAt'`));
const databaseClient=()=>({rpc:async(name:string,args:Record<string,unknown>)=>{
  await db.exec('RESET ROLE; SET ROLE service_role');
  const entries=Object.entries(args);
  const query=`SELECT public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) AS result`;
  try {const result=await db.query<{result:unknown}>(query,entries.map(([,v])=>v));return {data:result.rows[0]?.result,error:null};}
  catch {return {data:null,error:{code:'synthetic_sql_failed'}};}
}});
const statusWrapper=(a:Account)=>createAccountCompletionStatus({projectId:'status-fixture',environment:'disposable',url:'http://127.0.0.1:54321',scopeDigest:scope},{
  currentBinding:async()=>({projectId:'status-fixture',environment:'disposable',url:'http://127.0.0.1:54321',scopeDigest:scope}),
  createAdminClient:databaseClient,
  // Explicit synthetic Auth SDK port; SQL still checks current real fixture identity.
  authenticate:async()=>({data:{user:{id:a.user}},error:null}),
});
const statusRequest=()=>new Request('http://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-auth-port'}});
async function seed(coverage=true,pending=true):Promise<Account>{
  const suffix=String(++index).padStart(12,'0');
  const a={user:`b9110000-0000-4000-8000-${suffix}`,lease:`b9120000-0000-4000-8000-${suffix}`,hash:String(index).padStart(64,'a'),request:''};
  await sql(`INSERT INTO auth.users VALUES('${a.user}','wasm-${index}@example.test',now());
    SET ROLE service_role; SELECT issue_account_closure_pending_token('${a.user}','${a.hash}');`);
  a.request=await value<string>(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
  if(pending)await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
  if(coverage)await sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
    'synthetic WASM fixture legacy coverage','synthetic WASM fixture portal settlement')`);
  return a;
}
// The selected claim prerequisite: the owner holds an acknowledged, unexpired status capability for this request.
async function ready(a:Account){expect(await issueStatus(a)).toBe(true);expect(await ackStatus(a)).toBe(true);}
async function own(a:Account){await ready(a);const grant=await claim(a);expect(grant?.executionId).toBeTypeOf('string');return {...a,execution:grant!.executionId as string};}
async function finishedEffects(a:Account){
  for(const key of ['retain_trial','remove_storage','delete_auth']){
    await begin(a,key);
    // Execute the existing private retention policy as the declared fixture owner.
    // This is actual SQL, not a provider call or a production service credential.
    if(key==='retain_trial')await sql(`SET ROLE closure_owner; SELECT preserve_account_trial_email('${a.user}')`);
    await finish(a,key);
  }
  await sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
}

function controller(a:Account, options:{residue?:boolean;lostTerminalReply?:boolean}={}){
  let authDeletes=0;
  const ports:CompletionPorts={
    now:Date.now,currentScopeDigest:async()=>scope,
    claim:async()=>{const grant=await claim(a);if(typeof grant?.executionId==='string')a.execution=grant.executionId;return grant;},
    inspect:async()=>inspect(a),beginStage:async(_grant,key)=>begin(a,key),
    finishStage:async(_grant,key,outcome)=>finish(a,key,outcome),
    complete:async()=>{const result=await complete(a);if(options.lostTerminalReply)throw Error('synthetic reply lost after SQL commit');return result;},
    policy:()=>({
      now:Date.now,
      verifyCheckouts:async()=>!await value<boolean>(`SELECT EXISTS(SELECT 1 FROM account_checkout_operations WHERE user_id='${a.user}' AND phase<>'settled')`),
      listSubscriptions:async()=>{throw Error('Free fixture must not call provider');},
      cancelSubscription:async()=>{throw Error('Free fixture must not call provider');},
      settleBilling:async()=>{throw Error('Free fixture must not call provider');},
      deleteCustomer:async()=>{throw Error('Free fixture must not call provider');},
      preserveTrialEmail:async()=>{await sql(`SET ROLE closure_owner; SELECT preserve_account_trial_email('${a.user}')`);},
      removeOwnedStorage:async()=>{await sql(`DELETE FROM storage.objects WHERE owner_id='${a.user}' OR name LIKE '${a.user}/%'`);},
      deleteAuthUser:async()=>{
        await sql(`DELETE FROM auth.users WHERE id='${a.user}'`);authDeletes++;
        if(options.residue)await sql(`INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('synthetic','late-owned-residue','${a.user}')`);
        return {deleted:true};
      },
    }),
  };
  return {ports,authDeletes:()=>authDeletes};
}

beforeAll(async()=>{db=new PGlite();await db.exec(completionBootstrap());await db.exec(readFileSync(migration,'utf8'));
  initialEnabled=await value('SELECT enabled FROM account_completion_configuration');},30000);
beforeEach(async()=>{await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);});
afterAll(async()=>{await db?.close();});

describe('inactive completion SQL: actual migration semantics in PGlite',()=>{
  it('composes the owner/status wrapper through actual SQL and reads after actual Auth deletion',async()=>{
    const a=await seed(),wrapper=statusWrapper(a);
    const issued=await wrapper.issue(statusRequest(),{requestId:a.request});
    expect(issued.outcome).toBe('status_capability');if(issued.outcome!=='status_capability')throw Error('fixture issue failed');
    const proof={requestId:a.request,token:issued.token};
    expect(await wrapper.read(proof)).toEqual({outcome:'unavailable',canRetry:false});
    expect(await wrapper.acknowledge(statusRequest(),proof)).toEqual({outcome:'status_acknowledged',requestId:a.request});
    const stored=await value<string>(`SELECT token_hash FROM account_completion_status_capabilities WHERE user_id='${a.user}'`);
    expect(stored).not.toBe(issued.token);expect(stored).toMatch(/^[a-f0-9]{64}$/);
    const c=controller(a);expect((await completePendingAccount({userId:a.user,requestId:a.request},c.ports)).outcome).toBe('completed');
    expect(await wrapper.read(proof)).toEqual({outcome:'completed',requestId:a.request,accountDeleted:true,canRetry:false});
    expect(await wrapper.issue(statusRequest(),{requestId:a.request})).toEqual({outcome:'unavailable',canRetry:false});
    expect(await wrapper.acknowledge(statusRequest(),proof)).toEqual({outcome:'unavailable',canRetry:false});
    expect(c.authDeletes()).toBe(1);
  });
  it('recovers an unacknowledged lost issuance reply without extending its deadline or replacing an acknowledged key',async()=>{
    const a=await seed(),wrapper=statusWrapper(a);
    const lost=await wrapper.issue(statusRequest(),{requestId:a.request});
    expect(lost.outcome).toBe('status_capability');if(lost.outcome!=='status_capability')throw Error('fixture issue failed');
    const received=await wrapper.issue(statusRequest(),{requestId:a.request});
    expect(received.outcome).toBe('status_capability');if(received.outcome!=='status_capability')throw Error('fixture recovery failed');
    expect(received.expiresAt).toBe(lost.expiresAt);expect(received.token).not.toBe(lost.token);
    const proof={requestId:a.request,token:received.token};
    expect(await wrapper.acknowledge(statusRequest(),{requestId:a.request,token:lost.token})).toEqual({outcome:'unavailable',canRetry:false});
    expect(await wrapper.acknowledge(statusRequest(),proof)).toEqual({outcome:'status_acknowledged',requestId:a.request});
    expect(await wrapper.issue(statusRequest(),{requestId:a.request})).toEqual({outcome:'unavailable',canRetry:false});
    expect(await wrapper.read(proof)).toMatchObject({outcome:'pending',reason:'ready'});
    expect(await value(`SELECT count(*)::int FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe(0);
  });
  it('composes the pinned RPC adapter with actual SQL capability issue, ack and post-Auth read',async()=>{
    const a=await seed();
    const target:CompletionBinding={projectId:'status-fixture',environment:'disposable',url:'http://127.0.0.1:54321',scopeDigest:scope};
    const transport=createAccountCompletionRpc(target,{
      currentBinding:async()=>structuredClone(target),
      createAdminClient:databaseClient,
    });
    const identity={p_user_id:a.user,p_request_id:a.request,p_scope_digest:scope,p_token_hash:statusHash(a)};
    expect(await transport.rpc('issue_account_completion_status_v1',identity)).toMatchObject({requestId:a.request});
    expect(await transport.rpc('acknowledge_account_completion_status_v1',identity)).toBe(true);
    const c=controller(a);expect((await completePendingAccount({userId:a.user,requestId:a.request},c.ports)).outcome).toBe('completed');
    expect(await transport.rpc('read_account_completion_status_v1',{
      p_request_id:a.request,p_token_hash:statusHash(a),p_scope_digest:scope,
    })).toMatchObject({outcome:'completed',requestId:a.request,accountDeleted:true,canRetry:false,expiresAt:expect.any(Number)});
    expect(c.authDeletes()).toBe(1);
  });
  it('issues a hash-only read capability and requires its exact owner acknowledgment',async()=>{
    const a=await seed();
    expect(await issueStatus(a)).toBe(true);
    expect(await readStatus(a)).toBeNull();
    expect(await ackStatus(a)).toBe(true);
    expect(await readStatus(a)).toEqual({outcome:'pending',requestId:a.request,reason:'ready',canRetry:false});
    expect(await value(`SELECT token_hash FROM account_completion_status_capabilities WHERE user_id='${a.user}'`)).toBe(statusHash(a));
    expect(await value(`SELECT count(*)::int FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe(0);
    expect(await value(`SELECT phase FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe('pending');
  });
  it('wrong key, request, scope, disabled configuration and expired capability reveal no status',async()=>{
    const a=await seed(),b=await seed();await issueStatus(a);await ackStatus(a);
    expect(await readStatus(a,'d'.repeat(64))).toBeNull();
    expect(await readStatus({...a,request:b.request})).toBeNull();
    expect(await readStatus(a,statusHash(a),'d'.repeat(64))).toBeNull();
    await sql('UPDATE account_completion_configuration SET enabled=false');expect(await readStatus(a)).toBeNull();
    await sql(`UPDATE account_completion_configuration SET enabled=true; UPDATE account_completion_status_capabilities SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${a.user}'`);
    expect(await readStatus(a)).toBeNull();expect(await issueStatus(a)).toBe(false);
  });
  it('read capability issuance and acknowledgment preserve the original deadline',async()=>{
    const a=await seed();await issueStatus(a);
    const expiry=await value(`SELECT expires_at::text FROM account_completion_status_capabilities WHERE user_id='${a.user}'`);
    expect(await issueStatus(a)).toBe(true);
    expect(await ackStatus(a)).toBe(true);expect(await ackStatus(a)).toBe(true);
    expect(await issueStatus(a,'d'.repeat(64))).toBe(false);
    expect(await value(`SELECT expires_at::text FROM account_completion_status_capabilities WHERE user_id='${a.user}'`)).toBe(expiry);
  });
  it('post-Auth capability reports durable completion without a JWT and cannot be renewed',async()=>{
    const a=await seed();await issueStatus(a);await ackStatus(a);
    const c=controller(a);expect((await completePendingAccount({userId:a.user,requestId:a.request},c.ports)).outcome).toBe('completed');
    expect(await readStatus(a)).toEqual({outcome:'completed',requestId:a.request,accountDeleted:true,canRetry:false});
    expect(await issueStatus(a)).toBe(false);expect(await ackStatus(a)).toBe(false);
    expect(c.authDeletes()).toBe(1);
  });
  it('unknown Auth intent and expired executor stay verification-pending, never dispatch or complete',async()=>{
    const a=await seed();await issueStatus(a);await ackStatus(a);const g=await own(a);
    expect(await readStatus(a)).toEqual({outcome:'processing',requestId:a.request,canRetry:false});
    await begin(g,'delete_auth');await finish(g,'delete_auth','unknown');
    expect(await readStatus(a)).toEqual({outcome:'verification_pending',requestId:a.request,reason:'auth_unknown',canRetry:false});
    const b=await seed();await issueStatus(b);await ackStatus(b);await own(b);
    await sql(`UPDATE account_completion_executions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${b.user}'`);
    expect(await readStatus(b)).toEqual({outcome:'verification_pending',requestId:b.request,reason:'execution_expired',canRetry:false});
    expect(await value(`SELECT count(*)::int FROM account_completion_stages WHERE execution_id='${g.execution}'`)).toBe(1);
  });
  it('pending reason distinguishes missing coverage and admitted save debt without checkout-zero inference',async()=>{
    const a=await seed(false);await issueStatus(a);await ackStatus(a);
    expect(await readStatus(a)).toMatchObject({outcome:'pending',reason:'coverage_unverified'});
    const b=await seed();await issueStatus(b);await ackStatus(b);
    await sql(`INSERT INTO account_save_obligations(user_id,lease_id) VALUES('${b.user}','${b.lease}')`);
    expect(await readStatus(b)).toMatchObject({outcome:'pending',reason:'save_unsettled'});
  });
  it('status distinguishes unsettled checkout and unknown coaching without changing either ledger',async()=>{
    const a=await seed(true,false);
    await value(service(`SELECT begin_account_checkout('${a.user}')`));
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    await issueStatus(a);await ackStatus(a);
    expect(await readStatus(a)).toMatchObject({outcome:'pending',reason:'checkout_unsettled'});
    const b=await seed();await issueStatus(b);await ackStatus(b);
    await sql(`INSERT INTO account_coaching_operations(operation_id,user_id,session_id,phase) VALUES(gen_random_uuid(),'${b.user}',gen_random_uuid(),'unknown')`);
    expect(await readStatus(b)).toMatchObject({outcome:'pending',reason:'coaching_unsettled'});
    expect(await value(`SELECT phase FROM account_coaching_operations WHERE user_id='${b.user}'`)).toBe('unknown');
  });
  it('unknown non-Auth stage reads verification-pending without completing or redispatching it',async()=>{
    const a=await seed();await issueStatus(a);await ackStatus(a);const g=await own(a);
    await begin(g,'remove_storage');await finish(g,'remove_storage','unknown');
    expect(await readStatus(a)).toMatchObject({outcome:'verification_pending',reason:'operation_unknown'});
    expect((await begin(g,'remove_storage'))?.phase).toBe('unknown');
    expect(await value(`SELECT phase FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe('processing');
  });
  it('completed status rechecks canonical residue instead of trusting a journal label alone',async()=>{
    const a=await seed();await issueStatus(a);await ackStatus(a);const c=controller(a);
    expect((await completePendingAccount({userId:a.user,requestId:a.request},c.ports)).outcome).toBe('completed');
    await sql(`INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('synthetic','late-status-residue','${a.user}')`);
    expect(await readStatus(a)).toMatchObject({outcome:'verification_pending',reason:'completion_unverified'});
    expect(c.authDeletes()).toBe(1);
  });
  it('live owner email drift cannot issue or acknowledge a status capability',async()=>{
    const a=await seed();await issueStatus(a);
    await sql(`UPDATE auth.users SET email='changed-status@example.test' WHERE id='${a.user}'`);
    expect(await ackStatus(a)).toBe(false);expect(await issueStatus(a)).toBe(false);expect(await readStatus(a)).toBeNull();
  });
  it('an acknowledged status read does not report ready after owner identity or fence drift',async()=>{
    const a=await seed();await issueStatus(a);await ackStatus(a);
    await sql(`UPDATE auth.users SET email='changed-after-ack@example.test' WHERE id='${a.user}'`);
    expect(await readStatus(a)).toMatchObject({outcome:'verification_pending',reason:'identity_unverified'});
    const b=await seed();await issueStatus(b);await ackStatus(b);
    await sql(`UPDATE account_billing_fences SET phase='open',request_id=NULL WHERE user_id='${b.user}'`);
    expect(await readStatus(b)).toMatchObject({outcome:'verification_pending',reason:'completion_unverified'});
  });
  it('status capability tables and RPCs are inaccessible to browser roles',async()=>{
    for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
      expect(await value(`SELECT has_table_privilege('${role}','account_completion_status_capabilities','${privilege}')`)).toBe(false);
    expect(await value("SELECT relrowsecurity FROM pg_class WHERE oid='account_completion_status_capabilities'::regclass")).toBe(true);
    for(const role of ['anon','authenticated'])for(const fn of [
      'issue_account_completion_status_v1(uuid,uuid,text,text)','acknowledge_account_completion_status_v1(uuid,uuid,text,text)',
      'read_account_completion_status_v1(uuid,text,text)'])expect(await value(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`)).toBe(false);
  });
  it('composes the actual controller with canonical SQL cleanup before final residue proof',async()=>{
    const a=await seed(),c=controller(a);await ready(a);
    expect(await completePendingAccount({userId:a.user,requestId:a.request},c.ports)).toMatchObject({outcome:'completed',result:{outcome:'deleted'}});
    expect(await value(`SELECT phase FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe('completed');
    expect(await value(`SELECT count(*)::int FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe(0);
    expect(c.authDeletes()).toBe(1);
  });
  it('actual controller plus SQL keeps residual storage and the closing fence unresolved',async()=>{
    const a=await seed(),c=controller(a,{residue:true});await ready(a);
    expect((await completePendingAccount({userId:a.user,requestId:a.request},c.ports)).outcome).toBe('hold');
    expect(await value(`SELECT phase FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe('processing');
    expect(await value(`SELECT phase FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe('closing');
    expect(c.authDeletes()).toBe(1);
  });
  it('lost terminal SQL reply keeps durable completion and never repeats Auth deletion',async()=>{
    const a=await seed(),c=controller(a,{lostTerminalReply:true});await ready(a);
    const request={userId:a.user,requestId:a.request};
    expect((await completePendingAccount(request,c.ports)).outcome).toBe('hold');
    expect(await value(`SELECT phase FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe('completed');
    expect((await completePendingAccount(request,c.ports)).outcome).toBe('hold');
    expect(c.authDeletes()).toBe(1);
  });
  it('defaults disabled and keeps tables/private helpers inaccessible to clients',async()=>{
    expect(initialEnabled).toBe(false);
    await sql('UPDATE account_completion_configuration SET enabled=false');
    const a=await seed();expect(await claim(a)).toBeNull();
    expect(await value('SELECT enabled FROM account_completion_configuration')).toBe(false);
    for(const role of ['anon','authenticated','service_role'])for(const table of [
      'account_completion_configuration','account_completion_coverage','account_save_obligations','account_completion_executions','account_completion_stages']){
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
        expect(await value(`SELECT has_table_privilege('${role}','${table}','${privilege}')`)).toBe(false);
      expect(await value(`SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass`)).toBe(true);
    }
    for(const role of ['anon','authenticated'])for(const fn of [
      'claim_account_pending_completion_v1(uuid,uuid,text)','inspect_account_pending_completion_v1(uuid,uuid,uuid,text)',
      'begin_account_completion_stage_v1(uuid,uuid,uuid,text,text)','finish_account_completion_stage_v1(uuid,uuid,uuid,text,text,text)',
      'complete_account_pending_completion_v1(uuid,uuid,uuid,text)','_account_completion_lock_v1(uuid,uuid,uuid,text)'])
      expect(await value(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`)).toBe(false);
    await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);
  });
  // #1684 Codex P1 r4352097795: a worker claim must not overtake the client's status acknowledgment, or the ACK is refused
  // (an execution exists) and the unacknowledged capability can never read the deletion result after Auth deletion.
  it('does not claim before the status capability is acknowledged; claims once it is, and the result stays readable',async()=>{
    const a=await seed();
    expect(await issueStatus(a)).toBe(true);
    expect(await claim(a),'no claim while the status capability is unacknowledged').toEqual({outcome:'pending'});
    expect(await value(`SELECT count(*)::int FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe(0);
    expect(await ackStatus(a),'the owner can still acknowledge').toBe(true);
    expect((await claim(a))?.executionId).toBeTypeOf('string');
    expect(await readStatus(a)).not.toBeNull();
  });
  it('without an acknowledged, unexpired capability for exactly this request and scope, claim stays pending',async()=>{
    const pending={outcome:'pending'};
    const none=await seed();
    expect(await claim(none),'no capability').toEqual(pending);
    const unacked=await seed();expect(await issueStatus(unacked)).toBe(true);
    expect(await claim(unacked),'issued but unacknowledged').toEqual(pending);
    const expired=await seed();await ready(expired);
    await sql(`UPDATE account_completion_status_capabilities SET expires_at=now()-interval '1 second' WHERE user_id='${expired.user}'`);
    expect(await claim(expired),'acknowledged but expired').toEqual(pending);
    const scoped=await seed();await ready(scoped);
    await sql(`UPDATE account_completion_status_capabilities SET scope_digest='${'b'.repeat(64)}' WHERE user_id='${scoped.user}'`);
    expect(await claim(scoped),'acknowledged for another scope').toEqual(pending);
    const other=await seed();await ready(other);
    await sql(`UPDATE account_completion_status_capabilities SET request_id=gen_random_uuid() WHERE user_id='${other.user}'`);
    expect(await claim(other),'acknowledged for another request').toEqual(pending);
    expect(await value(`SELECT count(*)::int FROM account_completion_executions WHERE user_id IN
      ('${none.user}','${unacked.user}','${expired.user}','${scoped.user}','${other.user}')`)).toBe(0);
  });
  it('requires exact pending account/request, coverage and account-specific settled work',async()=>{
    const a=await seed(false),b=await seed();
    expect(await claim(a)).toEqual({outcome:'pending'});expect(await claim({...a,request:b.request})).toBeNull();
    await sql(`INSERT INTO account_save_obligations(user_id,lease_id) VALUES('${a.user}','${a.lease}')`);
    await ready(b);expect((await claim(b))?.executionId).toBeTypeOf('string');expect(await claim(a)).toEqual({outcome:'pending'});
  });
  it('requires checkout settlement and retains claim despite legacy finish/replay',async()=>{
    const a=await seed(true,false);
    const operation=await value(service(`SELECT begin_account_checkout('${a.user}')`));
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    expect(await claim(a)).toEqual({outcome:'pending'});
    expect(await value(service(`SELECT reconcile_rejected_account_checkout('${a.user}','${operation}','req_fixture','parameter_missing','line_items')`))).toBe(true);
    const g=await own(a);await sql(service(`SELECT finish_account_closure_attempt('${a.user}','${a.request}')`));
    expect((await inspect(g))?.phase).toBe('processing');expect(await claim(a)).toBeNull();
  });
  it.each([null,''])('paid account with missing customer identity %s cannot receive completion authority',async customer=>{
    const a=await seed(true,false);
    await sql(`UPDATE user_profiles SET subscription_status='pro',stripe_customer_id=${customer===null?'NULL':"''"} WHERE id='${a.user}'`);
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    expect(await claim(a)).toBeNull();
  });
  it('preserves a valid paid customer identity in the claimed proof',async()=>{
    const a=await seed(true,false);
    await sql(`UPDATE user_profiles SET subscription_status='pro',stripe_customer_id='cus_synthetic_control' WHERE id='${a.user}'`);
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));await ready(a);
    expect(await claim(a)).toMatchObject({proof:{userId:a.user,requestId:a.request,customerId:'cus_synthetic_control'}});
  });
  it.each(['changed-email','unconfirmed-email','missing-auth'])('authority holds after %s identity drift',async mode=>{
    const a=await own(await seed());
    if(mode==='changed-email')await sql(`UPDATE auth.users SET email='changed-${index}@example.test' WHERE id='${a.user}'`);
    if(mode==='unconfirmed-email')await sql(`UPDATE auth.users SET email_confirmed_at=NULL WHERE id='${a.user}'`);
    if(mode==='missing-auth')await sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
    expect(await inspect(a)).toBeNull();
    expect(await begin(a,'retain_trial')).toBeNull();
  });
  it('release cannot settle an admitted save; actual atomic save and exact lost-reply replay can',async()=>{
    const a=await seed(true,false);
    expect(await value(as(a,`SELECT acquire_recording_lease('${a.lease}')`))).toMatchObject({acquired:true});
    const row=await value<{new_session:{id:string}}>(as(a,`SELECT create_session_and_update_usage('{"title":"synthetic","duration":0,"lease_id":"${a.lease}"}'::jsonb,'private')`));
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));await ready(a);
    expect(await claim(a)).toEqual({outcome:'pending'});
    expect(await value(as(a,`SELECT release_recording_lease('${a.lease}')`))).toMatchObject({released:true});
    expect(await value(`SELECT count(*)::int FROM active_recording_lease WHERE user_id='${a.user}'`)).toBe(0);
    expect(await claim(a)).toEqual({outcome:'pending'});
    await expect(sql(`DELETE FROM auth.users WHERE id='${a.user}'`)).rejects.toThrow('admitted save unsettled');
    const save=as(a,`SELECT complete_session_v2('${row.new_session.id}','completed',30,NULL,
      '{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'synthetic saved words')`);
    expect(await value(save)).toMatchObject({success:true});expect(await value(save)).toMatchObject({success:true});
    expect(await value(`SELECT phase FROM account_save_obligations WHERE user_id='${a.user}'`)).toBe('completed');
    expect((await claim(a))?.executionId).toBeTypeOf('string');
  });
  it('unmaterialized lease and unknown coaching debt survive absence and cannot authorize Auth cleanup',async()=>{
    const a=await seed(true,false);await sql(as(a,`SELECT acquire_recording_lease('${a.lease}')`));
    await sql(as(a,`SELECT release_recording_lease('${a.lease}')`));
    await sql(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    expect(await claim(a)).toEqual({outcome:'pending'});
    await expect(sql(`DELETE FROM auth.users WHERE id='${a.user}'`)).rejects.toThrow('admitted save unsettled');
    const b=await seed();await sql(`INSERT INTO account_coaching_operations(operation_id,user_id,session_id,phase)
      VALUES(gen_random_uuid(),'${b.user}',gen_random_uuid(),'unknown')`);
    expect(await claim(b)).toEqual({outcome:'pending'});
  });
  it('dispatches a stage only once and never upgrades unknown to success',async()=>{
    const a=await own(await seed()),b=await own(await seed());
    expect(await inspect({...a,execution:b.execution})).toBeNull();
    expect((await begin(a,'retain_trial'))?.phase).toBe('dispatch');
    expect((await begin(a,'retain_trial'))?.phase).toBe('started');
    expect((await finish(a,'retain_trial','unknown'))?.phase).toBe('unknown');
    expect((await finish(a,'retain_trial'))?.phase).toBe('unknown');
    expect((await begin(a,'retain_trial'))?.phase).toBe('unknown');expect(await complete(a)).toBeNull();
  });
  it('expiry/config invalidation stops effects while preserving unknown dispatch intent',async()=>{
    const a=await own(await seed());await begin(a,'retain_trial');
    await sql(`UPDATE account_completion_executions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${a.user}'`);
    expect(await inspect(a)).toBeNull();expect(await begin(a,'remove_storage')).toBeNull();
    expect(await finish(a,'retain_trial')).toBeNull();expect((await finish(a,'retain_trial','unknown'))?.phase).toBe('unknown');
    const b=await own(await seed());await begin(b,'retain_trial');
    await sql('UPDATE account_completion_configuration SET enabled=false');
    expect(await inspect(b)).toBeNull();expect(await begin(b,'remove_storage')).toBeNull();
    expect((await finish(b,'retain_trial','unknown'))?.phase).toBe('unknown');
    await sql('UPDATE account_completion_configuration SET enabled=true');
  });
  it('terminal receipt requires completed stages and actual Auth/storage absence',async()=>{
    const a=await own(await seed());expect(await complete(a)).toBeNull();
    await sql(`SET ROLE closure_owner; SELECT preserve_account_trial_email('${a.user}')`);
    for(const key of ['retain_trial','remove_storage','delete_auth']){await begin(a,key);await finish(a,key);}
    expect(await complete(a)).toBeNull();
    await sql(`DELETE FROM auth.users WHERE id='${a.user}'; INSERT INTO storage.objects VALUES('synthetic','${a.user}/residue','${a.user}')`);
    expect(await complete(a)).toBeNull();await sql(`DELETE FROM storage.objects WHERE owner_id='${a.user}'`);
    expect((await complete(a))?.phase).toBe('completed');expect(await inspect(a)).toBeNull();
    expect(await value(`SELECT count(*)::int FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe(0);
    expect(await claim(a)).toBeNull();
  });

  it.each(['missing','wrong-email','wrong-owner'])('terminal completion rejects %s retained-trial evidence',async mode=>{
    const a=await own(await seed());await finishedEffects(a);
    const email=await value<string>(`SELECT claimed_email FROM account_closure_attempts WHERE user_id='${a.user}'`);
    if(mode==='missing')await sql(`DELETE FROM trial_entitlements WHERE email='${email}'`);
    if(mode==='wrong-email')await sql(`UPDATE trial_entitlements SET email='other-${index}@example.test' WHERE email='${email}'`);
    if(mode==='wrong-owner'){
      const other=await seed();await sql(`UPDATE trial_entitlements SET user_id='${other.user}' WHERE email='${email}'`);
    }
    expect(await complete(a)).toBeNull();
    expect(await value(`SELECT phase FROM account_closure_attempts WHERE user_id='${a.user}'`)).toBe('processing');
    expect(await value(`SELECT count(*)::int FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe(1);
  });

  it('terminal completion removes only the exact settled checkout identity rows',async()=>{
    const a=await own(await seed()),b=await seed();await finishedEffects(a);
    await sql(`INSERT INTO account_checkout_operations(user_id,phase) VALUES('${a.user}','settled'),('${b.user}','settled')`);
    expect((await complete(a))?.phase).toBe('completed');
    expect(await value(`SELECT count(*)::int FROM account_checkout_operations WHERE user_id='${a.user}'`)).toBe(0);
    expect(await value(`SELECT count(*)::int FROM account_checkout_operations WHERE user_id='${b.user}'`)).toBe(1);
  });

  it('unknown checkout residue cannot be silently erased by terminal completion',async()=>{
    const a=await own(await seed());await finishedEffects(a);
    await sql(`INSERT INTO account_checkout_operations(user_id,phase) VALUES('${a.user}','unknown')`);
    expect(await complete(a)).toBeNull();
    expect(await value(`SELECT phase FROM account_checkout_operations WHERE user_id='${a.user}'`)).toBe('unknown');
    expect(await value(`SELECT count(*)::int FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe(1);
  });

  it('legacy storage owner column is checked even with a modern owner_id column present',async()=>{
    const a=await own(await seed());await finishedEffects(a);
    await sql(`ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS owner uuid;
      INSERT INTO storage.objects(bucket_id,name,owner_id,owner) VALUES('synthetic','legacy-owner-only',NULL,'${a.user}')`);
    expect(await complete(a)).toBeNull();
    expect(await value(`SELECT count(*)::int FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe(1);
    await sql(`DELETE FROM storage.objects WHERE owner='${a.user}'`);
    expect((await complete(a))?.phase).toBe('completed');
  });

  it('the canonical FK residue check rolls terminal cleanup back when a future reference remains',async()=>{
    const a=await own(await seed());await finishedEffects(a);
    await sql(`SET ROLE closure_owner; CREATE TABLE completion_future_reference_fixture(user_id uuid);
      INSERT INTO completion_future_reference_fixture VALUES('${a.user}');
      ALTER TABLE completion_future_reference_fixture ADD CONSTRAINT completion_future_reference_fk
        FOREIGN KEY(user_id) REFERENCES auth.users(id) NOT VALID;`);
    await expect(complete(a)).rejects.toThrow('account completion residue remains');
    expect(await value(`SELECT phase FROM account_completion_executions WHERE user_id='${a.user}'`)).toBe('processing');
    expect(await value(`SELECT count(*)::int FROM account_billing_fences WHERE user_id='${a.user}'`)).toBe(1);
    await sql('DELETE FROM completion_future_reference_fixture');
    expect((await complete(a))?.phase).toBe('completed');
  });
  it('uses the canonical storage lookup when the schema has only legacy owner',async()=>{
    const a=await own(await seed());await finishedEffects(a);
    await sql(`ALTER TABLE storage.objects DROP COLUMN owner_id;
      INSERT INTO storage.objects(bucket_id,name,owner) VALUES('synthetic','legacy-schema-control','${a.user}')`);
    expect(await complete(a)).toBeNull();
    await sql(`DELETE FROM storage.objects WHERE owner='${a.user}'`);
    expect((await complete(a))?.phase).toBe('completed');
  });
});
