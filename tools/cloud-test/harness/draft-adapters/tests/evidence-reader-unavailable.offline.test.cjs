'use strict';
// Pure/synthetic controls for diagnostic continuation when NO authorized evidence reader exists. No browser, network or producer.
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const rx=require('../receivers/unavailable-evidence-reader.cjs'),a=require('../source-adapters.cjs'),{createOracles}=require('../oracles/index.cjs');
const pe=require('../../bundle/harness/producer-evidence.cjs'),f=require('../oracles/feedback-association.cjs');
const uid='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333',sha='a'.repeat(40);
const unavailable=async()=>{const e=new Error('EVIDENCE_READER_UNAVAILABLE: x');e.code='EVIDENCE_READER_UNAVAILABLE';throw e;};
test('receiver is fail-closed: never returns an artifact or provenance, only the typed error',async()=>{assert.equal(rx.contract.producesArtifacts,false);assert.equal(rx.contract.scope,'existing-authenticated-producer-receiving-capability');await assert.rejects(()=>rx.receiveArtifact({request:{}}),e=>e.code==='EVIDENCE_READER_UNAVAILABLE'&&!('provenance'in e));});
test('stand-in can never validate as a delivery: any shape it could return fails provenance validation',()=>{const req={artifactRole:'coaching-authority'};assert.throws(()=>pe.validateProducerDelivery({artifactBytes:Buffer.alloc(0)},req,{deliveryKind:'x'}),/NOT_RUN/);});
test('continuation applies ONLY to a typed unavailable-reader NOT RUN',()=>{const k=a.continuesAfterUnavailableReader;
 assert.equal(k({result:'NOT RUN',observed:false,evidenceReaderUnavailable:true}),true);
 assert.equal(k({result:'NOT RUN',observed:false}),false,'plain NOT RUN still stops the journey');
 assert.equal(k({result:'FAIL',observed:true,evidenceReaderUnavailable:true}),false,'FAIL is never swallowed');
 assert.equal(k({result:'PASS',observed:true,evidenceReaderUnavailable:true}),false,'PASS is never produced by this path');
 assert.equal(k({result:'NOT RUN',observed:true,evidenceReaderUnavailable:true}),false,'must be an unobserved result');
 assert.equal(k(null),false);});
const c={sourceSha:sha,servedSha:sha,campaignId:'UNIT',caseId:'AHT-07',account:{id:uid},oracleBindings:{},readback:{origin:'https://unit.invalid'},fixture:{name:'x',sha256:'0'.repeat(64)}};
const writes=[];const writeEvidence=async(name,v)=>{writes.push({name,v});return 'ev-'+writes.length+'.json';};
function oracles(reader){return createOracles({context:{},guard:{},caseConfig:c,writeEvidence,readPrivateEvidence:reader,pdfTextExtractor:null});}
test('feedback association with unavailable reader is a typed NOT RUN with no reports, never PASS',async()=>{
 const page=new EventEmitter();const o=oracles(unavailable);
 await o.feedbackAssociation({phase:'begin',page,sessionId:sid,description:'UNIT description'});
 const body={user_id:uid,session_id:sid,idempotency_key:key,description:'UNIT description'};
 page.emit('request',{url:()=>c.readback.origin+'/rest/v1/user_issue_reports',method:()=> 'POST',headers:()=>({}),postDataBuffer:()=>Buffer.from(JSON.stringify(body))});
 const r=await o.feedbackAssociation({phase:'assert',page});
 assert.equal(r.result,'NOT RUN');assert.equal(r.evidenceReaderUnavailable,true);assert.equal(r.observed,false);assert.equal(r.reports,null);assert.ok(r.evidenceRefs.length>=1);
 assert.equal(writes.at(-1).v.facts.reason,'authorized-evidence-reader-unavailable');});
