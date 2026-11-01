'use strict';
// Case 14 (R5 dossier; Sam's selected boundary 1793469167.805339) — the REAL AHT-14 adapter branch and the REAL
// browser-actions Start/Retry selection, driven against a scripted fake page and guard. No browser, account or network.
// Reused, not repeated here: the guard's own prefix/offline/restore mechanics (selftest S14, S14b) and fault matching
// (download-fault.test.cjs). These controls cover what those cannot: the adapter's verdicts at the browser boundary.
// The browser-prefix receipt is produced by the REAL BrowserPrefix correlator from scripted CDP Network events, through
// the same arm → bind → received order guard-proxy.cjs uses (lines 191, 391–393, 473); no success receipt is injected.
// Source binding (retained R5 5a1eca13): browser-prefix.cjs 9a4bf4f7, source-adapters.cjs 44adae91, guard-proxy.cjs 14d0fa38.
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const adapters=require('../source-adapters.cjs'),ui=require('../browser-actions.cjs'),observer=require('../browser-observers.cjs'),readback=require('../browser-readback.cjs');
const {BrowserPrefix}=require('../../bundle/harness/browser-prefix.cjs');

const SAVED={id:'synthetic-recovered-take',status:'completed',hasIdempotencyKey:true,transcriptState:'available',transcriptLength:40,transcriptSha256:'d'.repeat(64)};
const ASSET='https://unit.invalid/models/synthetic.bin';
// Scripted CDP Network events, as a page session would deliver them to the correlator.
const req=(id,o={})=>['Network.requestWillBeSent',{requestId:id,timestamp:o.t??1,request:{url:o.url??ASSET,method:o.method??'GET'},...(o.redirect?{redirectResponse:{status:302}}:{})}];
const resp=(id,o={})=>['Network.responseReceived',{requestId:id,response:{url:o.url??ASSET,status:o.status??200,...(o.from?{[o.from]:true}:{})}}];
const data=(id,o={})=>['Network.dataReceived',{requestId:id,timestamp:o.t??2,dataLength:o.len??65536,encodedDataLength:o.enc??65536}];
const ESTABLISHED_CDP=[req('r1'),resp('r1'),data('r1')];

/** A scripted page whose DOM follows the product's model-status contract; every click and restore is journaled in order. */
function fakeWorld(s,events){
 const attrs={'data-model-status':'none','data-runtime-state':'IDLE','data-stt-mode':'private','data-session-persisted':'false'};
 const visible=new Set();const faults=[];let modelRequests=0,closed=false;
 const prefix=new BrowserPrefix({journal:entry=>s.journal?.push(entry)});
 const setStatus=status=>{attrs['data-model-status']=status;for(const id of ['mic-download','mic-retry','mic-start'])visible.delete(id);
  visible.add(status==='download-required'?'mic-download':['error','init-failed'].includes(status)?'mic-retry':status==='ready'?'mic-start':'none');};
 const clicks={
  // As guard-proxy.cjs does: the matched request binds the correlator (391–393); after the prefix write the receipt
  // comes from received() before offline (473). Either refusal leaves the fault unfired and harness-limited.
  async 'mic-download'(){
   if(s.fires!==false){modelRequests++;const f=faults[0];
    for(const [method,params] of s.cdp??ESTABLISHED_CDP)prefix.event('page-session',method,params);
    if(s.closePrefix)prefix.close();
    try{
     const binding=await prefix.bind(f.id,{timeoutMs:25});
     const receipt=await prefix.received(binding,{timeoutMs:25});
     Object.assign(f,{fired:true,browserOfflineApplied:s.offlineApplied!==false,bytesForwarded:s.bytesForwarded??65536,
      browserPrefixReceipt:s.defenseReceipt?{...receipt,...s.defenseReceipt}:receipt});
    }catch{s.journal?.push({kind:'test-guard-harness-limited',reason:'browser-prefix-receipt-not-established'});}
   }
   setStatus('error');},
  'mic-retry'(){setStatus(faults[0]?.networkRestored?'ready':'error');},
  'mic-start'(){attrs['data-runtime-state']='RECORDING';visible.add('recorder-stop');visible.add('recorder-bar');},
  'recorder-stop'(){attrs['data-runtime-state']='IDLE';visible.delete('recorder-stop');visible.delete('recorder-bar');attrs['data-session-persisted']='true';attrs['data-session-persisted-id']=SAVED.id;},
 };
 const doc={documentElement:{getAttribute:n=>attrs[n]??null},querySelector(sel){const m=/data-testid="([^"]+)"/.exec(sel);return m&&visible.has(m[1])?{disabled:false,getClientRects:()=>[{}]}:null;}};
 const locator=id=>({first(){return this;},isVisible:async()=>visible.has(id),isEnabled:async()=>true,
  async click(){events.push('click:'+id);requireClick(id);await clicks[id]();},
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
  armDownloadFault(f){faults.push({id:'synthetic-fault-14',mode:f.mode,fired:false,browserOfflineApplied:false,bytesForwarded:0});
   if(f.mode==='offline-mid-download')prefix.arm({id:'synthetic-fault-14',url:f.url});return 'synthetic-fault-14';},
  // The guard's summary projection (guard-proxy.cjs 598): the receipt is carried only when one was established.
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
    writeEvidence:async(n,v)=>{if(v?.assertion){if(facts.has(v.assertion))throw new Error('second evidence write for '+v.assertion);facts.set(v.assertion,v.facts);}return n;},
    // Like case-results.cjs, a changed duplicate is refused; any duplicate at all fails row() below.
    recordAssertion:async r=>{const old=recorded.find(x=>x.id===r.id);if(old&&JSON.stringify(old)!==JSON.stringify(r))throw new Error('changed duplicate assertion '+r.id);recorded.push(r);}}});
  const row=id=>{const all=recorded.filter(r=>r.id===id);assert.ok(all.length<=1,'exactly one recorded row for '+id+', got '+all.length);if(all[0])assert.equal(new Set(all[0].evidenceRefs).size,all[0].evidenceRefs.length,'no repeated evidence ref for '+id);return all[0];};
  return {result,events,row,facts:id=>facts.get(id),presses:events.filter(e=>e.startsWith('press:')).map(e=>e.slice(6))};
 }finally{for(const [object,key,value] of changes.reverse())object[key]=value;}
}

