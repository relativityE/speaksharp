'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const policy=require('../coaching-failure-policy.cjs'),{classifyFailureResponse}=policy;
const oracleModule=require('../oracles/index.cjs'),source=require('../oracles/pure/coachingCollectorSelected.cjs');
const sourceAdapters=require('../source-adapters.cjs');
const {sanitizeEvidence}=require('../../bundle/harness/evidence-sanitizer.cjs');
const {createCaseRecorder}=require('../../bundle/harness/case-results.cjs');
for(const reason of ['provider_timeout','provider_http_5xx'])test('actual Edge failure envelope retains closed reason '+reason,()=>{
 const value=classifyFailureResponse({contentType:'application/json',body:JSON.stringify({error:'AI coaching could not be generated. Please try again.',reason})});
 assert.equal(value.errorCode,'code-'+reason);
});
test('reason takes precedence over a generic code, while arbitrary reason text never escapes',()=>{
 const value=body=>classifyFailureResponse({contentType:'application/json',body:JSON.stringify(body)});
 assert.equal(value({reason:'provider_timeout',code:'internal_error'}).errorCode,'code-provider_timeout');
 const arbitrary=value({reason:'token_customer_private'});assert.equal(arbitrary.errorCode,'code-unlisted');assert.ok(!JSON.stringify(arbitrary).includes('customer_private'));
});
test('malformed and non-object JSON cannot invent a reason or HTTP status',()=>{
 for(const body of ['{','[]','null','"provider_timeout"']){const value=classifyFailureResponse({contentType:'application/json',body});assert.equal(value.errorCode,null);assert.equal(value.upstreamStatus,null);}
});
const REQUEST='11111111-1111-4111-8111-111111111111',ATTEMPT='22222222-2222-4222-8222-222222222222',SESSION='33333333-3333-4333-8333-333333333333',RELEASE='c'.repeat(40);
const responseBody=()=>JSON.stringify({diagnostics:{schema_version:'coaching_diagnostic_v1',request_id:REQUEST,attempt_id:ATTEMPT,client_attempt:1,client_release_id:RELEASE,status:503,outcome:'failure'}});
function installedHandler(t,text,{deadlineMs=3000}={}){
 const page=new EventEmitter(),request={timing:()=>({responseEnd:17})},attempt=policy.newAttempt(1,{sessionId:SESSION,diagnostic_request_id:REQUEST,diagnostic_attempt_id:ATTEMPT,client_attempt:1,client_release_id:RELEASE});attempt.startedAt=Date.now();
 const attempts=new WeakMap([[request,attempt]]),installed=sourceAdapters.installCoachingResponseHandler(page,attempts,{deadlineMs});t.after(()=>installed.dispose());
 page.emit('response',{request:()=>request,headers:()=>({'content-type':'application/json'}),status:()=>503,text});return attempt;
}
function actualWriter(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coaching-correlation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sha='a'.repeat(40),recorder=createCaseRecorder({caseId:'AHT-01',requiredAssertions:['grounded-coaching'],sourceSha:sha,servedSha:sha,targetUrl:'https://speaksharp-public.vercel.app'},dir);
 return {dir,write(name,attempt){const closed=policy.closed(attempt,{first:SESSION});const ref=recorder.writeEvidence(name,{contentSafe:true,caseId:'AHT-01',kind:'coaching-correlation',correlation:closed.correlation||null});return path.join(dir,ref);}};
}
test('actual writer retains an exact matched correlation with no blocked strings or raw identifiers',t=>{
 const attempt=policy.newAttempt(1,{sessionId:SESSION,diagnostic_request_id:REQUEST,diagnostic_attempt_id:ATTEMPT,client_attempt:1,client_release_id:RELEASE});policy.finish(attempt,503);attempt.correlation=policy.classifyResponseCorrelation(attempt,{contentType:'application/json',body:responseBody(),status:503});
 const file=actualWriter(t).write('matched-correlation.json',attempt),written=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(written.sanitizer.blockedStrings,0);assert.equal(written.correlation.available,true);assert.equal(written.correlation.matched,true);assert.equal(written.correlation.authority,'browser-correlation-only');
 const encoded=JSON.stringify(written);for(const raw of [REQUEST,ATTEMPT,SESSION])assert.ok(!encoded.includes(raw));
});
test('installed response handler closes a rejected body read without later changing persisted evidence',async t=>{
 const attempt=installedHandler(t,async()=>{throw Error('private body read rejection');},{deadlineMs:50});await attempt.diagPromise;
 assert.deepEqual([attempt.correlation.available,attempt.correlation.matched],[false,null]);const file=actualWriter(t).write('rejected-body.json',attempt),before=fs.readFileSync(file);await new Promise(r=>setTimeout(r,75));assert.deepEqual(fs.readFileSync(file),before);
});
test('installed response handler times out a nonsettling body at 3 seconds and ignores its late settlement',async t=>{
 let release;const pending=new Promise(r=>{release=r;}),attempt=installedHandler(t,()=>pending);await attempt.diagPromise;
 assert.equal(attempt.diagExpired,true);assert.equal(attempt.correlation,undefined);const file=actualWriter(t).write('body-deadline.json',attempt),before=fs.readFileSync(file),snapshot=JSON.stringify(policy.closed(attempt,{first:SESSION}));
 release(responseBody());await new Promise(r=>setTimeout(r,25));assert.equal(JSON.stringify(policy.closed(attempt,{first:SESSION})),snapshot);assert.deepEqual(fs.readFileSync(file),before);
});
function captureFixture(t,{inputs='available',terminal=false,reader,throwInputs=false}={}){
 const A='22222222-2222-4222-8222-222222222222',uid='11111111-1111-4111-8111-111111111111',sha='a'.repeat(40),written=[];
 const oldRead=source.readSavedPromptObservation,oldPair=source.readLiveCoachingPair;
 source.readSavedPromptObservation=async()=>{if(throwInputs)throw Object.assign(Error('private-token-and-transcript'),{phase:'forged',cause:'private-token'});return{state:inputs,saved:{}};};
 source.readLiveCoachingPair=async()=>terminal?null:{sessionId:A,pair:{version:'gemini_coaching_v1',what_worked:'synthetic well',what_to_try_next:'synthetic next'}};
 t.after(()=>{source.readSavedPromptObservation=oldRead;source.readLiveCoachingPair=oldPair;});
 const c={campaignId:'UNIT-ONLY',caseId:'AHT-01',sourceSha:sha,servedSha:sha,oracleBindings:{},account:{id:uid},fixture:{name:'synthetic',sha256:'b'.repeat(64)},readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'synthetic-public',schemaSha256:'b'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit/rls.json'},targetUrl:'https://unit.invalid'};
 const page={on(){},off(){},getByTestId:()=>({getAttribute:async()=> 'error'})};
 const o=oracleModule.createOracles({context:{newPage:async()=>assert.fail('no extra page expected')},caseConfig:c,writeEvidence:async(name,value)=>{written.push(value);return name;},readPrivateEvidence:reader||(async()=>assert.fail('producer must not be reached'))});
 t.after(()=>o.dispose());return{o,page,A,written,c};
}
test('missing saved inputs exposes a code-owned closed cause before readiness/producer',async t=>{
 const f=captureFixture(t,{inputs:'unavailable'});await f.o.coaching({phase:'begin',page:f.page});
 await assert.rejects(f.o.coaching({phase:'capture',page:f.page,sessionId:f.A}),e=>{assert.deepEqual(oracleModule.captureDiagnostic(e),{phase:'saved-inputs',cause:'saved-inputs-unavailable'});return e.code==='NOT_RUN';});
});
test('unknown saved-input exception becomes an unknown observation, with phase and no raw payload',async t=>{
 const f=captureFixture(t,{throwInputs:true});await f.o.coaching({phase:'begin',page:f.page});
 const r=await f.o.coaching({phase:'capture',page:f.page,sessionId:f.A});assert.equal(r.result,'NOT RUN');assert.deepEqual(oracleModule.captureDiagnostic(r),{phase:'saved-inputs',cause:'saved-input-read-failed'});
 const copied=oracleModule.carryCaptureDiagnostic(r,new Error('private-token'));assert.deepEqual(oracleModule.captureDiagnostic(copied),{phase:'saved-inputs',cause:'saved-input-read-failed'});
 assert.ok(!JSON.stringify(f.written).includes('private-token'));assert.ok(!JSON.stringify(f.written).includes('transcript'));
 // Check the added closed diagnostics through the unchanged sink. Its existing
 // single-word oracle label is unrelated to the boundary fields under test.
 const sanitized=sanitizeEvidence(f.written.map(x=>x.facts));assert.equal(sanitized.stats.blockedStrings,0);assert.equal(sanitized.stats.truncated,0);assert.equal(sanitized.value[0].capture.phase,'saved-inputs');assert.equal(sanitized.value[0].capture.cause,'saved-input-read-failed');
});
test('terminal coaching readiness is distinct from missing saved inputs',async t=>{
 const f=captureFixture(t,{terminal:true});await f.o.coaching({phase:'begin',page:f.page});
 await assert.rejects(f.o.coaching({phase:'capture',page:f.page,sessionId:f.A}),e=>{assert.deepEqual(oracleModule.captureDiagnostic(e),{phase:'current-readiness',cause:'coaching-terminal-state'});return e.code==='NOT_RUN';});
});
test('stale authority envelope retains the authority-receipt boundary and still refuses',async t=>{
 const f=captureFixture(t,{reader:async()=>({content:{},provenance:{verified:true,bindingName:'coaching-authority',sourceSha:'a'.repeat(40),servedSha:'a'.repeat(40),campaignId:'UNIT-ONLY',caseId:'AHT-01',producedAt:'2000-01-01T00:00:00Z',artifactSha256:'b'.repeat(64),requestSha256:'c'.repeat(64),evidenceRef:'unit/producer.json'}})});await f.o.coaching({phase:'begin',page:f.page});
 await assert.rejects(f.o.coaching({phase:'capture',page:f.page,sessionId:f.A}),e=>{assert.deepEqual(oracleModule.captureDiagnostic(e),{phase:'authority-receipt',cause:'authority-receipt-unavailable'});return e.code==='NOT_RUN';});
});
test('caller-supplied error metadata is never treated as trusted boundary evidence',()=>{
 const e=Object.assign(Error('secret'),{capturePhase:'saved-inputs',captureCause:'saved-inputs-unavailable'});assert.deepEqual(oracleModule.captureDiagnostic(e),{phase:'unknown',cause:'unknown'});
});
