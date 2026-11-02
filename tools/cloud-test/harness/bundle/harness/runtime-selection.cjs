'use strict';
// Explicit runtime variants. Supporting GitHub does not waive browser, source or guard qualification.
const CLAUDE='Claude SpeakSharp R4',GITHUB='GitHub Actions SpeakSharp';
const supported=value=>value===CLAUDE||value===GITHUB;
function validateGitHubSelection(r,c,now){
 const bad=()=>{throw new Error('actual same-job GitHub execution receipt missing or mismatched');};
 if(!r||c.runtime!==GITHUB||r.runtime!==GITHUB||r.kind!=='github-actions-job-environment-receipt'||r.repository!=='relativityE/speaksharp'||r.platformUrl!=='https://github.com'||!/^\d+$/.test(r.runId||'')||!/^\d+$/.test(r.runAttempt||'')||!/^[A-Za-z0-9_-]{1,100}$/.test(r.jobId||'')||!/^[a-f0-9]{40}$/.test(r.workflowSourceSha||'')||r.workflowSourceSha!==c.runtimeWorkflowSourceSha)bad();
 const id=`${r.repository}/${r.runId}/${r.runAttempt}/${r.jobId}`,url=`https://github.com/${r.repository}/actions/runs/${r.runId}`;
 if(r.immutableEnvironmentId!==id||c.runtimeEnvironmentId!==id||r.sourceReference!==url||!Number.isFinite(Date.parse(r.observedAt))||Date.parse(r.observedAt)<Date.parse(c.approvedStartAt)||Date.parse(r.observedAt)>now)bad();
 return {platformUrl:r.platformUrl,environmentSelector:GITHUB,taskId:id,immutableEnvironmentId:id,sourceReference:url,observedAt:r.observedAt,workflowSourceSha:r.workflowSourceSha,note:'Job metadata recorded by the reviewed in-job launcher; not cryptographic attestation. Actual authenticated row delivery is separately required.'};
}
module.exports={CLAUDE,GITHUB,supported,validateGitHubSelection};
