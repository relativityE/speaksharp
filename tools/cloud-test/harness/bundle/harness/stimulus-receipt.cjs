'use strict';
// r15 stimulus preflight receipt verification. Pure: no filesystem, network or clock (the caller passes `now`).
// The receipt is produced OFFLINE (loopback only, no product traffic) by draft-adapters/stimulus-preflight.cjs with the same Chrome binary, flags and media the run will use. The runner refuses a
// plan that selects a Start-pressing case unless the receipt proves, for that exact media hash, that the capture device is acquired, that an ungranted request is denied with NotAllowedError (the
// AHT-12 stimulus), that a launch with no device gives NotFoundError (the R5 failure mode), that speech is audible, and, for Focus fixtures, that the real WAV aligns with its reviewed point windows.
const SHA=/^[a-f0-9]{64}$/;
function verifyStimulusReceipt(receipt,{selected,mediaShaByCase,needsDevice,codeManifestSha256,browserPath,browserSha256,now,maxAgeMs=12*3600*1000,focusCases=['AHT-02','AHT-03'],denialCases=['AHT-12']}){
 const e=[];
 if(!receipt||receipt.schema!=='speaksharp.stimulus-preflight.v1')return ['stimulus receipt schema'];
 if(receipt.codeManifestSha256!==codeManifestSha256)e.push('stimulus receipt was produced by a different runner code manifest');
 if(typeof browserPath!=='string'||!SHA.test(browserSha256||'')||receipt.chrome?.executablePath!==browserPath||receipt.chrome?.sha256!==browserSha256)e.push('stimulus receipt browser differs from the pre-plan browser identity');
 const t=Date.parse(receipt.createdAt||'');if(!Number.isFinite(t)||(now-t)>maxAgeMs||t>now+60000)e.push('stimulus receipt is stale or from the future');
 if(receipt.productTraffic!==0)e.push('stimulus receipt must record zero product traffic');
 for(const id of selected){
  if(!needsDevice(id))continue;
  const c=receipt.cases?.[id],m=mediaShaByCase[id];
  if(!c||!SHA.test(m||'')||c.mediaSha256!==m){e.push(id+': no receipt entry for the bound media');continue;}
  if(c.captureGranted!==true)e.push(id+': capture device not acquired with the bound media');
  if(c.noDeviceOutcome!=='not-found')e.push(id+': the no-device control did not give NotFoundError');
  if(c.speechDetected!==true)e.push(id+': no speech heard on the capture stream');
  if(denialCases.includes(id)&&c.ungrantedOutcome!=='not-allowed')e.push(id+': an ungranted request was not denied with NotAllowedError');
  if(focusCases.includes(id)&&c.alignment?.status!=='aligned')e.push(id+': the real fixture is not aligned with its reviewed point windows');
  if(c.ready!==true)e.push(id+': not ready');
 }
 return e;
}
module.exports={verifyStimulusReceipt};
