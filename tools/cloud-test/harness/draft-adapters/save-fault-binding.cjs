'use strict';
// Trusted-reviewed adapter, NOT a Node sandbox. Only browser GET below is active I/O;
// it uses the already-qualified browser boundary. No tokens cross the page boundary.
const crypto=require('node:crypto');
const {SessionCreateBinding}=require('./oracles/pure/rwtRecoveryCapture.cjs');
const {validateReadback}=require('./browser-readback.cjs');
const observer=require('./browser-observers.cjs');
const {readbackContract,validateBaseline,compareSavedRows}=require('./durable-save-oracle.cjs');
const {sessionReadbackBinding}=require('../bundle/harness/reviewed-oracle-loader.cjs');
const {immutableJsonCopy}=require('../bundle/harness/fault-contract.cjs');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const captures=new WeakMap(),armedOperations=new WeakMap(),PHASE='save-fault-new-session';
function unavailable(message){const error=new Error(message);error.code='NOT_RUN';error.trustedBlocker=message;throw error;}
function requireThat(value,message){if(!value)unavailable(message);}
function preflight(caseId,c,guard,configurationOnly=false){
  requireThat(['AHT-05','AHT-06'].includes(caseId),'save fault case unsupported');
  requireThat(c?.sourceSha===readbackContract.sourceSha&&c.servedSha===readbackContract.sourceSha,'save fault source/served release differs from inspected main70e');
  const b=validateReadback(c);requireThat(new URL(b.origin).host===readbackContract.host,'save fault backend differs from source-reviewed target');
  // Body/digest intentionally do not exist yet: they are captured once from this own new session.
  if(c.faultBinding)requireThat(c.faultBinding.operationIdentityMode==='bound-session-capture-payload'&&!c.faultBinding.requestBodySha256&&!c.faultBinding.operationDigest,'precomputed or endpoint-only save fault binding refused');
  if(!configurationOnly){
    for(const name of ['saveReadbackConfiguration','bindSaveReadback','capturedSaveOperation','markCompletionRetry','completionAttemptSummary','armFault','summary'])requireThat(typeof guard?.[name]==='function','dynamic completion guard capability missing');
    const configured=guard.saveReadbackConfiguration();
    requireThat(configured.sourceSha===c.sourceSha&&configured.host===readbackContract.host&&configured.accountSubjectSha256===sha(c.account.id),'reviewed dynamic oracle source/owner/backend mismatch');
  }
  return true;
}
function begin({page,caseConfig:c}){
  validateReadback(c);requireThat(c.sourceSha===readbackContract.sourceSha,'creation capture source mismatch');
  const capture=new SessionCreateBinding(c.readback.origin,()=>c.account.id);capture.arm(PHASE);capture.attach(page);
  captures.set(capture,{page,ownerId:c.account.id,sourceSha:c.sourceSha,used:false});return capture;
}
async function exactOwnRow(page,c,sessionId){
  const b=validateReadback(c),binding=sessionReadbackBinding(readbackContract,{host:new URL(b.origin).host,ownerId:c.account.id,sessionId,sourceSha:c.sourceSha});
  const result=await page.evaluate(async p=>{
    let auth;try{auth=JSON.parse(localStorage.getItem('sb-'+p.projectRef+'-auth-token')||'null');}catch{return{error:'auth_unreadable'};}
    if(auth?.user?.id!==p.uid||typeof auth.access_token!=='string')return{error:'owner_session_mismatch'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(p.url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',headers:{apikey:p.anonKey,Authorization:'Bearer '+auth.access_token,Accept:'application/json'},signal:controller.signal});
      if(response.status!==200)return{error:'readback_status'};
      const text=await response.text();if(text.length>2097152)return{error:'readback_oversize'};
      let rows;try{rows=JSON.parse(text);}catch{return{error:'readback_json'};}
      if(!Array.isArray(rows)||rows.length>2||rows.some(r=>!r||r.id!==p.sessionId||r.user_id!==p.uid))return{error:'readback_scope'};
      return{rows};
    }catch{return{error:'readback_transport'};}finally{clearTimeout(timer);}
  },{url:'https://'+binding.host+binding.pathname+binding.search,projectRef:b.projectRef,anonKey:b.anonKey,uid:c.account.id,sessionId});
  requireThat(result&&!result.error&&Array.isArray(result.rows),'exact own session readback unavailable');
  return result.rows; // Private comparison memory only; NEVER persisted or logged as evidence.
}
async function bindAndArm({capture,page,caseId,caseConfig:c,guard,baselineSessionIds}){
  const state=captures.get(capture);
  requireThat(state&&!state.used&&state.page===page&&state.ownerId===c.account.id&&state.sourceSha===c.sourceSha,'creation capture missing, reused or retargeted');
  state.used=true;preflight(caseId,c,guard);
  requireThat(Array.isArray(baselineSessionIds)&&new Set(baselineSessionIds).size===baselineSessionIds.length,'pre-Start session baseline missing or ambiguous');
  let creation=capture.binding(PHASE);const deadline=Date.now()+10000;
  while(creation.state==='unavailable'&&['creation_unsettled','no_creation_observed'].includes(creation.reason)&&Date.now()<deadline){await page.waitForTimeout(25);creation=capture.binding(PHASE);}
  requireThat(creation.state==='observed'&&capture.records.get(PHASE)?.length===1,'exactly one settled own Start creation not observed');
  requireThat(!baselineSessionIds.includes(creation.sessionId),'Start session was already present before this take');
  const mic=await observer.mic(page);requireThat(mic?.recording&&mic.liveTracks>0,'new own session must still be RECORDING before Stop');
  const rows=await exactOwnRow(page,c,creation.sessionId);requireThat(rows.length===1,'new own active session readback not unique');
  validateBaseline(rows[0],c.account.id,creation.sessionId);requireThat(rows[0].lease_id===creation.leaseId,'active row lease contradicts its own Start');
  const beforeRow=immutableJsonCopy(rows[0]);
  const stillRecording=await observer.mic(page);requireThat(stillRecording?.recording&&stillRecording.liveTracks>0&&stillRecording.documentToken===mic.documentToken,'recording changed before fault binding');
  const metadata=guard.bindSaveReadback({sessionId:creation.sessionId,ownerId:c.account.id,sourceSha:c.sourceSha,baselineRow:beforeRow});
  const faultId=guard.armFault({id:caseId+'-completion',mode:caseId==='AHT-05'?'request-lost':'response-lost',host:readbackContract.host,method:'POST',path:'^/rest/v1/rpc/complete_session_v2$',operationIdentityMode:'bound-session-capture-payload',accountSubjectSha256:sha(c.account.id),expectedSessionSha256:sha(creation.sessionId),sessionPointer:'/p_session_id',completionStatusPointer:'/p_status',expectedStatus:'completed',oracleSourceSha256:metadata.sha256,oracleSourceId:metadata.sourceId,readbackRequestSha256:metadata.readbackRequestSha256});
  const armed=Object.freeze({faultId,sessionId:creation.sessionId});armedOperations.set(armed,{ownerId:c.account.id,sourceSha:c.sourceSha,beforeRow,page,guard});return armed;
}
function authorizeRetry({guard,armed}){
  const state=armedOperations.get(armed);requireThat(state&&state.guard===guard,'Retry intent has no bound save operation');
  return guard.markCompletionRetry(armed.faultId);
}
function verifyCompletionAttempts({guard,armed}){
  const state=armedOperations.get(armed);requireThat(state&&state.guard===guard,'completion receipts have no bound operation');
  const result=guard.completionAttemptSummary(armed.faultId);
  requireThat(result.exactExpectedAttempts,'guarded completion attempts are missing, changed, extra or outside explicit Retry');
  return Object.freeze({attemptCount:result.attemptCount,exactExpectedAttempts:true,evidenceScope:result.evidenceScope,independentServerReceipts:'UNKNOWN'});
}
async function verifyRetrySave({page,caseConfig:c,guard,armed}){
  const state=armedOperations.get(armed);requireThat(state&&state.page===page&&state.guard===guard&&state.ownerId===c.account.id&&state.sourceSha===c.sourceSha,'retry save binding missing or retargeted');
  verifyCompletionAttempts({guard,armed});
  const operation=guard.capturedSaveOperation(armed.faultId);
  requireThat(operation.expectedSessionSha256===sha(armed.sessionId)&&operation.accountSubjectSha256===sha(c.account.id),'captured completion belongs to a different owner/session');
  const rows=await exactOwnRow(page,c,armed.sessionId);
  const proof=compareSavedRows(rows,immutableJsonCopy({...operation,beforeRow:state.beforeRow}));
  return Object.freeze({durableSaved:proof.durableSaved,savedRowCount:proof.savedRowCount});
}
module.exports={preflight,begin,bindAndArm,authorizeRetry,verifyRetrySave,verifyCompletionAttempts};
