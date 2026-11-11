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
 // AHT-02..15 prep (parity rows, AHT-07 key-bound stored-once, AHT-09 ready wait): exact reviewed postimages.
 'tests/live/helpers/feedbackDiagnosticRef.ts':'ad3648efc06cdcaed2631778731e7d4d6fa1ca094717894640007ff103c38a18',
 'tests/live/helpers/rwtAdverseJourney.ts':'51d4e3b804f7ed5508e0e1acc45f13cf267e11fd5db87ce9dd90e792e57236f5',
 'tests/live/helpers/rwtFocusPointsJourney.ts':'959f10376d3bc74021902f0e9f897702b1d876f9570958033ff0a938e2a2d7aa',
 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts':'b421c08b0f60e8ee5c77aa6092a2badf915203d69748801fcaebb3009e6137d5',
 'tests/live/rwt-feedback-association-boundaries.live.spec.ts':'bb0a2c5b45a55cca30e4968949c634837a3f3c19e26dc9450b36279471638036',
 'tests/live/rwt-pending-start-navigation.live.spec.ts':'99b370c6dcef771abe94ec0828369b2db4c8cd16108a7409df8d1db7a604d12a',
 'tests/live/rwt-products-navigation.live.spec.ts':'20538eaf3199454558e9fa01c92f7c0b286769637168156092f64253918d441d',
 'tests/live/rwt-save-retry-recovery.live.spec.ts':'7ce4108a882ff4d1a78a03f697cea8e6ae796635840a20bb83108fb109c97cb5',
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
