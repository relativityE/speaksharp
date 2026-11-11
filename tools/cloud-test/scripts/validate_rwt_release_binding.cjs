'use strict';
// A workflow-only diagnostic may test a separately pinned deployed ancestor only
// when product/dependency blobs are identical and tests/workflow inputs are
// unchanged or match the explicitly reviewed diagnostic postimages below.
// This is source compatibility, never permission to run a live case.
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
// Exact diagnostic postimages; never a broad live-test exception.
const TEST_PINS=Object.freeze({
 'tests/e2e/rwt-take-recorder.e2e.spec.ts':'9e574bfb96aec18a4ddb70c799a8288bf5de82b0a28999f0ec23b799dc5caf34',
 'tests/live/helpers/coachingExternal.ts':'c2fbb6084e04c80565532dd5f4b6e98fffe12ba447295069f0bc8f9511b1a0dd',
 'tests/live/helpers/deployedCoachingContract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
 'tests/live/helpers/runBinding.ts':'04fff3c3dad484fab25b8d3725ad28d896e8f832ace99e37dd6533ceeed6553d',
 'tests/live/helpers/runOwnedCleanup.ts':'f91d38925c442b35ef31468ad48254fe28f0e1b3ebdfd2247cda546f787ac1eb',
 'tests/live/helpers/rwtAcceptance.ts':'ffab897b764d7242a9d95cc055cb9695f8fc85b5f71c21495d109196bfd46b3e',
 'tests/live/helpers/rwtCoachingConsistency.ts':'9c496e6e90c4d88a4704c80fbfb84cf8f53378c1f6fe654a81d5aba6d3c89bee',
 'tests/live/helpers/rwtCoachingEvidence.ts':'308f6c26d0b1c5d612e44d64b764b623774e5183a62561b7c3209c6a6d85f946',
 'tests/live/helpers/rwtHarnessParity.ts':'ec3c45e6dd7e267ad08450e9fd694cdace901098b57add567c9a7ebb0bab5090',
 'tests/live/helpers/rwtJourney.ts':'fab2ec35f8d93700e7cfcd36b9fee9b3ab7abb123914b1f9c3ac561c6fa51e29',
 'tests/live/helpers/rwtLateCoaching.ts':'b0a32817c2327d65860cf2a8c2f2919c8dd1ac5b7b09ff486fe2c2507a43bc78',
 'tests/live/helpers/rwtWatchdog.ts':'94f8918412e98d8b1f6535a06c6ee96d24eda2f2da0b35a592816e3e607e7082',
 'tests/live/rwt-open-mic-first-session.live.spec.ts':'4eaea3e486a6c83d452dff87ee441b41e0e0ec3d3c81b28a7e35b8cf2fc3af69',
 'tests/unit/rwtCoachingExternal1258.test.ts':'fc2433029dc15dec55e815eab3ba61c3f4f56169ec99ac8724e028c627a2c57a',
 'tests/unit/rwtFinalization1532.test.ts':'83056c871a2980d7058541852f03006d19d3234dbab709aa4a1698c4c4082100',
 'tests/unit/rwtHarnessParity.test.ts':'9f6c162ebaa3dba70c23b2200108611cb6c3260cbe41aa57b755b5aa7462bd65',
 'tests/unit/rwtLateCoaching.test.ts':'acbbca37afbd4124156121ef7760f6787fc3b46fe4fc4a9f9fd72c6dbdbbcf50',
 'tests/unit/rwtNumericObserveSupabase.test.ts':'3afacabbc476e594dfa2a4bab98aa983c95fd82b7681ce00a12371578335f9b2',
 'tests/unit/rwtOrdinaryPersistenceRegistration.test.ts':'140e567dda2e98c2987b2dec259f862ad02e044997aa150dc7344505e0614933',
 'tests/unit/rwtReceivedFailureChain1593.test.ts':'1e347ad68f0c7daa08a6ccff2208620ce9595b6f7f6836333eec048d47bfc405',
 'tests/unit/rwtRunBoundCleanup.test.ts':'7a62a798a19e8d89e7db8bf02288595bf2ea73ec5ad5aecfcc21e73aea715eac',
 'tests/live/helpers/rwtDocumentIdentity.ts':'25c00c2a7eccd00f0cd0fe2ab3705ba5730049d187c8902e2ddd638c681594f0',
 'tests/unit/rwtWatchdog1593.test.ts':'14fe0f998d9ef1f9b5c3bd7e8d26fc264c980687c7f7eeabf166efbd77fb2162',
 'tests/unit/rwtDocumentBinaryTransport.test.js':'e4722993a0e008cf6ead7fe1e092cdc50f3d8b75df0ff29066f35dd95d2bda80',
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