test('Case14 full path: exactly Download → Retry → Start journaled, restoration before Retry, recovery saved and reopened',async()=>{
 const f=await runWithFacts({});
 assert.deepEqual(f.presses,['mic-download','mic-retry','mic-start']);
 assert.ok(f.events.indexOf('restore')>f.events.indexOf('press:mic-download')&&f.events.indexOf('restore')<f.events.indexOf('press:mic-retry'),'network restored after the fault and before Retry');
 for(const id of ['download-fault-exercised','download-failure-truthful','deliberate-recovery-saved','review-reopen'])assert.equal(f.row(id)?.result,'PASS',id);
 assert.equal(f.result.blocker,null);
 assert.equal(f.row('start-press-budget')?.result,'PASS');
});

// (a) The REAL correlator establishes the receipt from one exact armed GET whose bytes arrived before offline.
test('Case14 (a) real correlator: one armed GET with received bytes before offline is reported as correlated browser evidence',async()=>{
 const journal=[];const f=await runWithFacts({journal});
 assert.equal(f.row('download-fault-exercised')?.result,'PASS');
 assert.equal(f.facts('download-fault-exercised')?.prefixEvidence,'correlated-browser-network-event');
 assert.equal(f.facts('download-fault-exercised')?.browserPrefixReceipt,'ESTABLISHED');
 assert.equal(f.facts('download-fault-exercised')?.browserPrefixBytes,65536);
 assert.equal(f.facts('download-fault-exercised')?.modelConsumption,'NOT_ESTABLISHED','no model-consumption claim is inferred from a network receipt');
 const kinds=journal.map(e=>e.kind);
 assert.deepEqual(kinds,['browser-prefix-armed','browser-prefix-request','browser-prefix-received','browser-offline-invoking'],'armed → request → received → offline, in order');
 assert.ok(journal.every(e=>!('url' in e)&&!('body' in e)),'the correlator journal is content-free');
});

