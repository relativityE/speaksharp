'use strict';
// Passive final-action identity plus independently delivered server projection. No privileged I/O.
const {createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(x).digest('hex'),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function attach(page,c,{sessionId,description}){
 const s={count:0,blind:0,key:null,startedAt:Date.now()};
 const handler=r=>{try{const u=new URL(r.url());if(u.origin!==c.readback.origin||u.pathname!=='/rest/v1/user_issue_reports'||r.method()!=='POST')return;s.count++;const headers=r.headers?.();if(!headers||Object.entries(headers).some(([k,v])=>k.toLowerCase()==='content-profile'&&v!=='public')){s.blind++;return;}if(u.search||u.hash||r.postDataBuffer()?.length>1048576){s.blind++;return;}const raw=JSON.parse(r.postDataBuffer().toString('utf8'));const row=Array.isArray(raw)&&raw.length===1?raw[0]:!Array.isArray(raw)?raw:null;if(!row||row.user_id!==c.account.id||row.session_id!==sessionId||row.description!==description||!UUID.test(row.idempotency_key||'')){s.blind++;return;}s.key=row.idempotency_key;}catch{s.blind++;}};
 page.on('request',handler);s.detach=()=>page.off('request',handler);return s;
}
function observedIdentity(s){if(s.count>1)return{status:'FAIL',reason:'unexpected_final_feedback_insert_count'};if(s.count!==1||s.blind||!s.key)return{status:'HOLD',reason:'actual_final_feedback_action_unavailable'};return{status:'PASS',idempotencyKey:s.key};}
function associationProjection(loaded,c,key){
 const v=loaded?.content,p=loaded?.provenance;
 if(!v||v.schemaVersion!=='speaksharp.cloud-runner-readback-projection.v1'||v.artifactRole!=='feedback-association'||v.sourceReadRoute!=='user_issue_reports:owner-and-draft-key'||v.releaseSha!==c.sourceSha||v.campaignId!==c.campaignId||v.caseId!==c.caseId||v.requestSha256!==p?.requestSha256||!Array.isArray(v.observations)||v.observations.length>2)return{status:'HOLD',reason:'actual_feedback_projection_binding_missing'};
 for(const r of v.observations)if(r.createdInObservedWindow!==true||r.ownerSha256!==sha(c.account.id)||r.idempotencySha256!==sha(key)||!/^([a-f0-9]{64})$/.test(r.idSha256||'')||!(r.sessionSha256===null||/^[a-f0-9]{64}$/.test(r.sessionSha256||''))||!['absent','valid','malformed'].includes(r.diagnosticKind)||(r.diagnosticKind==='valid'?!/^[a-f0-9]{64}$/.test(r.diagnosticRefSha256||''):r.diagnosticRefSha256!==null))return{status:'FAIL',reason:'feedback_projection_owner_key_or_shape_mismatch'};
 if(v.observations.length===0)return{status:'HOLD',reason:'fresh_owner_key_row_or_clock_order_unproven'};
 return{status:'PASS',reports:v.observations.map(r=>({id:r.idSha256,sessionSha256:r.sessionSha256,diagnosticKind:r.diagnosticKind,diagnosticRefSha256:r.diagnosticRefSha256}))};
}
module.exports={attach,observedIdentity,associationProjection,sha};
