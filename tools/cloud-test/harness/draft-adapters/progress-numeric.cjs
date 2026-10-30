'use strict';
// G03 numeric comparison; selected d100 snapshots revalidated byte-for-byte at 66328703.
// Source qualification does not establish live product PASS.
const pure=require('./oracles/pure/progressNumericSelected.cjs');
const SOURCE_SHA='66328703bf47e865b730e229005411e78481d34c';
const ROW='same-target-numeric';
const SELECT=Object.freeze({
 recommendation:'id,user_id,source_session_id,formula_version,target_metric,target_direction,target_value,target_units,source_metric_value,shown_text',
 attempt:'id,user_id,recommendation_id,practice_session_id,next_comparable_session_id,lifecycle,outcome,accepted_at',
 evaluation:pure.EVAL_FIELDS+',user_id,formula_version'
});
function notRun(reason){const e=new Error(reason);e.code='NOT_RUN';e.trustedBlocker=reason;throw e;}
function preflight(c){if(c?.sourceSha!==SOURCE_SHA||c?.servedSha!==SOURCE_SHA)notRun('G03 numeric source requires the exact revalidated 66328703 source/served binding');return {ready:true,sourceSha:SOURCE_SHA};}
function answer(result,reason,more={}){return {result,facts:{sourceNumericContract:true,reason,...more}};}
const normalize=x=>typeof x==='string'?x.replace(/\s+/gu,' ').trim():null;
function expectedText(value){const f=pure.formatRepeatValues(value.metric,value.before,value.after);return normalize(`${pure.TARGET_METRIC_LABELS[value.metric]}: ${f.before} → ${f.after} ${value.units} (original session → linked repeat).${f.belowPrecision?' The stored values differ by less than the displayed precision.':''}`);}
function verify(expected,observation){
 if(expected.result)return expected;
 if(!observation||observation.readable!==true)return answer('NOT RUN','numeric-ui-observation-unavailable');
 if(observation.pathMatches!==true)return answer('FAIL','wrong-source-session-route');
 if(observation.settled!==true)return answer('NOT RUN','numeric-panel-not-settled');
 if(expected.value?.status!=='available')return answer('NOT RUN','source-comparison-evidence-unavailable');
 if(observation.count!==1||observation.visible!==true)return answer('FAIL','missing-or-duplicate-rendered-values',{count:Number.isInteger(observation.count)?observation.count:null});
 const equal=normalize(observation.text)===expectedText(expected.value);
 return answer(equal?'PASS':'FAIL',equal?'persisted-original-to-linked-repeat-values-match':'rendered-order-value-units-or-precision-mismatch',{originalToLinkedRepeat:true,exactPersistedValues:equal,exactStoredUnits:equal,sourcePrecisionPolicy:equal,belowDisplayedPrecision:pure.formatRepeatValues(expected.value.metric,expected.value.before,expected.value.after).belowPrecision});
}
async function readExpected({db,caseConfig:c,sourceSessionId,repeatSessionId,expectedAttemptId}){
 preflight(c);if(typeof sourceSessionId!=='string'||typeof repeatSessionId!=='string'||sourceSessionId===repeatSessionId)notRun('G03 actual distinct saved session identities missing');
 const read=async q=>{const r=await q;if(r?.error||!r)notRun('G03 owner GET unavailable; no admin fallback');return r.data;};
 const rec=await read(db.from('progress_recommendations').select(SELECT.recommendation).eq('source_session_id',sourceSessionId).eq('formula_version',pure.PROGRESS_FORMULA_VERSION).maybeSingle());
 if(!rec)return answer('NOT RUN','source-recommendation-unavailable');
 if(rec.user_id!==c.account.id||rec.source_session_id!==sourceSessionId||rec.formula_version!==pure.PROGRESS_FORMULA_VERSION)return answer('FAIL','persisted-recommendation-identity-mismatch');
 if(!Object.hasOwn(pure.TARGET_METRIC_LABELS,rec.target_metric)||!['decrease','increase','maintain'].includes(rec.target_direction)||!Number.isFinite(rec.target_value)||typeof rec.target_units!=='string'||!rec.target_units.trim()||typeof rec.shown_text!=='string'||!rec.shown_text.trim())return answer('NOT RUN','source-recommendation-evidence-unavailable');
 const attempts=await read(db.from('progress_recommendation_attempts').select(SELECT.attempt).eq('recommendation_id',rec.id).order('accepted_at',{ascending:false}).limit(2));
 if(!Array.isArray(attempts)||!attempts.length)return answer('NOT RUN','linked-attempt-unavailable');
 const attempt=attempts[0];if(attempts.some(x=>x.user_id!==c.account.id||x.recommendation_id!==rec.id))return answer('FAIL','persisted-attempt-owner-or-recommendation-mismatch');
 if(!Number.isFinite(Date.parse(attempt.accepted_at))||(attempts[1]&&(!Number.isFinite(Date.parse(attempts[1].accepted_at))||Date.parse(attempts[1].accepted_at)>=Date.parse(attempt.accepted_at))))return answer('NOT RUN','latest-attempt-order-ambiguous');
 if(attempt.practice_session_id!==repeatSessionId||(expectedAttemptId&&attempt.id!==expectedAttemptId))return answer('FAIL','stale-or-wrong-repeat-attempt');
 if(attempt.lifecycle!=='completed'||!['moved','did_not_move'].includes(attempt.outcome))return answer('NOT RUN','completed-comparable-repeat-unavailable');
 if(attempt.next_comparable_session_id!==repeatSessionId)return answer('FAIL','persisted-linked-comparison-is-not-this-repeat');
 const source=await read(db.from('session_progress_evaluations').select(SELECT.evaluation).eq('session_id',sourceSessionId).eq('formula_version',pure.PROGRESS_FORMULA_VERSION).maybeSingle());
 if(!source)return answer('NOT RUN','source-evaluation-unavailable');
 if(source.user_id!==c.account.id||source.session_id!==sourceSessionId||source.formula_version!==pure.PROGRESS_FORMULA_VERSION)return answer('FAIL','persisted-source-evaluation-identity-mismatch');
 if(!pure.hasCompleteEligibleProgressEvidence(pure.toEvaluation(source)))return answer('NOT RUN','source-evaluation-ineligible-or-incomplete');
 // Exact source derivation requests the persisted next-comparable evaluation. Add owner/formula identity
 // checks around that GET; do not fall back to session history, rounded metrics, target_value or zero.
 let nextIntegrity=null;
 const boundDb={from(table){if(table!=='session_progress_evaluations')notRun('G03 unexpected source read');const q=db.from(table);return {select(){q.select(SELECT.evaluation);return this;},eq(k,v){q.eq(k,v);return this;},async maybeSingle(){const r=await q.maybeSingle();if(r.error)notRun('G03 linked evaluation owner GET unavailable');if(r.data&&(r.data.user_id!==c.account.id||r.data.formula_version!==pure.PROGRESS_FORMULA_VERSION||r.data.session_id!==repeatSessionId)){nextIntegrity='persisted-linked-evaluation-identity-mismatch';return {data:null,error:null};}return r;}};}};
 const value=await pure.loadRepeatResult(boundDb,sourceSessionId,source,rec,attempt);
 if(nextIntegrity)return answer('FAIL',nextIntegrity);
 return {value};
}
async function observe({page,db,caseConfig,sourceSessionId,repeatSessionId,expectedAttemptId}){
 const expected=await readExpected({db,caseConfig,sourceSessionId,repeatSessionId,expectedAttemptId});if(expected.result)return expected;
 try{await page.waitForFunction(route=>location.pathname===route&&!!document.querySelector('[data-testid="progress-panel"] [data-testid="progress-direction"]')&&!document.querySelector('[data-testid="progress-panel"] [data-testid="progress-loading"]'),'/progress/'+sourceSessionId,{timeout:45000});}catch{return answer('NOT RUN','numeric-panel-not-settled');}
 let observation;try{observation=await page.evaluate(route=>{const panel=document.querySelector('[data-testid="progress-panel"]'),nodes=panel?Array.from(panel.querySelectorAll('[data-testid="progress-attempt-values"]')):[],node=nodes[0],style=node?getComputedStyle(node):null;return {readable:true,pathMatches:location.pathname===route,settled:!!panel?.querySelector('[data-testid="progress-direction"]')&&!panel?.querySelector('[data-testid="progress-loading"]'),count:nodes.length,visible:!!node&&style?.visibility!=='hidden'&&style?.display!=='none'&&node.getClientRects().length>0,text:node?.textContent??null};},'/progress/'+sourceSessionId);}catch{return answer('NOT RUN','numeric-ui-observation-unavailable');}
 return verify(expected,observation);
}
module.exports={SOURCE_SHA,ROW,SELECT,preflight,readExpected,observe,verify,expectedText};
