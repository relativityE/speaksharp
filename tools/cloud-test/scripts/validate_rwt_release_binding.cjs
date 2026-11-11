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
 // AHT-02..15 prep (parity rows, AHT-07 key-bound fail-closed stored-once, AHT-09 navigation-bound ready wait, AHT-04 recovery take, AHT-05/06 attempts/exact save/reopen, AHT-02/03 Focus marker and rows, AHT-08/11/12-15 checks): exact reviewed postimages.
 'tests/live/helpers/feedbackDiagnosticRef.ts':'aeccd8dbd54dd5172da83f08b87d948f1d32028090e846c50f2e5eaf55be27fe',
 'tests/live/helpers/rwtAdverseJourney.ts':'5d9a39e1edc3661024627004f2b100a39bed1af11639e9a677e50d9b153c1f61',
 'tests/live/helpers/rwtFocusPointsJourney.ts':'3888d276270cb66cac17e6e0029868a8e75aba4585a56d9a53f51c32d7c94fdd',
 'tests/live/helpers/rwtPendingStartRecovery.ts':'41ad72641a30753e8a173ff79390b33305d25d8c7b1eafed7a57bd2d010118c5',
 'tests/live/helpers/rwtSaveRetryAttempts.ts':'37273de2797ca95f69d61c217b26d68b512c37f97493315f06c864084a709740',
 'tests/live/helpers/rwtLeaveDestinationReady.ts':'5df6c2b0533098c9a9c019b2d491783b060be2cc6d5f52614d4a8053092542db',
 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts':'1dd31a69e18fae124630a19dbfc6ea1071a5d9a3954b7605ba534ff9e4e963ce',
 'tests/live/rwt-feedback-association-boundaries.live.spec.ts':'5ace9cb71d66dec7f37fb4edff52ed1ce6c5621979143f6e34b0554b096fda90',
 'tests/live/rwt-pending-start-navigation.live.spec.ts':'92f1ec5199de8de1563c81da693731078776e8ed10cc9f1e5b350c9b3a1aa803',
 'tests/live/rwt-products-navigation.live.spec.ts':'bedab954eb78a034395639a29bcf34ff97ed9c47897f3e10a66f668ce43e4343',
 'tests/live/rwt-save-retry-recovery.live.spec.ts':'96a8a6ea88dbbfccd24afd550a5c31f788d16a7d076715886c575136ae4d8028',
 'tests/unit/feedbackDiagnosticRef1539.test.ts':'efbf10346d95655897602852b5899f1eede8a12d1484eb99a18a8dc222bba125',
 'tests/unit/rwtSaveRetryAttempts.test.ts':'514f2a29fec03c845e5d377352d321275933ccd24223344e579aac0ed4e45caf',
 'tests/unit/rwtLeaveDestinationReady.test.ts':'3cee03cdd4decd808797ecbee2a5d4173c911e28dc397abd06ae7e6036f95477',
 'tests/unit/rwtPendingStartRecovery.test.ts':'02263700f91a69a2ac34bd95b5c50810e5931b39d9de912573544424905b1f76',
 'tests/live/helpers/returningSignInAttempt.ts':'cdd275c7475ccb6fddfbe6f9d74711f82973b6b343c06525d35f4ffbeef814b0',
 'tests/live/helpers/rwtAdverseRecovery.ts':'27fbf46c18a2c0c8e2d5a775ae1f85bf9fd7672959bff8c2ea82da1556d5f005',
 'tests/live/helpers/rwtFocusEditCancel.ts':'4eee72f4b9ad5f0d1c77bb7d69be39b077a062db6911e83728f4d873b4c1784d',
 'tests/live/helpers/rwtFocusNextMarker.ts':'a1fe3229acfddcd56f239e72102911495016e3f976b2fac9071d7237aa09a20e',
 'tests/live/helpers/rwtFocusOpenMicIsolation.ts':'e40f3656e48df87f6d73e6569a5cc6da0e6d29705e54263f70220bacc17de2a1',
 'tests/live/helpers/rwtFocusTakesDiffer.ts':'2258690baf15d05ba3d63f9b9a6a935c961e322445805190b118867b6c2f9490',
 'tests/live/helpers/rwtNavigationRows.ts':'f56cdc3314896562fe3c3a3cb8ea7ed546d9ede956650035fe37a62c905136b4',
 'tests/live/helpers/rwtTwoPlaces.ts':'8f6c864c2d22c34c7ed856fad91b4716e3dfcafe57c1d0ca1d8faa5a53797002',
 'tests/live/rwt-adverse-mic-denied.live.spec.ts':'1f9864cde59b644aecdf4839068a630c4fbe59e82473fa860712e5becb493c21',
 'tests/live/rwt-adverse-mic-model.live.spec.ts':'6d61b609d70264a579436af1a2480178fe44bb08741d9b343c1930c847f542ca',
 'tests/unit/feedbackAckReceivedAht08.test.ts':'a645fff8f8de3d0a5d1bab51be845484481b2779d055513eaa5ee51c05aad91f',
 'tests/unit/rwtAdverseRecovery.test.ts':'b3a11f4a7bae93cde1a280841b88e36463d44d108c77fb7b6ff5ce51769985f8',
 'tests/unit/rwtFocusEditCancel.test.ts':'5bc38f81042b773f1d7fd7254677a4d812f0e206d2095e8b7c5b0abe6f61914f',
 'tests/unit/rwtFocusNextMarker.test.ts':'84a78df21e117a0565c26bf847ab7da5b486660e02c7b96f11cda2c9072b2310',
 'tests/unit/rwtFocusOpenMicIsolation.test.ts':'96e07c9481583085704084d28ff062adad89f9f4850dcad2a71c4c36b0d2a489',
 'tests/unit/rwtFocusStartPressBudget.test.ts':'f3e1db2a8ab0861e8aace6cc09afe1620e08db5208fa4e30c7b1c65ffca46068',
 'tests/unit/rwtFocusTakesDiffer.test.ts':'078a93b07eac4d9af625bd047fb5fe74af45a0628e48c7b8c53379ab49a31eb0',
 'tests/unit/rwtNavigationRows.test.ts':'cc35217fbe2d48ba211a17fa52bb7adf04dac0f5f1b039ef0b9066f05082d357',
 'tests/unit/rwtTwoPlaces.test.ts':'08e12ae2829ad874ee73395adf773d1014afc44891071a55d8cfdb5f38882515',
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
