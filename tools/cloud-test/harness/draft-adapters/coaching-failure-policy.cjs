'use strict';
// Coaching generation attempts are correlated to the saved session they were requested for. A failed attempt is PRESERVED as a FAIL on the
// grounded-coaching row; a genuinely verified later recovery (oracle PASS and a later 2xx attempt for the same session) is recorded SEPARATELY
// and never turns the failed attempt into a PASS. Pure: no browser, network, filesystem or credentials. Only closed integers/enums are kept.
const crypto=require('node:crypto');
const isFailureStatus=s=>Number.isInteger(s)&&s>=400&&s<=599;
const isSuccessStatus=s=>Number.isInteger(s)&&s>=200&&s<=299;
const sessionRef=id=>typeof id==='string'&&id?crypto.createHash('sha256').update(id).digest('hex').slice(0,12):null;
// r14/r15 closed diagnostics for a FAILED attempt (R5 recorded only the status and duration of the 502; the layer that failed was unknowable). Only closed values survive:
// content kind, body size, two labelled latencies, an error code that is a member of a CLOSED ALLOWLIST, a three-digit upstream status and the presence of a retry-after header.
// No message text, header values, body text, URLs or free identifiers are retained: an identifier-shaped string that is not on the allowlist becomes `code-unlisted` (it could embed an id or a token fragment).
const ERROR_CODE_ALLOWLIST=Object.freeze(new Set(['bad_gateway','gateway_timeout','upstream_timeout','upstream_error','service_unavailable','rate_limited','quota_exceeded','unauthorized','forbidden','not_found','invalid_request','invalid_input','internal_error','provider_error','provider_timeout','model_unavailable','overloaded','timeout','unknown_error','provider_http_4xx','provider_http_5xx','provider_transport','missing_text','invalid_shape','over_character_ceiling','missing_model_version','request_cancelled','provider_malformed_response']));
const SHAPE=/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const normalizeCode=s=>s.toLowerCase().replace(/[-.]/g,'_');
// startedAt/respondedAt are Date.now() values taken at the browser's request and response EVENTS (the label says so); browserTimingMs is the browser's own responseEnd when it reports one.
// There is no fallback clock: a missing measurement is null, never a number measured from some later moment.
function classifyFailureResponse({contentType,body,startedAt,respondedAt,browserTimingMs,retryAfter}={}){
  const text=typeof body==='string'?body:'';const ct=typeof contentType==='string'?contentType.toLowerCase():'';
  let kind=text.length===0?'empty':/json/.test(ct)?'json':/html/.test(ct)||/^\s*</.test(text)?'html':/text|plain/.test(ct)?'text':'other';
  let parsed=null;if(kind==='json'||kind==='other'||kind==='text'){try{parsed=JSON.parse(text.slice(0,4096));if(kind!=='json'&&parsed&&typeof parsed==='object')kind='json';}catch{parsed=null;}}
  const o=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  const rawCode=(()=>{for(const k of ['reason','code','error_code','errorCode','error']){const v=o?.[k];if(typeof v==='string'&&SHAPE.test(v))return v;}return null;})();
  const code=rawCode===null?null:ERROR_CODE_ALLOWLIST.has(normalizeCode(rawCode))?'code-'+normalizeCode(rawCode):'code-unlisted';
  const num=(...keys)=>{for(const k of keys){const v=o?.[k];if(Number.isInteger(v)&&v>=100&&v<=599)return v;}return null;};
  const event=Number.isFinite(startedAt)&&Number.isFinite(respondedAt)&&respondedAt>=startedAt?Math.round(respondedAt-startedAt):null;
  return {contentKind:'body-'+kind,bodyBytes:Math.min(Buffer.byteLength(text),1000000),elapsedMs:event,latencyBasis:event===null?'unavailable':'request-event-to-response-event',
    browserTimingMs:Number.isFinite(browserTimingMs)&&browserTimingMs>0?Math.round(browserTimingMs):null,
    errorCode:code,upstreamStatus:num('upstream_status','upstreamStatus','status','statusCode'),retryAfterPresent:!!retryAfter};
}
function newAttempt(ordinal,body){const b=body&&typeof body==='object'&&!Array.isArray(body)?body:{};return {ordinal,ref:sessionRef(typeof b.sessionId==='string'?b.sessionId:''),clientAttempt:Number.isInteger(b.client_attempt)&&b.client_attempt>=0&&b.client_attempt<1000?b.client_attempt:null,status:null,outcome:'pending'};}
function finish(attempt,status){attempt.status=Number.isInteger(status)?status:null;attempt.outcome=isFailureStatus(status)?'failed':isSuccessStatus(status)?'succeeded':'completed-other';}
// A request the harness guard refused (per-case allowance) never reached the product: it is neither a failure nor a success.
function deny(attempt){attempt.status=null;attempt.outcome='denied';}
function abort(attempt){if(attempt.outcome==='pending'){attempt.outcome='aborted';}}
const role=(ref,ids)=>ref&&ref===sessionRef(ids?.first)?'first':ref&&ref===sessionRef(ids?.second)?'second':'other';
const closed=(a,ids)=>({ordinal:a.ordinal,role:a.ref?role(a.ref,ids):'uncorrelated',clientAttempt:a.clientAttempt,status:a.status,outcome:a.outcome,...(a.diag?{diag:a.diag}:{})});
function failedFor(attempts,sessionId){const ref=sessionRef(sessionId);return !!ref&&(attempts||[]).some(a=>a.ref===ref&&a.outcome==='failed');}
function anyFailure(attempts){return (attempts||[]).some(a=>a.outcome==='failed');}
// Source-control rows that are NOT RUN only because coaching never rendered may let the case continue (any FAIL still stops it).
function continueAfterSourceRows(rows,attempts){
  if(!Array.isArray(rows)||rows.some(r=>r?.result==='FAIL'))return false;
  const notPass=rows.filter(r=>r?.result!=='PASS');
  return notPass.length===0||(anyFailure(attempts)&&notPass.every(r=>r?.result==='NOT RUN'));
}
// null when no failed attempt is correlated to the validated takes (behaviour unchanged). Otherwise a FAIL decision that preserves every attempt.
function decideGrounded({attempts,ids,oracleResult}){
  const list=Array.isArray(attempts)?attempts:[];const mine=list.filter(a=>a.ref&&(a.ref===sessionRef(ids?.first)||a.ref===sessionRef(ids?.second)));
  const failed=mine.filter(a=>a.outcome==='failed');if(failed.length===0)return null;
  const failedRoles=[...new Set(failed.map(a=>role(a.ref,ids)))].sort();
  const recoveredRoles=failedRoles.filter(r=>{const firstFail=Math.min(...failed.filter(a=>role(a.ref,ids)===r).map(a=>a.ordinal));return mine.some(a=>role(a.ref,ids)===r&&a.outcome==='succeeded'&&a.ordinal>firstFail);});
  const verified=oracleResult?.result==='PASS'&&recoveredRoles.length===failedRoles.length;
  return {result:'FAIL',
    facts:{basis:'failed-coaching-attempt-preserved',failedRoles,attempts:mine.slice(0,12).map(a=>closed(a,ids)),uncorrelatedFailures:list.filter(a=>a.outcome==='failed'&&!mine.includes(a)).length,verifiedLaterRecovery:verified},
    recovery:{verified,failedRoles,recoveredRoles,oracleResult:['PASS','FAIL','NOT RUN'].includes(oracleResult?.result)?oracleResult.result:'none',successAfterFailureOrdinals:mine.filter(a=>a.outcome==='succeeded').map(a=>a.ordinal).slice(0,12)}};
}
module.exports={ERROR_CODE_ALLOWLIST,classifyFailureResponse,deny,isFailureStatus,isSuccessStatus,sessionRef,newAttempt,finish,abort,failedFor,anyFailure,continueAfterSourceRows,decideGrounded,closed};