// (b) Real correlation negatives. Each refusal happens inside the correlator, so — as in guard-proxy.cjs — the fault is never
// fired: no receipt, no offline, no restoration, no Retry and no recovery are ever spent.
const OTHER='https://unit.invalid/models/other.bin';
for(const [name,s] of [
 ['the browser never requested the armed asset',{cdp:[]}],
 ['a different asset was requested',{cdp:[req('r1',{url:OTHER}),resp('r1',{url:OTHER}),data('r1')]}],
 ['the armed asset was requested with POST',{cdp:[req('r1',{method:'POST'}),resp('r1'),data('r1')]}],
 ['two matching requests (ambiguous)',{cdp:[req('r1'),req('r2'),resp('r1'),data('r1')]}],
 ['the request arrived through a redirect',{cdp:[req('r1',{redirect:true}),resp('r1'),data('r1')]}],
 ['the response came from the disk cache',{cdp:[req('r1'),resp('r1',{from:'fromDiskCache'}),data('r1')]}],
 ['the response came from a service worker',{cdp:[req('r1'),resp('r1',{from:'fromServiceWorker'}),data('r1')]}],
 ['the request was served from cache',{cdp:[req('r1'),['Network.requestServedFromCache',{requestId:'r1'}],resp('r1'),data('r1')]}],
 ['a non-2xx response',{cdp:[req('r1'),resp('r1',{status:404}),data('r1')]}],
 ['no bytes were received',{cdp:[req('r1'),resp('r1'),data('r1',{len:0,enc:0})]}],
 ['no encoded bytes were received',{cdp:[req('r1'),resp('r1'),data('r1',{enc:0})]}],
 ['the bytes are stamped before the request',{cdp:[req('r1',{t:5}),resp('r1'),data('r1',{t:4})]}],
 ['the load failed',{cdp:[req('r1'),resp('r1'),data('r1'),['Network.loadingFailed',{requestId:'r1'}]]}],
 ['the observer was closed',{closePrefix:true}],
])
 test('Case14 (b) real correlator refuses when '+name+': NOT RUN, never PASS, nothing further spent',async()=>{
  const journal=[];const f=await runWithFacts({...s,journal});
  assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
  assert.equal(f.facts('download-fault-exercised')?.fired,false);
  assert.equal(f.result.blocker,'download fault not fired at reviewed asset boundary');
  assert.ok(!journal.some(e=>e.kind==='browser-offline-invoking'),'the browser was never taken offline');
  assert.ok(journal.some(e=>e.kind==='test-guard-harness-limited'),'the refusal came from the correlator');
  assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
  for(const id of ['download-failure-truthful','deliberate-recovery-saved','review-reopen'])assert.ok(!f.row(id)||f.row(id).result==='NOT RUN',id);
 });

// (c) Adapter defense in depth (source-adapters.cjs 291): receipt shapes the real correlator never returns, overlaid on a
// genuine receipt. They prove the adapter gate itself refuses them; they are not correlation evidence.
for(const [name,overlay] of [['not observed',{observed:false}],['received after offline',{beforeOffline:false}],
 ['another request',{requestCorrelated:false}],['zero bytes',{bytes:0}]])
 test('Case14 (c) adapter gate refuses a receipt '+name+': NOT QUALIFIED, never PASS, and no recovery is attempted',async()=>{
  const f=await runWithFacts({defenseReceipt:overlay});
  assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
  assert.equal(f.result.blocker,'browser-prefix-receipt-not-established');
  assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
  for(const id of ['download-failure-truthful','deliberate-recovery-saved','review-reopen'])assert.equal(f.row(id)?.result,'NOT RUN',id);
 });

test('Case14 (d) the fault never fires (warm cache, no model request): NOT RUN with a setup reason, nothing further pressed',async()=>{
 const f=await runWithFacts({fires:false});
 assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
 assert.equal(f.facts('download-fault-exercised')?.setupReason,'no-model-request-after-press');
 assert.equal(f.facts('download-fault-exercised')?.setupBlocked,true);
 assert.equal(f.result.blocker,'download fault not fired at reviewed asset boundary');
 assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
 assert.ok(!f.row('deliberate-recovery-saved')||f.row('deliberate-recovery-saved').result==='NOT RUN');
});

for(const [name,s] of [['offline not applied',{offlineApplied:false}],['no prefix forwarded',{bytesForwarded:0}]])
 test('Case14 (e) '+name+': NOT RUN, never PASS, and no restoration or recovery',async()=>{
  const f=await runWithFacts({...s});
  assert.equal(f.row('download-fault-exercised')?.result,'NOT RUN');
  assert.equal(f.result.blocker,'proxy prefix write and browser offline control not established');
  assert.deepEqual(f.presses,['mic-download']);assert.ok(!f.events.includes('restore'));
 });

test('Case14 (f) restoration fails: earlier verdicts are preserved, recovery is NOT RUN, and no Retry or Start is spent',async()=>{
 const f=await runWithFacts({restoreThrows:true});
 assert.equal(f.row('download-fault-exercised')?.result,'PASS');
 assert.equal(f.row('download-failure-truthful')?.result,'PASS');
 for(const id of ['deliberate-recovery-saved','review-reopen'])assert.equal(f.row(id)?.result,'NOT RUN',id);
 assert.equal(f.result.blocker,'browser-or-oracle-step-interrupted');
 assert.deepEqual(f.presses,['mic-download']);
});
