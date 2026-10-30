'use strict';
// A workflow-only diagnostic may test a separately pinned deployed ancestor only
// when product/dependency blobs are identical and tests are unchanged or match
// the three explicitly reviewed diagnostic postimages below.
// This is source compatibility, never permission to run a live case.
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
// Exact diagnostic postimages; never a broad live-test exception.
const TEST_PINS=Object.freeze({
 'tests/live/helpers/rwtDocumentIdentity.ts':'25c00c2a7eccd00f0cd0fe2ab3705ba5730049d187c8902e2ddd638c681594f0',
 'tests/unit/rwtWatchdog1593.test.ts':'14fe0f998d9ef1f9b5c3bd7e8d26fc264c980687c7f7eeabf166efbd77fb2162',
 'tests/unit/rwtDocumentBinaryTransport.test.js':'e4722993a0e008cf6ead7fe1e092cdc50f3d8b75df0ff29066f35dd95d2bda80',
});
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
  if(!Object.hasOwn(TEST_PINS,p))throw Error('PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS');
  if(createHash('sha256').update(git(['show',env.GITHUB_SHA+':'+p],true)).digest('hex')!==TEST_PINS[p])throw Error('DIAGNOSTIC_TEST_SOURCE_PIN_DIFFERS');
 }
 return {kind:'rwt-diagnostic-source-compatible-not-release-qualification',workflowSha:env.GITHUB_SHA,servedSha:release,changedProofPaths:paths.length};
}
if(require.main===module){try{console.log(JSON.stringify(verify()));}catch(e){console.error('HOLD: '+e.message);process.exitCode=1;}}
module.exports={SPECS,TEST_PINS,verify};
