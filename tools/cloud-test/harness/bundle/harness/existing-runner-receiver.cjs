'use strict';
// Receiving adapter, not a producer launcher or an authenticator. The injected function must be
// the independently reviewed EXISTING authenticated workflow/connector delivery capability.
// No operator JSON, old suite PASS or caseConfig boolean can stand in for that capability.
const {validateProjection,requestDigest,sha}=require('./existing-runner-projection.cjs');
function createExistingRunnerReceiver({receiveAuthenticatedArtifact,binding}){
 if(typeof receiveAuthenticatedArtifact!=='function')throw new Error('NOT_RUN: existing authenticated runner delivery capability unavailable');
 return async function receiveArtifact({request,requestSha256,signal}){
  if(signal?.aborted)throw new Error('NOT_RUN: runner delivery cancelled');
  if(requestSha256!==requestDigest(request))throw new Error('NOT_RUN: actual request digest differs');
  const delivery=await receiveAuthenticatedArtifact(Object.freeze({request,requestSha256,signal}));
  if(signal?.aborted)throw new Error('NOT_RUN: runner delivery arrived after cancellation');
  // Only shape/hash-adapt here. The mandatory OUTER reviewed loader validates all delivery
  // provenance, freshness and credential exclusions before any oracle consumes this output.
  // Do not import the preloaded loader itself: its fresh-receiver dependency-cache guard remains intact.
  if(!Buffer.isBuffer(delivery?.artifactBytes)||delivery.artifactBytes.length===0||delivery.artifactBytes.length>2*1024*1024||delivery.provenance?.artifactSha256!==sha(delivery.artifactBytes)||delivery.provenance?.requestSha256!==requestSha256)throw new Error('NOT_RUN: received artifact byte/request hash mismatch');
  let content;try{content=JSON.parse(delivery.artifactBytes.toString('utf8'));}catch{throw new Error('NOT_RUN: received artifact JSON unavailable');}const parsed={content};
  if(parsed.content?.schemaVersion==='speaksharp.cloud-runner-readback-projection.v1')validateProjection(parsed.content,request);
  else if(!(request.artifactRole==='coaching-authority'&&parsed.content?.schemaVersion==='speaksharp.gemini-session-readback-authority.v1'))throw new Error('NOT_RUN: supplied existing-runner artifact schema is not supported');
  return delivery;
 };
}
module.exports={createExistingRunnerReceiver,contract:{scope:'existing-authenticated-producer-receiving-capability',authentication:'Provided only by reviewed existing delivery capability; not established by this adapter',runtimeCapability:'UNBOUND',mandatoryOuterGate:'loadReviewedProducerReceiver + createProducerEvidenceReader/validateProducerDelivery; factory output alone is not validated authority'}};
