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
 // AHT-01 on the original Playwright route (PO 2026-11-10): run-bound cleanup and harness-parity checks, test-only.
 'tests/e2e/rwt-take-recorder.e2e.spec.ts':'2c5bfd1a9d54beb30f3b004504a202981ed394cd18377ed991aba2542833f7f9',
 'tests/live/helpers/coachingExternal.ts':'c2fbb6084e04c80565532dd5f4b6e98fffe12ba447295069f0bc8f9511b1a0dd',
 'tests/live/helpers/runBinding.ts':'04fff3c3dad484fab25b8d3725ad28d896e8f832ace99e37dd6533ceeed6553d',
 'tests/live/helpers/runOwnedCleanup.ts':'f91d38925c442b35ef31468ad48254fe28f0e1b3ebdfd2247cda546f787ac1eb',
 'tests/live/helpers/rwtAcceptance.ts':'6d8e73b4a43d7b700d96390ea5d31b17e26e371c1eef10128d3083ff33555612',
 'tests/live/helpers/rwtHarnessParity.ts':'acb3d1144b3fafa548b51a375d441eeb9a4ea82b5ee5a921b91a4d6a8ab5808f',
 'tests/live/helpers/rwtJourney.ts':'2334d84844e496940a858d52469788aebff5e51163fbe6de5403c2b5ee3e0b71',
 'tests/live/helpers/rwtWatchdog.ts':'94f8918412e98d8b1f6535a06c6ee96d24eda2f2da0b35a592816e3e607e7082',
 'tests/live/rwt-open-mic-first-session.live.spec.ts':'567cc528b707dd021057941bd37ceef67c89a35071ac4b43bbab0d102d0bdd68',
 'tests/unit/rwtCoachingExternal1258.test.ts':'fc2433029dc15dec55e815eab3ba61c3f4f56169ec99ac8724e028c627a2c57a',
 'tests/unit/rwtFinalization1532.test.ts':'83056c871a2980d7058541852f03006d19d3234dbab709aa4a1698c4c4082100',
 'tests/unit/rwtHarnessParity.test.ts':'7dd258b2bbbe26461eaba1eb03c68cba2eaa6435e531343c5a6078c55897cd33',
 'tests/unit/rwtNumericObserveSupabase.test.ts':'365b15fbd6579820d894b77d2d3b0dd2f4021c368bc9143e54563db9d9e45c83',
 'tests/unit/rwtReceivedFailureChain1593.test.ts':'1e347ad68f0c7daa08a6ccff2208620ce9595b6f7f6836333eec048d47bfc405',
 'tests/unit/rwtRunBoundCleanup.test.ts':'7a62a798a19e8d89e7db8bf02288595bf2ea73ec5ad5aecfcc21e73aea715eac',
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
