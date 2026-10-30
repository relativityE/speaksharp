'use strict';
// Executes the unchanged real adapter with synthetic external browser/readback/oracle I/O.
// No browser, account, provider, network, credential or admission operation occurs.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {EventEmitter}=require('node:events');
const root=path.join(__dirname,'..');
const adapters=require(path.join(root,'source-adapters.cjs'));
const ui=require(path.join(root,'browser-actions.cjs')),readback=require(path.join(root,'browser-readback.cjs'));
const observer=require(path.join(root,'browser-observers.cjs')),presentation=require(path.join(root,'presentation-controls.cjs'));
const focusControls=require(path.join(root,'focus-controls.cjs'));
const manifest=require(path.join(root,'oracles/pure/fixture-manifest.json')).fixtures;
async function execute(caseId,{staleOwner=false,coaching502=false,unknownCaptureError=false,wrongSavedTake=false,falseFullFocus=false,wrongReopen=false}={}){
 const fixtureName=caseId==='AHT-01'?'open_mic_tts':caseId==='AHT-02'?'focus_points_tts':'focus_points_partial_tts';
 const fixture=manifest[fixtureName],contract=adapters.CONTRACTS[caseId],seen=[],writes=[],recorded=[];
 const c={caseId,campaignId:'UNIT-ONLY',sourceSha:adapters.SOURCE_SHA,servedSha:adapters.SOURCE_SHA,targetUrl:'https://unit.invalid',requiredAssertions:contract.rows,
  account:{id:'11111111-1111-4111-8111-111111111111',mode:'existing-disposable',preprovisionReceipt:'unit/pre.json',analyticsExclusionReceipt:'unit/analytics.json',dispositionReceipt:'unit/disposition.json',effectiveFeatureAccessApproved:true},
  readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'synthetic-public',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit/rls.json'},
  observerSourceReviewed:true,observerQualificationReceipt:'unit/observer.json',takeCap:contract.takes,startPressCap:contract.startPresses,
  fixture:{name:fixtureName,sha256:fixture.sha256,launchSha256:fixture.sha256,speechDurationMs:Math.round(fixture.speechSeconds*1000)},
  oracleBindings:Object.fromEntries(contract.oracles.map(n=>[n,{sha256:'b'.repeat(64),reviewReceipt:'unit/review.json',module:'unit/'+n+'.cjs'}])),
  privateEvidenceProducers:{'coaching-authority':{reviewed:true}},pdfParser:{package:'pdfjs-dist',version:'4.10.38',sha256:'c'.repeat(64)}};
 if(caseId!=='AHT-01')c.focus={topic:fixture.topic,points:fixture.points,expectedFinal:fixture.expectedFinal,speechWindows:fixture.pointAudioWindows,expectsLive:fixture.pointAudioWindows.map(Boolean),newPoints:[fixture.points[0],fixture.points[1],'A closing promise we never make'],editedPoints:fixture.points.slice(0,3)};
 let closed=false,saved=false;const old=[];
 const patch=(o,k,v)=>{old.push([o,k,o[k]]);o[k]=v;};
 const page=Object.assign(new EventEmitter(),{setDefaultTimeout(){},setDefaultNavigationTimeout(){},waitForTimeout:async()=>{},waitForFunction:async()=>{},isClosed:()=>closed,close:async()=>{closed=true;},
  getByText:()=>({first(){return this;},isVisible:async()=>false}),
  getByTestId:id=>({getAttribute:async()=>id.startsWith('focus-point-')?(falseFullFocus?'covered':c.focus.expectedFinal[Number(id.slice(12))]):'ready'})});
 patch(ui,'login',async()=>true);patch(ui,'openMic',async()=>{});patch(ui,'products',async()=>{});patch(ui,'setupFocus',async()=>{});
 patch(ui,'start',async()=>seen.push('start'));patch(ui,'stop',async()=>{seen.push('stop');if(coaching502){const request={url:()=>c.readback.origin+'/functions/v1/get-ai-suggestions',method:()=> 'POST',postDataJSON:()=>({sessionId:'take-A',client_attempt:1}),timing:()=>({responseEnd:40})};page.emit('request',request);page.emit('response',{request:()=>request,status:()=>502,headers:()=>({'content-type':'application/json'}),text:async()=>JSON.stringify({error:'AI coaching could not be generated. Please try again.',reason:'provider_timeout'})});}});patch(ui,'saved',async()=>{saved=true;return 'take-A';});
 patch(ui,'reopen',async()=>{seen.push('reopen');return{before:'d'.repeat(64),after:(wrongReopen?'e':'d').repeat(64)};});
 patch(observer,'install',async()=>{});patch(observer,'mic',async()=>({acquisitions:0,liveTracks:0,recording:false,recorderVisible:false}));
 patch(readback,'sessions',async()=>[...(staleOwner?Array.from({length:24},(_,i)=>({id:'old-'+i,status:'completed'})):[]),...(saved?[{id:wrongSavedTake?'take-B':'take-A',status:'completed',hasIdempotencyKey:true,transcriptState:'available',transcriptLength:20,transcriptSha256:'d'.repeat(64)}]:[])]);
 for(const method of ['openMicReview','beforeFocus','afterFocus'])patch(presentation,method,async()=>[]);
 patch(presentation,'beginFocusLive',async()=>({}));patch(presentation,'freezeFocusLiveDetailed',async()=>({rows:[],observed:null}));patch(presentation,'disposeFocusLive',async()=>{});
 patch(presentation,'group',id=>({id,result:'PASS',facts:{synthetic:true}}));patch(focusControls,'backReload',async()=>[]);
 const oracles=Object.fromEntries(contract.oracles.map(name=>[name,async a=>{seen.push(name+':'+a.phase);if(name==='coaching'&&a.phase==='capture'){const error=Error('synthetic missing saved inputs; private-content');if(!unknownCaptureError)error.code='NOT_RUN';throw error;}return a.phase==='assert'?{observed:true,result:'PASS',contentSafe:true,evidenceRefs:['unit/oracle.json']}:{observed:true};}]));
 try{return {result:await adapters.run(caseId,{context:{newPage:async()=>page,grantPermissions:async()=>{}},guard:{summary:()=>({ledgerUsed:{model:0}})},caseConfig:c,capabilities:{credentials:{email:'synthetic@example.invalid',password:'synthetic-only'},oracles,recordStartPress:async()=>{},writeEvidence:async(name,value)=>{writes.push(value);return name;},recordAssertion:async row=>{recorded.push(row);seen.push('assert:'+row.id);}}}),seen,writes,recorded};}
 finally{for(const [o,k,v]of old.reverse())o[k]=v;}
}
for(const caseId of ['AHT-01','AHT-02','AHT-03'])test(caseId+' retains independent save before a coaching-capture interruption',async()=>{
 const f=await execute(caseId);assert.ok(f.seen.includes('coaching:capture'),JSON.stringify({seen:f.seen,blocker:f.result.blocker}));assert.equal(f.recorded.find(r=>r.id==='saved-once')?.result,'PASS');
 if(caseId!=='AHT-01')assert.equal(f.recorded.find(r=>r.id==='focus-final')?.result,'PASS');
 assert.ok(f.seen.indexOf('assert:saved-once')<f.seen.indexOf('coaching:capture'));
 assert.ok(!JSON.stringify(f.writes).includes('private-content'));
 assert.equal(f.recorded.find(r=>r.id==='review-reopen')?.result,'PASS');
 assert.notEqual(f.recorded.find(r=>r.id==='grounded-coaching')?.result,'PASS');
 assert.equal(f.seen.filter(x=>x==='start').length,1,'no repeat attempted without its coaching prerequisite');
});
test('coaching502 remains one explicit FAIL while saved/reopened/PDF observations survive',async()=>{
 const f=await execute('AHT-01',{coaching502:true});
 for(const id of ['saved-once','review-reopen','pdf-owner-take'])assert.equal(f.recorded.find(r=>r.id===id)?.result,'PASS');
 const grounded=f.recorded.filter(r=>r.id==='grounded-coaching');assert.equal(grounded.length,1);assert.equal(grounded[0].result,'FAIL');
 const recovery=f.writes.find(x=>x.kind==='coaching-recovery-record');assert.equal(recovery.verified,false);assert.deepEqual(recovery.failedRoles,['first']);
 assert.ok(JSON.stringify(f.writes).includes('code-provider_timeout'));
});
test('unknown capture failure stays FAIL; no arbitrary message escapes',async()=>{
 const f=await execute('AHT-01',{unknownCaptureError:true});assert.equal(f.recorded.find(r=>r.id==='grounded-coaching')?.result,'FAIL');
 assert.equal(f.recorded.find(r=>r.id==='saved-once')?.result,'PASS');assert.equal(f.recorded.find(r=>r.id==='review-reopen')?.result,'PASS');assert.ok(!JSON.stringify(f.writes).includes('private-content'));
});
test('wrong saved take still fails before coaching capture',async()=>{
 const f=await execute('AHT-01',{wrongSavedTake:true});assert.equal(f.recorded.find(r=>r.id==='saved-once')?.result,'FAIL');assert.equal(f.seen.includes('coaching:capture'),false);
});
test('false full Focus verdict still fails the partial case',async()=>{
 const f=await execute('AHT-03',{falseFullFocus:true});assert.equal(f.recorded.find(r=>r.id==='focus-final')?.result,'FAIL');assert.equal(f.seen.includes('coaching:capture'),false);
});
test('wrong reopened transcript stays FAIL after independent coaching failure',async()=>{
 const f=await execute('AHT-01',{coaching502:true,wrongReopen:true});assert.equal(f.recorded.find(r=>r.id==='review-reopen')?.result,'FAIL');assert.equal(f.recorded.find(r=>r.id==='grounded-coaching')?.result,'FAIL');
});
test('AHT-01 stale 24-session fixture stops before recording intent',async()=>{
 const f=await execute('AHT-01',{staleOwner:true});
 assert.equal(f.recorded.find(r=>r.id==='fresh-first-session')?.result,'NOT RUN');
 assert.equal(f.seen.includes('start'),false,'a known nonfresh owner must not consume a recording attempt');
});
