'use strict';
// Exact source oracles with synthetic events/owner rows. No browser or live effects.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const {createOracles}=require('../oracles/index.cjs');
const owner='00000000-0000-4000-8000-000000000001';
const current={id:'00000000-0000-4000-8000-000000000002',user_id:owner,status:'active',lease_id:'00000000-0000-4000-8000-000000000003',recording_fenced_at:null,recording_fenced_reason:null};
const older={...current,id:'00000000-0000-4000-8000-000000000004',lease_id:'00000000-0000-4000-8000-000000000005',recording_fenced_at:'2026-01-01T00:00:00Z',recording_fenced_reason:'displaced'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Page extends EventEmitter{
 constructor(data){super();this.data=data;this.reads=[];this.readOverride=null;}
 locator(){return {getAttribute:async()=> 'download-required'};}
 async evaluate(_fn,args){
  if(args?.url){
   const u=new URL(args.url);this.reads.push(u);
   if(this.readOverride)return this.readOverride(u);
   const id=u.searchParams.get('id');
   return {data:structuredClone(this.data.filter(row=>!id||'eq.'+row.id===id)),error:null};
  }
  return {token:args?.token};
 }
}
function fixture(t,rows=[older,current]){
 const a=new Page(rows),b=new Page(rows);
 const c={caseId:'AHT-11',campaignId:'SYNTHETIC-NOT-A-RUN',account:{id:owner},oracleBindings:{takeoverLease:{}},readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'SYNTHETIC-NOT-A-KEY',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'private/synthetic.json'}};
 const evidence=[];
 const oracles=createOracles({caseConfig:c,writeEvidence:async(name,value)=>{evidence.push(value);return 'private/'+name;}});
 t.after(()=>oracles.dispose());
 const emit=({lease=current.lease_id,created=current,response=true,bodyReadable=true,responsePromise=null}={})=>a.emit('request',{
  url:()=>c.readback.origin+'/rest/v1/rpc/create_session_and_update_usage',method:()=> 'POST',
  postDataJSON:()=>{if(!bodyReadable)throw Error('synthetic unreadable');return {p_session_data:{lease_id:lease}};},
  response:()=>responsePromise??Promise.resolve(response?{ok:()=>true,json:async()=>({new_session:created})}:null)
 });
 return {a,b,c,oracles,evidence,emit,arm:()=>oracles.takeoverLease({phase:'before-first',page:a}),begin:()=>oracles.takeoverLease({phase:'begin',tabA:a,tabB:b})};
}
const refuses=operation=>assert.rejects(operation,e=>e.code==='NOT_RUN');
test('observed own creation binds despite unrelated historical fenced-active row',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();assert.equal((await f.begin()).observed,true);
 assert.equal(f.a.reads.length,1);assert.equal(f.a.reads[0].searchParams.get('id'),'eq.'+current.id);assert.equal(f.a.reads[0].searchParams.get('user_id'),'eq.'+owner);
 assert.equal(f.a.listenerCount('request'),0,'completed create observer detached');assert.equal(f.b.listenerCount('request'),1,'refusal window model observer retained');
});
test('legacy one-active-row guess cannot substitute for unobserved creation',async t=>{const f=fixture(t,[current]);await refuses(f.begin());assert.equal(f.a.reads.length,0);});
test('armed observer with no actual creation refuses even when one active row exists',async t=>{const f=fixture(t,[current]);await f.arm();await refuses(f.begin());assert.equal(f.a.reads.length,0);});
for(const [name,change]of [
 ['missing response',{response:false}],['unreadable request lease',{bodyReadable:false}],
 ['missing request lease',{lease:null}],['owner mismatch',{created:{...current,user_id:'other'}}],
 ['request/response lease mismatch',{created:{...current,lease_id:'other'}}],
 ['missing response identity',{created:{...current,id:null}}],['refused creation envelope',{created:null}]
])test(name+' cannot bind a guessed active row',async t=>{const f=fixture(t,[current]);await f.arm();f.emit(change);await tick();await refuses(f.begin());assert.equal(f.a.reads.length,0);});
test('multiple created sessions remain ambiguous',async t=>{const f=fixture(t);await f.arm();f.emit();f.emit({created:{...current,id:'other'}});await tick();await refuses(f.begin());});
test('idempotent repeats of the same observed identity stay bound',async t=>{const f=fixture(t);await f.arm();f.emit();f.emit();await tick();assert.equal((await f.begin()).observed,true);});
test('one observed session with inconsistent response leases refuses',async t=>{const f=fixture(t);await f.arm();f.emit();f.emit({lease:'different',created:{...current,lease_id:'different'}});await tick();await refuses(f.begin());});
test('wrong first page refuses before owner read or refusal observation',async t=>{const f=fixture(t);await f.arm();f.emit();await tick();await refuses(f.oracles.takeoverLease({phase:'begin',tabA:f.b,tabB:f.a}));assert.equal(f.a.reads.length+f.b.reads.length,0);});
test('changed owner refuses before owner read',async t=>{const f=fixture(t);await f.arm();f.emit();await tick();f.c.account.id='different';await refuses(f.begin());assert.equal(f.a.reads.length,0);});
for(const [name,rows]of [
 ['missing exact row',[]],['duplicate exact row',[current,current]],
 ['foreign exact row',[{...current,user_id:'other'}]],['wrong lease',[{...current,lease_id:'other'}]],
 ['completed row',[{...current,status:'completed'}]],['previous permanent fence',[{...current,recording_fenced_at:older.recording_fenced_at,recording_fenced_reason:'displaced'}]],
 ['missing fence columns',[{id:current.id,user_id:owner,status:'active',lease_id:current.lease_id}]]
])test(name+' refuses after actual creation observation',async t=>{const f=fixture(t,rows);await f.arm();f.emit();await tick();await refuses(f.begin());assert.equal(f.b.listenerCount('request'),0);});
test('contradictory creation arriving during exact owner read refuses',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();
 f.a.readOverride=async()=>{f.emit({created:{...current,id:'other'}});await tick();return {data:[current],error:null};};
 await refuses(f.begin());assert.equal(f.b.listenerCount('request'),0);
});
test('interrupted unsettled response cannot regain authority after disposal',async t=>{
 const f=fixture(t);let resolve;const responsePromise=new Promise(r=>resolve=r);
 await f.arm();f.emit({responsePromise});await tick();await refuses(f.begin());
 f.oracles.dispose();assert.equal(f.a.listenerCount('request'),0);
 resolve({ok:()=>true,json:async()=>({new_session:current})});await tick();await refuses(f.begin());assert.equal(f.a.reads.length,0);
});
test('disposal during owner read cannot open the refusal window',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();f.a.readOverride=()=>{f.oracles.dispose();return {data:[current],error:null};};
 await refuses(f.begin());assert.equal(f.b.listenerCount('request'),0);
});
test('completion disposes both create and model listeners without exposing identities',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();await f.begin();f.oracles.dispose();
 assert.equal(f.a.listenerCount('request'),0);assert.equal(f.b.listenerCount('request'),0);assert.deepEqual(f.evidence,[]);
});
test('a second begin cannot replace or leak the first refusal observer',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();await f.begin();await refuses(f.begin());
 assert.equal(f.b.listenerCount('request'),1);assert.equal(f.a.reads.length,1);
});
test('overlapping begins reserve before the row await and open only one window',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();
 let resolve;const read=new Promise(r=>resolve=r);f.a.readOverride=()=>read;
 const first=f.begin();await tick();const second=f.begin().then(()=>false,e=>{assert.equal(e.code,'NOT_RUN');return true;});
 await tick();const reads=f.a.reads.length;resolve({data:[current],error:null});
 assert.equal((await first).observed,true);const secondRefused=await second;
 assert.deepEqual({reads,secondRefused,modelObservers:f.b.listenerCount('request')},{reads:1,secondRefused:true,modelObservers:1});
});
test('disposal while reading model status cannot open late observation windows',async t=>{
 const f=fixture(t);await f.arm();f.emit();await tick();
 f.b.locator=()=>({getAttribute:async()=>{f.oracles.dispose();return 'download-required';}});
 let opened=0;const evaluate=f.a.evaluate.bind(f.a);f.a.evaluate=(fn,args)=>{if(!args?.url)opened++;return evaluate(fn,args);};
 await refuses(f.begin());assert.equal(opened,0);assert.equal(f.b.listenerCount('request'),0);
});
test('adapter arms on first page before first Start and retains post-baseline terminal safety',()=>{
 const source=readFileSync(require.resolve('../source-adapters.cjs'),'utf8');
 const branch=source.slice(source.indexOf("}else if(caseId==='AHT-11'){"),source.indexOf("}else if(caseId==='AHT-12'){"));
 const armed=branch.indexOf("await hook('takeoverLease','before-first')"),start=branch.indexOf('await ui.start(page)');
 assert.ok(armed>=0&&start>armed,'creation observer precedes actual first Start');
 assert.ok(branch.includes("(await rows(d)).every(r=>r.status!=='active')"),'final post-baseline no-active condition unchanged');
});

