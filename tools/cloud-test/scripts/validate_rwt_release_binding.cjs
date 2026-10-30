'use strict';
// A workflow-only diagnostic may test a separately pinned deployed ancestor only
// when every product, live spec, helper and dependency blob is still identical.
// This is source compatibility, never permission to run a live case.
const {spawnSync}=require('node:child_process');
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
 function git(args){const r=spawnSync('git',args,{cwd,encoding:'utf8',timeout:10000,maxBuffer:1048576});if(r.error||r.status!==0)throw Error('SOURCE_BINDING_UNPROVEN');return r.stdout;}
 // The checked-out source must be the actual job head, not a caller-supplied substitute.
 if(git(['rev-parse','HEAD']).trim()!==env.GITHUB_SHA)throw Error('JOB_SOURCE_DIFFERS');
 git(['merge-base','--is-ancestor',release,env.GITHUB_SHA]);
 const paths=git(['diff','--name-only','-z',release,env.GITHUB_SHA,'--']).split('\0').filter(Boolean);
 if(paths.some(p=>p!=='.github/workflows/rc-gates.yml'&&!p.startsWith('tools/cloud-test/')))throw Error('PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS');
 return {kind:'rwt-diagnostic-source-compatible-not-release-qualification',workflowSha:env.GITHUB_SHA,servedSha:release,changedProofPaths:paths.length};
}
if(require.main===module){try{console.log(JSON.stringify(verify()));}catch(e){console.error('HOLD: '+e.message);process.exitCode=1;}}
module.exports={SPECS,verify};
