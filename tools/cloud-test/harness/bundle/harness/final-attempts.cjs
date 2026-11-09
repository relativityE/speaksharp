'use strict';
// Pure final-boundary checks. Missing observations are NOT RUN, not invented resends.
function classifyAttempt(record,expected){
 if(!record||typeof record!=='object'||Array.isArray(record))return 'INCOMPLETE';
 const attempts=record.attempts,count=record.attemptCount;
 // These are actual observed guard contradictions, unlike an unfinished expected sequence.
 const provenProblems=new Set(['completion-scope-contradiction','extra-or-changed-completion-attempt','completion-session-noncanonical','extra-or-changed-feedback-attempt','feedback-operation-unbound','feedback-idempotency-contradiction']);
 if(record.violation===true||record.status==='VIOLATION'||provenProblems.has(record.problem))return 'VIOLATION';
 if(Number.isSafeInteger(count)&&count>expected)return 'VIOLATION';
 if(Array.isArray(attempts)){
  if(attempts.some(a=>a?.permitted===false||a?.action==='deny'))return 'VIOLATION';
  if(attempts.length>expected)return 'VIOLATION';
  if(expected===2&&attempts.length>1&&record.retryMarked===false)return 'VIOLATION';
  const operations=attempts.map(a=>a?.operationDigest).filter(x=>typeof x==='string');
  if(operations.length>1&&new Set(operations).size>1)return 'VIOLATION';
 }
 if(typeof record.problem==='string'&&record.problem.length)return 'INCOMPLETE';
 if(!Number.isSafeInteger(count)||count<0||!Array.isArray(attempts)||attempts.length!==count||attempts.some(a=>!a||typeof a!=='object'))return 'INCOMPLETE';
 return record.exactExpectedAttempts===true&&count===expected?'PASS':'INCOMPLETE';
}
function finalAttemptViolations(guard){
 const completionState=guard?.completionAttempts==null?'NOT_APPLICABLE':classifyAttempt(guard.completionAttempts,2);
 const f=guard?.feedbackFaults;
 const states=f===undefined||Array.isArray(f)&&f.length===0?[]:Array.isArray(f)?f.map(x=>classifyAttempt(x,x?.mode==='observe-once'?1:2)):['INCOMPLETE'];
 const feedbackState=states.includes('VIOLATION')?'VIOLATION':states.includes('INCOMPLETE')?'INCOMPLETE':states.length?'PASS':'NOT_APPLICABLE';
 const completion=completionState==='VIOLATION',feedback=feedbackState==='VIOLATION';
 return {completion,feedback,unsafe:completion||feedback,completionIncomplete:completionState==='INCOMPLETE',feedbackIncomplete:feedbackState==='INCOMPLETE',completionState,feedbackState};
}
function finalAttemptAssertions(assertions,summary){
 const rows=assertions.map(r=>({...r})),v=finalAttemptViolations(summary?.guard);
 for(const [violated,state,id,detail]of [[v.completion||summary?.completionAttemptsViolation,v.completionState,'completion-attempts','Final guard summary contradicts expected exact-session completion attempts'],[v.feedback||summary?.feedbackAttemptsViolation,v.feedbackState,'feedback-attempts','Final guard summary contradicts expected exact-feedback attempts']]){
  const prior=rows.find(x=>x.id===id);
  const incomplete=state==='INCOMPLETE'||state==='NOT_APPLICABLE'&&!!prior;
  if(!violated&&!incomplete)continue;
  if(!violated&&prior?.result==='FAIL')continue; // observed FAIL is sticky, even if final evidence is absent
  const row={id,result:violated?'FAIL':'NOT RUN',detail:violated?detail:'Final attempt sequence is incomplete or unavailable; no duplicate/changed attempt was established',evidenceRefs:summary?['summary.json']:[]};if(prior)Object.assign(prior,row);else rows.push(row);
 }
 return rows;
}
module.exports={classifyAttempt,finalAttemptViolations,finalAttemptAssertions};
