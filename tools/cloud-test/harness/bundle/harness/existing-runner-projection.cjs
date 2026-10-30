'use strict';
// PURE adapters of existing trusted-runner read routes, not a new workflow or authentication system.
// No clients, env, credentials, filesystem, network or privileged invocation. Raw input remains memory-only.
const crypto=require('node:crypto');
const {canonicalSuggestionSha256}=require('../../draft-adapters/oracles/pure/rwtCoachingEvidence.cjs');
const SCHEMA='speaksharp.cloud-runner-readback-projection.v1',SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function need(x,s){if(!x)throw Object.assign(new Error(s),{code:'NOT_RUN'});}
function requestDigest(request){need(request&&UUID.test(request.ownerAccountId||'')&&/^[a-f0-9]{40}$/.test(request.sourceSha||'')&&request.sourceSha===request.servedSha&&typeof request.campaignId==='string'&&request.campaignId&&/^AHT-\d{2}$/.test(request.caseId||'')&&/^[a-f0-9]{32}$/.test(request.requestNonce||''),'runner projection request binding missing');return sha(JSON.stringify(request));}
function shell(request,route,observations){return {schemaVersion:SCHEMA,artifactRole:request.artifactRole,releaseSha:request.sourceSha,campaignId:request.campaignId,caseId:request.caseId,requestSha256:requestDigest(request),sourceReadRoute:route,observations};}
function coachingQuery(request){requestDigest(request);need(request.artifactRole==='coaching-authority'&&request.sessionIds?.length===1&&UUID.test(request.sessionIds[0]),'one current actual session required');return {rpc:'read_ai_suggestion_authority_v1',args:{p_session_ids:[request.sessionIds[0]]},requiredOwnerId:request.ownerAccountId};}
function projectCoachingAuthority(rows,request){
 const q=coachingQuery(request);need(Array.isArray(rows)&&rows.length===1,'exact own authority row required');const r=rows[0];need(r?.session_id===q.args.p_session_ids[0]&&r.user_id===q.requiredOwnerId,'authority owner/session differs');
 const digest=canonicalSuggestionSha256(r.ai_suggestions);need(r.provider==='google_gemini'&&r.provider_request_made===true&&typeof r.model==='string'&&/^[A-Za-z0-9._:-]+$/.test(r.model)&&Number.isSafeInteger(r.cache_read_count)&&r.cache_read_count>=0&&SHA.test(r.receipt_suggestion_sha256||'')&&digest===r.receipt_suggestion_sha256&&r.current_suggestion_sha256===digest,'actual authority digest/provider/cache facts incomplete');
 return shell(request,q.rpc,[{sessionSha256:sha(r.session_id),ownerSha256:sha(r.user_id),provider:r.provider,model:r.model,providerRequestMade:true,cacheReadCount:r.cache_read_count,immutableSuggestionSha256:r.receipt_suggestion_sha256,currentSuggestionSha256:r.current_suggestion_sha256,canonicalSavedPairSha256:digest}]);
}
function feedbackQuery(request){requestDigest(request);need(request.artifactRole==='feedback-association'&&UUID.test(request.idempotencyKey||''),'actual feedback draft key required');need(Number.isFinite(Date.parse(request.startedAt))&&Number.isFinite(Date.parse(request.requestedAt))&&Date.parse(request.startedAt)<=Date.parse(request.requestedAt),'actual feedback observation window missing');return{table:'user_issue_reports',select:'id,user_id,session_id,idempotency_key,metadata,created_at',filters:[['user_id','eq',request.ownerAccountId],['idempotency_key','eq',request.idempotencyKey],['created_at','gte',request.startedAt]],limit:2};}
function projectFeedbackAssociation(rows,request){
 feedbackQuery(request);need(Array.isArray(rows)&&rows.length<=2,'bounded feedback readback rows required');return shell(request,'user_issue_reports:owner-and-draft-key',rows.map(r=>{
  need(r&&UUID.test(r.id||'')&&r.user_id===request.ownerAccountId&&r.idempotency_key===request.idempotencyKey&&Object.hasOwn(r,'session_id')&&(r.session_id===null||UUID.test(r.session_id))&&Object.hasOwn(r,'metadata')&&Number.isFinite(Date.parse(r.created_at))&&Date.parse(r.created_at)>=Date.parse(request.startedAt)&&Date.parse(r.created_at)<=Date.parse(request.requestedAt)+5000,'actual feedback row scope/shape/freshness differs');
  const v=r.metadata&&typeof r.metadata==='object'?r.metadata.coaching_diagnostic_ref:undefined,kind=v==null?'absent':typeof v==='string'&&new RegExp(UUID.source,'i').test(v)?'valid':'malformed';
  return{createdInObservedWindow:true,idSha256:sha(r.id),ownerSha256:sha(r.user_id),idempotencySha256:sha(r.idempotency_key),sessionSha256:r.session_id===null?null:sha(r.session_id),diagnosticKind:kind,diagnosticRefSha256:kind==='valid'?sha(v):null};
 }));
}
function validateProjection(content,request){
 need(content?.schemaVersion===SCHEMA&&content.artifactRole===request.artifactRole&&content.releaseSha===request.sourceSha&&content.campaignId===request.campaignId&&content.caseId===request.caseId&&content.requestSha256===requestDigest(request)&&Array.isArray(content.observations),'received projection does not bind this actual request');
 const q=request.artifactRole==='coaching-authority'?coachingQuery(request):feedbackQuery(request),obs=content.observations;
 if(request.artifactRole==='coaching-authority'){
  need(content.sourceReadRoute===q.rpc&&obs.length===1,'authority projection route/cardinality differs');const r=obs[0];need(r.ownerSha256===sha(request.ownerAccountId)&&r.sessionSha256===sha(request.sessionIds[0])&&r.provider==='google_gemini'&&r.providerRequestMade===true&&typeof r.model==='string'&&/^[A-Za-z0-9._:-]+$/.test(r.model)&&Number.isSafeInteger(r.cacheReadCount)&&r.cacheReadCount>=0&&SHA.test(r.immutableSuggestionSha256||'')&&r.currentSuggestionSha256===r.immutableSuggestionSha256&&r.canonicalSavedPairSha256===r.immutableSuggestionSha256,'authority projection facts mismatch');
 }else{need(content.sourceReadRoute==='user_issue_reports:owner-and-draft-key'&&obs.length<=2,'feedback projection route/cardinality differs');for(const r of obs)need(r.createdInObservedWindow===true&&r.ownerSha256===sha(request.ownerAccountId)&&r.idempotencySha256===sha(request.idempotencyKey)&&SHA.test(r.idSha256||'')&&(r.sessionSha256===null||SHA.test(r.sessionSha256||''))&&['absent','valid','malformed'].includes(r.diagnosticKind)&&(r.diagnosticKind==='valid'?SHA.test(r.diagnosticRefSha256||''):r.diagnosticRefSha256===null),'feedback projection facts mismatch');}
 return content;
}
module.exports={SCHEMA,sha,requestDigest,coachingQuery,feedbackQuery,projectCoachingAuthority,projectFeedbackAssociation,validateProjection};
