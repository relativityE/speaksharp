'use strict';
// Source-derived preserved-form cases. All effects use the qualified browser/guard. No native I/O.
const crypto=require('node:crypto');const {validateReadback}=require('./browser-readback.cjs');
const telemetrySource=require('./oracles/passive-telemetry.cjs');
const {feedbackSentVerdict}=require('./oracles/feedback-sequence.cjs');
const {SOURCE_SHA,HOST,MODES,FIELDS}=require('../bundle/harness/feedback-fault.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const ROWS=Object.freeze({'transport-before-send':'feedback-transport-form-retry','synthetic-42501':'feedback-rejection-form-retry','stored-response-lost':'feedback-response-lost-form-retry'});
const ERROR_COPY='That didn’t go through. Try again?',ACK='Thanks — we’ve got it.';
function unavailable(message){const e=new Error(message);e.code='NOT_RUN';e.trustedBlocker=message;throw e;}
function need(value,message){if(!value)unavailable(message);}
function preflight(c,guard,configurationOnly=false){
 need(c?.sourceSha===SOURCE_SHA&&c.servedSha===SOURCE_SHA&&c.targetUrl==='https://speaksharp-public.vercel.app'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.account?.id||''),'feedback controls require exact inspected source/served/app and bound own account');
 need(Number.isSafeInteger(c.feedbackAttemptCap)&&c.feedbackAttemptCap>=7&&Number.isSafeInteger(c.feedbackNewReportCap)&&c.feedbackNewReportCap>=4,'AHT07 requires explicit budget for 7 insert attempts and 4 new reports including final association report');
 if(!configurationOnly){for(const name of ['feedbackFaultConfiguration','armFeedbackFault','armFeedbackObservation','markFeedbackRetry','feedbackFaultSummary'])need(typeof guard?.[name]==='function','required feedback guard capability unavailable before effects');const config=guard.feedbackFaultConfiguration();need(config.sourceSha===SOURCE_SHA&&config.host===HOST&&config.deliveryProof==='plain-insert-201-explicit-replay-v1'&&JSON.stringify(config.modes)===JSON.stringify(MODES),'feedback guarded contract differs from source');}
 return true;
}
// Historical optional read probe only: never called by preflight, run or finalize.
async function probeReadPrivilege({page,caseConfig:c}){
 preflight(c,null,true);const b=validateReadback(c);need(b.origin==='https://'+HOST&&b.projectRef===HOST.split('.')[0],'optional feedback read probe requires exact backend binding');const url=new URL('/rest/v1/user_issue_reports',b.origin);url.searchParams.set('select',['id',...FIELDS].join(','));url.searchParams.set('user_id','eq.'+c.account.id);url.searchParams.set('limit','0');
 const result=await page.evaluate(async p=>{
  let auth;try{auth=JSON.parse(localStorage.getItem('sb-'+p.projectRef+'-auth-token')||'null');}catch{return{available:false};}if(auth?.user?.id!==p.owner||typeof auth.access_token!=='string')return{available:false};
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),15000);
  try{const response=await fetch(p.url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',headers:{apikey:p.anonKey,Authorization:'Bearer '+auth.access_token,Accept:'application/json'},signal:ac.signal});if(response.status!==200)return{available:false};const body=await response.text();if(body.length>1024)return{available:false};const rows=JSON.parse(body);return{available:Array.isArray(rows)&&rows.length===0};}catch{return{available:false};}finally{clearTimeout(timer);}
 },{url:url.href,projectRef:b.projectRef,anonKey:b.anonKey,owner:c.account.id});
 need(result?.available===true,'feedback SELECT/schema request unavailable before product takes; no admin fallback');
 return Object.freeze({readRequestAccepted:true,emptyProjectionShape:true,ownerRlsCorrectness:'NOT_PROVEN_BY_EMPTY_PROBE'});
}
function initialBoundaryVerified(mode,summary){
 const a=summary?.attempts?.[0];if(!a||summary.mode!==mode||summary.fired!==true||summary.attemptCount!==1||summary.problem)return false;
 if(mode==='stored-response-lost')return a.outcome==='feedback-stored-response-lost'&&a.initialInsertCreated===true&&a.status===201&&a.complete===true&&a.forwarded===true;
 if(mode==='synthetic-42501')return a.outcome==='feedback-synthetic-42501'&&a.status===403&&a.complete===true&&a.forwarded===false;
 return mode==='transport-before-send'&&a.outcome==='feedback-transport-before-send'&&a.forwarded===false;
}
function failureFacts({mode,description,sessionId,form,summary,serviceErrors}){
 return{faultExercised:summary.fired===true&&summary.attemptCount===1&&!summary.problem,initialBoundaryVerified:initialBoundaryVerified(mode,summary),truthfulError:form.error===ERROR_COPY,dialogPreserved:form.dialogVisible===true,descriptionPreserved:form.description===description,typePreserved:form.typeChecked==='true',sessionPreserved:form.sessionId===sessionId,noFreshSuccess:form.freshSuccessCount===0,retryEnabled:form.submitEnabled===true,serviceErrorExactlyOnce:mode!=='synthetic-42501'||serviceErrors===1};
}
function violated(summary,expected=2){return summary?.violation===true||summary?.status==='VIOLATION'||['feedback-idempotency-contradiction','extra-or-changed-feedback-attempt','feedback-operation-unbound'].includes(summary?.problem)||Number.isSafeInteger(summary?.attemptCount)&&summary.attemptCount>expected;}
function retryVerdict(summary,{freshSuccessCount,dialogDetached,serviceErrors},mode){
 if(violated(summary)||Number.isInteger(freshSuccessCount)&&freshSuccessCount>1||mode==='synthetic-42501'&&Number.isInteger(serviceErrors)&&serviceErrors>1)return 'FAIL';
 const confirmed=summary?.mode===mode&&summary?.attemptCount===2&&summary?.exactExpectedAttempts===true&&summary?.deliveryConfirmed===true&&(mode!=='stored-response-lost'||summary.lostAckStorageConfirmed===true);
 if(!confirmed)return 'NOT RUN';
 if(dialogDetached===false||Number.isInteger(freshSuccessCount)&&freshSuccessCount!==1||mode==='synthetic-42501'&&Number.isInteger(serviceErrors)&&serviceErrors!==1)return 'FAIL';
 if(dialogDetached!==true||freshSuccessCount!==1||mode==='synthetic-42501'&&serviceErrors!==1)return 'NOT RUN';
 return 'PASS';
}
function sequenceVerdict(events,blind,c){const verdict=feedbackSentVerdict(events,{expectedOutcomes:['attempted','storage_failed','attempted','storage_ok'],blind:blind?1:0});if(verdict.status!=='PASS')return{result:verdict.status==='FAIL'?'FAIL':'NOT RUN',reason:verdict.reason};return{result:verdict.identity.releaseSha===c.sourceSha&&['canary','internal_test'].includes(verdict.identity.trafficType)?'PASS':'FAIL',reason:'source_correlated_local_only'};}
function observeSequence(page){const tap=telemetrySource.attach(page);return{get events(){return tap.events.filter(e=>e.event==='feedback_submit');},get blind(){return tap.blind;},detach:()=>tap.detach()};}
async function run({page,caseConfig:c,guard,sessionId,onRows}){
 preflight(c,guard);need(typeof onRows==='function'&&typeof sessionId==='string','feedback controls require row sink and bound older session');
 await page.goto(c.targetUrl+'/analytics',{waitUntil:'domcontentloaded'});
 const completed=[];
 for(const mode of MODES){
  await page.reload({waitUntil:'domcontentloaded'});const telemetry=observeSequence(page);
  const description='Automated RWT feedback retry control: '+mode+'.';let serviceErrors=0;
  const onConsole=message=>{if(message.type()==='error'&&message.text().includes('[issueReportService.submit]'))serviceErrors++;};page.on('console',onConsole);
  try{
   await page.getByTestId('nav-report-issue-button').first().click();const dialog=page.getByTestId('issue-report-dialog');await dialog.waitFor({state:'visible',timeout:20000});
   await page.getByTestId('feedback-session-select').selectOption(sessionId);await page.getByTestId('feedback-type-broke').click();await page.getByTestId('issue-report-description').fill(description);
   await page.locator('li[data-sonner-toast]').evaluateAll(es=>es.forEach(e=>e.setAttribute('data-rwt-feedback-retry-previous','true')));
   const id=guard.armFeedbackFault({id:'AHT07-'+mode,mode,sourceSha:SOURCE_SHA,host:HOST,accountSubjectSha256:sha(c.account.id),expectedSessionSha256:sha(sessionId),descriptionSha256:sha(description)});
   await page.getByTestId('issue-report-submit').click();await dialog.getByRole('alert').waitFor({state:'visible',timeout:30000});
   const fresh=page.locator('li[data-sonner-toast]:not([data-rwt-feedback-retry-previous])').filter({hasText:ACK});
   const form={error:await dialog.getByRole('alert').innerText(),dialogVisible:await dialog.isVisible(),description:await page.getByTestId('issue-report-description').inputValue(),typeChecked:await page.getByTestId('feedback-type-broke').getAttribute('aria-checked'),sessionId:await page.getByTestId('feedback-session-select').inputValue(),freshSuccessCount:await fresh.count(),submitEnabled:await page.getByTestId('issue-report-submit').isEnabled()};
   const first=guard.feedbackFaultSummary(id);
   const facts=failureFacts({mode,description,sessionId,form,summary:first,serviceErrors});
   if(!Object.values(facts).every(x=>x===true)){await onRows([{id:ROWS[mode],result:violated(first)||first.fired&&Object.entries(facts).some(([key,value])=>!['faultExercised','initialBoundaryVerified'].includes(key)&&value===false)?'FAIL':'NOT RUN',facts:{...facts,controlledFault:mode,syntheticServerRejection:mode==='synthetic-42501'}}]);unavailable('feedback failure form did not retain required truth/identity');}
   // Intent marker is immediately before the one deliberate retry. No other click or body edit.
   guard.markFeedbackRetry(id);await page.getByTestId('issue-report-submit').click();
   // A completed source201/409 with a readable stuck form or missing/duplicate fresh ACK is a
   // real observed UI contradiction. Unreadable UI/response remains NOT RUN, never invented FAIL.
   try{await dialog.waitFor({state:'detached',timeout:30000});await fresh.first().waitFor({state:'visible',timeout:30000});}catch{}
   const summary=guard.feedbackFaultSummary(id),freshSuccessCount=await fresh.count().catch(()=>null),dialogDetached=await dialog.isVisible().then(v=>!v).catch(()=>null);
   const local=retryVerdict(summary,{freshSuccessCount,dialogDetached,serviceErrors},mode);
   const deliveryFacts={...facts,attemptCount:summary.attemptCount,deliveryConfirmed:summary.deliveryConfirmed===true,deliveryProofScope:summary.deliveryProofScope||'UNAVAILABLE',lostAckStorageConfirmed:mode==='stored-response-lost'?summary.lostAckStorageConfirmed===true:null,persistedAssociation:'NOT_PROVEN_BY_HTTP',rowCardinality:'NOT_PROVEN_BY_HTTP',freshSuccessCount,dialogDetached,serviceErrors};
   if(local==='FAIL'){await onRows([{id:ROWS[mode],result:'FAIL',facts:deliveryFacts}]);unavailable('known feedback retry boundary or UI contradiction');}
   const deadline=Date.now()+8000;while(telemetry.events.length<4&&!telemetry.blind&&Date.now()<deadline)await page.waitForTimeout(100);
   const sequence=sequenceVerdict(telemetry.events,telemetry.blind,c);
   const result=sequence.result==='FAIL'?'FAIL':local==='PASS'&&sequence.result==='PASS'?'PASS':'NOT RUN';
   await onRows([{id:ROWS[mode],result,facts:{...deliveryFacts,localSentSequenceVerified:sequence.result==='PASS',localSentEvents:telemetry.events.length,vendorReceivedProof:'NOT_CLAIMED_FOR_CONTROLLED_FAILURE_LEG',idempotencyIndexObserved:mode==='stored-response-lost'?summary.attempts?.[1]?.idempotentReplay===true:null,syntheticServerRejection:mode==='synthetic-42501',evidenceScope:'guarded-outbound-and-HTTP-response-receipts',independentServerReceipts:'UNKNOWN'}}]);
   if(result!=='PASS')unavailable('feedback retry causal delivery, form or local sequence incomplete/contradictory');completed.push(id);
  }finally{page.off('console',onConsole);telemetry.detach();}
 }
 const stable=completed.length===3&&completed.every(id=>{const s=guard.feedbackFaultSummary(id);return s.exactExpectedAttempts===true&&s.deliveryConfirmed===true;});
 await onRows([{id:'feedback-failure-retry-form',result:stable?'PASS':'NOT RUN',facts:{subcasesCompleted:completed.length,allThreeModesExercised:stable,guardedOperationsConfirmed:completed.length,insertAttempts:completed.length*2,persistedAssociation:'INDEPENDENT_ORACLE_REQUIRED',rowCardinality:'NOT_PROVEN_BY_HTTP',synthetic42501NotActualBackendRejection:true}}]);
 need(stable,'feedback three-mode control group incomplete');return Object.freeze({completedModes:3,guardedOperationsConfirmed:3,insertAttempts:6,persistedAssociation:'INDEPENDENT_ORACLE_REQUIRED'});
}
function armFinal({caseConfig:c,guard,sessionId,description}){preflight(c,guard);need(typeof description==='string'&&description.trim()===description&&description.length>0,'final feedback description unavailable');return guard.armFeedbackObservation({id:'AHT07-final-observe-once',mode:'observe-once',sourceSha:SOURCE_SHA,host:HOST,accountSubjectSha256:sha(c.account.id),expectedSessionSha256:sha(sessionId),descriptionSha256:sha(description)});}
async function finalize({guard,onRows}){
 const modes=[...MODES,'observe-once'],states=modes.map(mode=>guard.feedbackFaultSummary('AHT07-'+(mode==='observe-once'?'final-observe-once':mode)));
 const count=states.reduce((n,s)=>n+(Number.isSafeInteger(s?.attemptCount)?s.attemptCount:NaN),0);
 const exact=states.every((s,i)=>s?.mode===modes[i]&&s.exactExpectedAttempts===true&&s.deliveryConfirmed===true&&(modes[i]!=='stored-response-lost'||s.lostAckStorageConfirmed===true))&&count===7&&states[3]?.injectedFault===false;
 const result=states.some((s,i)=>violated(s,i===3?1:2))?'FAIL':exact?'PASS':'NOT RUN';
 await onRows([{id:'feedback-attempts',result,facts:{controlledInsertAttempts:Number.isFinite(count)?count-(states[3]?.attemptCount||0):null,finalInsertAttempts:states[3]?.attemptCount??null,totalInsertAttempts:Number.isFinite(count)?count:null,allAttemptsExact:exact,guardedDeliveriesConfirmed:states.filter(s=>s?.deliveryConfirmed===true).length,finalModeNoFaultInjected:states[3]?.mode==='observe-once'&&states[3]?.injectedFault===false,persistedAssociation:'INDEPENDENT_ORACLE_REQUIRED',rowCardinality:'NOT_PROVEN_BY_HTTP',independentServerReceipts:'UNKNOWN'}}]);
 need(result==='PASS','late/missing feedback attempt or causal delivery contradiction');return true;
}

module.exports={preflight,probeReadPrivilege,run,armFinal,finalize,failureFacts,initialBoundaryVerified,retryVerdict,sequenceVerdict,ROWS,ERROR_COPY};
