'use strict';
// A workflow-only diagnostic may test a separately pinned deployed ancestor only
// when product/dependency blobs are identical and tests/workflow inputs are
// unchanged or match the explicitly reviewed diagnostic postimages below.
// This is source compatibility, never permission to run a live case.
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
// Exact diagnostic postimages; never a broad live-test exception.
const TEST_PINS=Object.freeze({
 'tests/unit/rwtPartialFixtureMatcher.test.ts':'9a6b7f29a5c3cccf7560b2ce0a93cd13b24ef8d2cf105d320cbb2cf04ba87848',
 'tests/unit/rwtComparableSaveTake.test.ts':'c93b6f4507b63d0f3b68e75abdea028edb5835cb557cfdfbea5e7574b87cdfa5',
 // Reviewed #1811 v3 cleanup/watchdog and evidence-registry postimages.
 'scripts/lib/helperExecutionEvidence.mjs':'308866ee91665a4e867c745518bf2aac40be1c75a63bff565ffae4d7fa4d4723',
 'scripts/lib/sourceContractEvidence.mjs':'523d7b10fcecc10b20c601a8a9e49761f181e5eaf1e39868d01240a1b9d9a948',
 'tests/live/helpers/runOwnedCleanup.ts':'f52a848832000addbe93a164f57bccbfd0fbbf4185b9943bc4cf8c3e89f36211',
 'tests/live/helpers/rwtHarnessParity.ts':'c3715f6327955dd077596156e340072be554c7d160858a0a6bf321b0c8fdbd25',
 'tests/live/helpers/rwtWatchdog.ts':'fd360afaa23d2bf396765eb6622dbcefaffb38dacd289219ffad4f68d7a1f102',
 'tests/unit/helperExecutionEvidence.test.js':'01e30fa2f62ba2ff00812c77a6d2fa3cb128ce41b88e6766e9b99a75b846d3ab',
 'tests/unit/runOwnedCleanupNullCount1593.test.ts':'a30489f6a20893a3995b4c4ce44ede89aaf243378ea471906d90effa99a185e9',
 'tests/unit/runOwnedCleanupSaveObligations1643.test.ts':'515aad81c1f7905ba30fcbcfb034112638f06e8324063203c102482f28093100',
 'tests/unit/rwtHarnessParity.test.ts':'602cd32f1ae367250fae5ceac1663013cb3cb01cb160be356041f3088c042c45',
 'tests/unit/rwtRunBoundCleanup.test.ts':'1c9cefde2b065db2feb2c6aace2e3967deaa97211a6f27442308da39d16a95b2',
 'tests/unit/rwtSharedAcceptance1811.test.ts':'a6ac34441dae1d3137297d4d00c67d10109a1c81d23efd316ed232e0eae29288',
 'tests/unit/rwtWatchdogAht0215Signals.test.ts':'e9d8daeac67fa1bb033f0fd7f22078e1aabe7350f02decd6dc0865077f57a173',
 'tests/unit/sourceContractEvidence.test.js':'667d7a788dd835df9ecc68c5f544a4e87b0b35febf00d0277a92104b3fb891b6',
 // AHT-07 bounded writes (pre-send caps, three fault legs, race-safe report cleanup): exact reviewed postimages.
 'tests/live/helpers/feedbackAttemptLedger.ts':'106f421cc75c5e793a613b7a89eb453392409dce14c4e8663275643b32a8b751',
 'tests/live/helpers/feedbackReportCleanup.ts':'c1c3cbe22affac9c6b0ca754d0d13626d63024ec1e4d61e880bb4cb70679b4af',
 'tests/live/helpers/feedbackRecoveryInventory.ts':'1327d8cf15867817ec5fcc5219942b53a7bd2e8e047141efba8312424a683679',
 'tests/unit/feedbackBoundedWrites.test.ts':'b130d4a55397a5722c2f7e4cb48356432b0ed1a891e07ef1d8c1de4db976c243',
 'tests/unit/rwtSupplementalAcceptance1594.test.ts':'3926cc8aef7eca22cc8009cbbf62ae408a0624dae8621426f957def17008cca7',
 'tests/live/helpers/rwtDocumentIdentity.ts':'25c00c2a7eccd00f0cd0fe2ab3705ba5730049d187c8902e2ddd638c681594f0',
 'tests/unit/rwtWatchdog1593.test.ts':'2182dee01df81d24027902093086d9b02da9e02bfb45c9b5bf5968e5050608f8',
 'tests/unit/rwtDocumentBinaryTransport.test.js':'e4722993a0e008cf6ead7fe1e092cdc50f3d8b75df0ff29066f35dd95d2bda80',
 // AHT-02..15 prep (parity rows, AHT-07 key-bound fail-closed stored-once, AHT-09 navigation-bound ready wait, AHT-04 recovery take, AHT-05/06 attempts/exact save/reopen, AHT-02/03 Focus marker and rows, AHT-08/11/12-15 checks): exact reviewed postimages.
 'tests/live/helpers/feedbackDiagnosticRef.ts':'aeccd8dbd54dd5172da83f08b87d948f1d32028090e846c50f2e5eaf55be27fe',
 'tests/live/helpers/rwtAcceptance.ts':'76f1c3b92aa530ae40cc08ef426efded3a0088853d2efb7ee76fc3b286b76c5b',
 'tests/live/helpers/rwtAdverseJourney.ts':'3e22be61570789f3cee98d14fb94255b5715f6c7b7025c101a29995da920f11a',
 'tests/live/helpers/rwtFocusPointsJourney.ts':'7bd806a84f6bce20874c2f924a2090f4e8f197f31d7720cf17278c28ca7b8ce1',
 'tests/live/helpers/rwtPendingStartRecovery.ts':'41ad72641a30753e8a173ff79390b33305d25d8c7b1eafed7a57bd2d010118c5',
 'tests/live/helpers/rwtSaveRetryAttempts.ts':'cfa37a628a18e1c4347bb40eed73b33b303245a6930efaca0aeb24ee39ec0be2',
 'tests/live/helpers/rwtLeaveDestinationReady.ts':'5df6c2b0533098c9a9c019b2d491783b060be2cc6d5f52614d4a8053092542db',
 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts':'f8391ed96b6ba8d2c88c3873b2ee74be9821b73b2b024b0b65d1afb6bfc1b399',
 'tests/live/rwt-feedback-association-boundaries.live.spec.ts':'0168beda80853c699690defec2c9f7d0882e7e173417a35a797e458d6cf8e9a3',
 'tests/live/rwt-pending-start-navigation.live.spec.ts':'2d6ab35237f77a5980878a5b5fd7ea106094e10a8e64f4fdbca2c9df0300bf51',
 'tests/live/rwt-products-navigation.live.spec.ts':'bedab954eb78a034395639a29bcf34ff97ed9c47897f3e10a66f668ce43e4343',
 'tests/live/rwt-save-retry-recovery.live.spec.ts':'a41c3f7a74167cd912065c1d3edfea690cde699ca95d1e4e734c91b28425d2c5',
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
 'tests/unit/rwtFinalization1532.test.ts':'59fb6409ada5b3dca9cffde96899a3c463df2a4d99dc43a1aaccd594d119633b',
 'tests/unit/rwtFocusEditCancel.test.ts':'5bc38f81042b773f1d7fd7254677a4d812f0e206d2095e8b7c5b0abe6f61914f',
 'tests/unit/rwtFocusNextMarker.test.ts':'84a78df21e117a0565c26bf847ab7da5b486660e02c7b96f11cda2c9072b2310',
 'tests/unit/rwtFocusOpenMicIsolation.test.ts':'96e07c9481583085704084d28ff062adad89f9f4850dcad2a71c4c36b0d2a489',
 'tests/unit/rwtFocusStartPressBudget.test.ts':'f3e1db2a8ab0861e8aace6cc09afe1620e08db5208fa4e30c7b1c65ffca46068',
 'tests/unit/rwtFocusTakesDiffer.test.ts':'078a93b07eac4d9af625bd047fb5fe74af45a0628e48c7b8c53379ab49a31eb0',
 'tests/unit/rwtNavigationRows.test.ts':'cc35217fbe2d48ba211a17fa52bb7adf04dac0f5f1b039ef0b9066f05082d357',
 'tests/unit/rwtTwoPlaces.test.ts':'08e12ae2829ad874ee73395adf773d1014afc44891071a55d8cfdb5f38882515',
 // AHT-02/03 sign-in, Focus presentation group and same-target repeat; AHT-08 no-session report cleanup.
 'tests/live/helpers/rwtFocusPresentation.ts':'273c1f55de34c403a59d88793d6ab08c9b8569c615ef265a565fb8a2a501ba41',
 'tests/live/helpers/rwtFocusSameTarget.ts':'7cf49770fd9d2e4dcd239ae010ce425c9422ce0e92a2599779a5355f2281f800',
 'tests/live/helpers/feedbackNoSessionCleanup.ts':'ef27d95a9f5928421a5e13d635daf139579b69c098431aa57cb07f4f2de7632b',
 'tests/unit/rwtFocusPresentation.test.ts':'619317a034774fbab4b27424aafc7e7952e02a79f5902c1fec8070156a983055',
 'tests/unit/rwtFocusSameTarget.test.ts':'6416b44baf04692ea1c328deeca902fc90483c18458e631efee5a67cdeddee2d',
 'tests/unit/feedbackNoSessionCleanup.test.ts':'7643a2506eadd22f7ee40efa468497123b845bd1afdad2506454d67755506223',
 'tests/live/helpers/rwtFocusSaveIsolation.ts':'08b562963051141d88bec185682bf89aaf8d829e65e124c1f089629dc1063dca',
 'tests/unit/rwtFocusSaveIsolation.test.ts':'60e59c932e09a8b61d5dca85e21c9f13eadeabab2012b21806da1368de2d6367',
});
// These two non-product inputs are part of this diagnostic integration itself.
// Pin their exact reviewed postimages rather than treating every workflow or
// authority-test change as proof-only source.
const INTEGRATION_PINS=Object.freeze({
 // Inherited reviewed main: #1832 source-currency docs and #1830 AHT-01 save expectations.
 'product_release/RELEASE_STATUS.md':'f823b945fa3d24dbb49ffb1a72e705fa84b767e0ce96229d6e861b9c44279779',
 'product_release/ROADMAP.md':'ac4e34c689c8575883a33f9cdd15d95267c3bae42f82a9daa65f85e32b5e8fb7',
 'tests/live/rwt-open-mic-first-session.live.spec.ts':'955bef27970a423a0586f069c5ebbeb8eaf1e02ee63d9079695af8ae71ef2de6',
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