test('a DIFFERENT reader error is not swallowed as unavailability (still propagates)',async()=>{
 const page=new EventEmitter();const o=oracles(async()=>{throw new Error('some other failure');});
 await o.feedbackAssociation({phase:'begin',page,sessionId:sid,description:'UNIT description'});
 page.emit('request',{url:()=>c.readback.origin+'/rest/v1/user_issue_reports',method:()=> 'POST',headers:()=>({}),postDataBuffer:()=>Buffer.from(JSON.stringify({user_id:uid,session_id:sid,idempotency_key:key,description:'UNIT description'}))});
 // the generic wrapper turns non-NOT_RUN errors into a HOLD (observationInterrupted), never into the unavailable-reader marker
 const r=await o.feedbackAssociation({phase:'assert',page});assert.notEqual(r.evidenceReaderUnavailable,true);assert.notEqual(r.result,'PASS');});
// ---- coaching: browser-side capture is kept, server authority is honestly unavailable ----
const source=require('../oracles/pure/coachingCollectorSelected.cjs');
const A='44444444-4444-4444-8444-444444444444',B='55555555-5555-4555-8555-555555555555';
function coachingRig(t,reader){const oldRead=source.readSavedPromptObservation,oldRender=source.readLiveCoachingPair;let currentId;const reads=[],written=[];
 source.readSavedPromptObservation=async(_d,_o,id)=>{reads.push(id);currentId=id;return{state:'available',totalWords:10,saved:{transcript:'UNIT private words',metrics:{},promptContext:{transcriptState:'available',focusContext:{kind:'none'}}}};};
 source.readLiveCoachingPair=async()=>({sessionId:currentId,pair:{version:'gemini_coaching_v1',what_worked:'UNIT well',what_to_try_next:'UNIT next'}});
 t.after(()=>{source.readSavedPromptObservation=oldRead;source.readLiveCoachingPair=oldRender;});
 const cc={campaignId:'UNIT-NOT-A-RUN',caseId:'AHT-01',sourceSha:sha,servedSha:sha,oracleBindings:{},account:{id:uid},fixture:{name:'unit',sha256:'a'.repeat(64)},readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'public-unit-key',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit'},targetUrl:'https://unit.invalid'};
 const page={on(){},off(){}},context={newPage:async()=>assert.fail('unexpected temporary browser page')};
 const o=createOracles({context,caseConfig:cc,writeEvidence:async(n,v)=>{written.push(v);return n;},readPrivateEvidence:reader});return{o,page,reads,written};}
test('coaching with unavailable reader: capture continues, assert is NOT RUN (never PASS/FAIL), no raw text written',async t=>{
 const f=coachingRig(t,unavailable);await f.o.coaching({phase:'begin',page:f.page});
 const cap=await f.o.coaching({phase:'capture',page:f.page,sessionId:A});assert.equal(cap.observed,true,'browser-side capture is observed and journey may continue');
 await f.o.coaching({phase:'capture',page:f.page,sessionId:B,inputsOnly:true});
 const r=await f.o.coaching({phase:'assert',page:f.page,sessionId:A,repeatId:B});
 assert.equal(r.result,'NOT RUN');assert.equal(r.observed,false);assert.equal(r.evidenceReaderUnavailable,true);assert.ok(r.evidenceRefs.length>=1);
 assert.equal(JSON.stringify(f.written).includes('UNIT private words'),false);assert.equal(JSON.stringify(f.written).includes('UNIT well'),false);
 assert.equal(f.written.at(-1).facts.serverAuthorityRead,false);f.o.dispose();});
test('coaching with a reader that throws a different error does NOT take the unavailable path',async t=>{
 const f=coachingRig(t,async()=>{throw new Error('unrelated failure');});await f.o.coaching({phase:'begin',page:f.page});
 const r=await f.o.coaching({phase:'capture',page:f.page,sessionId:A});assert.notEqual(r.evidenceReaderUnavailable,true);assert.equal(a.continuesAfterUnavailableReader(r),false,'an unrelated reader failure must still stop the journey');assert.notEqual(r.result,'PASS');f.o.dispose();});
