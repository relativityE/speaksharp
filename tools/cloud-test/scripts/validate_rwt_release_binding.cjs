'use strict';
// A workflow-only diagnostic may test a separately pinned deployed ancestor only
// when product/dependency blobs are identical and tests/workflow inputs are
// unchanged or match the explicitly reviewed diagnostic postimages below.
// This is source compatibility, never permission to run a live case.
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
// Exact diagnostic postimages; never a broad live-test exception.
const TEST_PINS=Object.freeze({
 // AHT-07 bounded writes (pre-send caps, three fault legs, race-safe report cleanup): exact reviewed postimages.
 'tests/live/helpers/feedbackAttemptLedger.ts':'106f421cc75c5e793a613b7a89eb453392409dce14c4e8663275643b32a8b751',
 'tests/live/helpers/feedbackReportCleanup.ts':'c1c3cbe22affac9c6b0ca754d0d13626d63024ec1e4d61e880bb4cb70679b4af',
 'tests/unit/feedbackBoundedWrites.test.ts':'6765f04db1eed1bd69325659fc1a91e6c7948e1014c553b48e6c5c034bded0b5',
 'tests/unit/rwtSupplementalAcceptance1594.test.ts':'3d3c20a76c7c47bfaf52a56d458a5ff0052388e72e77f50a373721c0b7031685',
 'tests/live/helpers/rwtDocumentIdentity.ts':'25c00c2a7eccd00f0cd0fe2ab3705ba5730049d187c8902e2ddd638c681594f0',
 'tests/unit/rwtWatchdog1593.test.ts':'14fe0f998d9ef1f9b5c3bd7e8d26fc264c980687c7f7eeabf166efbd77fb2162',
 'tests/unit/rwtDocumentBinaryTransport.test.js':'e4722993a0e008cf6ead7fe1e092cdc50f3d8b75df0ff29066f35dd95d2bda80',
 // AHT-02..15 prep (parity rows, AHT-07 key-bound fail-closed stored-once, AHT-09 navigation-bound ready wait, AHT-04 recovery take, AHT-05/06 attempts/exact save/reopen, AHT-02/03 Focus marker and rows, AHT-08/11/12-15 checks): exact reviewed postimages.
 'tests/live/helpers/feedbackDiagnosticRef.ts':'aeccd8dbd54dd5172da83f08b87d948f1d32028090e846c50f2e5eaf55be27fe',
 'tests/live/helpers/rwtAcceptance.ts':'20ab4e11d55b33caa8c0f233845e7e579ed3945e243a41e58707a077cb5ef0c1',
 'tests/live/helpers/rwtAdverseJourney.ts':'43b481b686f04ad4632fc5c05a503b012dc4ab1914201905b302c95492158e3a',
 'tests/live/helpers/rwtFocusPointsJourney.ts':'3888d276270cb66cac17e6e0029868a8e75aba4585a56d9a53f51c32d7c94fdd',
 'tests/live/helpers/rwtPendingStartRecovery.ts':'41ad72641a30753e8a173ff79390b33305d25d8c7b1eafed7a57bd2d010118c5',
 'tests/live/helpers/rwtSaveRetryAttempts.ts':'cfa37a628a18e1c4347bb40eed73b33b303245a6930efaca0aeb24ee39ec0be2',
 'tests/live/helpers/rwtLeaveDestinationReady.ts':'5df6c2b0533098c9a9c019b2d491783b060be2cc6d5f52614d4a8053092542db',
 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts':'1dd31a69e18fae124630a19dbfc6ea1071a5d9a3954b7605ba534ff9e4e963ce',
 'tests/live/rwt-feedback-association-boundaries.live.spec.ts':'98e06bc46e5003f6689b0a370fe39747ba86e2e519ab29b38b8f478dd132acb2',
 'tests/live/rwt-pending-start-navigation.live.spec.ts':'92f1ec5199de8de1563c81da693731078776e8ed10cc9f1e5b350c9b3a1aa803',
 'tests/live/rwt-products-navigation.live.spec.ts':'bedab954eb78a034395639a29bcf34ff97ed9c47897f3e10a66f668ce43e4343',
 'tests/live/rwt-save-retry-recovery.live.spec.ts':'fdc50db1ead0c097e9f1318cb0cfc4e054d32f36fb4989571f0fae3f7fea5620',
 'tests/unit/feedbackDiagnosticRef1539.test.ts':'efbf10346d95655897602852b5899f1eede8a12d1484eb99a18a8dc222bba125',
 'tests/unit/rwtSaveRetryAttempts.test.ts':'13908b304c5c9f38b0d5fcca560c8664dcd20cf5eee56d514af6327d030f9e89',
 'tests/unit/rwtLeaveDestinationReady.test.ts':'3cee03cdd4decd808797ecbee2a5d4173c911e28dc397abd06ae7e6036f95477',
 'tests/unit/rwtPendingStartRecovery.test.ts':'02263700f91a69a2ac34bd95b5c50810e5931b39d9de912573544424905b1f76',
 'tests/live/helpers/returningSignInAttempt.ts':'cdd275c7475ccb6fddfbe6f9d74711f82973b6b343c06525d35f4ffbeef814b0',
 'tests/live/helpers/rwtAdverseRecovery.ts':'109d1b78075d82d6070498410ae2f4f866ecd78b9bf649574d1a8519863fb6c8',
 'tests/live/helpers/rwtFocusEditCancel.ts':'4eee72f4b9ad5f0d1c77bb7d69be39b077a062db6911e83728f4d873b4c1784d',
 'tests/live/helpers/rwtFocusNextMarker.ts':'a1fe3229acfddcd56f239e72102911495016e3f976b2fac9071d7237aa09a20e',
 'tests/live/helpers/rwtFocusOpenMicIsolation.ts':'e40f3656e48df87f6d73e6569a5cc6da0e6d29705e54263f70220bacc17de2a1',
 'tests/live/helpers/rwtFocusTakesDiffer.ts':'2258690baf15d05ba3d63f9b9a6a935c961e322445805190b118867b6c2f9490',
 'tests/live/helpers/rwtNavigationRows.ts':'f56cdc3314896562fe3c3a3cb8ea7ed546d9ede956650035fe37a62c905136b4',
 'tests/live/helpers/rwtTwoPlaces.ts':'8f6c864c2d22c34c7ed856fad91b4716e3dfcafe57c1d0ca1d8faa5a53797002',
 'tests/live/rwt-adverse-mic-denied.live.spec.ts':'1f9864cde59b644aecdf4839068a630c4fbe59e82473fa860712e5becb493c21',
 'tests/live/rwt-adverse-mic-model.live.spec.ts':'6d61b609d70264a579436af1a2480178fe44bb08741d9b343c1930c847f542ca',
 'tests/unit/feedbackAckReceivedAht08.test.ts':'a645fff8f8de3d0a5d1bab51be845484481b2779d055513eaa5ee51c05aad91f',
 'tests/unit/rwtAdverseRecovery.test.ts':'3f7f3ca2e9134247a8d04174b0c093a29331d446978c1e4148856150bac8a7db',
 'tests/unit/rwtFinalization1532.test.ts':'7fd5568f0ae24d3ea6346e5965c72a1263f949ab692fff515ffaa7f932fe2442',
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
