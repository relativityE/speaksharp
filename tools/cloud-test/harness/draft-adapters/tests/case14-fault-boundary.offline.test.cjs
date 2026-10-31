'use strict';
// Case 14 (R5 dossier; Sam's selected boundary 1793469167.805339) — the REAL AHT-14 adapter branch and the REAL
// browser-actions Start/Retry selection, driven against a scripted fake page and guard. No browser, account or network.
// Reused, not repeated here: the guard's own prefix/offline/restore mechanics (selftest S14, S14b) and fault matching
// (download-fault.test.cjs). These controls cover what those cannot: the adapter's verdicts at the browser boundary.
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const adapters=require('../source-adapters.cjs'),ui=require('../browser-actions.cjs'),observer=require('../browser-observers.cjs'),readback=require('../browser-readback.cjs');

const SAVED={id:'synthetic-recovered-take',status:'completed',hasIdempotencyKey:true,transcriptState:'available',transcriptLength:40,transcriptSha256:'d'.repeat(64)};
const ESTABLISHED={observed:true,requestCorrelated:true,beforeOffline:true,bytes:65536};

/** A scripted page whose DOM follows the product's model-status contract; every click and restore is journaled in order. */
function fakeWorld(s,events){
 const attrs={'data-model-status':'none','data-runtime-state':'IDLE','data-stt-mode':'private','data-session-persisted':'false'};
 const visible=new Set();const faults=[];let modelRequests=0,closed=false;
 const setStatus=status=>{attrs['data-model-status']=status;for(const id of ['mic-download','mic-retry','mic-start'])visible.delete(id);
  visible.add(status==='download-required'?'mic-download':['error','init-failed'].includes(status)?'mic-retry':status==='ready'?'mic-start':'none');};
 const clicks={
  'mic-download'(){if(s.fires!==false){modelRequests++;const f=faults[0];Object.assign(f,{fired:true,browserOfflineApplied:s.offlineApplied!==false,bytesForwarded:s.bytesForwarded??65536,...(s.receipt?{browserPrefixReceipt:{...s.receipt}}:{})});}setStatus('error');},
  'mic-retry'(){setStatus(faults[0]?.networkRestored?'ready':'error');},
  'mic-start'(){attrs['data-runtime-state']='RECORDING';visible.add('recorder-stop');visible.add('recorder-bar');},
  'recorder-stop'(){attrs['data-runtime-state']='IDLE';visible.delete('recorder-stop');visible.delete('recorder-bar');attrs['data-session-persisted']='true';attrs['data-session-persisted-id']=SAVED.id;},
 };
 const doc={documentElement:{getAttribute:n=>attrs[n]??null},querySelector(sel){const m=/data-testid="([^"]+)"/.exec(sel);return m&&visible.has(m[1])?{disabled:false,getClientRects:()=>[{}]}:null;}};
 const locator=id=>({first(){return this;},isVisible:async()=>visible.has(id),isEnabled:async()=>true,
  async click(){events.push('click:'+id);requireClick(id);clicks[id]();},
  async waitFor({state}={}){if((state==='detached')===visible.has(id))throw Object.assign(new Error('synthetic wait timeout'),{name:'TimeoutError'});}});
 const requireClick=id=>{if(!visible.has(id))throw new Error('synthetic click on hidden control '+id);};
 const page=Object.assign(new EventEmitter(),{
  setDefaultTimeout(){},setDefaultNavigationTimeout(){},waitForTimeout:async()=>{},isClosed:()=>closed,close:async()=>{closed=true;},evaluate:async()=>undefined,
  getByTestId:locator,getByText:()=>({first(){return this;},isVisible:async()=>false,waitFor:async()=>{throw new Error('synthetic copy absent');}}),
  locator:()=>({getAttribute:async n=>attrs[n]??null}),
  async waitForFunction(fn,arg){const previous=globalThis.document;globalThis.document=doc;let r;try{r=fn(arg);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
   if(!r)throw Object.assign(new Error('synthetic waitForFunction timeout'),{name:'TimeoutError'});return {jsonValue:async()=>r,dispose:async()=>{}};},
 });
 const guard={
  armDownloadFault(f){faults.push({id:'synthetic-fault-14',mode:f.mode,fired:false,browserOfflineApplied:false,bytesForwarded:0});return 'synthetic-fault-14';},
  summary:()=>({ledgerUsed:{model:modelRequests},downloadFaults:faults.map(f=>({...f}))}),
  async resumeDownloadNetwork(id){events.push('restore');if(s.restoreThrows)throw new Error('HARNESS_LIMITED: synthetic restoration failure');const f=faults.find(x=>x.id===id);f.networkRestored=true;return true;},
 };
 return {page,guard,openMic:()=>setStatus('download-required')};
}

// Recorded rows carry no facts; the facts are read back from the evidence the adapter writes for each row.
async function runWithFacts(s){
 const events=[],recorded=[],changes=[],facts=new Map();const w=fakeWorld(s,events);let saved=false;
 const patch=(object,key,value)=>{changes.push([object,key,object[key]]);object[key]=value;};
 patch(ui,'login',async()=>true);patch(ui,'openMic',async()=>{w.openMic();});patch(ui,'reopen',async()=>({before:SAVED.transcriptSha256,after:SAVED.transcriptSha256}));
 patch(observer,'install',async()=>{});patch(observer,'armStates',async()=>{});patch(observer,'states',async()=>['download-required','downloading','error']);
 patch(observer,'mic',async()=>({acquisitions:0,log:[],liveTracks:0,recording:false,recorderVisible:false}));
 patch(readback,'sessions',async()=>(saved?[SAVED]:[]));
 const c={caseId:'AHT-14',campaignId:'UNIT-CASE14',sourceSha:adapters.SOURCE_SHA,servedSha:adapters.SOURCE_SHA,targetUrl:'https://unit.invalid',requiredAssertions:adapters.CONTRACTS['AHT-14'].rows,
  account:{id:'14141414-1414-4141-8141-141414141414',mode:'existing-disposable',preprovisionReceipt:'unit/pre.json',analyticsExclusionReceipt:'unit/analytics.json',dispositionReceipt:'unit/disposition.json',effectiveFeatureAccessApproved:true},
  readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'synthetic-public',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit/rls.json',immutableFenceMigrationQualificationReceipt:'unit/fence.json'},
  observerSourceReviewed:true,observerQualificationReceipt:'unit/observer.json',takeCap:1,startPressCap:3,coldModelRequired:true,fixture:{sha256:'b'.repeat(64),launchSha256:'b'.repeat(64),speechDurationMs:7000},
  downloadFault:{mode:'offline-mid-download',url:'https://unit.invalid/models/synthetic.bin',afterBytes:65536,qualificationReceipt:'unit/offline-fault.json'}};
 try{
  const result=await adapters.run('AHT-14',{context:{newPage:async()=>w.page,grantPermissions:async()=>{},clearPermissions:async()=>{}},guard:w.guard,caseConfig:c,
   capabilities:{credentials:{email:'synthetic@example.invalid',password:'synthetic-only'},oracles:{},
    recordStartPress:async({control})=>{events.push('press:'+control);if(control==='mic-start')saved=true;},
    writeEvidence:async(n,v)=>{if(v?.assertion)facts.set(v.assertion,v.facts);return n;},recordAssertion:async r=>recorded.push(r)}});
  const row=id=>recorded.find(r=>r.id===id);
  return {result,events,row,facts:id=>facts.get(id),presses:events.filter(e=>e.startsWith('press:')).map(e=>e.slice(6))};
 }finally{for(const [object,key,value] of changes.reverse())object[key]=value;}
}

test('Case14 full path: exactly Download → Retry → Start journaled, restoration before Retry, recovery saved and reopened',async()=>{
 const f=await runWithFacts({receipt:ESTABLISHED});
 assert.deepEqual(f.presses,['mic-download','mic-retry','mic-start']);
 assert.ok(f.events.indexOf('restore')>f.events.indexOf('press:mic-download')&&f.events.indexOf('restore')<f.events.indexOf('press:mic-retry'),'network restored after the fault and before Retry');
 for(const id of ['download-fault-exercised','download-failure-truthful','deliberate-recovery-saved','review-reopen'])assert.equal(f.row(id)?.result,'PASS',id);
 assert.equal(f.result.blocker,null);
 assert.equal(f.row('start-press-budget')?.result,'PASS');
});

test('Case14 (a) selected boundary: an established browser prefix receipt is reported, not the proxy write',async()=>{
 const f=await runWithFacts({receipt:ESTABLISHED});
 assert.equal(f.row('download-fault-exercised')?.result,'PASS');
 assert.equal(f.facts('download-fault-exercised')?.browserPrefixReceipt,'ESTABLISHED');
 assert.equal(f.facts('download-fault-exercised')?.browserPrefixBytes,ESTABLISHED.bytes);
 assert.equal(f.facts('download-fault-exercised')?.modelConsumption,'NOT_ESTABLISHED','no model-consumption claim is inferred from a network receipt');
});

for(const [name,receipt] of [['absent',undefined],['not observed',{...ESTABLISHED,observed:false}],['received after offline',{...ESTABLISHED,beforeOffline:false}],
 ['another request',{...ESTABLISHED,requestCorrelated:false}],['zero bytes',{...ESTABLISHED,bytes:0}]])
 test('Case14 (a) browser receipt '+name+': NOT QUALIFIED, never PASS, and no recovery is attempted',async()=>{
  const f=await runWithFacts({receipt});
  assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
  assert.equal(f.result.blocker,'browser-prefix-receipt-not-established');
  assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
  for(const id of ['download-failure-truthful','deliberate-recovery-saved','review-reopen'])assert.equal(f.row(id)?.result,'NOT RUN',id);
 });

test('Case14 (d) the fault never fires (warm cache, no model request): NOT RUN with a setup reason, nothing further pressed',async()=>{
 const f=await runWithFacts({fires:false,receipt:ESTABLISHED});
 assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
 assert.equal(f.facts('download-fault-exercised')?.setupReason,'no-model-request-after-press');
 assert.equal(f.facts('download-fault-exercised')?.setupBlocked,true);
 assert.equal(f.result.blocker,'download fault not fired at reviewed asset boundary');
 assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
 assert.ok(!f.row('deliberate-recovery-saved')||f.row('deliberate-recovery-saved').result==='NOT RUN');
});

for(const [name,s] of [['offline not applied',{offlineApplied:false}],['no prefix forwarded',{bytesForwarded:0}]])
 test('Case14 (e) '+name+': NOT RUN, never PASS, and no restoration or recovery',async()=>{
  const f=await runWithFacts({...s,receipt:ESTABLISHED});
  assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
  assert.equal(f.result.blocker,'proxy prefix write and browser offline control not established');
  assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
 });

test('Case14 (f) restoration fails: earlier verdicts are preserved, recovery is NOT RUN, and no Retry or Start is spent',async()=>{
 const f=await runWithFacts({receipt:ESTABLISHED,restoreThrows:true});
 assert.equal(f.row('download-fault-exercised')?.result,'PASS');
 assert.equal(f.row('download-failure-truthful')?.result,'PASS');
 for(const id of ['deliberate-recovery-saved','review-reopen'])assert.equal(f.row(id)?.result,'NOT RUN',id);
 assert.equal(f.result.blocker,'browser-or-oracle-step-interrupted');
 assert.deepEqual(f.presses,['mic-download']);
});
