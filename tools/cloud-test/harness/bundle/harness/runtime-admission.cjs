'use strict';
// Dispatch requires this campaign's complete admission plus actual fresh qualification evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyQualification,STAGES}=require('./admission-core.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function validateDispatchEvidence({admission,qualification,qualificationSha256,qualificationFile,admissionSha256,expectedAdmissionSha256,campaignId,codeManifestSha256,policySha256,ledgerFile,actualRuntime,browserArtifactSha256,now=Date.now(),evidence,requiredCapability='browser-guard',ledgerIdentity}) {
 const fail=s=>{throw new Error('BLOCKED_SETUP: '+s);};
 if(!/^[a-f0-9]{64}$/.test(expectedAdmissionSha256||'')||admissionSha256!==expectedAdmissionSha256)fail('admission receipt bytes unbound/changed');
 if(!admission||admission.result!=='ADMISSION PASS'||!require('./runtime-selection.cjs').supported(admission.runtime))fail('current R0 admission not PASS');
 if(!campaignId||admission.binding?.campaignId!==campaignId)fail('wrong campaign admission');
 for(const id of STAGES)if(admission.steps?.filter(x=>x.id===id&&x.result==='PASS').length!==1)fail('missing admission stage '+id);
 const b=admission.binding;
 if(!ledgerIdentity||!b.campaignLedgerIdentity||['instanceId','creationAnchorSha256','capsSha256'].some(k=>!ledgerIdentity[k]||ledgerIdentity[k]!==b.campaignLedgerIdentity[k]))fail('campaign ledger instance/creation anchor changed or unavailable');
 if(!ledgerFile||path.resolve(ledgerFile)!==b.campaignLedger)fail('dispatch must use the cumulative admitted campaign ledger');
 if(b.codeManifestSha256!==codeManifestSha256||b.policySha256!==policySha256||b.sourceSha!==b.servedSha||!/^[a-f0-9]{40}$/.test(b.sourceSha||''))fail('admission source/policy/code identity mismatch');
 if(!Number.isFinite(Date.parse(b.approvedStartAt))||!Number.isFinite(Date.parse(b.approvedDeadlineAt))||now<Date.parse(b.approvedStartAt)||now>=Date.parse(b.approvedDeadlineAt))fail('outside admitted campaign window');
 if(admission.identityReceipt?.result!=='MATCH'||admission.identityReceipt.servedSha!==b.servedSha)fail('admission identity not matched');
 if(admission.runtimeQualificationReceipt!==qualificationFile||admission.runtimeQualificationSha256!==qualificationSha256)fail('qualification is not this admission receipt');
 if(!actualRuntime||['node','playwright','chromiumRevision','chromeSha256','wrapperSha256'].some(k=>actualRuntime[k]!==b.runtimeVariant?.[k])||browserArtifactSha256!==b.browserArtifactSha256)fail('current runtime/browser bytes differ from admitted compatibility variant');
 if(requiredCapability==='lighthouse'&&(!/^[a-f0-9]{64}$/.test(actualRuntime.lighthouseCliSha256||'')||actualRuntime.lighthouseCliSha256!==b.runtimeVariant?.lighthouseCliSha256))fail('current Lighthouse CLI bytes differ from admitted qualification');
 const stage=admission.steps.find(s=>s.id==='A6.guard-selftest');
 verifyQualification(qualification,{codeManifestSha256,startedAt:Date.parse(stage.startedAt),endedBy:Date.parse(stage.endedAt),expectedRuntime:b.runtimeVariant,expectedRuntimeName:admission.runtime,expectedSelection:b.lighthouseSelection,ownerApprovalReference:b.lighthouseOwnerApprovalReference,requiredCapability,evidence});
 return {result:'DISPATCH_ADMISSION_VALID',campaignId,sourceSha:b.sourceSha,servedSha:b.servedSha,deadlineAt:b.approvedDeadlineAt,expectedLedgerIdentity:b.campaignLedgerIdentity};
}
function regular(file){const p=path.resolve(file);const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(p)!==p)throw new Error('BLOCKED_SETUP: noncanonical evidence file');return p;}
function requireRuntimeQualification(file,options={}) {
 if(!file||!options.admissionReceiptFile)throw new Error('BLOCKED_SETUP: current campaign admission and R0 qualification receipts required');
 const root=path.resolve(__dirname,'..');const integrity=require('./preflight.cjs').verifyManifest(root,'CODE.sha256');
 if(integrity.result!=='PASS')throw new Error('BLOCKED_SETUP: actual code differs from reviewed manifest');
 const qfile=regular(file),afile=regular(options.admissionReceiptFile),qbytes=fs.readFileSync(qfile),abytes=fs.readFileSync(afile);
 const qroot=path.dirname(qfile),policy=fs.readFileSync(regular(options.policyFile));
 const browserBytes=fs.readFileSync(regular(options.browserFile)),browser=JSON.parse(browserBytes),pw=JSON.parse(fs.readFileSync(require.resolve('playwright/package.json',{paths:[process.cwd()]}),'utf8'));
 const actualRuntime={node:process.versions.node,playwright:pw.version,chromiumRevision:browser.revision,chromeSha256:sha(fs.readFileSync(regular(browser.copiedExecutable))),wrapperSha256:sha(fs.readFileSync(regular(browser.wrapperPath)))};
 if(options.requiredCapability==='lighthouse'){actualRuntime.lighthouseCliSha256=require('./launch-boundary.cjs').hashExecutable(options.lighthouseCli,options.lighthouseCliSha256).sha256;if(actualRuntime.lighthouseCliSha256!==options.lighthouseCliSha256)throw new Error('BLOCKED_SETUP: provided Lighthouse CLI digest differs from actual bytes');}
 return validateDispatchEvidence({admission:JSON.parse(abytes),qualification:JSON.parse(qbytes),qualificationSha256:sha(qbytes),qualificationFile:qfile,admissionSha256:sha(abytes),expectedAdmissionSha256:options.admissionReceiptSha256,campaignId:options.campaignId,requiredCapability:options.requiredCapability||'browser-guard',codeManifestSha256:sha(fs.readFileSync(path.join(root,'CODE.sha256'))),policySha256:sha(policy),ledgerFile:options.ledgerFile,actualRuntime,browserArtifactSha256:sha(browserBytes),ledgerIdentity:require('./campaign-ledger.cjs').Ledger.inspectIdentity(options.ledgerFile),evidence:relative=>{const p=path.resolve(qroot,relative);if(!p.startsWith(qroot+path.sep))throw new Error('qualification evidence escapes root');return sha(fs.readFileSync(regular(p)));}});
}
module.exports={requireRuntimeQualification,validateDispatchEvidence};
