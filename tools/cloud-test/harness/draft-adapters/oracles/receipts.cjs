'use strict';
// Receipt validation NEVER manufactures producer evidence. Provenance is supplied by the independently verifying loader.
const crypto=require('node:crypto');
const {canonicalSuggestionSha256}=require('./pure/rwtCoachingEvidence.cjs');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const SHA=/^[0-9a-f]{40}$/,HASH=/^[0-9a-f]{64}$/;
function receiptBinding(loaded,c,kind,startedAt){
 const p=loaded?.provenance;const t=Date.parse(p?.producedAt||'');
 if(!p||!HASH.test(p.artifactSha256||'')||!HASH.test(p.requestSha256||'')||p.verified!==true||p.sourceSha!==c.sourceSha||p.campaignId!==c.campaignId||p.servedSha!==c.servedSha||p.caseId!==c.caseId||!(p.bindingName===kind||p.verificationScope===kind)||!Number.isFinite(t)||t<startedAt||t>Date.now()+5000||!SHA.test(c.sourceSha))return {status:'HOLD',reason:'independent_producer_binding_missing'};
 return {status:'PASS',value:loaded.content};
}
function receivedFeedbackVerdict(receipt,sent,c){
 if(!receipt||!sent||receipt.gate!=='TELEMETRY-READBACK-COMPLETENESS')return {status:'HOLD',reason:'received_readback_missing'};
 if(receipt.release_sha!==c.sourceSha||receipt.journey_id!==sent.journeyId||receipt.boot_id!==sent.bootId||receipt.traffic_type!==sent.trafficType||receipt.identity_bound!==true)return {status:'FAIL',reason:'received_identity_mismatch'};
 if(receipt.verdict==='FAIL'||(receipt.duplicate_families||[]).length||(receipt.delivery_failures||[]).length)return {status:'FAIL',reason:'received_delivery_contradiction'};
 const required=['stage_reasons','missing','reasons','unrecognised'];
 if(receipt.verdict!=='QUALIFIED'||required.some(k=>!Array.isArray(receipt[k])||receipt[k].length)||!Array.isArray(receipt.stages_declared)||!receipt.stages_declared.includes('share_feedback')||!['feedback_dialog_opened','feedback_field','feedback_submit'].every(n=>receipt.observed_families?.includes(n)&&receipt.required_families?.includes(n))||receipt.received_counts?.telemetry_positive_control!==1)return {status:'HOLD',reason:'received_feedback_not_qualified_once'};
 return {status:'PASS',reason:'independent_source_share_feedback_stage_qualified',feedbackVendorCardinality:'NOT_ESTABLISHED_BY_SUMMARY'};
}
function authorityFromReceipt(receipt,c,sessionId,{ownPair,requestSha256}={}){
 if(receipt?.schemaVersion==='speaksharp.cloud-runner-readback-projection.v1'||receipt?.schemaVersion==='speaksharp.gemini-session-readback-authority.v1'){
  if(!ownPair||typeof ownPair!=='object'||Object.keys(ownPair).sort().join(',')!=='version,what_to_try_next,what_worked'||typeof ownPair.what_worked!=='string'||typeof ownPair.what_to_try_next!=='string')return{status:'HOLD',reason:'current_own_saved_pair_unavailable'};
  if(receipt.releaseSha!==c.sourceSha||!Array.isArray(receipt.observations))return{status:'HOLD',reason:'actual_authority_projection_binding_missing'};
  let r,cache,d,provider,model,made;
  if(receipt.schemaVersion==='speaksharp.cloud-runner-readback-projection.v1'){
   if(receipt.artifactRole!=='coaching-authority'||receipt.sourceReadRoute!=='read_ai_suggestion_authority_v1'||receipt.campaignId!==c.campaignId||receipt.caseId!==c.caseId||!HASH.test(requestSha256||'')||receipt.requestSha256!==requestSha256||receipt.observations.length!==1)return{status:'HOLD',reason:'actual_authority_projection_request_missing'};
   r=receipt.observations[0];if(r.sessionSha256!==digest(sessionId)||r.ownerSha256!==digest(c.account.id))return{status:'FAIL',reason:'coaching_authority_owner_session_mismatch'};
   cache=r.cacheReadCount;d=r.immutableSuggestionSha256;provider=r.provider;model=r.model;made=r.providerRequestMade;
   if(r.currentSuggestionSha256!==d||r.canonicalSavedPairSha256!==d)return{status:'FAIL',reason:'authority_digest_contradiction'};
  }else{
   const matches=receipt.observations.filter(x=>x.persistedSessionId===sessionId);if(matches.length!==1)return{status:'HOLD',reason:'legacy_authority_session_not_unique'};r=matches[0];
   if(r.quota?.userDigest!==digest(JSON.stringify(['speaksharp-ai-suggestion-user-v1',c.account.id])))return{status:'FAIL',reason:'legacy_authority_owner_mismatch'};
   // Existing comparison schema exposes a boolean, NOT an exact positive count. Never invent count=1.
   if(r.cacheReplayObserved!==false)return{status:'HOLD',reason:'legacy_positive_cache_count_not_exposed'};
   cache=0;d=r.immutableSuggestionSha256;provider=r.provider;model=r.model;made=r.providerRequestMade;
   if(r.immutableDigestVerified!==true)return{status:'HOLD',reason:'legacy_immutable_digest_unverified'};
  }
  if(!HASH.test(d||'')||provider!=='google_gemini'||made!==true||typeof model!=='string'||!model||!Number.isSafeInteger(cache)||cache<0)return{status:'HOLD',reason:'authority_projection_incomplete'};
  if(canonicalSuggestionSha256(ownPair)!==d)return{status:'FAIL',reason:'own_saved_pair_differs_from_independent_authority_digest'};
  return{status:'PASS',reconstruction:'owner_saved_pair_verified_against_independent_server_digest_not_raw_server_phrase_delivery',value:{session_id:sessionId,user_id:c.account.id,ai_suggestions:structuredClone(ownPair),provider,model,provider_request_made:made,receipt_suggestion_sha256:d,current_suggestion_sha256:d,cache_read_count:cache}};
 }

 if(!receipt||receipt.schemaVersion!=='rwt_coaching_authority_readback_v1'||receipt.releaseSha!==c.sourceSha||receipt.campaignId!==c.campaignId||!Array.isArray(receipt.rows))return {status:'HOLD',reason:'coaching_authority_receipt_missing'};
 const rows=receipt.rows.filter(r=>r.session_id===sessionId);if(rows.length!==1)return {status:'HOLD',reason:'coaching_authority_not_unique'};
 if(rows[0].user_id!==c.account.id)return {status:'FAIL',reason:'coaching_authority_owner_mismatch'};
 return {status:'PASS',value:rows[0]};
}
module.exports={receiptBinding,receivedFeedbackVerdict,authorityFromReceipt};
