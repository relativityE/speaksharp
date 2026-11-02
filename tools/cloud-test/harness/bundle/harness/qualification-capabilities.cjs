'use strict';
// Pure selection/receipt policy. This validates supplied owner records; it never grants approval.
const LIGHTHOUSE_IDS=['S10.lighthouse','S10.lighthouse-privilege','S10.lighthouse-cleanup','S10.reconcile.a.test','S10.no-leak'];
function selection(value){if(!['required','not-selected'].includes(value))throw new Error('explicit lighthouseSelection required (required or not-selected); no default waiver');return value;}
function validateSelectionApproval(value,approval){
 const mode=selection(value),selected=mode==='required',record=approval?.capabilities?.lighthouse;
 if(!record||record.selected!==selected||!record.ownerApprovalReference||record.ownerApprovalReference!==approval.ownerApprovalReference)throw new Error('Lighthouse selection lacks matching final owner approval');
 return {selection:mode,selected,ownerApprovalReference:record.ownerApprovalReference};
}
function summarizeQualification(results,value){
 const mode=selection(value),selected=mode==='required';
 const ids=new Set();for(const r of results){if(!r?.id||ids.has(r.id))throw new Error('duplicate/missing qualification assertion');ids.add(r.id);}
 const browser=results.filter(r=>!r.id.startsWith('S10.')),lh=results.filter(r=>r.id.startsWith('S10.'));
 const stages=['S1.','S2.','S3.','S4.','S5.','S6.','S7.','S8.','S9.','S11.','S12.','S13.','S14.','S15.'];
 const missingStages=stages.filter(p=>!browser.some(r=>r.id.startsWith(p)));
 const browserPassed=!missingStages.length&&browser.every(r=>r.ok===true&&r.result!=='NOT_RUN');
 const lhComplete=LIGHTHOUSE_IDS.every(id=>lh.some(r=>r.id===id));
 const lhPassed=selected&&lhComplete&&lh.every(r=>r.ok===true&&r.result!=='NOT_RUN');
 const lhNotRun=!selected&&lhComplete&&lh.every(r=>r.ok===null&&r.result==='NOT_RUN'&&r.reason==='OWNER_NOT_SELECTED');
 return {result:browserPassed&&(selected?lhPassed:lhNotRun)?'PASS':'FAIL',qualifiedScope:selected?'browser-guard-and-lighthouse':'browser-guard-only',fullLighthouseQualification:lhPassed,browserGuardResult:browserPassed?'PASS':'FAIL',lighthouseResult:selected?(lhPassed?'PASS':'FAIL'):'NOT_RUN',missingStages,passed:results.filter(r=>r.ok===true).length,failed:results.filter(r=>r.ok===false).length,notRun:results.filter(r=>r.result==='NOT_RUN').length};
}
function verifyCapabilityReceipt(receipt,{expectedSelection,ownerApprovalReference,requiredCapability='browser-guard',verifyEvidence}){
 const mode=selection(expectedSelection),lh=receipt?.capabilities?.lighthouse;
 if(!['browser-guard','lighthouse'].includes(requiredCapability))throw new Error('unknown requested qualification capability');
 if(!lh||lh.selection!==mode||lh.selected!==(mode==='required')||!ownerApprovalReference||lh.ownerApprovalReference!==ownerApprovalReference)throw new Error('qualification capability/owner binding differs');
 if(receipt.qualifiedScope!==(mode==='required'?'browser-guard-and-lighthouse':'browser-guard-only')||receipt.browserGuardResult!=='PASS')throw new Error('browser guard scope not qualified');
 if(mode==='required'&&(lh.result!=='PASS'||receipt.fullLighthouseQualification!==true))throw new Error('selected Lighthouse not qualified');
 if(mode==='not-selected'&&(lh.result!=='NOT_RUN'||lh.reason!=='OWNER_NOT_SELECTED'||receipt.fullLighthouseQualification!==false))throw new Error('unselected Lighthouse cannot claim qualification');
 if(requiredCapability==='lighthouse'&&mode!=='required')throw new Error('Lighthouse dispatch prohibited: capability NOT_RUN');
 verifyEvidence(lh,'lighthouse capability');
 return {qualifiedScope:receipt.qualifiedScope,lighthouse:lh.result,fullLighthouseQualification:receipt.fullLighthouseQualification};
}
module.exports={LIGHTHOUSE_IDS,selection,validateSelectionApproval,summarizeQualification,verifyCapabilityReceipt};