async function adapterTerminalControl({newActive=false}={}){
 const adapters=require('../source-adapters.cjs'),ui=require('../browser-actions.cjs'),observer=require('../browser-observers.cjs'),readback=require('../browser-readback.cjs');
 const patches=[],recorded=[],phases=[],made=[];let completed=false,otherClosed=false;
 const patch=(object,key,value)=>{patches.push([object,key,object[key]]);object[key]=value;};
 const page=name=>{let closed=false;const p=Object.assign(new EventEmitter(),{name,setDefaultTimeout(){},setDefaultNavigationTimeout(){},waitForTimeout:async()=>{},isClosed:()=>closed,close:async()=>{closed=true;},getByText:()=>({first(){return this;},waitFor:async()=>{},isVisible:async()=>false})});made.push(p);return p;};
 const a=page('first'),b=page('same-context'),d=page('independent'),queue=[a,b];
 const contract=adapters.CONTRACTS['AHT-11'],c={caseId:'AHT-11',campaignId:'UNIT-TERMINAL',sourceSha:adapters.SOURCE_SHA,servedSha:adapters.SOURCE_SHA,targetUrl:'https://unit.invalid',requiredAssertions:contract.rows,
  account:{id:owner,mode:'existing-disposable',preprovisionReceipt:'unit/pre.json',analyticsExclusionReceipt:'unit/analytics.json',dispositionReceipt:'unit/disposition.json',effectiveFeatureAccessApproved:true},
  readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'synthetic-public',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit/rls.json'},
  observerSourceReviewed:true,observerQualificationReceipt:'unit/observer.json',takeCap:2,startPressCap:4,fixture:{sha256:'b'.repeat(64),launchSha256:'b'.repeat(64),speechDurationMs:7000},
  oracleBindings:{takeoverLease:{sha256:'c'.repeat(64),reviewReceipt:'unit/review.json',module:'unit/takeover.cjs'}}};
 const historical={id:'historical-fenced',status:'active'},first={id:'created-first',status:'completed'},second={id:'created-second',status:'completed'};
 patch(ui,'login',async()=>true);patch(ui,'openMic',async()=>{});patch(ui,'start',async()=>{});patch(ui,'primary',async()=>{});patch(ui,'recording',async()=>{});patch(ui,'speak',async()=>{});patch(ui,'stop',async()=>{});
 patch(ui,'saved',async p=>{completed=true;return p===a?first.id:second.id;});
 patch(observer,'install',async()=>{});patch(observer,'mic',async p=>({recording:p===a,liveTracks:p===a?1:0,recorderVisible:p===a,acquisitions:0}));
 patch(readback,'sessions',async()=>[historical,...(completed?[first,second,...(newActive?[{id:'new-unclosed',status:'active'}]:[])]:[])]);
 try{
  const result=await adapters.run('AHT-11',{context:{newPage:async()=>queue.shift(),grantPermissions:async()=>{}},browser:{newContext:async()=>({newPage:async()=>d,close:async()=>{otherClosed=true;}})},guard:{summary:()=>({ledgerUsed:{model:0}})},caseConfig:c,
   capabilities:{credentials:{email:'synthetic@example.invalid',password:'synthetic-only'},recordStartPress:async()=>{},writeEvidence:async n=>n,recordAssertion:async r=>recorded.push(r),oracles:{takeoverLease:async args=>{phases.push(args.phase);return args.phase==='assert'?{observed:true,result:'PASS',contentSafe:true,evidenceRefs:['unit/synthetic-oracle.json']}:{observed:true};}}}});
  return {result,recorded,phases,closed:made.every(p=>p.isClosed()),otherClosed};
 }finally{for(const [object,key,value]of patches.reverse())object[key]=value;}
}
test('whole adapter permits unchanged historical active row excluded by its initial baseline',async()=>{
 const f=await adapterTerminalControl();assert.equal(f.recorded.find(r=>r.id==='two-takes-isolated')?.result,'PASS');assert.equal(f.recorded.find(r=>r.id==='owned-pages-closed')?.result,'PASS');assert(f.closed&&f.otherClosed);assert.equal(f.phases[0],'before-first');
});
test('whole adapter fails a NEW active row after takeover and still closes every owned page/context',async()=>{
 const f=await adapterTerminalControl({newActive:true});assert.equal(f.recorded.find(r=>r.id==='two-takes-isolated')?.result,'FAIL');assert.equal(f.recorded.find(r=>r.id==='owned-pages-closed')?.result,'PASS');assert(f.closed&&f.otherClosed);assert.equal(f.result.blocker,'observed-product-contradiction');
});
