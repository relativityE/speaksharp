'use strict';
// Pure source-derived row oracle. No transport/client/token access. Main70e storage.ts completeSession
// and final versioned 20261025021046 complete_session_v2: all 11 arguments, null means unchanged,
// duration clamp, strict idempotent replay and transcript-retention transaction.
// Complete storage/SQL bytes revalidated unchanged at 66328703; see source/receiving-save-source.json.
// This source binding does not prove the deployed backend. Runtime still NOT RUN.
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const SOURCE_SHA = '66328703bf47e865b730e229005411e78481d34c';
const HOST = 'yxlapjuovrsvjswkwnrk.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const columns = Object.freeze(['id','user_id','status','idempotency_key','lease_id','duration','status_reason','total_words','clarity_score','wpm','filler_counts','pause_metrics','next_action_signal','transcript','transcript_state']);
const readbackContract = Object.freeze({version:1,kind:'own-session-v1',sourceSha:SOURCE_SHA,host:HOST,pathname:'/rest/v1/sessions',columns});
const args = Object.freeze(['p_session_id','p_status','p_final_duration','p_reason','p_next_action','p_total_words','p_clarity_score','p_wpm','p_filler_counts','p_pause_metrics','p_final_transcript']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function rowShape(row) {
  if (!row || typeof row!=='object' || Array.isArray(row) || columns.some(k=>!Object.hasOwn(row,k))) return false;
  if (!UUID.test(row.id)||!UUID.test(row.user_id)||typeof row.idempotency_key!=='string'||!row.idempotency_key||typeof row.lease_id!=='string'||!row.lease_id) return false;
  for (const k of ['duration','total_words','clarity_score','wpm']) if(row[k]!==null && (typeof row[k]!=='number'||!Number.isFinite(row[k]))) return false;
  for (const k of ['status_reason','transcript']) if(row[k]!==null && typeof row[k]!=='string') return false;
  return true;
}
function validateBaseline(row,ownerId,sessionId) {
  if(!rowShape(row)||row.user_id!==ownerId||row.id!==sessionId||row.status!=='active') throw new Error('HARNESS_LIMITED: exact own active baseline row required');
  return true;
}
function compareSavedRows(rows,expectedOperation) {
  const fail=()=>({operationDigest:expectedOperation?.operationDigest,durableSaved:false,savedRowCount:Array.isArray(rows)?rows.length:0});
  const e=expectedOperation,b=e?.requestBody,before=e?.beforeRow;
  if(!b||Object.keys(b).length!==args.length||args.some(k=>!Object.hasOwn(b,k))||b.p_status!=='completed'||!UUID.test(b.p_session_id||'')||!before) return fail();
  try{validateBaseline(before,before.user_id,b.p_session_id);}catch{return fail();}
  if(sha(before.user_id)!==e.accountSubjectSha256||sha(b.p_session_id)!==e.expectedSessionSha256) return fail();
  if(!Array.isArray(rows)||rows.length!==1) return fail();
  const row=rows[0]; if(!rowShape(row)||row.id!==b.p_session_id||row.user_id!==before.user_id||row.status!=='completed'||row.idempotency_key!==before.idempotency_key||row.lease_id!==before.lease_id) return fail();
  if(b.p_final_duration!==null&&(!Number.isInteger(b.p_final_duration)))return fail();
  const duration=Math.min(600,Math.max(0,b.p_final_duration??before.duration??0));
  if(row.duration!==duration||b.p_next_action===null||!isDeepStrictEqual(row.next_action_signal,b.p_next_action))return fail();
  const pairs=[['p_reason','status_reason'],['p_total_words','total_words'],['p_clarity_score','clarity_score'],['p_wpm','wpm'],['p_filler_counts','filler_counts'],['p_pause_metrics','pause_metrics'],['p_final_transcript','transcript']];
  for(const [arg,column]of pairs)if(!isDeepStrictEqual(row[column],b[arg]??before[column]))return fail();
  // This journey claims a real retained take, not merely a 2xx RPC envelope or placeholder row.
  if(row.filler_counts===null||row.transcript_state!=='available'||typeof row.transcript!=='string'||!row.transcript.trim())return fail();
  return{operationDigest:e.operationDigest,durableSaved:true,savedRowCount:1};
}
async function readback({request,expectedOperation}) {
  const response=await request();
  if(response.status!==200)return{operationDigest:expectedOperation.operationDigest,durableSaved:false,savedRowCount:0};
  let rows;try{rows=JSON.parse(response.bodyText);}catch{return{operationDigest:expectedOperation.operationDigest,durableSaved:false,savedRowCount:0};}
  return compareSavedRows(rows,expectedOperation);
}
module.exports={readback,readbackContract,validateBaseline,compareSavedRows};
