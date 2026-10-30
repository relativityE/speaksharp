'use strict';
// SOURCE-DERIVED, TARGET-UNBOUND. No live claim. See README.md and contracts.json.
// Never import native Playwright test fixtures or the repository's admin-bearing RWT helpers.
const ui=require('./browser-actions.cjs');
const readback=require('./browser-readback.cjs');
const observer=require('./browser-observers.cjs');
const repeatProbes=require('./repeat-probes.cjs');
const focusControls=require('./focus-controls.cjs');
const presentation=require('./presentation-controls.cjs');
const focusOracle=require('./focus-oracle.cjs');
const audioTiming=require('./audio-timing.cjs');
const fixtureManifest=require('./oracles/pure/fixture-manifest.json');
const fixtureActivity=require('./fixture-activity.json');
const feedbackRetry=require('./feedback-retry-controls.cjs');
const navigation=require('./navigation-controls.cjs');
const saveFault=require('./save-fault-binding.cjs');
const progressNumeric=require('./progress-numeric.cjs');
const finiteDenominator=require('./finite-aht-denominator.json');
const SOURCE_SHA='66328703bf47e865b730e229005411e78481d34c';
const SHA=/^[0-9a-f]{64}$/;
const CONTRACTS={
 'AHT-01':{rows:['fresh-first-session','saved-once','grounded-coaching','review-reopen','pdf-owner-take','same-target-repeat'],oracles:['coaching','pdfOwnerTake','sameTarget'],takes:2},
 'AHT-02':{rows:['focus-final','focus-live-durable','saved-once','grounded-coaching','review-reopen','same-target-repeat','focus-edit-cancel-save','focus-new-set','open-mic-isolation','focus-back-reload'],oracles:['focusEvidence','coaching','sameTarget','focusControlBinding'],takes:4},
 'AHT-03':{rows:['focus-final','focus-live-durable','saved-once','grounded-coaching','review-reopen','same-target-repeat'],oracles:['focusEvidence','coaching','sameTarget'],takes:2},
 'AHT-04':{rows:['cold-pending-observed','pending-leave-no-mic','pending-leave-no-session','return-no-resume','deliberate-recovery-saved'],oracles:[],takes:1},
 'AHT-05':{rows:['fault-exercised','recovery-truthful','retry-saved-once','review-reopen','next-take-isolated'],oracles:[],takes:2},
 'AHT-06':{rows:['fault-exercised','recovery-truthful','retry-saved-once','review-reopen','next-take-isolated'],oracles:[],takes:2},
 'AHT-07':{rows:['fresh-acknowledgment','feedback-stored-once','older-take-association','older-coaching-association','received-feedback-proof'],oracles:['feedbackReceived','feedbackAssociation','coachingAssociation'],takes:2},
 'AHT-08':{rows:['fresh-acknowledgment','feedback-stored-once','no-session-association','no-coaching-association','received-feedback-proof'],oracles:['feedbackReceived','feedbackAssociation'],takes:0},
 'AHT-09':{rows:['recording-before-leave','leave-released','return-no-resume','recovery-truthful','left-take-saved-once','next-take-isolated','lease-fenced'],oracles:['abandonmentLease'],takes:2},
 'AHT-10':{rows:['recording-before-leave','leave-released','return-no-resume','recovery-truthful','next-take-isolated','lease-fenced'],oracles:['abandonmentLease'],takes:2},
 'AHT-11':{rows:['same-browser-refused','independent-context-refused','lease-before-model-window','takeover-fences-old-owner','two-takes-isolated'],oracles:['takeoverLease'],takes:2},
 'AHT-12':{rows:['press-bound-denial','denial-truthful-no-mic','allowed-recovery-saved','review-reopen'],oracles:[],takes:1},
 'AHT-13':{rows:['download-fault-exercised','download-failure-truthful','deliberate-recovery-saved','review-reopen'],oracles:[],takes:1},
 'AHT-14':{rows:['download-fault-exercised','download-failure-truthful','deliberate-recovery-saved','review-reopen'],oracles:[],takes:1},
 'AHT-15':{rows:['history-preserved','switches-mic-off','signed-out','return-owner-preserved','no-recording-or-session-write'],oracles:[],takes:0}
};
for(const id of ['AHT-01','AHT-02','AHT-03']){CONTRACTS[id].rows.push('analytics-repeat-opens-product','rapid-repeat-gate','rapid-repeat-release','next-start','next-start-release','probe-save-isolation');CONTRACTS[id].takes=id==='AHT-02'?7:4;}
for(const id of ['AHT-01','AHT-02','AHT-03'])CONTRACTS[id].rows.push(progressNumeric.ROW);
CONTRACTS['AHT-02'].rows.push('focus-switch-isolation');
CONTRACTS['AHT-03'].rows.push('focus-back-reload');
for(const id of ['AHT-05','AHT-06'])CONTRACTS[id].rows.push('completion-attempts');
CONTRACTS['AHT-02'].oracles=CONTRACTS['AHT-02'].oracles.filter(x=>x!=='focusControlBinding');
for(const [id,c]of Object.entries(CONTRACTS))c.unimplementedRequiredAssertions=finiteDenominator.requiredUnimplemented.filter(x=>x.caseIds.includes(id)).map(x=>x.assertionId);
for(const group of [...(finiteDenominator.requiredImplemented||[]),...finiteDenominator.requiredUnimplemented])for(const id of group.caseIds)CONTRACTS[id].rows.push(group.assertionId);
CONTRACTS['AHT-07'].rows.push(...Object.values(feedbackRetry.ROWS),'feedback-attempts','feedback-readback-preflight');
CONTRACTS['AHT-01'].rows.push(...presentation.OPEN_ROWS);
for(const id of ['AHT-02','AHT-03'])CONTRACTS[id].rows.push(...presentation.FOCUS_ROWS);
// Full AHT12 cold recovery: denied Start, explicit setup Retry, then a separate recording Start.
// This strengthens preflight refusal for an insufficient approved cap; it never raises that cap.
const START_PRESS_MINIMUM=[4,7,4,2,2,2,2,0,3,3,4,3,2,2,0];
for(const [i,c]of Object.values(CONTRACTS).entries()){c.startPresses=START_PRESS_MINIMUM[i];c.rows=['owner-bound',...c.rows,'start-press-budget','no-cloud-stt','owned-pages-closed'];}
CONTRACTS['AHT-09'].rows.push('navigation-ready');
CONTRACTS['AHT-15'].rows.push('return-entry-mic-off','deep-link-exact-return','deep-link-rendered-own-detail','deep-link-mic-off','return-signed-out');
// Breadth sample: AHT-02/03 run ONE saved take. AHT-01 always runs FULL so one real two-take coaching comparison (first take plus same-target repeat) is preserved. Every row that needs a second take or a repeat is still required and is recorded NOT RUN (case incomplete, never PASS).
// Every other case keeps its full row set: its extra takes are paired failure/recovery, isolation or older/newer actions, not repetitions.
const BREADTH_NEEDS=Object.freeze({'AHT-02':{takes:1,startPresses:1},'AHT-03':{takes:1,startPresses:1}});
// Minimal sample (owner direction, fixed budget): every case still runs, each as a small signal. Retained rows keep their original oracles; everything beyond the cut is recorded
// NOT RUN (omittedBy:'minimal-sample'), so a cut case is incomplete and can never be PASS. AHT-01 keeps ONE small paired comparison (first take + same-target repeat).
const MINIMAL_NEEDS=Object.freeze({'AHT-01':{takes:2,startPresses:2},'AHT-02':{takes:1,startPresses:1},'AHT-03':{takes:1,startPresses:1},'AHT-04':{takes:0,startPresses:1},'AHT-05':{takes:1,startPresses:1},'AHT-06':{takes:1,startPresses:1},'AHT-07':{takes:1,startPresses:1},'AHT-08':{takes:0,startPresses:0},'AHT-09':{takes:1,startPresses:1},'AHT-10':{takes:1,startPresses:1},'AHT-11':{takes:1,startPresses:3},'AHT-12':{takes:0,startPresses:1},'AHT-13':{takes:0,startPresses:1},'AHT-14':{takes:0,startPresses:1},'AHT-15':{takes:0,startPresses:0}});
// r14: a case that presses Start needs a capture device. R5 launched AHT-04/12/13/14 with no fake capture device (media-less launch: takes 0), so the Private
// engine setup ended in an error before any model request and AHT-12 could never obtain a NotAllowedError. Pressing Start therefore binds media even when no take is recorded.
const requiresCaptureDevice=(caseId,c)=>needs(caseId,c).startPresses>0;
const needs=(caseId,c)=>c?.sampleMode==='minimal'&&MINIMAL_NEEDS[caseId]?MINIMAL_NEEDS[caseId]:c?.sampleMode==='breadth'&&BREADTH_NEEDS[caseId]?BREADTH_NEEDS[caseId]:{takes:CONTRACTS[caseId].takes,startPresses:CONTRACTS[caseId].startPresses};
function notRun(message){const e=new Error(message);e.code='NOT_RUN';e.trustedBlocker=message;throw e;}
function requireThat(value,message){if(!value)notRun(message);}
function safeRef(x){return typeof x==='string'&&x.length<512&&!x.startsWith('/')&&!x.split('/').includes('..')&&!/[\r\n]/.test(x);}
function preflight(caseId,c,cap,guard,configurationOnly=false){
 const contract=CONTRACTS[caseId];requireThat(contract,'unknown case');requireThat(contract.unimplementedRequiredAssertions.length===0,'required harness implementation missing: '+contract.unimplementedRequiredAssertions.join(', '));
 requireThat(c&&c.caseId===caseId&&c.sourceSha===SOURCE_SHA,'exact inspected source not bound; revalidation required for changed release');
 requireThat(/^[0-9a-f]{40}$/.test(c.servedSha||'')&&c.sourceSha===c.servedSha,'selected source/served binding missing or different');
 let url;try{url=new URL(c.targetUrl);}catch{notRun('target URL missing');}
 requireThat(url.protocol==='https:'&&url.origin===c.targetUrl,'target must be exact approved HTTPS origin');
 requireThat(Array.isArray(c.requiredAssertions)&&JSON.stringify([...c.requiredAssertions].sort())===JSON.stringify([...contract.rows].sort()),'required assertion denominator differs from source adapter');
 if(!configurationOnly){requireThat(typeof cap?.writeEvidence==='function'&&typeof cap.recordAssertion==='function','evidence sink missing');requireThat(typeof cap.credentials?.email==='string'&&typeof cap.credentials?.password==='string'&&cap.credentials.email&&cap.credentials.password,'approved credential pair missing');}
 readback.validateReadback(c);
 requireThat(c.account.mode===(caseId==='AHT-15'?'maintained-read-only':'existing-disposable'),'wrong account role');
 for(const name of ['preprovisionReceipt','analyticsExclusionReceipt','dispositionReceipt'])requireThat(safeRef(c.account[name]),'account '+name+' missing');
 requireThat(c.account.effectiveFeatureAccessApproved===true,'effective feature access unverified; Free label is not a verdict');
 requireThat(c.observerSourceReviewed===true&&safeRef(c.observerQualificationReceipt),'passive browser observer source/runtime qualification missing');
 requireThat(c.sampleMode===undefined||['full','breadth','minimal'].includes(c.sampleMode),'unknown sample mode');requireThat(c.sampleMode!=='breadth'||BREADTH_NEEDS[caseId],'breadth sample is not defined for this case; it runs in full');const need=needs(caseId,c);requireThat(Number.isInteger(c.takeCap)&&c.takeCap>=need.takes,'approved take cap insufficient');
 requireThat(Number.isInteger(c.startPressCap)&&c.startPressCap>=need.startPresses,'approved per-Start press cap insufficient');
 if(!configurationOnly&&need.startPresses>0)requireThat(typeof cap?.recordStartPress==='function','required per-Start press journal unavailable before login');
 if(need.takes>0||need.startPresses>0){requireThat(SHA.test(c.fixture?.sha256||'')&&Number.isInteger(c.fixture.speechDurationMs)&&c.fixture.speechDurationMs>=5000&&c.fixture.speechDurationMs<=300000,'reviewed WAV/duration missing');requireThat(c.fixture.launchSha256===c.fixture.sha256,'browser media bytes not bound to fixture');}
 for(const name of contract.oracles){if(!configurationOnly)requireThat(typeof cap.oracles?.[name]==='function','missing reviewed '+name+' oracle implementation');requireThat(SHA.test(c.oracleBindings?.[name]?.sha256||'')&&safeRef(c.oracleBindings[name].reviewReceipt)&&safeRef(c.oracleBindings[name].module),'unbound '+name+' oracle source/module');}
 if(['AHT-02','AHT-03'].includes(caseId))requireThat(c.focus&&typeof c.focus.topic==='string'&&Array.isArray(c.focus.points)&&c.focus.points.length>0&&c.focus.points.length===c.focus.expectedFinal?.length&&c.focus.expectedFinal.every(s=>['covered','partial','missing'].includes(s)),'Focus reference/independent expected verdicts missing');
 if(caseId==='AHT-02')requireThat(Array.isArray(c.focus.newPoints)&&Array.isArray(c.focus.editedPoints)&&c.focus.newPoints.length===c.focus.editedPoints.length&&c.focus.newPoints.length>=3,'New Set/Edit reference inputs missing');
 if(caseId==='AHT-07')feedbackRetry.preflight(c,guard,configurationOnly);
 if(['AHT-05','AHT-06'].includes(caseId))saveFault.preflight(caseId,c,guard,configurationOnly);
 if(['AHT-13','AHT-14'].includes(caseId)){if(!configurationOnly)requireThat(typeof guard?.armDownloadFault==='function','reviewed model fault implementation missing');let faultUrl;try{faultUrl=new URL(c.downloadFault?.url);}catch{notRun('exact app-origin model download fault URL missing');}requireThat(c.downloadFault?.mode===(caseId==='AHT-13'?'download-fails':'offline-mid-download')&&faultUrl.origin===c.targetUrl,'exact app-origin model download fault binding missing');}
 if(caseId==='AHT-14'){requireThat(safeRef(c.downloadFault.qualificationReceipt)&&Number.isSafeInteger(c.downloadFault.afterBytes)&&c.downloadFault.afterBytes>0,'qualified browser offline-after-prefix fault binding missing');if(!configurationOnly)requireThat(typeof guard?.resumeDownloadNetwork==='function','reviewed browser network recovery missing');}
 if(caseId==='AHT-12')requireThat(c.permissionQualification?.denialThenGrantSameContext===true&&safeRef(c.permissionQualification.receipt),'real NotAllowedError then grant in same guarded context not qualified; fake-ui autoapprove is not denial');
 if(['AHT-04','AHT-13','AHT-14'].includes(caseId))requireThat(c.coldModelRequired===true,'cold model condition not selected');
 if(['AHT-01','AHT-02','AHT-03'].includes(caseId))progressNumeric.preflight(c);
 require('./oracles/index.cjs').preflight(c);focusControls.preflight(c);return contract;
}
// Diagnostic continuation: ONLY an explicitly typed NOT RUN caused by an unavailable authorized evidence reader keeps the browser journey going; FAIL, plain NOT RUN and PASS paths are unchanged.
const coachingPolicy=require('./coaching-failure-policy.cjs');
const continuesAfterUnavailableReader=r=>!!r&&r.result==='NOT RUN'&&r.observed===false&&r.evidenceReaderUnavailable===true;
function ownSaved(rows,id){return !!id&&rows.length===1&&rows[0].id===id&&rows[0].status==='completed'&&rows[0].hasIdempotencyKey&&rows[0].transcriptState==='available'&&rows[0].transcriptLength>0;}
function newestOnly(rows,oldId,newId){const old=rows.find(r=>r.id===oldId),next=rows.find(r=>r.id===newId);return !!old&&!!next&&oldId!==newId&&rows.length===2&&old.status==='completed'&&next.status==='completed'&&next.transcriptState==='available'&&next.transcriptLength>0&&old.transcriptState==='expired'&&old.transcriptLength===0;}
async function retainInterruptionEvidence({caseId,diag,assertions,writeEvidence}){
 const ref=await writeEvidence(caseId.toLowerCase()+'-interruption.json',{contentSafe:true,caseId,kind:'interruption-diagnostic',diagnosticOnly:true,...diag,afterRecordedAssertion:assertions.some(row=>row.id===diag.step)});
 requireThat(safeRef(ref),'interruption evidence sink returned invalid reference');
 // Prior verdicts/references are immutable: the real recorder rejects changed duplicate rows.
 // The later cleanup assertion links this diagnostic even when the previous row already passed.
 return ref;
}
async function run(caseId,args){
 const {context,browser,guard,caseConfig:c,capabilities:cap}=args;
 const contract=preflight(caseId,c,cap,guard);const minimal=c.sampleMode==='minimal';const breadth=(c.sampleMode==='breadth'||minimal)&&['AHT-02','AHT-03'].includes(caseId);const assertions=[];let evidenceIndex=0,current='owner-bound',page=null,blocker=null,interruptionDiag=null;let cloudCount=0,sessionWriteRequests=0,startPresses=0;const coachingAttempts=[],coachingByRequest=new WeakMap();let lastPressAcquisitions=null;const executionSignals={authenticationRejected:false,startPressCapExceeded:false};
 const pages=[],contexts=[];let baselineIds=null,coachingCaptureController=null,coachingCapturePromise=null,focusPresentationWindow=null,interruptionRef=null;
 async function assertion(id,result,facts={},externalRefs=[]){
   // Evidence is booleans/counts/closed statuses only; never pass raw DOM, IDs, errors, URLs, or text here.
   const ref=await cap.writeEvidence(caseId.toLowerCase()+'-'+(++evidenceIndex)+'.json',{contentSafe:true,caseId,assertion:id,result,facts});
   requireThat(safeRef(ref),'evidence sink did not return private relative reference');
   requireThat(externalRefs.every(safeRef),'external oracle reference invalid');const row={id,result,evidenceRefs:[ref,...externalRefs],detail:result==='PASS'?'The named source assertion was observed.':result==='FAIL'?'Observed behavior contradicts the named source assertion.':'The named assertion was not established.'};
   assertions.push(row);await cap.recordAssertion(row);return row;
 }
 async function check(id,ok,facts={},externalRefs=[]){current=id;await assertion(id,ok?'PASS':'FAIL',facts,externalRefs);if(!ok){const e=new Error('product assertion failed');e.code='PRODUCT_FAIL';throw e;}}
 async function hook(name,phase,data={}){
   const result=await cap.oracles[name]({phase,page,context,caseConfig:c,...data});
   if(phase!=='assert'){requireThat(result?.observed===true,'oracle '+name+' could not open observation');return result;}
   requireThat(result&&['PASS','FAIL','NOT RUN'].includes(result.result)&&result.contentSafe===true&&Array.isArray(result.evidenceRefs)&&result.evidenceRefs.length&&result.evidenceRefs.every(safeRef),'oracle '+name+' returned incomplete evidence');
   requireThat(result.result!=='PASS'||result.observed===true,'oracle '+name+' supplied an unobserved PASS');return result;
 }
 // r14 evidence retention: a PRESENTATION row (copy, marker, colours, coaching text) is recorded exactly as observed, FAIL included, but never ends the case, so it cannot
 // suppress the independent save, final-state, durable-result and reopen checks that follow. The case still ends FAIL/NOT RUN from the recorded rows.
 async function presentationRows(rows,refsById={}){for(const r of rows){requireThat(contract.rows.includes(r.id),'unexpected source assertion outside denominator');current=r.id;await assertion(r.id,r.result,r.facts,refsById[r.id]||[]);}}
 async function sourceRows(rows){for(const r of rows){requireThat(contract.rows.includes(r.id),'unexpected source assertion outside denominator');current=r.id;await assertion(r.id,r.result,r.facts);}const failure=rows.find(r=>r.result==='FAIL')||rows.find(r=>r.result!=='PASS');if(failure&&coachingPolicy.continueAfterSourceRows(rows,coachingAttempts))return;if(failure){const e=new Error('source control did not pass');e.code=failure.result==='FAIL'?'PRODUCT_FAIL':'NOT_RUN';throw e;}}
 async function settleDiag(){await Promise.all(coachingAttempts.map(a=>a.diagPromise).filter(Boolean));}
 async function recordGroundedFailure(decision,externalRefs=[]){current='grounded-coaching';const recoveryRef=await cap.writeEvidence(caseId.toLowerCase()+'-coaching-recovery.json',{contentSafe:true,caseId,kind:'coaching-recovery-record',...decision.recovery});await assertion('grounded-coaching',decision.result,decision.facts,[...externalRefs,recoveryRef]);}
 async function oracleAssertion(id,name,data={}){current=id;const result=await hook(name,'assert',{assertionId:id,...data});if(id==='grounded-coaching')await settleDiag();const groundedDecision=id==='grounded-coaching'?coachingPolicy.decideGrounded({attempts:coachingAttempts,ids:{first:data.sessionId,second:data.repeatId},oracleResult:result}):null;if(groundedDecision){await recordGroundedFailure(groundedDecision,result.evidenceRefs);return;}const row={id,result:result.result,evidenceRefs:result.evidenceRefs,detail:continuesAfterUnavailableReader(result)?'Server-evidence assertion NOT RUN: no authorized evidence reader available; browser observations continue.':'Reviewed source-specific oracle result.'};assertions.push(row);await cap.recordAssertion(row);if(result.result!=='PASS'){if(continuesAfterUnavailableReader(result))return;const e=new Error('oracle did not pass');e.code=result.result==='FAIL'?'PRODUCT_FAIL':'NOT_RUN';throw e;}}
 // r14 setup proof: closed facts that say whether the stimulus was actually established (capture device bound, model request issued, microphone outcome) so a missing stimulus is reported as a setup blocker, never as a product verdict.
 const closedOutcome=n=>({NotAllowedError:'not-allowed',NotFoundError:'not-found',NotReadableError:'not-readable',AbortError:'abort',SecurityError:'security',OverconstrainedError:'overconstrained',TypeError:'type',granted:'granted',pending:'pending'}[n]||'other');
 const modelRequestCount=()=>{try{const n=guard?.summary?.()?.ledgerUsed?.model;return Number.isInteger(n)?n:null;}catch{return null;}};
 const captureDeviceBound=()=>typeof c.fixture?.sha256==='string'&&c.fixture.launchSha256===c.fixture.sha256;
 async function setupSnapshot(){let permissionState='unknown',modelStatus='unknown',downloadControl=false,mic=null;try{permissionState=await page.evaluate(async()=>{try{return (await navigator.permissions.query({name:'microphone'})).state;}catch{return 'unknown';}});}catch{}try{modelStatus=await ui.attr(page,'data-model-status')||'none';}catch{}try{downloadControl=await page.getByTestId('mic-download').isVisible();}catch{}try{mic=await observer.mic(page);}catch{}return {captureDeviceBound:captureDeviceBound(),permissionStateBeforePress:['granted','denied','prompt'].includes(permissionState)?permissionState:'unknown',modelStatusBeforePress:/^[a-z-]{1,24}$/.test(modelStatus||'')?modelStatus:'other',downloadControlVisible:downloadControl,acquisitionsBeforePress:Number.isInteger(mic?.acquisitions)?mic.acquisitions:null,modelRequestsBeforePress:modelRequestCount()};}
 async function setupOutcome(before){let mic=null;try{mic=await observer.mic(page);}catch{}const after=modelRequestCount();return {modelRequestsAfterPress:after!==null&&before.modelRequestsBeforePress!==null?after-before.modelRequestsBeforePress:null,acquisitionOutcomes:Array.isArray(mic?.log)?mic.log.slice(0,8).map(x=>closedOutcome(x.outcome)):null,liveTracks:Number.isInteger(mic?.liveTracks)?mic.liveTracks:null};}
 // r14 diagnostics (never requirement rows): recognition progress, and where the fixture was when RECORDING began. Evidence only; failures to collect never change a verdict.
 async function liveDiagnostics(observed){try{const f=fixtureManifest.fixtures[c.fixture?.name];const windows=f?.pointAudioWindows;if(!f||!Array.isArray(windows))return [];const timing=await observer.audioTiming(page);const ref=fixtureActivity.fixtures[c.fixture?.name],reference=ref&&ref.wavSha256===c.fixture?.sha256?ref.bits:undefined;const at=audioTiming.analyze({timing,windows,loopSec:f.speechSeconds+f.trailingSilenceSeconds,reference});const rp=focusOracle.recognitionProgress(observed,windows);const rec=timing?.states?.find(s=>s[1]==='r'&&s[2]==='RECORDING');const aligned=audioTiming.alignRecognition({recognition:rp.facts,audio:at.facts,observerStartMs:observed?.perfT0,recordingMs:rec?rec[0]:null,windows});const refs=[];refs.push(await cap.writeEvidence(caseId.toLowerCase()+'-audio-timing.json',{contentSafe:true,caseId,kind:'audio-timing-diagnostic',...at.facts}));refs.push(await cap.writeEvidence(caseId.toLowerCase()+'-focus-recognition.json',{contentSafe:true,caseId,kind:'focus-recognition-diagnostic',...rp.facts,...aligned}));return refs.filter(safeRef);}catch{return [];}}
 async function newPage(ctx=context){const p=await ctx.newPage();pages.push(p);ui.bindStartPressRecorder(p,async control=>{requireThat(typeof cap.recordStartPress==='function','per-Start press journal missing');try{const m=await observer.mic(p);if(m&&Number.isInteger(m.acquisitions))lastPressAcquisitions=m.acquisitions;}catch{/* observer not installed yet */}await cap.recordStartPress({caseId,control});startPresses++;});await observer.install(p);p.on('request',r=>{if(/assemblyai/i.test(r.url()))cloudCount++;if(r.method()==='POST'&&/\/rest\/v1\/rpc\/(create_session_and_update_usage|complete_session_v2)(?:[?]|$)/.test(r.url()))sessionWriteRequests++;});p.on('websocket',w=>{if(/assemblyai/i.test(w.url()))cloudCount++;});const isCoaching=q=>{try{return q.method()==='POST'&&/\/functions\/v1\/get-ai-suggestions(?:[?]|$)/.test(q.url());}catch{return false;}};p.on('request',q=>{if(!isCoaching(q))return;let body=null;try{body=q.postDataJSON();}catch{body=null;}const a=coachingPolicy.newAttempt(coachingAttempts.length+1,body);a.startedAt=Date.now();coachingAttempts.push(a);coachingByRequest.set(q,a);});p.on('response',r=>{try{const a=coachingByRequest.get(r.request());if(!a)return;const h=typeof r.headers==='function'?r.headers():{};if(h&&h['x-ss-harness-deny'])coachingPolicy.deny(a);else{coachingPolicy.finish(a,r.status());a.respondedAt=Date.now();if(coachingPolicy.isFailureStatus(r.status())){a.diagPromise=Promise.race([Promise.resolve().then(async()=>{let body='';try{body=await r.text();}catch{/* body unavailable */}let timing=null;try{timing=r.request().timing();}catch{/* no timing */}a.diag=coachingPolicy.classifyFailureResponse({contentType:h['content-type'],body,startedAt:a.startedAt,respondedAt:a.respondedAt,browserTimingMs:timing&&Number.isFinite(timing.responseEnd)?timing.responseEnd:null,retryAfter:h['retry-after']});}),new Promise(res=>setTimeout(res,3000))]).catch(()=>{});}}}catch{/* page closing */}});p.on('requestfailed',q=>{const a=coachingByRequest.get(q);if(a)coachingPolicy.abort(a);});return p;}
 async function saveReopen(p,id){current='review-reopen';const own=(await rows(p)).find(r=>r.id===id);requireThat(own&&own.transcriptState==='available'&&own.transcriptSha256,'saved transcript readback unavailable for exact reopen comparison');const fingerprints=await ui.reopen(p,c,id);await check('review-reopen',fingerprints.before===own.transcriptSha256&&fingerprints.after===own.transcriptSha256,{reopenedMatchesSaved:fingerprints.before===own.transcriptSha256,reloadedMatchesSaved:fingerprints.after===own.transcriptSha256});}
 async function rows(p=page){const all=await readback.sessions(p,c);return baselineIds&&caseId!=='AHT-15'?all.filter(r=>!baselineIds.has(r.id)):all;}
 async function stopAndSave(p,old=null){await ui.speak(p,c);await ui.stop(p);return ui.saved(p,old);}
 async function noResume(p,id='return-no-resume'){const m=await observer.mic(p);requireThat(m,'microphone observation missing');await check(id,!m.recording&&!m.recorderVisible&&m.liveTracks===0,{liveTracks:m.liveTracks,recording:m.recording});}
 try{
  page=await newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(45000);
  await check('owner-bound',await ui.login(page,c,cap.credentials),{ownerMatches:true});
  // #1476 lease: a previous case's unreleased lease expires 15 s after its last heartbeat; settle before the first Start so back-to-back cases on the shared account cannot collide.
  if(!['AHT-08','AHT-15'].includes(caseId))await page.waitForTimeout(20000);
  if(caseId==='AHT-07'){current='feedback-readback-preflight';const readProbe=await hook('feedbackAssociation','capability');await check('feedback-readback-preflight',readProbe.observed===true,{existingAuthenticatedReceiverBound:true,browserSelectNotRequired:true,actualDeliveryNotYetProven:true});}
  if(caseId!=='AHT-12'&&caseId!=='AHT-15')await context.grantPermissions(['microphone'],{origin:c.targetUrl});
  const baseline=await rows();
  if(caseId==='AHT-01'){if(baseline.length===0)await check('fresh-first-session',true,{existingSessions:0});else{current='fresh-first-session';await assertion('fresh-first-session','NOT RUN',{existingSessions:baseline.length,preconditionNotMet:true});}}
  baselineIds=new Set(baseline.map(r=>r.id));
  if(['AHT-01','AHT-02','AHT-03'].includes(caseId)){
   const focus=caseId!=='AHT-01',timing=focusControls.plan(c),firstPresentation=[];
   const emitPresentation=async(rs,refsById)=>{firstPresentation.push(...rs);await presentationRows(rs,refsById);};
   if(focus){await ui.products(page,'focus-points');current='focus-pace-guide';await ui.setupFocus(page,c,undefined,async()=>emitPresentation([await presentation.paceGuide(page)]));current='focus-rail-before';await emitPresentation(await presentation.beforeFocus(page,c.focus.points.length));await hook('focusEvidence','begin');}else await ui.openMic(page,c);
   await hook('coaching','begin');current=focus?'focus-final':'saved-once';await ui.start(page);const firstStartedAt=Date.now();if(focus)focusPresentationWindow=await presentation.beginFocusLive(page,c.focus.points.length);await page.waitForTimeout(timing.fullMs);if(focus)await hook('focusEvidence','freeze');const liveFrozen=focus?await presentation.freezeFocusLiveDetailed(page,focusPresentationWindow):{rows:[],observed:null};const livePresentation=liveFrozen.rows;focusPresentationWindow=null;const liveDiagRefs=focus?await liveDiagnostics(liveFrozen.observed):[];
   // r15 evidence-first: the frozen live rows and their diagnostics are written NOW, before Stop and Save. If Stop, Save or anything later fails, the live observation is already on disk and is never lost with the in-memory window.
   if(focus)await emitPresentation(livePresentation,{'focus-next-point-marked':liveDiagRefs});const firstStoppedAt=Date.now();await ui.stop(page);const first=await ui.saved(page);if(!focus){current='open-mic-review-presentation';await presentationRows(await presentation.openMicReview(page));}await hook('coaching','capture',{sessionId:first});
   await check('saved-once',ownSaved(await rows(),first),{savedRows:(await rows()).length});
   if(focus){await page.waitForFunction(n=>Array.from({length:n},(_,i)=>document.querySelector('[data-testid="focus-point-'+i+'"]')?.getAttribute('data-status')).every(x=>x&&x!=='pending'),c.focus.points.length,{timeout:60000});const states=await Promise.all(c.focus.points.map((_,i)=>page.getByTestId('focus-point-'+i).getAttribute('data-status')));await check('focus-final',states.every((value,i)=>value===c.focus.expectedFinal[i]),{points:states.length,matching:states.filter((value,i)=>value===c.focus.expectedFinal[i]).length});await emitPresentation(await presentation.afterFocus(page,c.focus.expectedFinal,firstStoppedAt-firstStartedAt));await presentationRows([presentation.group('focus-presentation-contract',presentation.FOCUS_ROWS,firstPresentation)]);await oracleAssertion('focus-live-durable','focusEvidence',{sessionId:first});current='focus-back-reload';await sourceRows(await focusControls.backReload({page,caseConfig:c,sessionId:first}));}
   await saveReopen(page,first);
   if(!focus)await oracleAssertion('pdf-owner-take','pdfOwnerTake',{sessionId:first});
   let skipRepeat=false;if(breadth)skipRepeat='breadth';else try{await hook('sameTarget','begin',{baselineId:first});}catch(e){if(e?.code==='NOT_RUN'&&coachingPolicy.failedFor(coachingAttempts,first))skipRepeat=true;else throw e;}
   if(skipRepeat){
    // Prerequisite invalid: the saved baseline take has no coaching output (failed generation attempt preserved on grounded-coaching). Only rows that need it are NOT RUN.
    const omitted=skipRepeat==='breadth';const omitFacts=omitted?{omittedBy:'breadth-sample',needs:'second-take',notAttempted:true}:{prerequisite:'coaching-output-unavailable',notAttempted:true};
    for(const id of contract.rows)if(!['grounded-coaching','owned-pages-closed','no-cloud-stt','start-press-budget'].includes(id)&&!assertions.some(a=>a.id===id)){current=id;await assertion(id,'NOT RUN',omitFacts);}
    // Breadth: the first take's coaching attempt may still be in flight; wait (bounded) so a real HTTP failure is preserved as FAIL rather than missed.
    if(omitted){const ref=coachingPolicy.sessionRef(first);for(let w=0;w<240&&!coachingAttempts.some(a=>a.ref===ref&&a.outcome!=='pending');w++)await page.waitForTimeout(250);}
    await settleDiag();const skipped=coachingPolicy.decideGrounded({attempts:coachingAttempts,ids:{first,second:null},oracleResult:null});
    if(skipped)await recordGroundedFailure(skipped,[]);
    else{current='grounded-coaching';const ref=coachingPolicy.sessionRef(first);await assertion('grounded-coaching','NOT RUN',{omittedBy:'breadth-sample',needs:'second-take',firstTakeAttempts:coachingAttempts.filter(a=>a.ref===ref).slice(0,4).map(a=>coachingPolicy.closed(a,{first,second:null}))});}
    if(omitted)blocker=blocker||'breadth-sample-omitted-assertions';
   }else{
   current='analytics-repeat-opens-product';await page.goto(c.targetUrl+'/analytics/'+first,{waitUntil:'domcontentloaded'});await page.getByTestId('saved-review-practice').waitFor({state:'visible',timeout:30000});await page.getByTestId('saved-review-practice').click();await page.waitForURL('**/session',{timeout:30000});const samePending=focus?await repeatProbes.pendingSameSet(page,c.focus.points):await page.getByTestId('focus-points-rail').count()===0;await check('analytics-repeat-opens-product',samePending,{openedSession:true,sameProductAndPendingSet:samePending});
   current='same-target-repeat';await ui.start(page);await hook('sameTarget','recording');await page.waitForTimeout(timing.savedRepeatMs);let repeatStopClickedAt=null;await ui.stop(page,()=>{repeatStopClickedAt=Date.now();});const second=await ui.saved(page,first),repeatSavedAt=Date.now();
   // Rapid probes run immediately from the saved review BEFORE waiting for late coaching/producers.
   current='rapid-repeat-gate';const rapidWindow=repeatProbes.beginRapidRepeat(page,focus,{stopClickedAt:repeatStopClickedAt,savedAt:repeatSavedAt});coachingCaptureController=new AbortController();const bCapture=hook('coaching','capture',{sessionId:second,inputsOnly:true,signal:coachingCaptureController.signal}).then(()=>({ok:true}),error=>({error}));coachingCapturePromise=bCapture;if(minimal){await repeatProbes.cancelRapidWindow(rapidWindow);}else{try{await sourceRows(await repeatProbes.rapidRepeat(page,focus,rapidWindow));}finally{await repeatProbes.cancelRapidWindow(rapidWindow);}current='next-start';await sourceRows(await repeatProbes.nextStart(page,c));current='probe-save-isolation';const afterProbes=await rows();const unexpectedSaved=afterProbes.filter(r=>r.status==='completed'&&r.id!==first&&r.id!==second).length;await check('probe-save-isolation',unexpectedSaved===0,{unexpectedCompletedTakes:unexpectedSaved});}current='grounded-coaching';const captureResult=await bCapture;if(captureResult.error)throw captureResult.error;
   await oracleAssertion('grounded-coaching','coaching',{sessionId:first,repeatId:second});await oracleAssertion('same-target-repeat','sameTarget',{baselineId:first,repeatId:second});await oracleAssertion(progressNumeric.ROW,'sameTarget',{phase:'numeric',baselineId:first,repeatId:second});
   if(caseId==='AHT-02')await focusControls.extendedFocus({page,caseConfig:c,firstId:first,previousId:second,onRows:sourceRows,onStep:id=>{current=id;}});
   }
  }else if(caseId==='AHT-04'){
   await ui.openMic(page,c);current='cold-pending-observed';await page.waitForFunction(()=>document.documentElement.getAttribute('data-model-status')==='download-required',undefined,{timeout:60000});
   const setupBefore=await setupSnapshot();const token04='AHT-04-model';await observer.armStates(page,token04);
   await ui.pressStart(page,'mic-download');const pending=await page.waitForFunction(()=>document.documentElement.getAttribute('data-model-status')==='loading',undefined,{timeout:15000}).then(()=>true,()=>false);
   if(!pending){const out=await setupOutcome(setupBefore);const modelStates=(await observer.states(page,token04))||[];const setupBlocked=out.modelRequestsAfterPress===0||!setupBefore.captureDeviceBound;await assertion('cold-pending-observed','NOT RUN',{pendingObserved:false,setupBlocked,setupReason:!setupBefore.captureDeviceBound?'capture-device-not-bound':out.modelRequestsAfterPress===0?'no-model-request-after-press':'pending-state-not-seen',...setupBefore,...out,modelStates:modelStates.slice(0,12).map(s=>/^[a-z-]{1,24}$/.test(String(s))?String(s):'other')});blocker=setupBlocked?'setup-blocked-stimulus-not-established':blocker;notRun('pending phase not observed');}await check('cold-pending-observed',true,{pendingObserved:true});
   const atLeave=await observer.mic(page);await ui.products(page,'focus-points');await ui.closeFocus(page,{expected:true});
   await page.waitForFunction(()=>{const s=document.documentElement.getAttribute('data-model-status');return s!==null&&s!=='loading';},undefined,{timeout:600000});
   const after=await observer.mic(page);requireThat(atLeave&&after&&atLeave.documentToken===after.documentToken,'pending-start observer continuity missing');
   await check('pending-leave-no-mic',!after.recording&&after.liveTracks===0&&after.acquisitions===atLeave.acquisitions,{liveTracks:after.liveTracks,newAcquisitions:after.acquisitions-atLeave.acquisitions});
   await check('pending-leave-no-session',(await rows()).length===0,{rows:(await rows()).length});await ui.products(page,'open-mic');await noResume(page);
   if(!minimal){current='deliberate-recovery-saved';const id=await ui.take(page,c);await check('deliberate-recovery-saved',ownSaved(await rows(),id),{saved:true});}
  }else if(['AHT-05','AHT-06'].includes(caseId)){
   await ui.openMic(page,c);const capture=saveFault.begin({page,caseConfig:c});try{await ui.start(page);const armed=await saveFault.bindAndArm({capture,page,caseId,caseConfig:c,guard,baselineSessionIds:[...baselineIds]});const faultId=armed.faultId;await ui.speak(page,c);current='fault-exercised';await ui.stop(page);
   const banner=await ui.visible(page,'session-unresolved-recovery',180000).then(()=>true,()=>false);const before=await rows();const f=guard.summary().faults.find(x=>x.id===faultId);
   const committed=before.filter(r=>r.status==='completed').length;const expected=caseId==='AHT-05'?0:1;
   if(!f?.fired||committed!==expected){await assertion('fault-exercised','NOT RUN',{fired:!!f?.fired,completed:committed});notRun('intended completion fault/order not established');}await check('fault-exercised',true,{fired:true,completed:committed});
   if(!banner)await check('recovery-truthful',false,{bannerShown:false});
   const message=await page.getByTestId('session-unresolved-message').innerText();const resolution=await page.getByTestId('session-unresolved-recovery').getAttribute('data-resolution');
   const retry=await page.getByTestId('session-retry-save').isVisible();
   const falseUnsaved=committed>0&&/\b(?:not (?:fully )?saved|has not been saved|was not saved|wasn['’]t saved|is not saved|isn['’]t saved)\b/i.test(message);
   const textPresent=await page.locator('[data-testid="live-transcript"],[data-testid="transcript-container"],[data-testid="review-transcript"]').evaluateAll(es=>es.some(e=>(e.textContent||'').trim().length>0));
   await check('recovery-truthful',retry&&['full_save','initial_save'].includes(resolution)&&!falseUnsaved&&(message.includes('Your words are still here')===textPresent),{retryOffered:retry,falseUnsaved,wordsVisible:textPresent});
   current='retry-saved-once';saveFault.authorizeRetry({guard,armed});await page.getByTestId('session-retry-save').click();const first=await ui.saved(page);const durable=await saveFault.verifyRetrySave({page,caseConfig:c,guard,armed});await check('retry-saved-once',first===armed.sessionId&&durable.durableSaved&&durable.savedRowCount===1&&ownSaved(await rows(),first),{savedRows:(await rows()).length,boundTakeMatches:first===armed.sessionId,durableExactPayloadMatched:durable.durableSaved});
   if(!minimal){current='next-take-isolated';const second=await ui.repeat(page,c,first);await check('next-take-isolated',newestOnly(await rows(),first,second),{twoDistinctTakes:first!==second});await saveReopen(page,second);}current='completion-attempts';const attempts=saveFault.verifyCompletionAttempts({guard,armed});await check('completion-attempts',attempts.exactExpectedAttempts&&attempts.attemptCount===2,{attemptCount:attempts.attemptCount,guardedOutboundOnly:true,independentServerReceipts:'UNKNOWN'});
   }finally{capture.detach();}
  }else if(['AHT-07','AHT-08'].includes(caseId)){
   let older=null,newer=null;if(caseId==='AHT-07'){await ui.openMic(page,c);await hook('coachingAssociation','begin');older=await ui.take(page,c);if(!minimal){newer=await ui.repeat(page,c,older);current='feedback-failure-retry-form';await feedbackRetry.run({page,caseConfig:c,guard,sessionId:older,onRows:sourceRows});const priorFeedbackPage=page;page=await newPage();await priorFeedbackPage.close();}}
   await hook('feedbackReceived','begin');await page.goto(c.targetUrl+'/analytics',{waitUntil:'domcontentloaded'});await page.getByTestId('nav-report-issue-button').first().click();await ui.visible(page,'issue-report-dialog');
   await page.getByTestId('feedback-session-select').selectOption(older||'__none');await page.getByTestId('feedback-type-broke').click();
   const finalFeedbackDescription='Automated RWT feedback-association boundary check.';await page.getByTestId('issue-report-description').fill(finalFeedbackDescription);
   const toast=page.locator('li[data-sonner-toast]');await toast.evaluateAll(es=>es.forEach(e=>e.setAttribute('data-rwt-previous-ack','true')));
   await hook('feedbackAssociation','begin',{sessionId:older,description:finalFeedbackDescription});current='fresh-acknowledgment';if(caseId==='AHT-07'&&!minimal)feedbackRetry.armFinal({caseConfig:c,guard,sessionId:older,description:finalFeedbackDescription});await page.getByTestId('issue-report-submit').click();await page.getByTestId('issue-report-dialog').waitFor({state:'detached',timeout:30000});
   const freshToast=page.locator('li[data-sonner-toast]:not([data-rwt-previous-ack])').filter({hasText:'Thanks — we’ve got it.'});await freshToast.first().waitFor({state:'visible',timeout:30000});
   const fresh=await freshToast.first().isVisible();await check('fresh-acknowledgment',fresh,{fresh});
   current='feedback-stored-once';const association=await hook('feedbackAssociation','assert');if(!association.reports){await assertion('feedback-stored-once',association.result||'NOT RUN',{independentAssociationReadUnavailable:true},association.evidenceRefs||[]);notRun('independent feedback server projection unavailable');}const reports=association.reports;if(reports.length!==1)await check('feedback-stored-once',false,{rows:reports.length,independentServerRead:true},association.evidenceRefs);const report=reports[0];
   if(older&&minimal){/* older-vs-newer needs the second take: omitted rows are recorded NOT RUN below */}else if(older){await check('older-take-association',report.sessionSha256===require('./oracles/feedback-association.cjs').sha(older)&&older!==newer,{matchesOlder:report.sessionSha256===require('./oracles/feedback-association.cjs').sha(older)});await oracleAssertion('older-coaching-association','coachingAssociation',{report,olderId:older,newerId:newer});}
   else{await check('no-session-association',report.sessionSha256===null,{unattached:report.sessionSha256===null});await check('no-coaching-association',report.diagnosticKind==='absent',{absent:report.diagnosticKind==='absent',malformed:report.diagnosticKind==='malformed'});}
   await oracleAssertion('received-feedback-proof','feedbackReceived',{reportId:report.id});current='feedback-stored-once';const finalAssociation=await hook('feedbackAssociation','assert',{finalize:true});await assertion('feedback-stored-once',finalAssociation.result,{rows:reports.length,independentServerRead:true,finalActionCountValid:finalAssociation.result==='PASS'},[...association.evidenceRefs,...finalAssociation.evidenceRefs]);if(finalAssociation.result!=='PASS')notRun('late final feedback action count not established');if(caseId==='AHT-07'&&!minimal){current='feedback-attempts';await feedbackRetry.finalize({page,caseConfig:c,guard,onRows:sourceRows});}
  }else if(['AHT-09','AHT-10'].includes(caseId)){
   await ui.openMic(page,c);await hook('abandonmentLease','begin',{baseline});await ui.start(page);await hook('abandonmentLease','recording');await page.waitForTimeout(8000);
   const live=await observer.mic(page);await check('recording-before-leave',!!live&&live.recording&&live.liveTracks>0,{recording:!!live?.recording,liveTracks:live?.liveTracks||0});
   current='leave-released';if(caseId==='AHT-09'){
    let accepted=0;const handler=d=>{if(d.type()==='confirm'&&d.message()==='A recording is still active. Stop and save this session before leaving?'&&accepted===0){accepted++;void d.accept();}else void d.dismiss();};
    page.on('dialog',handler);try{await ui.products(page,'focus-points');await navigation.ready(page,{pathname:'/practice',product:'focus-points'});}finally{page.off('dialog',handler);}await page.waitForTimeout(3000);
    const after=await observer.mic(page);await check('leave-released',accepted===1&&!!after&&!after.recording&&after.liveTracks===0,{accepted,liveTracks:after?.liveTracks||0});await ui.visible(page,'objective-setup-dialog',15000);await ui.closeFocus(page);await ui.products(page,'open-mic');await navigation.ready(page,{pathname:'/session'});await page.waitForTimeout(3000);await check('navigation-ready',true,{leaveRouteAndVisibleReady:true,returnRouteAndVisibleReady:true});
   }else{
    const dialogTypes=[],dialogDone=[];const closedEvent=new Promise(res=>page.once('close',()=>res(true)));page.on('dialog',d=>{dialogTypes.push(d.type());const handled=d.type()==='beforeunload'?d.accept():d.dismiss();handled.catch(()=>{});dialogDone.push(handled);});await page.close({runBeforeUnload:true});await Promise.race([closedEvent,new Promise(res=>setTimeout(res,5000))]);const settledDialogs=await Promise.allSettled(dialogDone);const handlerFailures=settledDialogs.filter(x=>x.status==='rejected');await check('leave-released',page.isClosed()&&handlerFailures.length===0,{tabClosed:page.isClosed(),dialogTypes,dialogsHandled:settledDialogs.length-handlerFailures.length,handlerFailures:handlerFailures.length,handlerError:handlerFailures.length?ui.safeErrorSummary(handlerFailures[0].reason):null});page=await newPage();await ui.openMic(page,c);
   }
   await noResume(page);await oracleAssertion('recovery-truthful','abandonmentLease',{phasePoint:'returned-before-dismiss'});
   if(caseId==='AHT-09'){const held=await rows();await check('left-take-saved-once',held.length===1&&held[0].status==='completed',{rows:held.length});}
   if(await page.getByTestId('session-recovery-actions').count())await page.getByTestId('session-recovery-dismiss').click();
   if(!minimal){
   const beforeNext=await rows();await hook('abandonmentLease','before-successor');current='next-take-isolated';await ui.primary(page);
   const immediately=await ui.recording(page,30000).then(()=>true,()=>false);
   if(!immediately){const refusal=await page.getByText(/A recording is active on .+\. Stop it there, or press Start again to take over here/).isVisible();requireThat(refusal,'successor Start not exercised under known lease refusal');await ui.primary(page);await ui.recording(page,60000);}
   await hook('abandonmentLease','successor-recording');const next=await stopAndSave(page);await oracleAssertion('lease-fenced','abandonmentLease',{savedSessionId:next});const afterNext=await rows();
   await check('next-take-isolated',!!next&&!beforeNext.some(r=>r.id===next)&&afterNext.filter(r=>r.id===next&&r.status==='completed').length===1,{newIdentity:!beforeNext.some(r=>r.id===next)});
   }
  }else if(caseId==='AHT-11'){
   await ui.openMic(page,c);await ui.start(page);const a=page;const b=await newPage();await ui.openMic(b,c);await ui.primary(b);
   await b.getByText('Active session in another tab. Switch to that tab to continue.',{exact:true}).waitFor({state:'visible',timeout:30000});
   const [am,bm]=[await observer.mic(a),await observer.mic(b)];await check('same-browser-refused',!!am&&!!bm&&am.recording&&am.liveTracks>0&&!bm.recording&&bm.liveTracks===0,{aRecording:!!am?.recording,bRecording:!!bm?.recording});await b.close();
   const other=await browser.newContext({baseURL:c.targetUrl,serviceWorkers:'block',permissions:['microphone']});contexts.push(other);const d=await newPage(other);requireThat(await ui.login(d,c,cap.credentials),'independent context did not bind same account');await ui.openMic(d,c);
   await hook('takeoverLease','begin',{tabA:a,tabB:d});await ui.primary(d);
   await d.getByText(/A recording is active on .+\. Stop it there, or press Start again to take over here/).waitFor({state:'visible',timeout:30000});
   const denied=await observer.mic(d);await check('independent-context-refused',!!denied&&!denied.recording&&denied.liveTracks===0,{recording:!!denied?.recording,liveTracks:denied?.liveTracks||0});
   if(!minimal){
   await hook('takeoverLease','arm-gesture',{tabA:a,tabB:d});await ui.primary(d);await hook('takeoverLease','after-gesture',{tabA:a,tabB:d});await oracleAssertion('lease-before-model-window','takeoverLease',{tabA:a,tabB:d});await ui.recording(d);
   await oracleAssertion('takeover-fences-old-owner','takeoverLease',{tabA:a,tabB:d,phasePoint:'successor-recording'});
   const second=await stopAndSave(d);const first=await ui.saved(a);await check('two-takes-isolated',first!==second&&(await rows(d)).filter(r=>[first,second].includes(r.id)&&r.status==='completed').length===2&&(await rows(d)).every(r=>r.status!=='active'),{distinct:first!==second});page=d;
   }else page=d;
  }else if(caseId==='AHT-12'){
   await context.clearPermissions();await ui.openMic(page,c);const before=await observer.mic(page);requireThat(before,'microphone acquisition observer missing');const setupBefore12=await setupSnapshot();
   current='press-bound-denial';await ui.primary(page);
   // Qualifying denial = a NotAllowedError microphone acquisition created AFTER the journaled Start press (acquisition count captured at the pre-effect press). Bounded 30 s poll.
   const gate=Number.isInteger(lastPressAcquisitions)?lastPressAcquisitions:before.acquisitions;let denied=false;for(let w=0;w<120&&!denied;w++){const snap=await observer.mic(page);denied=!!snap&&snap.log.some(x=>x.id>=gate&&x.outcome==='NotAllowedError');if(!denied)await page.waitForTimeout(250);}
   if(!denied){const out=await setupOutcome(setupBefore12);const oc=out.acquisitionOutcomes||[];const stimulus=!setupBefore12.captureDeviceBound?'device-missing':oc.includes('not-found')?'device-missing':oc.includes('granted')?'permission-granted':oc.length===0?'no-acquisition-attempted':'other-error';await assertion('press-bound-denial','NOT RUN',{deniedAtBoundary:false,waitedMs:30000,setupBlocked:true,stimulus,setupReason:stimulus,...setupBefore12,...out});blocker='setup-blocked-stimulus-not-established';notRun('actual press-bound NotAllowedError not observed');}await check('press-bound-denial',true,{deniedAtBoundary:true,qualifiedAfterStartPress:Number.isInteger(lastPressAcquisitions)});
   const copyWaitStartedAt=Date.now();const blockedCopy=await page.getByText('Microphone access is blocked. Allow microphone access and try again.',{exact:true}).waitFor({state:'visible',timeout:90000}).then(()=>true,()=>false);
   const after=await observer.mic(page);
   const copyIds=blockedCopy?null:await ui.uiCopyIds(page);await check('denial-truthful-no-mic',blockedCopy&&!after.recording&&!after.recorderVisible&&after.liveTracks===0,{blockedCopy,copyWaitMs:Date.now()-copyWaitStartedAt,liveTracks:after.liveTracks,recording:after.recording,uiCopy:copyIds});
   if(!minimal){await context.grantPermissions(['microphone'],{origin:c.targetUrl});current='allowed-recovery-saved';const id=await ui.take(page,c);await check('allowed-recovery-saved',ownSaved(await rows(),id),{sameGuardedContext:true});await saveReopen(page,id);}
  }else if(['AHT-13','AHT-14'].includes(caseId)){
   await ui.openMic(page,c);await page.waitForFunction(()=>document.documentElement.getAttribute('data-model-status')==='download-required',undefined,{timeout:60000});
   const token=caseId+'-model';await observer.armStates(page,token);const setupBefore13=await setupSnapshot();const id=guard.armDownloadFault(c.downloadFault);current='download-fault-exercised';await ui.pressStart(page,'mic-download');
   const failureState=await page.waitForFunction(()=>['error','init-failed'].includes(document.documentElement.getAttribute('data-model-status')),undefined,{timeout:300000}).then(()=>true,()=>false);
   const fault=guard.summary().downloadFaults.find(x=>x.id===id);if(!fault?.fired){const out=await setupOutcome(setupBefore13);const modelStates=(await observer.states(page,token))||[];const reason=!setupBefore13.captureDeviceBound?'capture-device-not-bound':out.modelRequestsAfterPress===0?'no-model-request-after-press':'no-request-matched-fault-asset';await assertion('download-fault-exercised','NOT RUN',{fired:false,setupBlocked:true,setupReason:reason,...setupBefore13,...out,modelStates:modelStates.slice(0,12).map(s=>/^[a-z-]{1,24}$/.test(String(s))?String(s):'other')});blocker='setup-blocked-stimulus-not-established';notRun('download fault not fired at reviewed asset boundary');}
   if(caseId==='AHT-14')requireThat(fault.browserOfflineApplied===true&&fault.bytesForwarded>0,'browser offline after actual received prefix not established');await check('download-fault-exercised',true,{fired:true,bytesForwarded:fault.bytesForwarded||0,browserOfflineApplied:fault.browserOfflineApplied===true});const states=await observer.states(page,token);requireThat(states,'complete model-state history missing');
   const retry=await page.getByTestId('mic-retry').isVisible();const mode=await ui.attr(page,'data-stt-mode');await check('download-failure-truthful',failureState&&!states.includes('ready')&&retry&&mode==='private',{failureState,claimedReady:states.includes('ready'),retryOffered:retry,stayedPrivate:mode==='private'});
   if(caseId==='AHT-14')await guard.resumeDownloadNetwork(id);if(!minimal){current='deliberate-recovery-saved';const saved=await ui.take(page,c);await check('deliberate-recovery-saved',ownSaved(await rows(),saved),{saved:true});await saveReopen(page,saved);}
  }else if(caseId==='AHT-15'){
   const entryMic=await observer.mic(page);await check('return-entry-mic-off',navigation.micOff(entryMic),{observed:!!entryMic,micOff:navigation.micOff(entryMic)});const target=navigation.existingTarget(baseline);
   await context.clearPermissions();await page.getByTestId('nav-analytics-link').first().click();await navigation.ready(page,{pathname:'/progress'});const before=await rows();await page.getByTestId('open-session-detail-'+target.id).or(page.getByTestId('open-session-detail-mobile-'+target.id)).first().waitFor({state:'visible',timeout:45000});
   await check('history-preserved',navigation.unchanged(baseline,before),{historyRows:before.length,completedRows:before.filter(r=>r.status==='completed').length,ownedTargetListed:true});
   await ui.products(page,'open-mic');await navigation.ready(page,{pathname:'/session'});const openMic=await observer.mic(page);await ui.products(page,'focus-points');await ui.visible(page,'objective-setup-dialog');await ui.closeFocus(page);await ui.products(page,'open-mic');await navigation.ready(page,{pathname:'/session'});
   const switchMic=await observer.mic(page);requireThat(openMic&&switchMic,'product switching observer missing');await check('switches-mic-off',navigation.micOff(openMic)&&navigation.micOff(switchMic),{acquisitions:openMic.acquisitions+switchMic.acquisitions,liveTracks:switchMic.liveTracks});
   current='signed-out';await ui.signout(page);const signedOut=await ui.sessionCleared(page,c);await check('signed-out',signedOut,{sessionCleared:signedOut});
   current='return-owner-preserved';await navigation.returnToOwnDetail({page,caseConfig:c,credentials:cap.credentials,target,onRows:sourceRows});
   const after=await rows();await check('no-recording-or-session-write',sessionWriteRequests===0&&navigation.unchanged(baseline,after),{before:baseline.length,after:after.length,writeRequests:sessionWriteRequests});await ui.signout(page);const cleared=await ui.sessionCleared(page,c);await check('return-signed-out',cleared,{secondSessionCleared:cleared});
  }
  if(minimal){for(const id of contract.rows)if(!['owned-pages-closed','no-cloud-stt','start-press-budget'].includes(id)&&!assertions.some(a=>a.id===id)){current=id;await assertion(id,'NOT RUN',{omittedBy:'minimal-sample',notAttempted:true});}blocker=blocker||'minimal-sample-omitted-assertions';}
  for(const missing of finiteDenominator.requiredUnimplemented.filter(x=>x.caseIds.includes(caseId))){await assertion(missing.assertionId,'NOT RUN',{requiredTechnicalImplementationMissing:true});blocker=blocker||'required-technical-assertion-not-implemented';}
  await check('no-cloud-stt',cloudCount===0,{cloudRequests:cloudCount});
 }catch(error){
  // Preserve every earlier assertion, especially FAIL; missing later evidence can never overwrite it.
  if(error?.code==='AUTH_REJECTED')executionSignals.authenticationRejected=true;if(error?.code==='START_PRESS_CAP')executionSignals.startPressCapExceeded=true;
  blocker=error?.trustedBlocker|| (error?.code==='PRODUCT_FAIL'?'observed-product-contradiction':'browser-or-oracle-step-interrupted');
  {const failedPage=ui.failurePage(error,page);const trace=failedPage?await ui.controlTrace(failedPage):null;const leaseNotice=failedPage?await failedPage.getByText(/A recording is active on .+\. Stop it there/).first().isVisible().catch(()=>null):null;const diag={stage:ui.failureStage(error,page),step:current,leaseHeldNoticeVisible:leaseNotice,controlTrace:Array.isArray(trace)?trace:null,error:ui.safeErrorSummary(error)};interruptionDiag=diag;interruptionRef=await retainInterruptionEvidence({caseId,diag,assertions,writeEvidence:(name,value)=>cap.writeEvidence(name,value)});if(!assertions.some(a=>a.id===current))await assertion(current,['NOT_RUN','AUTH_REJECTED','START_PRESS_CAP'].includes(error?.code)?'NOT RUN':'FAIL',{interrupted:true,diag},[interruptionRef]);}
  for(const id of contract.rows)if(!['owned-pages-closed','no-cloud-stt','start-press-budget'].includes(id)&&!assertions.some(a=>a.id===id))await assertion(id,'NOT RUN',{notReached:true});
 }finally{
  // Only runner-owned pages/contexts are closed; account deletion or server cleanup is not attempted here.
  let failedCloses=0;const bounded=async operation=>{let timer;try{await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('close-timeout')),30000);})]);}catch{failedCloses++;}finally{clearTimeout(timer);}};
  coachingCaptureController?.abort();
  if(focusPresentationWindow&&page)await bounded(presentation.disposeFocusLive(page));if(typeof cap.oracles?.dispose==='function')cap.oracles.dispose();if(coachingCapturePromise)await bounded(coachingCapturePromise);
  for(const p of pages)if(!p.isClosed())await bounded(p.close());
  for(const ctx of contexts)await bounded(ctx.close());
  if(!assertions.some(a=>a.id==='no-cloud-stt'))await assertion('no-cloud-stt',cloudCount>0?'FAIL':'NOT RUN',{cloudRequests:cloudCount,incomplete:!!blocker});
  await assertion('start-press-budget',executionSignals.startPressCapExceeded?'NOT RUN':startPresses<=c.startPressCap?'PASS':'FAIL',{observedStartPressReservations:startPresses,approvedCap:c.startPressCap,stoppedBeforeExcessPress:executionSignals.startPressCapExceeded});
  await assertion('owned-pages-closed',failedCloses===0&&pages.every(p=>p.isClosed())?'PASS':'NOT RUN',{failedCloses,ownedPages:pages.length,closedPages:pages.filter(p=>p.isClosed()).length,...(interruptionDiag?{interruption:interruptionDiag}:{})},interruptionRef?[interruptionRef]:[]);
 }
 return {caseId,contentSafe:true,assertions,blocker,executionSignals};
}
module.exports={requiresCaptureDevice,continuesAfterUnavailableReader,retainInterruptionEvidence,run,preflight,configurationPreflight:(caseId,c)=>{preflight(caseId,c,null,null,true);return {ready:true,caseId,requiredAssertions:CONTRACTS[caseId].rows,requiredOracles:CONTRACTS[caseId].oracles};},CONTRACTS,SOURCE_SHA};
