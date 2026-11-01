'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ui=require('../browser-actions.cjs');
const {retainInterruptionEvidence}=require('../source-adapters.cjs');
const {sanitizeEvidence}=require('../../bundle/harness/evidence-sanitizer.cjs');
const {createCaseRecorder}=require('../../bundle/harness/case-results.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

function fakePage(failAt){
 const error=Object.assign(new Error("locator.click: Timeout 20000ms exceeded getByTestId('nav-products-button') private text https://example.test/?token=secret"),{name:'TimeoutError'});
 const step=phase=>{if(failAt===phase)throw error;};
 const locator=id=>({
  or(){return this;},filter(){return this;},first(){return this;},isVisible:async()=>true,
  waitFor:async()=>step(id==='menu'?'products-menu-wait':id==='recorder-bar'?'stop-release-wait':'products-trigger-wait'),
  click:async()=>step(id==='nav-products-button'?'products-trigger-click':id==='recorder-stop'?'stop-press':'products-item-click'),
  getAttribute:async()=>{step('save-readback');return 'private-persisted-id';},
 });
 return {error,getByTestId:locator,getByRole:locator,locator,
  waitForFunction:async(_fn,arg)=>step(typeof arg==='string'&&arg.startsWith('nav-')?'products-open-wait':'save-wait')};
}

for(const phase of ['products-trigger-wait','products-menu-wait','products-trigger-click','products-open-wait','products-item-click']){
 test('Products interruption identifies exact closed phase '+phase,async()=>{
  const page=fakePage(phase);
  await assert.rejects(ui.products(page,'open-mic'),error=>error===page.error);
  assert.equal(ui.failureStage(page.error,page),phase);
  const safe=ui.safeErrorSummary(page.error);
  assert.equal(safe.kind,'timeout');assert.equal(safe.timeoutMs,20000);
  assert(!JSON.stringify(safe).includes('private text'));assert(!JSON.stringify(safe).includes('secret'));
 });
}

for(const phase of ['stop-press','stop-release-wait','save-wait','save-readback']){
 test('Stop/save interruption identifies phase '+phase,async()=>{
  const page=fakePage(phase);
  await assert.rejects(phase.startsWith('stop')?ui.stop(page):ui.saved(page),error=>error===page.error);
  assert.equal(ui.failureStage(page.error,page),phase);
 });
}

test('interleaved pages retain their own phase and the failing page, not the primary page',async()=>{
 const a=fakePage('stop-release-wait'),b=fakePage('products-trigger-click'),fresh=fakePage(null);
 await assert.rejects(ui.stop(a));await assert.rejects(ui.products(b,'open-mic'));
 assert.equal(ui.currentStage(a),'stop-release-wait');assert.equal(ui.currentStage(b),'products-trigger-click');
 assert.equal(ui.currentStage(fresh),'idle');assert.equal(ui.currentStage(null),'idle');
 assert.equal(ui.failurePage(b.error,a),b);assert.equal(ui.failureStage(b.error,a),'products-trigger-click');
});

test('Products click failure retains code-owned hit-target states without DOM text or caller error properties',async()=>{
 const page=fakePage('products-trigger-click');let reads=0;
 page.locator=()=>({evaluate:async()=>({triggerVisible:true,triggerEnabled:true,inViewport:true,triggerIsHitTarget:reads++===0,focusDialogVisible:false,focusIntent:false,privateText:'private transcript token=secret',pointerEventsEnabled:'private token'})});
 await assert.rejects(ui.products(page,'open-mic'),error=>error===page.error);
 const diag=ui.productsDiagnostic(page.error);assert.equal(reads,2);
 assert.equal(diag.before.triggerIsHitTarget,true);assert.equal(diag.after.triggerIsHitTarget,false);
 assert.equal(diag.before.pointerEventsEnabled,null);
 assert.equal(ui.productsDiagnostic(Object.assign(Error('private'),{products:diag})),null);
 const json=JSON.stringify(diag);assert(!json.includes('private'));assert(!json.includes('token'));assert(!json.includes('transcript'));
 const safe=sanitizeEvidence({products:diag});assert.equal(safe.stats.blockedStrings,0);assert.deepEqual(safe.value.products,diag);
 assert.equal(ui.failureStage(page.error,page),'products-trigger-click');
});
test('unavailable hit-target diagnostics do not replace the actual click error or extend its timeout',async()=>{
 const page=fakePage('products-trigger-click');page.locator=()=>({evaluate:async()=>{throw Error('private');}});
 await assert.rejects(ui.products(page,'open-mic'),error=>error===page.error);
 assert.deepEqual(ui.productsDiagnostic(page.error),{before:null,after:null});
 assert.equal(ui.safeErrorSummary(page.error).timeoutMs,20000);
});

test('successful save returns the same private ID without putting it in diagnostic phase',async()=>{
 const page=fakePage(null);assert.equal(await ui.saved(page),'private-persisted-id');assert.equal(ui.currentStage(page),'save-complete');
});

test('an earlier PASS stays immutable while a separate diagnostic reference is retained',async()=>{
 const row={id:'focus-no-red-before-stop',result:'PASS',evidenceRefs:['earlier.json']},writes=[];
 const page=fakePage('save-wait');await assert.rejects(ui.saved(page));
 const diag={stage:ui.failureStage(page.error,page),step:row.id,error:ui.safeErrorSummary(page.error)};
 const ref=await retainInterruptionEvidence({caseId:'AHT-02',diag,assertions:[row],writeEvidence:async(name,value)=>{writes.push(value);return name;}});
 assert.equal(row.result,'PASS');assert.deepEqual(row.evidenceRefs,['earlier.json']);assert.equal(ref,'aht-02-interruption.json');
 assert.equal(writes[0].afterRecordedAssertion,true);
 assert.equal(writes[0].kind,'interruption-diagnostic');assert.equal(writes[0].diagnosticOnly,true);
 assert.equal(writes[0].stage,'save-wait');assert(!JSON.stringify(writes).includes('secret'));assert(!JSON.stringify(writes).includes('private text'));
 const sanitized=sanitizeEvidence(writes[0]);assert.equal(sanitized.stats.blockedStrings,0);assert.equal(sanitized.stats.truncated,0);assert.equal(sanitized.value.stage,'save-wait');
});

test('a missing assertion does not create a synthetic verdict and still retains the interruption',async()=>{
 const rows=[],writes=[];
 const ref=await retainInterruptionEvidence({caseId:'AHT-08',diag:{stage:'idle',step:'feedback-stored-once',error:ui.safeErrorSummary(new Error('private text secret'))},assertions:rows,writeEvidence:async(name,value)=>{writes.push(value);return name;}});
 assert.equal(ref,'aht-08-interruption.json');assert.deepEqual(rows,[]);assert.equal(writes.length,1);assert(!JSON.stringify(writes).includes('private text'));
});

test('an invalid diagnostic reference is refused instead of published',async()=>{
 await assert.rejects(retainInterruptionEvidence({caseId:'AHT-04',diag:{step:'return-no-resume'},assertions:[],writeEvidence:async()=> '../outside.json'}));
});

test('known refusal codes survive, arbitrary error codes and messages do not',()=>{
 for(const code of ['NOT_RUN','AUTH_REJECTED','START_PRESS_CAP','START_CONTROL_NOT_READY','PRODUCT_FAIL','EVIDENCE_READER_UNAVAILABLE']){
  assert.equal(ui.safeErrorSummary(Object.assign(new Error('private transcript'),{code})).code,code);
 }
 const summary=ui.safeErrorSummary(Object.assign(new Error('private transcript token=secret'),{code:'private-secret'}));
 assert.equal(summary.code,null);assert(!JSON.stringify(summary).includes('secret'));assert(!JSON.stringify(summary).includes('transcript'));
});

test('new phase and code vocabulary survives the unchanged evidence sink',async()=>{
 for(const stage of ['products-trigger-wait','products-menu-wait','products-trigger-click','products-open-wait','products-item-click','stop-press','stop-clicked','stop-release-wait','save-wait','save-readback','save-complete']){
  const record={stage,error:ui.safeErrorSummary(Object.assign(new Error('private transcript'),{code:'NOT_RUN'}))};
  const sanitized=sanitizeEvidence(record);assert.equal(sanitized.stats.blockedStrings,0);assert.equal(sanitized.value.stage,stage);assert.equal(sanitized.value.error.code,'NOT_RUN');
 }
});

test('real recorder finishes an interrupted case without mutating the earlier PASS',async t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'interruption-recorder-')));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const config={caseId:'AHT-02',sourceSha:'a'.repeat(40),servedSha:'a'.repeat(40),targetUrl:'https://speaksharp-public.vercel.app',requiredAssertions:['focus-no-red-before-stop','owned-pages-closed']};
 const recorder=createCaseRecorder(config,dir);
 const ref=recorder.writeEvidence('earlier.json',{contentSafe:true,observed:true});
 const row={id:'focus-no-red-before-stop',result:'PASS',detail:'The named source assertion was observed.',evidenceRefs:[ref]};
 recorder.recordAssertion(row);
 const before=JSON.stringify(row);
 const interruptionRef=await retainInterruptionEvidence({caseId:config.caseId,diag:{stage:'save-wait',step:row.id,error:ui.safeErrorSummary(new Error('private text'))},assertions:[row],writeEvidence:recorder.writeEvidence});
 const cleanup={id:'owned-pages-closed',result:'PASS',detail:'The named source assertion was observed.',evidenceRefs:[interruptionRef]};
 recorder.recordAssertion(cleanup);
 const result=recorder.finish({caseId:config.caseId,contentSafe:true,assertions:[row,cleanup]});
 assert.equal(JSON.stringify(row),before);
 assert.equal(result.assertions[0].result,'PASS');
 assert.equal(result.assertions[1].evidenceRefs[0],interruptionRef);
 assert.ok(result.evidenceDigests[interruptionRef]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,interruptionRef))).stage,'save-wait');
});
