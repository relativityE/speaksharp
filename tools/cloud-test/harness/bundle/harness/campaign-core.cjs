'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {summarizeAssertions}=require('./case-results.cjs');
const IDS=Object.freeze(Array.from({length:15},(_,i)=>'AHT-'+String(i+1).padStart(2,'0')));
const IDENTITY_MAX_MS=25000;
const requiredIdentityCap=(caseCount=IDS.length)=>1+2*caseCount+1; // A7 + before/after each case + final
// r15 case selection. A plan may approve a SUBSET of the 15 journeys (explicit owner reference, explicit order). Unselected cases are NOT dispatched: no requests, no identity reads,
// and they are reported as `notSelected` (distinct from omitted-by-design and from NOT RUN for lack of evidence). Without a selection every behaviour is unchanged.
function selectedOrder(plan){return plan&&plan.selection?plan.selection.order||plan.selection.ids:IDS;}
function unselectedIds(plan){const s=new Set(selectedOrder(plan));return IDS.filter(id=>!s.has(id));}
function validateSelection(p){
 const errors=[],s=p?.selection;if(s===undefined)return Array.isArray(p?.gates)&&p.gates.length?['gates need a valid selection']:errors;
 if(!s||typeof s!=='object'||Array.isArray(s))return ['selection'];
 if(!Array.isArray(s.ids)||!s.ids.length||new Set(s.ids).size!==s.ids.length||s.ids.some(id=>!IDS.includes(id)))errors.push('selection.ids');
 if(typeof s.ownerApprovalReference!=='string'||s.ownerApprovalReference.trim().length<8)errors.push('selection.ownerApprovalReference required');
 if(typeof s.reason!=='string'||!s.reason.trim())errors.push('selection.reason required');
 if(s.order!==undefined&&(!Array.isArray(s.order)||s.order.length!==s.ids.length||s.order.some(id=>!s.ids.includes(id))||new Set(s.order).size!==s.order.length))errors.push('selection.order must be a permutation of selection.ids');
 if(!errors.length){
  const order=selectedOrder(p);
  for(const g of p.gates||[]){
   if(!g||!order.includes(g.caseId)||!Array.isArray(g.requires)||!g.requires.length)errors.push('gate '+(g&&g.caseId));
   else for(const r of g.requires){if(!order.includes(r.caseId)||order.indexOf(r.caseId)>=order.indexOf(g.caseId)||typeof r.row!=='string'||!r.row||r.result!=='PASS')errors.push('gate '+g.caseId+' requires a PASS row of an earlier selected case');}
  }
 }else if((p.gates||[]).length)errors.push('gates need a valid selection');
 return errors;
}
// r15 run identity: every run is bound to the release, the runner code and the backend state it was run against, with an explicit owner-stated vs verified label.
function validateRunIdentity(r){
 if(r===undefined)return [];
 const e=[];if(!r||typeof r!=='object'||Array.isArray(r))return ['runIdentity'];
 if(!/^[a-f0-9]{40}$/.test(r.frontend?.sourceSha||'')||r.frontend?.servedSha!==r.frontend?.sourceSha)e.push('runIdentity.frontend');
 if(!/^[a-f0-9]{64}$/.test(r.runner?.codeManifestSha256||'')||!/^[a-f0-9]{64}$/.test(r.runner?.packetManifestSha256||''))e.push('runIdentity.runner');
 const b=r.backend;
 if(!b||typeof b.manifestRef!=='string'||!b.manifestRef||!['owner-stated','cloud-verified'].includes(b.source)||!Number.isSafeInteger(b.generation)||!['ON','OFF'].includes(b.completion)||!Array.isArray(b.facts)||b.facts.some(x=>!/^[a-z0-9-]{1,40}$/.test(x?.name||'')||!['absent','applied','unknown'].includes(x?.state)))e.push('runIdentity.backend');
 else if(b.source==='cloud-verified'&&!Number.isFinite(Date.parse(b.verifiedAtUtc||'')))e.push('runIdentity.backend.verifiedAtUtc required when cloud-verified');
 else if(b.source==='owner-stated'&&b.verifiedAtUtc!==null&&b.verifiedAtUtc!==undefined)e.push('runIdentity.backend.verifiedAtUtc must be null when owner-stated');
 return e;
}
// Reasons are written to the campaign report. Only a harness-authored first line with a closed prefix and no quoting/markup/call-log characters is kept;
// anything else (for example a browser-library message that can embed page text or element markup) is replaced so it can never ride into the report.
const SAFE_REASON_PREFIX=/^(BLOCKED_SETUP|NOT_RUN|HARNESS_LIMITED)\b/;
function safeReason(error){const m=String(error&&error.message||'').split(/[\r\n]/)[0].slice(0,240);return SAFE_REASON_PREFIX.test(m)&&!/["'`<>{}]|Call log|locator\.|page\./i.test(m)?m:'Error details withheld: not a closed harness-authored message';}
function validateRequestBudget(b,unselected=[]){
 if(b===undefined)return [];
 if(!b||typeof b!=='object'||Array.isArray(b))return ['requestBudget'];
 const errors=[],int=(v,min)=>Number.isSafeInteger(v)&&v>=min;
 if(!int(b.runCap,1))errors.push('requestBudget.runCap');
 if(!int(b.cleanupReserve,0))errors.push('requestBudget.cleanupReserve');
 for(const k of ['estimates','ceilings']){const m=b[k];if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==IDS.length||IDS.some(id=>!int(m[id],0)))errors.push('requestBudget.'+k+' for exactly all15');}
 const declared=b.skip===undefined?[]:b.skip;if(!Array.isArray(declared)||new Set(declared).size!==declared.length||declared.some(id=>!IDS.includes(id)))errors.push('requestBudget.skip');
 const skip=[...new Set([...(Array.isArray(declared)?declared:[]),...unselected])];
 if(!errors.length){
  if(IDS.some(id=>b.ceilings[id]<b.estimates[id]))errors.push('requestBudget.ceilings must be at least the estimates');
  if(skip.length===IDS.length)errors.push('requestBudget.skip cannot skip every case');
  const funded=IDS.filter(id=>!skip.includes(id)).reduce((n,id)=>n+b.estimates[id],0)+b.cleanupReserve;
  if(funded>b.runCap)errors.push('requestBudget underfunded: runCap '+b.runCap+' is below the cleanup reserve plus selected estimates '+funded+'; declare skipped cases explicitly');
 }
 return errors;
}
// The plan's run cap must be the cap the guard and ledger actually enforce, otherwise the plan reserves against a number nothing enforces.
function budgetBindingErrors(b,policyCaps,ledgerCaps){
 if(!b)return [];const errors=[];
 if(!policyCaps||typeof policyCaps!=='object'||policyCaps.total!==b.runCap)errors.push('requestBudget.runCap differs from the policy total cap the guard enforces');
 if(ledgerCaps!==null&&ledgerCaps!==undefined&&(typeof ledgerCaps!=='object'||ledgerCaps.total!==b.runCap))errors.push('requestBudget.runCap differs from the admitted ledger total cap');
 return errors;
}
const SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
function validateCampaignPlan(p) {
 const errors=[];
 if(!p||p.version!==1||typeof p.campaignId!=='string'||!p.campaignId.trim())errors.push('campaignId/version');
 if(p?.runtime!=='Claude SpeakSharp R4'||p?.targetUrl!=='https://speaksharp-public.vercel.app/'||p?.costCeilingUsd!==0)errors.push('R0 canonical $0 scope');
 if(!COMMIT.test(p?.sourceSha||'')||p?.servedSha!==p?.sourceSha)errors.push('exact aligned source/served SHA');
 for(const k of ['admissionConfigFile','stepRoot','stepManifestFile','campaignLedger','identityLedger','runRoot'])if(typeof p?.[k]!=='string'||!p[k])errors.push(k);
 for(const k of ['admissionConfigSha256','stepManifestSha256'])if(!SHA.test(p?.[k]||''))errors.push(k);
 errors.push(...validateSelection(p));errors.push(...validateRunIdentity(p?.runIdentity));
 const nSelected=selectedOrder(p).length;
 if(!Number.isSafeInteger(p?.identityCap)||p.identityCap<requiredIdentityCap(nSelected))errors.push('identityCap must cover admission + before/after each selected case + final (minimum '+requiredIdentityCap(nSelected)+' for '+nSelected+' cases)');
 if(!Number.isFinite(Date.parse(p?.deadlineAt))||!Number.isSafeInteger(p?.cleanupReserveMs)||p.cleanupReserveMs<1)errors.push('deadline/cleanup reserve');
 const cases=p?.cases;
 if(!Array.isArray(cases)||cases.length!==15||IDS.some(id=>cases.filter(c=>c.id===id).length!==1))errors.push('exactly one of all15 AHT IDs required');
 for(const c of cases||[]){for(const k of ['driverFile','configFile'])if(typeof c[k]!=='string'||!c[k])errors.push(c.id+'.'+k);for(const k of ['driverSha256','configSha256'])if(!SHA.test(c[k]||''))errors.push(c.id+'.'+k);if(!Number.isSafeInteger(c.maxMs)||c.maxMs<1)errors.push(c.id+'.maxMs');}
 errors.push(...validateRequestBudget(p?.requestBudget,p?.selection?unselectedIds(p):[]));
 const mappings=p?.requirementMappings||[];if(!Array.isArray(mappings)||new Set(mappings.map(x=>x.requirementId)).size!==mappings.length)errors.push('ambiguous duplicate requirement mappings');
 if(mappings.length&&(!SHA.test(p?.coverageReviewSha256||'')||typeof p.coverageReviewFile!=='string'||!p.coverageReviewFile))errors.push('independent hash-bound oracle coverage review required');
 if(errors.length)throw new Error('BLOCKED_SETUP: '+errors.join(', '));return p;
}
function initializeMatrix(report,matrix,provenance) {
 const active=matrix?.rows?.filter(r=>r.row_role==='VALIDATION_REQUIREMENT')||[];
 report.validationRequirements=active.map(r=>({requirementId:r.requirement_id,title:r.requirement_title,categoryId:r.product_category_id,layer:/^HUM-/.test(r.requirement_id)?'real-human':/^(PAID-|EXIT-)/.test(r.requirement_id)?'paid-effect':/source/i.test(r.campaign_phase||'')?'source-only':'agent-served',result:'NOT RUN',reason:'Not selected/exercised by a fully covering explicit assertion mapping; retained denominator is not dispatch authority',actual:null,expected:r.pass_oracle||null,evidenceRefs:[]}));
 report.denominators={AHT:15,HUM:6,accessibility:3,activeValidation:active.length,totalPreservedMatrix:matrix?.rows?.length||0};
 report.matrixProvenance=provenance;const categories=Array.isArray(matrix?.categories)?matrix.categories.map(c=>c.id||c.category_id||c.product_category_id):Object.keys(matrix?.categories||{});report.categoryResults=Object.fromEntries(categories.map(id=>[id,{PASS:0,FAIL:0,'NOT RUN':0}]));
 for(const r of report.validationRequirements){report.categoryResults[r.categoryId]||={PASS:0,FAIL:0,'NOT RUN':0};report.categoryResults[r.categoryId]['NOT RUN']++;}
 return report;
}
function initialReport(plan){const report={schemaVersion:1,campaignId:plan?.campaignId||null,sourceSha:plan?.sourceSha||null,servedSha:plan?.servedSha||null,result:'NOT RUN',fullAcceptance:'NOT RUN',scope:'15 live agent-observable journeys within a unified report; admission/synthetic controls are not product PASS',cases:IDS.map(caseId=>({caseId,result:'NOT RUN',reason:'Not dispatched',assertions:[]})),humanObservations:Array.from({length:6},(_,i)=>({id:'HUM-0'+(i+1),layer:'real-human',result:'NOT RUN',reason:'Requires actual approved human/device observation; cloud automation is not a substitute'})),accessibilityObservations:Array.from({length:3},(_,i)=>({id:'HUM-A11Y-0'+(i+1),layer:'real-human/accessibility',result:'NOT RUN',reason:'Explicit keyboard/screen-reader/400% zoom evidence not supplied by an unrelated journey'})),paidCheckout:{layer:'paid-effect',result:'NOT RUN',reason:'Separate paid effects not authorized under $0'},layers:{sourceOnly:'NOT RUN unless separately evidenced',agentServed:'NOT RUN',realHuman:'NOT RUN',paidEffect:'NOT RUN',harness:'NOT RUN until actual R0 qualification'},identityReceipts:[]};
 const binding=require('../config/matrix-reference.json'),file=path.resolve(__dirname,binding.path);
 try{const bytes=fs.readFileSync(file),actual=crypto.createHash('sha256').update(bytes).digest('hex');if(actual!==binding.sha256)throw new Error('matrix bytes differ from reviewed reference');const matrix=JSON.parse(bytes);if(!Array.isArray(matrix.rows)||matrix.rows.length!==binding.totalRows||matrix.rows.filter(r=>r.row_role==='VALIDATION_REQUIREMENT').length!==binding.activeValidationRows)throw new Error('matrix denominator mismatch');initializeMatrix(report,matrix,{kind:'preserved-reference-not-dispatch-authority',sha256:actual});for(const [cat,count]of Object.entries(binding.perCategory))if(report.categoryResults[cat]?.['NOT RUN']!==count)throw new Error('matrix category denominator mismatch');return report;}catch(e){report.matrixReadError='BLOCKED_SETUP: '+e.message;report.matrixProvenance={kind:'UNAVAILABLE_OR_INVALID'};report.denominators={AHT:15,HUM:6,accessibility:3,activeValidation:null,totalPreservedMatrix:null};report.validationRequirements=[];report.categoryResults={};return report;}

}
function applyRequirementMappings(report,plan) {
 for(const mapping of plan.requirementMappings||[]){
  const row=report.validationRequirements.find(r=>r.requirementId===mapping.requirementId),c=report.cases.find(r=>r.caseId===mapping.caseId);
  if(!row||!c||row.layer==='real-human'||row.layer==='paid-effect'||mapping.reviewStatus!=='REVIEWED_FULL_COVERAGE'||!SHA.test(mapping.reviewReceiptSha256||'')||mapping.coverage!=='full'||!Array.isArray(mapping.assertionIds)||!mapping.assertionIds.length)continue;
  const assertions=mapping.assertionIds.map(id=>c.assertions.find(a=>a.id===id));
  if(assertions.some(a=>a?.result==='FAIL'))row.result='FAIL';else if(!c.executionInvalid&&row.result!=='FAIL'&&assertions.every(a=>a?.result==='PASS'&&a.evidenceRefs?.length))row.result='PASS';else continue;
  row.layer='agent-served';row.reason='Explicit fully-covering mapping to exercised source assertion IDs';row.evidenceRefs=[...new Set(assertions.filter(Boolean).flatMap(a=>a.evidenceRefs||[]))];row.actual={caseId:c.caseId,assertionIds:mapping.assertionIds};
 }
 for(const counts of Object.values(report.categoryResults))for(const k of ['PASS','FAIL','NOT RUN'])counts[k]=0;
 for(const row of report.validationRequirements)report.categoryResults[row.categoryId][row.result]++;
 report.layers.agentServed=report.result;report.fullAcceptance=report.validationRequirements.some(r=>r.result==='FAIL')?'FAIL':'NOT RUN';
}
async function runCampaign(plan,io,{executeR0=false}={}) {
 const report=initialReport(plan),save=()=>io.save(report);
 try{validateCampaignPlan(plan);if(report.matrixReadError)throw new Error(report.matrixReadError);if((plan.requirementMappings||[]).length)await io.verifyCoverageReview(plan);if(plan.requestBudget){if(typeof io.verifyBudgetBinding!=='function')throw new Error('BLOCKED_SETUP: request budget binding to the guard cap unavailable');await io.verifyBudgetBinding(plan);}if(plan.runIdentity){if(typeof io.verifyRunIdentity!=='function')throw new Error('BLOCKED_SETUP: run identity binding unavailable');await io.verifyRunIdentity(plan);}if(plan.stimulusPreflight){if(typeof io.verifyStimulusPreflight!=='function')throw new Error('BLOCKED_SETUP: stimulus preflight verification unavailable');await io.verifyStimulusPreflight(plan);}for(const id of selectedOrder(plan))await io.preflightCase(plan.cases.find(c=>c.id===id),plan);report.driverPreflight=plan.selection?'SELECTED_'+selectedOrder(plan).length+'_BOUND':'ALL_15_BOUND';}
 catch(e){report.reason=safeReason(e);await save();return{exitCode:78,report};}
 if(plan.selection){report.selection={ids:[...plan.selection.ids],order:[...selectedOrder(plan)],unselected:unselectedIds(plan),ownerApprovalReference:plan.selection.ownerApprovalReference,reason:plan.selection.reason,gates:(plan.gates||[]).map(g=>({caseId:g.caseId,requires:g.requires.map(r=>({caseId:r.caseId,row:r.row,result:r.result}))}))};for(const id of unselectedIds(plan)){const row=report.cases.find(x=>x.caseId===id);row.notSelected=true;row.plannedRequests=0;row.requestsUsed=0;row.reason='Not selected by the approved case selection; not dispatched, no requests and no identity reads spent';}}
 if(plan.runIdentity)report.runIdentity={...plan.runIdentity,cases:plan.cases.filter(c=>selectedOrder(plan).includes(c.id)).map(c=>({id:c.id,driverSha256:c.driverSha256,configSha256:c.configSha256,mediaSha256:c.mediaSha256||null}))};
 if(!executeR0){report.reason='Offline plan only; actual R0 admission and journeys NOT_RUN';await save();return{exitCode:78,report};}
 let admitted=false,safetyStopped=false;
 const order=selectedOrder(plan);report.identityPlan={admission:1,beforeCases:order.length,afterCases:order.length,final:1,requiredCap:requiredIdentityCap(order.length),approvedCap:plan.identityCap};
 const matches=identity=>identity?.result==='MATCH'&&identity.servedSha===plan.servedSha;
 const observeIdentity=async phase=>{let value;try{value=await io.identity(phase,plan);}catch(e){value={result:'NOT RUN',reason:'Identity unavailable: '+safeReason(e)};}const receipt={...value,phase};report.identityReceipts.push(receipt);return receipt;};
 const invalidate=(row,reason)=>{row.executionInvalid=true;if(row.result!=='FAIL')row.result='NOT RUN';row.reason=reason;};
 try{
  const admission=await io.admit(plan);report.admission=admission;
  if(admission.result!=='ADMISSION PASS')throw new Error('BLOCKED_SETUP: campaign admission failed');admitted=true;
  for(const id of order){
   const c=plan.cases.find(x=>x.id===id),row=report.cases.find(x=>x.caseId===id);
   // r15 stimulus gate: a case whose trigger depends on an earlier stimulus is not dispatched when that stimulus was not established, so no request, identity read or time is spent on a scenario that cannot reach its trigger.
   const gate=(plan.gates||[]).find(g=>g.caseId===id);
   if(gate){const unmet=gate.requires.find(r=>{const prior=report.cases.find(x=>x.caseId===r.caseId),a=(prior?.assertions||[]).find(x=>x.id===r.row);return !(a&&a.result===r.result);});if(unmet){row.reason='NOT_RUN: prerequisite stimulus not established ('+unmet.caseId+'/'+unmet.row+'); not dispatched, no requests or identity reads spent';row.gateBlocked=true;row.gateRequirement={caseId:unmet.caseId,row:unmet.row,required:unmet.result};row.plannedRequests=plan.requestBudget?plan.requestBudget.estimates[id]:null;row.requestsUsed=0;continue;}}
   // Reserve before + after + campaign-end identity calls as well as the bounded case and cleanup.
   if(io.now()+plan.cleanupReserveMs+c.maxMs+3*IDENTITY_MAX_MS>Date.parse(plan.deadlineAt)){row.reason='Insufficient approved time for bounded case, before/after/final identity and cleanup';safetyStopped=true;break;}
   const budget=plan.requestBudget;let allowance=null,usedBefore=null;
   if(budget){
    if((budget.skip||[]).includes(id)){row.reason='Not selected: the approved partial request budget declares this case skipped before the run';row.requestBudgetSkipped=true;row.plannedRequests=0;continue;}
    usedBefore=typeof io.ledgerUsed==='function'?io.ledgerUsed():null;
    if(!Number.isSafeInteger(usedBefore)){row.reason='Request ledger unreadable; failing closed before this case';safetyStopped=true;break;}
    // Later selected cases and the cleanup reserve are protected: this case may spend only what is left after them, never more than its own ceiling.
    const later=order.slice(order.indexOf(id)+1).filter(x=>!(budget.skip||[]).includes(x)).reduce((n,x)=>n+budget.estimates[x],0);
    const available=budget.runCap-usedBefore-budget.cleanupReserve-later;
    if(available<budget.estimates[id]){row.reason='Insufficient request budget after protecting later cases and the cleanup reserve; not started';row.requestBudgetSkipped=true;row.plannedRequests=budget.estimates[id];row.ledgerUsedAtDecision=usedBefore;continue;}
    allowance=Math.min(budget.ceilings[id],available);row.requestAllowance=allowance;row.plannedRequests=budget.estimates[id];
   }
   const identity=await observeIdentity('before-'+id);row.identityBefore=identity;
   if(!matches(identity)){invalidate(row,'Served identity drift/unproved before case; no repin or automatic retry');safetyStopped=true;break;}
   let ran;
   try{ran=await io.runCase(c,plan,admission,{requestAllowance:allowance});const cfg=await io.caseConfig(c);const result=summarizeAssertions(cfg,ran.assertions||[]);Object.assign(row,result,{reason:ran.reason||null,executionReceipt:ran.executionReceipt||null,...(ran.outcomeClasses?{outcomeClasses:ran.outcomeClasses}:{}),...(ran.cleanup?{cleanup:ran.cleanup}:{})});if(budget){const usedAfter=io.ledgerUsed();if(Number.isSafeInteger(usedAfter))row.requestsUsed=usedAfter-usedBefore;}if(ran.allowanceExhausted===true){row.allowanceExhausted=true;row.interruption='request-allowance';row.reason='Case request allowance exhausted; the case was stopped before further requests and its affected checks are NOT RUN';if(row.result==='PASS')row.result='NOT RUN';}}
   catch(e){ran={safetyStop:true,reason:'Case execution/receipt unavailable: '+safeReason(e)};invalidate(row,ran.reason);}
   // Even an early driver interruption needs an AFTER receipt, or the case cannot keep PASS.
   let after;
   if(io.now()+IDENTITY_MAX_MS+plan.cleanupReserveMs<=Date.parse(plan.deadlineAt))after=await observeIdentity('after-'+id);
   else{after={phase:'after-'+id,result:'NOT RUN',reason:'Approved window unavailable for bounded post-case identity'};report.identityReceipts.push(after);}
   row.identityAfter=after;
   if(!matches(after)){invalidate(row,'Served identity drift/unproved after case; observations cannot be attributed to one release');safetyStopped=true;}
   if(ran.authenticationRejected===true){report.authenticationRejected=true;invalidate(row,'Authentication rejected; remaining cases stopped to avoid repeated credentials');safetyStopped=true;}
   if(ran.safetyStop===true){invalidate(row,ran.reason||'Guard/cap/ownership/cleanup safety stop');safetyStopped=true;}
   // Later cases run only after the interrupted case's cleanup is positively verified (owned processes gone, media and launch cleanup clean, no other safety condition).
   if(ran.allowanceExhausted===true&&ran.allowanceCleanupVerified!==true&&!safetyStopped){invalidate(row,'Allowance exhaustion: bounded cleanup not verified; campaign stopped');safetyStopped=true;}
   await save();if(safetyStopped)break;
  }
 }catch(e){report.reason=safeReason(e);safetyStopped=true;}
 if(admitted&&io.now()+IDENTITY_MAX_MS+plan.cleanupReserveMs<=Date.parse(plan.deadlineAt)){
  const final=await observeIdentity('campaign-end');report.finalIdentityReceipt=final;
  if(!matches(final)){report.finalIdentity='BLOCKED';safetyStopped=true;}else report.finalIdentity='MATCH';
 }else{report.finalIdentity='NOT RUN: admission/window unavailable';report.finalIdentityReceipt={phase:'campaign-end',result:'NOT RUN',reason:'Admission/window unavailable'};safetyStopped=true;}

 for(const row of report.cases)if(row.reason==='Not dispatched')row.reason=safetyStopped?'Campaign stopped before this case; not omitted':'No case result returned';
 report.result=report.cases.some(c=>c.result==='FAIL')?'FAIL':report.cases.every(c=>c.result==='PASS')&&!safetyStopped&&report.finalIdentity==='MATCH'?'PASS':'NOT RUN';report.safetyStopped=safetyStopped;applyRequirementMappings(report,plan);await save();
 return{exitCode:report.result==='PASS'?0:report.result==='FAIL'?1:78,report};
}
module.exports={selectedOrder,unselectedIds,validateSelection,validateRunIdentity,safeReason,validateRequestBudget,budgetBindingErrors,IDS,IDENTITY_MAX_MS,requiredIdentityCap,validateCampaignPlan,initialReport,initializeMatrix,applyRequirementMappings,runCampaign};
