'use strict';
// Ported from the harness proof workspace (harness-proof-workspace.zip sha256 9fc02fd68a8d272d61817bcb2fc6fa662b69e11b08c22d3389e78aaf0f9566cd), tests/extra-tests-r15/harness-fixes-r15.offline.test.cjs; only the path, pin and browser bindings below changed.
// r15 candidate controls (consolidated owner punchlist after r14). Synthetic only: no network, account or production host.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fake,minCfg,P}=require('./helpers/fake-run.cjs');
const core=require(P+'/bundle/harness/campaign-core.cjs');
const oracle=require(P+'/draft-adapters/focus-oracle.cjs');
const pres=require(P+'/draft-adapters/presentation-controls.cjs');
const policy=require(P+'/draft-adapters/coaching-failure-policy.cjs');
const outcome=require(P+'/bundle/harness/outcome-class.cjs');
const {verifyStimulusReceipt}=require(P+'/bundle/harness/stimulus-receipt.cjs');
const {summarizeAssertions}=require(P+'/bundle/harness/case-results.cjs');
const {sanitizeEvidence}=require(P+'/bundle/harness/evidence-sanitizer.cjs');
const Pn='pending',Pa='partial',Cv='covered';
const frozen=(timeline,extra={})=>({frozen:true,samples:60,unreadable:0,timeline,multiMarker:[],...extra});
// ---------- F. Focus oracle: duplicate markers and contradictory states ----------
test('F1 a duplicate marker is a FAIL even when the first marker is on the right point',()=>{
  const r=oracle.markerVerdict(frozen([[0,0,[Pn,Pn,Pn,Pn]],[5000,0,[Pn,Pn,Pn,Pn]]],{multiMarker:[[2500,2]]}));
  assert.equal(r.result,'FAIL');assert.equal(r.facts.resultBasis,'duplicate-marker');assert.equal(r.facts.duplicateMarkerSamples,1);assert.equal(r.facts.maxMarkersInASample,2);assert.equal(r.facts.firstDuplicateMarkerMs,2500);
});
test('F2 a status that goes backwards is a contradiction: the marker row is NOT RUN (inconclusive), never a PASS and never a product FAIL',()=>{
  const r=oracle.markerVerdict(frozen([[0,0,[Pn,Pn,Pn,Pn]],[3000,1,[Pa,Pn,Pn,Pn]],[4000,0,[Pn,Pn,Pn,Pn]]]));
  assert.equal(r.result,'NOT RUN');assert.equal(r.facts.resultBasis,'contradictory-state');assert.deepEqual(r.facts.contradictionKinds,['status-went-backwards']);assert.equal(r.facts.statusRegressions,1);
  const t=oracle.markerVerdict(frozen([[5000,0,[Pn,Pn,Pn,Pn]],[1000,0,[Pn,Pn,Pn,Pn]]]));assert.equal(t.result,'NOT RUN');assert.deepEqual(t.facts.contradictionKinds,['timestamps-went-backwards']);
  const o=oracle.markerVerdict(frozen([[0,9,[Pn,Pn,Pn,Pn]]]));assert.ok(o.result==='FAIL'||o.result==='NOT RUN');assert.ok(o.facts.contradictionKinds.includes('marker-out-of-range'));
});
test('F3 a real marker defect is never hidden by a contradiction: wrong marker plus regression stays FAIL; the original R5 shapes still PASS',()=>{
  assert.equal(oracle.markerVerdict(frozen([[0,0,[Pn,Pn,Pn,Pn]],[3000,3,[Pa,Pn,Pn,Pn]],[4000,0,[Pn,Pn,Pn,Pn]]])).result,'FAIL');
  assert.equal(oracle.markerVerdict(frozen([[0,0,[Pn,Pn,Pn,Pn]],[12003,0,[Pn,Pn,Pa,Pn]],[23501,0,[Pn,Pn,Pa,Cv]]])).result,'PASS');
  assert.equal(oracle.markerVerdict(frozen([[9,0,[Pn,Pn,Pn,Pn]],[6010,0,[Pn,Pn,Pa,Pn]]])).result,'PASS');
  const f=oracle.markerVerdict(frozen([[0,0,[Pn,Pn,Pn,Pn]],[3000,1,[Pa,Pn,Pn,Pn]],[4000,0,[Pn,Pn,Pn,Pn]]])).facts;assert.equal(sanitizeEvidence({contentSafe:true,...f}).stats.blockedStrings,0);
});
test('F4 the live sampler counts markers per sample: two "Still to cover" rows in one sample are reported, the marker index is still the first',async()=>{
  let tick;const win={};const marked=new Set([0,2]);
  const doc={querySelector:sel=>{const i=Number((sel.match(/focus-point-(\d+)/)||[])[1]);return {getAttribute:()=>'pending',querySelectorAll:()=>[{textContent:marked.has(i)?'Still to cover':'x'}]};},querySelectorAll:()=>[]};
  const page={evaluate:async(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(arg)',{window:win,arg,document:doc,setInterval:f=>{tick=f;return 1;},clearInterval:()=>{tick=null;}})};
  const w=await pres.beginFocusLive(page,4);tick();const {rows,observed}=await pres.freezeFocusLiveDetailed(page,w);
  assert.ok(observed.multiMarker.length>=1&&observed.multiMarker[0][1]===2,JSON.stringify(observed.multiMarker));assert.equal(rows[0].result,'FAIL');assert.equal(rows[0].facts.resultBasis,'duplicate-marker');
});
// ---------- D. diagnostic code allowlist and honest latency ----------
test('D1 error codes come from a CLOSED allowlist: listed codes normalised, any other identifier becomes code-unlisted, prose is dropped',()=>{
  const c=body=>policy.classifyFailureResponse({contentType:'application/json',body:JSON.stringify(body),startedAt:0,respondedAt:10}).errorCode;
  assert.equal(c({error:'Upstream-Timeout'}),'code-upstream_timeout');assert.equal(c({code:'RATE_LIMITED'}),'code-rate_limited');assert.equal(c({error_code:'bad.gateway'}),'code-bad_gateway');
  assert.equal(c({error:'user_9f3a1c77deadbeef'}),'code-unlisted','an id-shaped value must never reach evidence');assert.equal(c({error:'tok_live_abc123'}),'code-unlisted');
  assert.equal(c({error:'Something went wrong with provider X'}),null);assert.equal(c({message:'only prose'}),null);
  for(const code of policy.ERROR_CODE_ALLOWLIST)assert.match(code,/^[a-z][a-z_]*$/);assert.ok(policy.ERROR_CODE_ALLOWLIST.size>=15);
  const j=policy.classifyFailureResponse({contentType:'application/json',body:JSON.stringify({error:'user_9f3a1c77deadbeef'}),startedAt:0,respondedAt:10});assert.equal(sanitizeEvidence({contentSafe:true,...j}).stats.blockedStrings,0);assert.ok(!JSON.stringify(j).includes('9f3a1c77'));
});
test('D2 latency is honest: event-clock elapsed and the browser timing are separate labelled fields; a missing measurement is null, never a number from a later moment',()=>{
  const a=policy.classifyFailureResponse({contentType:'application/json',body:'{}',startedAt:1000,respondedAt:31039,browserTimingMs:30030.4});
  assert.equal(a.elapsedMs,30039);assert.equal(a.latencyBasis,'request-event-to-response-event');assert.equal(a.browserTimingMs,30030);
  const b=policy.classifyFailureResponse({contentType:'',body:'',startedAt:1000});assert.equal(b.elapsedMs,null);assert.equal(b.latencyBasis,'unavailable');assert.equal(b.browserTimingMs,null);
  const c=policy.classifyFailureResponse({contentType:'',body:'',startedAt:5000,respondedAt:4000,browserTimingMs:-1});assert.equal(c.elapsedMs,null);assert.equal(c.browserTimingMs,null);
  assert.ok(!/Date\.now\(\)-t0/.test(fs.readFileSync(P+'/draft-adapters/source-adapters.cjs','utf8')),'the r14 fallback clock is gone');
});
test('D3 through the real driver: the request event stamps the start and the response event the end; the 502 keeps a closed code and both latencies',async()=>{
  const focusStub={'./focus-controls.cjs':{...require(P+'/draft-adapters/focus-controls.cjs'),backReload:async()=>[{id:'focus-back-reload',result:'PASS',facts:{}}]}};
  const r=await fake('AHT-03',{cfg:{sampleMode:'breadth',takeCap:1,startPressCap:1},extraStubs:focusStub,coaching:{status:502,responseEnd:30030,body:JSON.stringify({error:'gateway_timeout',message:'SECRET'})}});
  const ev=r.evidence.find(e=>e.v.assertion==='grounded-coaching').v;const d=ev.facts.attempts[0].diag;
  assert.equal(d.errorCode,'code-gateway_timeout');assert.equal(d.latencyBasis==='unavailable'||d.latencyBasis==='request-event-to-response-event',true);assert.ok(d.elapsedMs===null||d.elapsedMs>=0);assert.equal(d.browserTimingMs,30030);
  assert.ok(!JSON.stringify(r.evidence).includes('SECRET'));
});
// ---------- E. evidence saved even when later actions fail ----------
test('E1 Stop fails after the live window: the frozen live rows and diagnostics are already recorded; later rows are notReached; the original observation is kept',async()=>{
  const r=await fake('AHT-03',{cfg:{sampleMode:'breadth',takeCap:1,startPressCap:1},ui:{stop:async()=>{throw new Error('stop failed')}},observer:{audioTiming:async()=>({gumCalledMs:900,gumResolvedMs:990,tapStartMs:1000,tapState:'running',energy:[],states:[],acquisitions:[{}]})},presentation:{beginFocusLive:async()=>({armed:true}),
    freezeFocusLiveDetailed:async()=>({rows:[{id:'focus-next-point-marked',result:'FAIL',facts:{resultBasis:'marker-wrong'}},{id:'focus-no-red-before-stop',result:'PASS',facts:{}}],observed:frozen([[0,0,[Pn,Pn,Pn,Pn]]])})}});
  const m=new Map(r.res.assertions.map(a=>[a.id,a]));
  assert.equal(m.get('focus-next-point-marked').result,'FAIL','recorded before Stop');assert.equal(m.get('focus-no-red-before-stop').result,'PASS');
  assert.ok(r.evidence.some(e=>e.name==='aht-03-focus-recognition.json'),'diagnostic written before Stop');
  assert.equal(m.get('saved-once').result,'NOT RUN');assert.ok(r.evidence.find(e=>e.v.assertion==='saved-once').v.facts.notReached||r.evidence.find(e=>e.v.assertion==='saved-once').v.facts.interrupted);
  assert.equal(summarizeAssertions({...r.config},r.res.assertions).result,'FAIL','the preserved FAIL still decides the case');
});
test('E2 static: the live window is recorded exactly once, before Stop, and open-mic review rows are still recorded after save',()=>{
  const s=fs.readFileSync(P+'/draft-adapters/source-adapters.cjs','utf8'),a=s.indexOf('const firstStartedAt='),b=s.indexOf("await check('saved-once'",a),body=s.slice(a,b);
  assert.ok(body.indexOf("await emitPresentation(livePresentation,")<body.indexOf('await ui.stop'));assert.equal((body.match(/emitPresentation\(livePresentation,/g)||[]).length,1);assert.ok(body.indexOf('openMicReview')>body.indexOf('await ui.saved'));
});
// ---------- S. selected cases and stimulus gates (real campaign core) ----------
const hash='a'.repeat(64),commit='b'.repeat(40),NOW=Date.parse('2026-10-28T20:00:00Z');
const backend={manifestRef:'owner-deployment-manifest-ref',source:'owner-stated',generation:6,completion:'OFF',facts:[{name:'migration-129',state:'absent'}],verifiedAtUtc:null};
function plan(extra={}){return{version:1,campaignId:'UNIT-NOT-A-RUN',runtime:'Claude SpeakSharp R4',targetUrl:'https://speaksharp-public.vercel.app/',costCeilingUsd:0,sourceSha:commit,servedSha:commit,admissionConfigFile:'unit.json',admissionConfigSha256:hash,stepRoot:'unit',stepManifestFile:'steps.json',stepManifestSha256:hash,campaignLedger:'ledger.json',identityLedger:'identity.json',identityCap:32,runRoot:'unit',deadlineAt:'2026-10-29T02:00:00Z',cleanupReserveMs:1000,cases:core.IDS.map(id=>({id,driverFile:id+'.cjs',driverSha256:hash,configFile:id+'.json',configSha256:hash,maxMs:100,...(['AHT-04','AHT-12','AHT-13','AHT-14','AHT-03'].includes(id)?{mediaFile:'/m/x.wav',mediaSha256:hash}:{})})),...extra};}
const SEL=['AHT-12','AHT-04','AHT-13','AHT-14','AHT-03'];
const selection=(ids=SEL)=>({ids,order:ids,ownerApprovalReference:'owner-chat-approval-ref-1',reason:'targeted run'});
const gates=()=>[{caseId:'AHT-04',requires:[{caseId:'AHT-12',row:'press-bound-denial',result:'PASS'}]},{caseId:'AHT-13',requires:[{caseId:'AHT-04',row:'cold-pending-observed',result:'PASS'}]},{caseId:'AHT-14',requires:[{caseId:'AHT-04',row:'cold-pending-observed',result:'PASS'}]}];
function io(rows={}){const calls=[];return{calls,now:()=>NOW,save:async()=>{},preflightCase:async c=>calls.push('check:'+c.id),admit:async()=>{calls.push('admit');return{result:'ADMISSION PASS'};},identity:async phase=>{calls.push('identity:'+phase);return{result:'MATCH',servedSha:commit};},caseConfig:async c=>({caseId:c.id,sourceSha:commit,servedSha:commit,targetUrl:'https://speaksharp-public.vercel.app/',requiredAssertions:['denial','pending','actual']}),
  runCase:async c=>{calls.push('run:'+c.id);const r=rows[c.id]||{};return{assertions:[{id:'denial',result:r.denial||'PASS',detail:'unit',evidenceRefs:['u.json']},{id:'pending',result:r.pending||'PASS',detail:'unit',evidenceRefs:['u.json']},{id:'actual',result:'PASS',detail:'unit',evidenceRefs:['u.json']}]};}};}
const gp=()=>plan({selection:selection(),identityCap:12,gates:[{caseId:'AHT-04',requires:[{caseId:'AHT-12',row:'denial',result:'PASS'}]},{caseId:'AHT-13',requires:[{caseId:'AHT-04',row:'pending',result:'PASS'}]},{caseId:'AHT-14',requires:[{caseId:'AHT-04',row:'pending',result:'PASS'}]}]});
test('S1 selection validation: owner reference, reason, ids, order permutation and gate ordering are all required',()=>{
  const v=p=>core.validateCampaignPlan(p);
  assert.doesNotThrow(()=>v(plan({selection:selection(),identityCap:12})));
  for(const [bad,re] of [[{...selection(),ownerApprovalReference:''},/ownerApprovalReference/],[{...selection(),reason:''},/reason/],[{ids:['AHT-99'],ownerApprovalReference:'owner-ref-12345',reason:'x'},/selection.ids/],[{...selection(),order:['AHT-12','AHT-04']},/permutation/],[{ids:[],ownerApprovalReference:'owner-ref-12345',reason:'x'},/selection.ids/]])assert.throws(()=>v(plan({selection:bad,identityCap:12})),re);
  assert.throws(()=>v(plan({selection:selection(),identityCap:12,gates:[{caseId:'AHT-12',requires:[{caseId:'AHT-04',row:'x',result:'PASS'}]}]})),/earlier selected case/);
  assert.throws(()=>v(plan({selection:selection(),identityCap:12,gates:[{caseId:'AHT-01',requires:[{caseId:'AHT-12',row:'x',result:'PASS'}]}]})),/gate/);
  assert.throws(()=>v(plan({gates:gates()})),/gates need a valid selection/);
});
test('S2 identity cap scales with the selection: 2k+2 reads, so 5 cases need 12 and 11 is refused; the full run still needs 32',()=>{
  assert.equal(core.requiredIdentityCap(5),12);assert.throws(()=>core.validateCampaignPlan(plan({selection:selection(),identityCap:11})),/minimum 12 for 5 cases/);
  // Proof-v2 positive control (Sam 1793390819, Jensen's M11 witness): the scaled minimum is ACCEPTED, so a cap that ignores the selection is caught here.
  assert.doesNotThrow(()=>core.validateCampaignPlan(plan({selection:selection(),identityCap:12})));assert.equal(core.requiredIdentityCap(),32);assert.throws(()=>core.validateCampaignPlan(plan({identityCap:31})),/minimum 32 for 15 cases/);
});
test('S3 a selected run dispatches only the selected cases, in the approved order, with exactly 2k+2 identity reads; unselected cases are notSelected, not dispatched and cost nothing',async()=>{
  const x=io(),r=await core.runCampaign(gp(),x,{executeR0:true});
  assert.deepEqual(x.calls.filter(s=>s.startsWith('run:')),SEL.map(id=>'run:'+id));assert.deepEqual(x.calls.filter(s=>s.startsWith('check:')),SEL.map(id=>'check:'+id),'only selected cases are preflighted');
  assert.equal(x.calls.filter(s=>s.startsWith('identity:')).length,2*5+1,'before/after each selected case plus the campaign-end read; the admission read is the 12th (2k+2)');assert.equal(r.report.identityPlan.requiredCap,12);assert.equal(r.report.driverPreflight,'SELECTED_5_BOUND');
  for(const id of core.IDS.filter(i=>!SEL.includes(i))){const row=r.report.cases.find(c=>c.caseId===id);assert.equal(row.notSelected,true);assert.equal(row.requestsUsed,0);assert.match(row.reason,/Not selected/);assert.ok(!x.calls.some(s=>s.includes(id)));}
  assert.equal(r.report.result,'NOT RUN','a subset can never be an all-journey PASS');assert.deepEqual(r.report.selection.order,SEL);assert.equal(r.report.selection.unselected.length,10);
});
test('S4 stimulus gates: when the denial stimulus is not established, AHT-04/13/14 are NOT dispatched and spend no request, identity read or time; the reason names the missing stimulus',async()=>{
  const x=io({'AHT-12':{denial:'NOT RUN'}}),r=await core.runCampaign(gp(),x,{executeR0:true});
  assert.deepEqual(x.calls.filter(s=>s.startsWith('run:')),['run:AHT-12','run:AHT-03']);
  for(const id of ['AHT-04','AHT-13','AHT-14']){const row=r.report.cases.find(c=>c.caseId===id);assert.equal(row.gateBlocked,true);assert.match(row.reason,/^NOT_RUN: prerequisite stimulus not established/);assert.equal(row.requestsUsed,0);assert.ok(!x.calls.some(s=>(s.startsWith('identity:')||s.startsWith('run:'))&&s.includes(id)),id+' no identity read and no run');}
  assert.equal(r.report.cases.find(c=>c.caseId==='AHT-13').gateRequirement.caseId,'AHT-04','a gate whose prerequisite itself never ran is blocked too');
  assert.equal(x.calls.filter(s=>s.startsWith('identity:')).length,2*2+1,'only the two cases that ran are read (before/after each) plus the campaign-end read');
});
test('S5 gates chain: denial PASS runs AHT-04; AHT-04 pending PASS runs 13 and 14; AHT-04 pending NOT RUN blocks 13 and 14 only',async()=>{
  const ok=io(),r1=await core.runCampaign(gp(),ok,{executeR0:true});assert.deepEqual(ok.calls.filter(s=>s.startsWith('run:')),SEL.map(id=>'run:'+id));assert.ok(r1.report.cases.every(c=>!c.gateBlocked));
  const x=io({'AHT-04':{pending:'NOT RUN'}}),r2=await core.runCampaign(gp(),x,{executeR0:true});assert.deepEqual(x.calls.filter(s=>s.startsWith('run:')),['run:AHT-12','run:AHT-04','run:AHT-03']);
  assert.equal(r2.report.cases.find(c=>c.caseId==='AHT-13').gateBlocked,true);assert.equal(r2.report.cases.find(c=>c.caseId==='AHT-14').gateBlocked,true);assert.ok(!r2.report.cases.find(c=>c.caseId==='AHT-04').gateBlocked);
});
test('S6 request budget with a selection: unselected cases are treated as skipped, later selected cases stay protected by the APPROVED ORDER, an underfunded selection is refused',async()=>{
  const est=Object.fromEntries(core.IDS.map(id=>[id,SEL.includes(id)?100:0])),ceil=Object.fromEntries(core.IDS.map(id=>[id,SEL.includes(id)?125:0]));
  const ok=plan({selection:selection(),identityCap:12,requestBudget:{runCap:600,cleanupReserve:50,estimates:est,ceilings:ceil}});assert.doesNotThrow(()=>core.validateCampaignPlan(ok));
  assert.throws(()=>core.validateCampaignPlan(plan({selection:selection(),identityCap:12,requestBudget:{runCap:500,cleanupReserve:50,estimates:est,ceilings:ceil}})),/underfunded/);
  let used=0;const x=io();x.verifyBudgetBinding=async()=>{};x.ledgerUsed=()=>used;const run=x.runCase;x.runCase=async(c,p,a,o)=>{const seen=o.requestAllowance;x.calls.push('allow:'+c.id+':'+seen);used+=140;return run(c,p,a,o);};
  const r=await core.runCampaign(ok,x,{executeR0:true});
  assert.equal(r.report.cases.find(c=>c.caseId==='AHT-12').requestAllowance,125);assert.ok(r.report.cases.find(c=>c.caseId==='AHT-03').requestAllowance<=125);
  const protectedLater=ok.requestBudget.runCap-0-50-(100*4);assert.ok(r.report.cases.find(c=>c.caseId==='AHT-12').requestAllowance<=protectedLater,'protects the four later selected cases, not the ten unselected ones');
});
// ---------- I. run identity binding ----------
test('I1 run identity: release, runner and backend are required and labelled; owner-stated must not carry a verification time, cloud-verified must',()=>{
  const ok={frontend:{sourceSha:commit,servedSha:commit},runner:{codeManifestSha256:hash,packetManifestSha256:hash},backend};
  assert.deepEqual(core.validateRunIdentity(ok),[]);assert.deepEqual(core.validateRunIdentity(undefined),[]);
  assert.ok(core.validateRunIdentity({...ok,frontend:{sourceSha:commit,servedSha:'c'.repeat(40)}}).length);assert.ok(core.validateRunIdentity({...ok,runner:{codeManifestSha256:'x',packetManifestSha256:hash}}).length);
  assert.ok(core.validateRunIdentity({...ok,backend:{...backend,verifiedAtUtc:'2026-10-28T10:00:00Z'}}).length,'owner-stated with a verification time is contradictory');
  assert.ok(core.validateRunIdentity({...ok,backend:{...backend,source:'cloud-verified'}}).length,'cloud-verified needs a time');assert.deepEqual(core.validateRunIdentity({...ok,backend:{...backend,source:'cloud-verified',verifiedAtUtc:'2026-10-28T10:00:00Z'}}),[]);
  assert.ok(core.validateRunIdentity({...ok,backend:{...backend,facts:[{name:'Migration 129',state:'absent'}]}}).length);assert.ok(core.validateRunIdentity({...ok,backend:{...backend,completion:'maybe'}}).length);
  assert.throws(()=>core.validateCampaignPlan(plan({runIdentity:{...ok,runner:{}}})),/runIdentity/);
});
test('I2 the report carries the run identity with the media and driver hash of every selected case (null media where none is bound)',async()=>{
  const ri={frontend:{sourceSha:commit,servedSha:commit},runner:{codeManifestSha256:hash,packetManifestSha256:hash},backend};
  const x1=io();x1.verifyRunIdentity=async()=>{};const r=await core.runCampaign(plan({selection:selection(),identityCap:12,runIdentity:ri}),x1,{});
  assert.ok(r.report&&r.report.runIdentity,'the report carries a run identity');  // asserted before use (Sam 1793390819): absence is a FAIL, never a runtime error
  assert.equal(r.report.runIdentity.backend.source,'owner-stated');assert.equal(r.report.runIdentity.cases.length,5);assert.equal(r.report.runIdentity.cases.find(c=>c.id==='AHT-12').mediaSha256,hash);
  const x2=io();x2.verifyRunIdentity=async()=>{};const r2=await core.runCampaign(plan({runIdentity:ri}),x2,{});assert.ok(r2.report&&r2.report.runIdentity,'the full-run report carries a run identity');assert.equal(r2.report.runIdentity.cases.find(c=>c.id==='AHT-01').mediaSha256,null);
});
test('I3 the runner refuses a run whose loaded runner code differs from the identity the plan declares (real adapter hook)',async()=>{
  const runner=require(P+'/bundle/harness/campaign-runner.cjs'),bundle=P+'/bundle',crypto=require('node:crypto');
  const codeSha=crypto.createHash('sha256').update(fs.readFileSync(bundle+'/CODE.sha256')).digest('hex');
  const p=plan({runIdentity:{frontend:{sourceSha:commit,servedSha:commit},runner:{codeManifestSha256:codeSha,packetManifestSha256:hash},backend}});
  const a=runner.createAdapter({...p,runRoot:'/tmp/unused-r15'},bundle,{});
  await a.verifyRunIdentity(p);
  await assert.rejects(()=>a.verifyRunIdentity({...p,runIdentity:{...p.runIdentity,runner:{...p.runIdentity.runner,codeManifestSha256:hash}}}),/differs from the runner bundle CODE.sha256/);
  await assert.rejects(()=>a.verifyRunIdentity({...p,sourceSha:'c'.repeat(40)}),/differs from the plan source SHA/);
  const s=fs.readFileSync(bundle+'/harness/campaign-runner.cjs','utf8');assert.ok(s.includes('run identity binding (release, runner, media, backend) is required to execute'));assert.ok(s.includes('a stimulus preflight receipt is required to execute'));
});
// ---------- P. stimulus preflight receipt ----------
const receipt=(over={})=>({schema:'speaksharp.stimulus-preflight.v1',createdAt:new Date(NOW-60000).toISOString(),productTraffic:0,codeManifestSha256:hash,cases:{'AHT-12':{mediaSha256:hash,captureGranted:true,ungrantedOutcome:'not-allowed',noDeviceOutcome:'not-found',speechDetected:true,alignment:{status:'not-applicable'},ready:true},'AHT-03':{mediaSha256:hash,captureGranted:true,ungrantedOutcome:'not-allowed',noDeviceOutcome:'not-found',speechDetected:true,alignment:{status:'aligned',estimateSec:0.1},ready:true}},...over});
const ctx={selected:['AHT-12','AHT-03','AHT-01'],mediaShaByCase:{'AHT-12':hash,'AHT-03':hash,'AHT-01':null},needsDevice:id=>id!=='AHT-01',codeManifestSha256:hash,now:NOW};
test('P1 a complete receipt passes; every missing proof is a named refusal',()=>{
  assert.deepEqual(verifyStimulusReceipt(receipt(),ctx),[]);
  const bad=(mut,re)=>{const r=receipt();mut(r);const e=verifyStimulusReceipt(r,ctx).join('|');assert.match(e,re);};
  bad(r=>{r.cases['AHT-12'].captureGranted=false;},/capture device not acquired/);bad(r=>{r.cases['AHT-12'].noDeviceOutcome='other';},/no-device control/);bad(r=>{r.cases['AHT-12'].speechDetected=false;},/no speech heard/);
  bad(r=>{r.cases['AHT-12'].ungrantedOutcome='granted';},/NotAllowedError/);bad(r=>{r.cases['AHT-03'].alignment={status:'misaligned'};},/not aligned/);bad(r=>{delete r.cases['AHT-03'];},/no receipt entry/);
  bad(r=>{r.cases['AHT-12'].mediaSha256='d'.repeat(64);},/no receipt entry for the bound media/);bad(r=>{r.codeManifestSha256='d'.repeat(64);},/different runner code manifest/);bad(r=>{r.productTraffic=3;},/zero product traffic/);
  bad(r=>{r.createdAt=new Date(NOW-13*3600*1000).toISOString();},/stale/);bad(r=>{r.schema='x';},/schema/);bad(r=>{r.cases['AHT-12'].ready=false;},/not ready/);
});
// ---------- O. outcome classes ----------
test('O1 outcome classes separate product failure, harness failure, setup-blocked, missing evidence, omitted-by-design and allowance interruption; NOT RUN never reads as a product verdict',()=>{
  const c=(row,facts)=>outcome.classifyRow(row,facts);
  assert.equal(c({id:'saved-once',result:'PASS'}),'pass');assert.equal(c({id:'owned-pages-closed',result:'PASS'}),'harness-control');
  assert.equal(c({id:'focus-final',result:'FAIL'},{}),'product-failure');assert.equal(c({id:'focus-final',result:'FAIL'},{interrupted:true}),'harness-failure');
  assert.equal(c({id:'cold-pending-observed',result:'NOT RUN'},{setupBlocked:true,setupReason:'no-model-request-after-press'}),'setup-blocked');
  assert.equal(c({id:'older-take-association',result:'NOT RUN'},{evidenceReaderUnavailable:true}),'missing-evidence');assert.equal(c({id:'x',result:'NOT RUN'},{}),'missing-evidence');
  assert.equal(c({id:'review-reopen',result:'NOT RUN'},{omittedBy:'minimal-sample'}),'omitted-by-design');assert.equal(c({id:'x',result:'NOT RUN'},{notReached:true}),'not-reached');
  assert.equal(c({id:'x',result:'NOT RUN',interruptedBy:'request-allowance'},{}),'allowance-interrupted');
  const k=outcome.classifyCase([{id:'a',result:'PASS'},{id:'b',result:'FAIL'},{id:'c',result:'NOT RUN'}],{c:{omittedBy:'breadth-sample'}});assert.equal(k.counts['omitted-by-design'],1);assert.equal(k.counts.pass,1);assert.equal(k.counts['product-failure'],1);
  const s=fs.readFileSync(P+'/bundle/harness/campaign-runner.cjs','utf8');assert.ok(s.includes('outcome-class.cjs')&&s.includes('ownedProcessesRemaining'),'runner returns classes and the case cleanup receipt');
});
