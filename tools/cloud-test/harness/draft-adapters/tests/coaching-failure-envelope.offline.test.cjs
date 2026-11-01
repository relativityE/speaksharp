'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const policy=require('../coaching-failure-policy.cjs'),{classifyFailureResponse}=policy;
const oracleModule=require('../oracles/index.cjs'),source=require('../oracles/pure/coachingCollectorSelected.cjs');
const {sanitizeEvidence}=require('../../bundle/harness/evidence-sanitizer.cjs');
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
test('actual adapter response path attaches the bounded request/response correlation before evidence settles',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../source-adapters.cjs'),'utf8');
 assert.ok(source.includes('a.correlation=coachingPolicy.classifyResponseCorrelation(a,{contentType:h[\'content-type\'],body,status})'));
 assert.ok(source.includes('await Promise.all(coachingAttempts.map(a=>a.diagPromise).filter(Boolean))'));
 const request='11111111-1111-4111-8111-111111111111',attemptId='22222222-2222-4222-8222-222222222222',release='c'.repeat(40);
 const a=policy.newAttempt(1,{sessionId:'33333333-3333-4333-8333-333333333333',diagnostic_request_id:request,diagnostic_attempt_id:attemptId,client_attempt:1,client_release_id:release});
 const body=JSON.stringify({diagnostics:{schema_version:'coaching_diagnostic_v1',request_id:request,attempt_id:attemptId,client_attempt:1,client_release_id:release,status:503,outcome:'failure'}});
 const result=policy.classifyResponseCorrelation(a,{contentType:'application/json',body,status:503});
 assert.equal(result.state,'matched');assert.equal(result.authority,'browser-correlation-only');
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
