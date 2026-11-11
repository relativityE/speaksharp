'use strict';
// A workflow-only diagnostic may test a separately pinned deployed ancestor only
// when product/dependency blobs are identical and tests/workflow inputs are
// unchanged or match the explicitly reviewed diagnostic postimages below.
// This is source compatibility, never permission to run a live case.
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
// Exact diagnostic postimages; never a broad live-test exception.
const TEST_PINS=Object.freeze({
 'tests/live/helpers/rwtDocumentIdentity.ts':'25c00c2a7eccd00f0cd0fe2ab3705ba5730049d187c8902e2ddd638c681594f0',
 'tests/unit/rwtWatchdog1593.test.ts':'14fe0f998d9ef1f9b5c3bd7e8d26fc264c980687c7f7eeabf166efbd77fb2162',
 'tests/unit/rwtDocumentBinaryTransport.test.js':'e4722993a0e008cf6ead7fe1e092cdc50f3d8b75df0ff29066f35dd95d2bda80',
 // AHT-02..15 prep (parity rows, AHT-07 key-bound fail-closed stored-once, AHT-09 navigation-bound ready wait, AHT-04 recovery take, AHT-05/06 attempts/exact save/reopen): exact reviewed postimages.
 'tests/live/helpers/feedbackDiagnosticRef.ts':'a6bdf509479f666378b90afe377fddc51fdb60fc3465c20e8cc1ac4044acb456',
 'tests/live/helpers/rwtAdverseJourney.ts':'51d4e3b804f7ed5508e0e1acc45f13cf267e11fd5db87ce9dd90e792e57236f5',
 'tests/live/helpers/rwtFocusPointsJourney.ts':'959f10376d3bc74021902f0e9f897702b1d876f9570958033ff0a938e2a2d7aa',
 'tests/live/helpers/rwtPendingStartRecovery.ts':'41ad72641a30753e8a173ff79390b33305d25d8c7b1eafed7a57bd2d010118c5',
 'tests/live/helpers/rwtSaveRetryAttempts.ts':'37273de2797ca95f69d61c217b26d68b512c37f97493315f06c864084a709740',
 'tests/live/helpers/rwtLeaveDestinationReady.ts':'5df6c2b0533098c9a9c019b2d491783b060be2cc6d5f52614d4a8053092542db',
 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts':'475160dbdc5d7325a40f9df87c5ab2d8ddd813b7f7419524f3f9b21b5174c137',
 'tests/live/rwt-feedback-association-boundaries.live.spec.ts':'a96001cef1478baf07ab953ce4096942911e162ffde2b8af5420846f03d52388',
 'tests/live/rwt-pending-start-navigation.live.spec.ts':'92f1ec5199de8de1563c81da693731078776e8ed10cc9f1e5b350c9b3a1aa803',
 'tests/live/rwt-products-navigation.live.spec.ts':'20538eaf3199454558e9fa01c92f7c0b286769637168156092f64253918d441d',
 'tests/live/rwt-save-retry-recovery.live.spec.ts':'96a8a6ea88dbbfccd24afd550a5c31f788d16a7d076715886c575136ae4d8028',
 'tests/unit/feedbackDiagnosticRef1539.test.ts':'efbf10346d95655897602852b5899f1eede8a12d1484eb99a18a8dc222bba125',
 'tests/unit/rwtSaveRetryAttempts.test.ts':'514f2a29fec03c845e5d377352d321275933ccd24223344e579aac0ed4e45caf',
 'tests/unit/rwtLeaveDestinationReady.test.ts':'3cee03cdd4decd808797ecbee2a5d4173c911e28dc397abd06ae7e6036f95477',
 'tests/unit/rwtPendingStartRecovery.test.ts':'02263700f91a69a2ac34bd95b5c50810e5931b39d9de912573544424905b1f76',
});
// These two non-product inputs are part of this diagnostic integration itself.
// Pin their exact reviewed postimages rather than treating every workflow or
// authority-test change as proof-only source.
const INTEGRATION_PINS=Object.freeze({
 '.github/workflows/cloud-test.yml':'33a0d4ee002f59946ee3e09c1b3cad9c30e26741ae3ea5a841c7f55a97c5c285',
 'tests/unit/modelComparisonRunAuthority.test.js':'95262458ac364c96c13a2a6d7c1164a4008914a04d626078a3ef57a2588088d6',
});
const SOURCE_PINS=Object.freeze({...TEST_PINS,...INTEGRATION_PINS});
const SPECS=Object.freeze([
 'rwt-open-mic-first-session.live.spec.ts','rwt-focus-points-session.live.spec.ts',
 'rwt-focus-points-partial.live.spec.ts','rwt-pending-start-navigation.live.spec.ts',
 'rwt-save-retry-recovery.live.spec.ts','rwt-feedback-association-boundaries.live.spec.ts',
 'rwt-abandon-and-two-tabs.live.spec.ts','rwt-adverse-mic-denied.live.spec.ts',
 'rwt-adverse-mic-model.live.spec.ts','rwt-products-navigation.live.spec.ts',
].map(n=>'tests/live/'+n));
const SHA=/^[0-9a-f]{40}$/;
function verify(env=process.env,cwd=process.cwd()){
 const release=env.DIAGNOSTIC_RELEASE||'';
 if(!release)return {kind:'unchanged-workflow-source-binding'};
 if(!SHA.test(release)||!SHA.test(env.GITHUB_SHA||'')||!SPECS.includes(env.DIAGNOSTIC_SPEC)||env.SELECTED_GATE!=='gate-3-dast'||!env.DIAGNOSTIC_GREP?.trim()||(env.COMPARISON_CELL||'none')!=='none'||env.PAID_LAUNCH)throw Error('BOUNDED_RWT_SELECTION_REQUIRED');
 function git(args,binary=false){const r=spawnSync('git',args,{cwd,encoding:binary?null:'utf8',timeout:10000,maxBuffer:1048576});if(r.error||r.status!==0)throw Error('SOURCE_BINDING_UNPROVEN');return r.stdout;}
 // The checked-out source must be the actual job head, not a caller-supplied substitute.
 if(git(['rev-parse','HEAD']).trim()!==env.GITHUB_SHA)throw Error('JOB_SOURCE_DIFFERS');
 git(['merge-base','--is-ancestor',release,env.GITHUB_SHA]);
 const paths=git(['diff','--no-renames','--name-only','-z',release,env.GITHUB_SHA,'--']).split('\0').filter(Boolean);
 for(const p of paths){
  if(p==='.github/workflows/rc-gates.yml'||p.startsWith('tools/cloud-test/'))continue;
  if(!Object.hasOwn(SOURCE_PINS,p))throw Error('PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS');
  if(createHash('sha256').update(git(['show',env.GITHUB_SHA+':'+p],true)).digest('hex')!==SOURCE_PINS[p])throw Error('DIAGNOSTIC_TEST_SOURCE_PIN_DIFFERS');
 }
 return {kind:'rwt-diagnostic-source-compatible-not-release-qualification',workflowSha:env.GITHUB_SHA,servedSha:release,changedProofPaths:paths.length};
}
if(require.main===module){try{console.log(JSON.stringify(verify()));}catch(e){console.error('HOLD: '+e.message);process.exitCode=1;}}
module.exports={SPECS,TEST_PINS,INTEGRATION_PINS,verify};
