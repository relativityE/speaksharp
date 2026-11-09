'use strict';
// FAIL-CLOSED STAND-IN, TRUTHFULLY LABELLED. No authorized evidence reader (coaching authority / feedback association /
// feedback received) exists in this cloud session: the existing trusted runner needs service-role access that must not be
// exported here, and no permission may be changed. This module therefore NEVER returns an artifact or provenance, so it
// can never produce a PASS or any "verified" receipt. Every call is refused with a typed error; the oracle layer turns that
// into a NOT RUN row (evidence unavailable) and the browser journey continues diagnostically.
// It is NOT a producer, NOT an authenticator and is not evidence of anything.
const contract=Object.freeze({scope:'existing-authenticated-producer-receiving-capability',status:'UNAVAILABLE_FAIL_CLOSED',producesArtifacts:false});
async function receiveArtifact(){
  const e=new Error('EVIDENCE_READER_UNAVAILABLE: no authorized evidence reader is available to this session; no artifact fabricated');
  e.code='EVIDENCE_READER_UNAVAILABLE';
  throw e;
}
module.exports={contract,receiveArtifact};
