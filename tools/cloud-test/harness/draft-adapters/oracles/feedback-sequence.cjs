'use strict';
// Closed-field source adaptation: feedbackTelemetry, outcomeCorrelation and rwtJourney AnalyticsTap.
// Sent cardinality is not vendor ingestion. Same boot/submit_seq and actual producer/FIFO order are mandatory.
function feedbackSentVerdict(events,{expectedOutcomes=['attempted','storage_ok'],blind=0}={}){
 const bad=reason=>({status:'FAIL',reason}),hold=reason=>({status:'HOLD',reason});
 if(!Array.isArray(events)||!Array.isArray(expectedOutcomes)||![2,4].includes(expectedOutcomes.length)||expectedOutcomes.some((x,i)=>i%2===0?x!=='attempted':!['storage_ok','storage_failed'].includes(x)))return hold('feedback_sequence_contract_missing');
 if(events.length>expectedOutcomes.length)return bad('extra_feedback_sent_events');
 if(blind>0)return hold('opaque_feedback_batch_cannot_exclude_duplicates');
 if(events.length<expectedOutcomes.length)return hold('feedback_sent_pair_incomplete');
 const first=events[0],identity=['journeyId','bootId','releaseSha','trafficType'];
 if(identity.some(k=>typeof first?.[k]!=='string'||!first[k]))return hold('feedback_sent_identity_missing');
 if(events.some(e=>e.event!=='feedback_submit'||identity.some(k=>e[k]!==first[k])))return bad('feedback_sent_identity_mismatch');
 const rows=events.slice();
 const sameBatch=rows.every(e=>Number.isSafeInteger(e.batch)&&e.batch===first.batch&&Number.isSafeInteger(e.batchIndex));
 if(sameBatch){if(new Set(rows.map(e=>e.batchIndex)).size!==rows.length)return hold('feedback_fifo_position_ambiguous');rows.sort((a,b)=>a.batchIndex-b.batchIndex);}
 else{if(rows.some(e=>!Number.isFinite(e.producerTs)))return hold('feedback_producer_order_missing');if(rows.some((e,i)=>rows.some((other,j)=>j>i&&e.batch!==other.batch&&e.producerTs===other.producerTs)))return hold('feedback_cross_batch_timestamp_tie');rows.sort((a,b)=>a.producerTs-b.producerTs||(a.batchIndex??0)-(b.batchIndex??0));}
 const pairs=expectedOutcomes.length/2;
 if(rows.some((e,i)=>e.fields?.outcome!==expectedOutcomes[i]||e.fields?.submit_seq!==Math.floor(i/2)+1))return bad('feedback_pair_order_mismatch');
 for(let i=0;i<pairs;i++){
  const seq=i+1,pair=rows.filter(e=>e.fields?.submit_seq===seq);
  if(pair.length!==2)return bad('feedback_submit_sequence_not_exact');
  if(pair[0].fields?.outcome!=='attempted'||pair[1].fields?.outcome!==expectedOutcomes[2*i+1])return bad('feedback_attempt_outcome_mismatch');
 }
 if(rows.some(e=>!Number.isSafeInteger(e.fields?.submit_seq)||e.fields.submit_seq<1||e.fields.submit_seq>pairs))return bad('feedback_submit_sequence_out_of_scope');
 return {status:'PASS',reason:'source_correlated_sent_feedback_pairs',identity:Object.fromEntries(identity.map(k=>[k,first[k]])),events:rows.length,attempts:pairs,stored:expectedOutcomes.filter(x=>x==='storage_ok').length,controlledFailures:expectedOutcomes.filter(x=>x==='storage_failed').length};
}
module.exports={feedbackSentVerdict};
