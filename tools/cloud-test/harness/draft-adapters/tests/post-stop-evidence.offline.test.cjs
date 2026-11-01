'use strict';
// Executes the unchanged real adapter with synthetic external browser/readback/oracle I/O.
// No browser, account, provider, network, credential or admission operation occurs.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {EventEmitter}=require('node:events');
const root=path.join(__dirname,'..');
const adapters=require(path.join(root,'source-adapters.cjs'));
const ui=require(path.join(root,'browser-actions.cjs')),readback=require(path.join(root,'browser-readback.cjs'));
const observer=require(path.join(root,'browser-observers.cjs')),presentation=require(path.join(root,'presentation-controls.cjs'));
const focusControls=require(path.join(root,'focus-controls.cjs'));
const {createCaseRecorder}=require('../../bundle/harness/case-results.cjs');
const manifest=require(path.join(root,'oracles/pure/fixture-manifest.json')).fixtures;
async function execute(caseId,{staleOwner=false,coaching502=false,late502=false,unknownCaptureError=false,wrongSavedTake=false,falseFullFocus=false,wrongReopen=false,pcmReceipt=null,saveFailure=false,finalWaitFailure=false}={}){
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
 const page=Object.assign(new EventEmitter(),{setDefaultTimeout(){},setDefaultNavigationTimeout(){},waitForTimeout:async()=>{},waitForFunction:async()=>{if(finalWaitFailure)throw new Error('synthetic final wait failure');},isClosed:()=>closed,close:async()=>{closed=true;},
  getByText:()=>({first(){return this;},isVisible:async()=>false}),
  getByTestId:id=>({getAttribute:async()=>id.startsWith('focus-point-')?(falseFullFocus?'covered':c.focus.expectedFinal[Number(id.slice(12))]):'ready'})});
 patch(ui,'login',async()=>true);patch(ui,'openMic',async()=>{});patch(ui,'products',async()=>{});patch(ui,'setupFocus',async()=>{});
 let delayedResponse=null;patch(ui,'start',async()=>seen.push('start'));patch(ui,'stop',async()=>{seen.push('stop');if(coaching502){const request={url:()=>c.readback.origin+'/functions/v1/get-ai-suggestions',method:()=> 'POST',postDataJSON:()=>({sessionId:'take-A',client_attempt:1}),timing:()=>({responseEnd:40})};page.emit('request',request);const response=()=>page.emit('response',{request:()=>request,status:()=>502,headers:()=>({'content-type':'application/json'}),text:async()=>JSON.stringify({error:'AI coaching could not be generated. Please try again.',reason:'provider_timeout'})});if(late502)delayedResponse=response;else response();}});patch(ui,'saved',async()=>{if(saveFailure)throw new Error('synthetic save failure');saved=true;return 'take-A';});
 patch(ui,'reopen',async()=>{seen.push('reopen');delayedResponse?.();return{before:'d'.repeat(64),after:(wrongReopen?'e':'d').repeat(64)};});
 patch(observer,'install',async()=>{});patch(observer,'mic',async()=>({acquisitions:0,liveTracks:0,recording:false,recorderVisible:false}));patch(observer,'pcmBoundaryBaseline',async()=>({observedAtMs:10,captureIds:[]}));patch(observer,'pcmBoundaries',async()=>pcmReceipt);
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
test('a correlated502 arriving during reopen cannot be hidden by an earlier capture NOT RUN',async()=>{
 const f=await execute('AHT-01',{coaching502:true,late502:true});assert.equal(f.recorded.find(r=>r.id==='saved-once')?.result,'PASS');assert.equal(f.recorded.find(r=>r.id==='review-reopen')?.result,'PASS');const grounded=f.recorded.filter(r=>r.id==='grounded-coaching');assert.equal(grounded.length,1);assert.equal(grounded[0].result,'FAIL');
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

const pcmCapture=(captureId='11111111-1111-4111-8111-111111111111',createdAtMs=20)=>({schema:'speaksharp.pcm-boundaries.v1',captureId,createdAtMs,sampleRateHz:16000,
 format:'Float32LE',meaning:'observed-boundary-inputs-not-proof-of-recognizer-output-or-accepted-focus-points',complete:true,
 workletClosed:true,listenerClosed:true,pendingHashes:0,problems:[],receipts:['worklet_output','listener_delivery','live_decode_input','final_decode_input'].map((domain,ordinal)=>({
  domain,ordinal,samples:4,bytes:16,atMs:ordinal+1,sha256:String(ordinal+1).repeat(64),status:'hashed',lineageComplete:true,
  spans:[{captureId:'11111111-1111-4111-8111-111111111111',start:ordinal*4,samples:4,operations:[domain==='worklet_output'?'worklet':domain==='listener_delivery'?'listener-copy':'utterance-copy']}]
 }))});

const baseline={observedAtMs:10,captureIds:[]};
test('PCM receipt sanitizer emits one bounded current-capture summary and rejects false completeness',()=>{
 const input=pcmCapture();input.privateTranscript='must-not-escape';input.receipts[0].privateAudio='must-not-escape';
 const clean=observer.sanitizePcmBoundaryReceipts([input],{baseline});assert.equal(clean.selectedCapture.validatedComplete,true);assert.equal(clean.selectedCapture.receiptCount,4);
 assert.equal(JSON.stringify(clean).includes('must-not-escape'),false);assert.equal(clean.diagnosticOnly,true);assert.match(clean.selectedCapture.captureDigest,/^[a-f0-9]{64}$/);
 const pending=pcmCapture();pending.receipts.push({...pending.receipts[0],ordinal:4,status:'pending',sha256:null});const pendingSummary=observer.sanitizePcmBoundaryReceipts([pending],{baseline});assert.equal(pendingSummary.selectedCapture.declaredComplete,true);assert.equal(pendingSummary.selectedCapture.validatedComplete,false);assert.equal(pendingSummary.selectedCapture.contradiction,true);assert.equal(pendingSummary.selectedCapture.allReceiptsHashed,false);
 const wrongLineage=pcmCapture();wrongLineage.receipts[0].spans[0].captureId='22222222-2222-4222-8222-222222222222';const lineageSummary=observer.sanitizePcmBoundaryReceipts([wrongLineage],{baseline});assert.equal(lineageSummary.selectedCapture.validatedComplete,false);assert.equal(lineageSummary.selectedCapture.allSpansCurrentCapture,false);
 const missing=pcmCapture();missing.receipts.pop();assert.equal(observer.sanitizePcmBoundaryReceipts([missing],{baseline}).selectedCapture.validatedComplete,false);
 const wrongHash=pcmCapture();wrongHash.receipts[0].sha256='not-a-hash';assert.equal(observer.sanitizePcmBoundaryReceipts([wrongHash],{baseline}).selectedCapture.validatedComplete,false);
});

test('PCM current capture is bound after the pre-Start baseline and stale or successor captures refuse selection',()=>{
 const old=pcmCapture('22222222-2222-4222-8222-222222222222',5),current=pcmCapture();
 const selected=observer.sanitizePcmBoundaryReceipts([old,current],{baseline:{observedAtMs:10,captureIds:[old.captureId]}});assert.equal(selected.selectionStatus,'passed');assert.equal(selected.selectedCapture.createdAtMs,20);
 assert.equal(observer.sanitizePcmBoundaryReceipts([old],{baseline:{observedAtMs:10,captureIds:[old.captureId]}}).selectionCode,'PCM_CURRENT_CAPTURE_MISSING');
 const successor=pcmCapture('33333333-3333-4333-8333-333333333333',30);assert.equal(observer.sanitizePcmBoundaryReceipts([current,successor],{baseline}).selectionCode,'PCM_CURRENT_CAPTURE_AMBIGUOUS');
});

test('real evidence writer preserves the bounded PCM summary without blocking or truncation',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pcm-writer-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const recorder=createCaseRecorder({caseId:'AHT-02',sourceSha:'a'.repeat(40),servedSha:'a'.repeat(40),targetUrl:'https://speaksharp-public.vercel.app',requiredAssertions:['focus-final']},dir);
 const diagnostic=observer.sanitizePcmBoundaryReceipts([pcmCapture()],{baseline});const ref=recorder.writeEvidence('pcm.json',{contentSafe:true,caseId:'AHT-02',kind:'pcm-boundary-diagnostic',...diagnostic});const written=JSON.parse(fs.readFileSync(path.join(dir,ref)));
 assert.deepEqual(written.sanitizer,{blockedStrings:0,droppedKeys:0,truncated:0});assert.equal(written.selectedCapture.validatedComplete,true);assert.equal(written.selectedCapture.domains.length,4);
});

test('PCM receipt capture is opt-in and only the selected Focus path enables it',async()=>{
 const args=[];const page={addInitScript:async(_fn,arg)=>args.push(arg)};
 await observer.install(page);await observer.install(page,{pcmBoundaries:true});assert.deepEqual(args,[false,true]);
});

for(const caseId of ['AHT-02','AHT-03'])test(caseId+' attaches the sanitized PCM diagnostic to focus-final without making the verdict',async()=>{
 const sanitized=observer.sanitizePcmBoundaryReceipts([pcmCapture()],{baseline});const f=await execute(caseId,{pcmReceipt:sanitized});
 const row=f.recorded.find(r=>r.id==='focus-final');assert.equal(row.result,'PASS');assert.ok(row.evidenceRefs.includes(caseId.toLowerCase()+'-pcm-boundaries.json'));
 const evidence=f.writes.find(x=>x.kind==='pcm-boundary-diagnostic');assert.equal(evidence.diagnosticOnly,true);assert.equal(evidence.selectedCapture.validatedComplete,true);
});

test('missing PCM diagnostics create no evidence while malformed identity is retained as a bounded diagnostic failure',async()=>{
 const malformed=observer.sanitizePcmBoundaryReceipts([{schema:'not-accepted',privateAudio:'must-not-escape'}],{baseline});
 const absent=await execute('AHT-03',{pcmReceipt:null});assert.equal(absent.recorded.find(r=>r.id==='focus-final').result,'PASS');assert.equal(absent.writes.some(x=>x.kind==='pcm-boundary-diagnostic'),false);
 const failed=await execute('AHT-03',{pcmReceipt:malformed});assert.equal(failed.recorded.find(r=>r.id==='focus-final').result,'PASS');const evidence=failed.writes.find(x=>x.kind==='pcm-boundary-diagnostic');assert.equal(evidence.selectionStatus,'failed');assert.equal(evidence.selectionCode,'PCM_CAPTURE_IDENTITY_INVALID');assert.equal(JSON.stringify(evidence).includes('must-not-escape'),false);
});

for(const [name,options] of [['save wait', {saveFailure:true}],['final Focus wait',{finalWaitFailure:true}]])test('PCM diagnostic survives '+name+' interruption and remains linked to the failed row',async()=>{
 const diagnostic=observer.sanitizePcmBoundaryReceipts([pcmCapture()],{baseline});const f=await execute('AHT-02',{pcmReceipt:diagnostic,...options});const row=f.recorded.find(r=>r.id==='focus-final');
 assert.equal(row.result,'FAIL');assert.ok(row.evidenceRefs.includes('aht-02-pcm-boundaries.json'));assert.ok(f.writes.some(x=>x.kind==='pcm-boundary-diagnostic'));
});
