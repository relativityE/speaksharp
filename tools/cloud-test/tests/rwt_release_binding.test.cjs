'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {verify,SPECS,TEST_PINS,INTEGRATION_PINS}=require('../scripts/validate_rwt_release_binding.cjs');
function fixture(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rwt-binding-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
 function commit(file,body){const p=path.join(dir,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);git('add','--',file);git('commit','-qm','synthetic');return git('rev-parse','HEAD');}
 const release=commit('frontend/src/app.ts','synthetic product');
 const head=commit('tools/cloud-test/proof.txt','synthetic proof');
 const env={DIAGNOSTIC_RELEASE:release,GITHUB_SHA:head,DIAGNOSTIC_SPEC:SPECS[0],SELECTED_GATE:'gate-3-dast',DIAGNOSTIC_GREP:'one exact selected test',COMPARISON_CELL:'none'};
 return {dir,git,commit,release,head,env};
}
// Hermetic by design: no git history. The quality-evidence step runs this file in a single-commit source copy, so a
// test may read only this checkout's current bytes. A pinned path whose current bytes still equal its pin proves the
// acceptance path; one whose bytes have drifted since its pin proves refusal. Pins are never moved to fit current bytes.
const ROOT=path.resolve(__dirname,'../../..');
const SOURCE_PIN_MAP={...TEST_PINS,...INTEGRATION_PINS};
const sha256=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
const currentBytes=p=>{try{return fs.readFileSync(path.join(ROOT,p));}catch{return null;}};
const matchesPin=p=>{const b=currentBytes(p);return b!==null&&sha256(b)===SOURCE_PIN_MAP[p];};
const MATCHING_PINS=Object.keys(SOURCE_PIN_MAP).filter(matchesPin);
const DRIFTED_PINS=Object.keys(SOURCE_PIN_MAP).filter(p=>currentBytes(p)!==null&&!matchesPin(p));
test('no override preserves existing workflow binding',()=>assert.deepEqual(verify({}),{kind:'unchanged-workflow-source-binding'}));
test('every closed RWT spec permits unchanged product/live source on a proof-only successor',t=>{const f=fixture(t);for(const spec of SPECS)assert.equal(verify({...f.env,DIAGNOSTIC_SPEC:spec},f.dir).servedSha,f.release);});
test('product or live-helper change cannot use separately pinned served ancestor',t=>{const f=fixture(t);for(const p of ['frontend/src/app.ts','tests/live/helpers/rwtJourney.ts','pnpm-lock.yaml','.github/actions/setup-environment/action.yml']){const h=f.commit(p,'changed '+p);assert.throws(()=>verify({...f.env,GITHUB_SHA:h},f.dir),/PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS/);}});
test('identical product file renamed into allowed proof directory still refuses',t=>{const f=fixture(t);f.git('mv','frontend/src/app.ts','tools/cloud-test/moved-product.ts');f.git('commit','-qm','synthetic cross-boundary rename');const head=f.git('rev-parse','HEAD');assert.equal(f.git('diff','--name-only','--find-renames',f.release,head).includes('frontend/src/app.ts'),false);assert.throws(()=>verify({...f.env,GITHUB_SHA:head},f.dir),/PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS/);});
test('unknown live spec, missing grep, paid or comparison scope and all-gates selection refuse',t=>{const f=fixture(t);for(const change of [{DIAGNOSTIC_SPEC:'tests/live/unreviewed.live.spec.ts'},{DIAGNOSTIC_GREP:''},{PAID_LAUNCH:'true'},{COMPARISON_CELL:'v2:base.en/open_mic'},{SELECTED_GATE:'all'},{DIAGNOSTIC_RELEASE:'main'},{GITHUB_SHA:'x'.repeat(40)}])assert.throws(()=>verify({...f.env,...change},f.dir),/BOUNDED_RWT_SELECTION_REQUIRED/);});
test('claimed source must equal checked-out actual job head',t=>{const f=fixture(t);assert.throws(()=>verify({...f.env,GITHUB_SHA:f.release},f.dir),/JOB_SOURCE_DIFFERS/);});
test('unavailable or nonancestor release cannot be substituted',t=>{const f=fixture(t);assert.throws(()=>verify({...f.env,DIAGNOSTIC_RELEASE:'1'.repeat(40)},f.dir),/SOURCE_BINDING_UNPROVEN/);f.git('checkout','--orphan','unrelated');f.git('rm','-rf','.');const other=f.commit('other.txt','unrelated');f.git('checkout','--detach',f.head);assert.throws(()=>verify({...f.env,DIAGNOSTIC_RELEASE:other},f.dir),/SOURCE_BINDING_UNPROVEN/);});
test('normal changed workflow plus proof files remain diagnostic only',t=>{const f=fixture(t);const head=f.commit('.github/workflows/rc-gates.yml','synthetic diagnostic workflow');assert.equal(verify({...f.env,GITHUB_SHA:head},f.dir).kind,'rwt-diagnostic-source-compatible-not-release-qualification');});
test('only the exact accepted attribution and integration postimages may differ from deployed source',t=>{
 assert.ok(MATCHING_PINS.length>0,'no pinned path still matches its pin: the acceptance path is unproven');
 const f=fixture(t);let head=f.head;for(const p of MATCHING_PINS)head=f.commit(p,currentBytes(p));
 assert.equal(verify({...f.env,GITHUB_SHA:head},f.dir).servedSha,f.release);});
test('current checkout bytes that no longer match their reviewed pin still refuse',t=>{
 if(DRIFTED_PINS.length===0)return t.skip('no pinned path has drifted in this checkout');
 for(const p of DRIFTED_PINS){const f=fixture(t);const head=f.commit(p,currentBytes(p));
  assert.throws(()=>verify({...f.env,GITHUB_SHA:head},f.dir),/DIAGNOSTIC_TEST_SOURCE_PIN_DIFFERS/,p);}
});
for(const p of Object.keys({...TEST_PINS,...INTEGRATION_PINS}))test('changed reviewed source bytes refuse: '+p,t=>{const f=fixture(t),head=f.commit(p,'synthetic unreviewed alteration');assert.throws(()=>verify({...f.env,GITHUB_SHA:head},f.dir),/DIAGNOSTIC_TEST_SOURCE_PIN_DIFFERS/);});

// The v3 integration must remain usable against the unchanged deployed product.
const V3_PROOF_PATHS=[
 "scripts/lib/helperExecutionEvidence.mjs",
 "scripts/lib/sourceContractEvidence.mjs",
 "tests/live/helpers/runOwnedCleanup.ts",
 "tests/live/helpers/rwtHarnessParity.ts",
 "tests/live/helpers/rwtWatchdog.ts",
 "tests/unit/helperExecutionEvidence.test.js",
 "tests/unit/runOwnedCleanupNullCount1593.test.ts",
 "tests/unit/runOwnedCleanupSaveObligations1643.test.ts",
 "tests/unit/rwtHarnessParity.test.ts",
 "tests/unit/rwtRunBoundCleanup.test.ts",
 "tests/unit/rwtSharedAcceptance1811.test.ts",
 "tests/unit/rwtWatchdogAht0215Signals.test.ts",
 "tests/unit/sourceContractEvidence.test.js"
];
test('v3 integration pins include every changed cleanup, watchdog and registry proof input',()=>{for(const p of V3_PROOF_PATHS)assert.ok(Object.hasOwn({...TEST_PINS,...INTEGRATION_PINS},p), 'missing reviewed proof pin: '+p);});
test('an unreviewed sibling of a v3 helper still refuses',t=>{const f=fixture(t),head=f.commit('tests/live/helpers/runOwnedCleanupUnreviewed.ts','unreviewed sibling');assert.throws(()=>verify({...f.env,GITHUB_SHA:head},f.dir),/PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS/);});

test('inherited main proof inputs stay individually pinned',()=>{for(const p of ['product_release/RELEASE_STATUS.md', 'product_release/ROADMAP.md', 'tests/live/rwt-open-mic-first-session.live.spec.ts'])assert.ok(Object.hasOwn(INTEGRATION_PINS,p), p);});

// Exact #1834 integration delta against main 4787338d, materialized with current checkout bytes (hermetic, as above).
// A pinned path whose bytes have drifted since its pin is left out here; its refusal is proven above.
const RUNTIME_DISCOVERY_PATHS=[
 '.github/workflows/rc-gates.yml',
 'scripts/lib/nativeTestExecutionEvidence.mjs',
 'tests/unit/modelComparisonRunAuthority.test.js',
 'tools/cloud-test/scripts/resolve_rwt_served_release.mjs',
 'tools/cloud-test/scripts/validate_rwt_release_binding.cjs',
 'tools/cloud-test/tests/rwt_served_release.test.mjs',
 'tools/cloud-test/tests/rwt_release_binding.test.cjs',
];
test('runtime-discovery integration delta accepts exact registered proof postimages',t=>{
 const f=fixture(t);let head=f.head;
 for(const p of RUNTIME_DISCOVERY_PATHS.filter(q=>!Object.hasOwn(SOURCE_PIN_MAP,q)||matchesPin(q)))head=f.commit(p,currentBytes(p));
 assert.equal(verify({...f.env,GITHUB_SHA:head},f.dir).servedSha,f.release);
 const altered=f.commit('scripts/lib/nativeTestExecutionEvidence.mjs','unreviewed registry alteration');
 assert.throws(()=>verify({...f.env,GITHUB_SHA:altered},f.dir),/DIAGNOSTIC_TEST_SOURCE_PIN_DIFFERS/);
});
test('runtime-discovery does not exempt registry siblings',t=>{
 const f=fixture(t),head=f.commit('scripts/lib/unreviewedNativeRegistry.mjs','unreviewed sibling');
 assert.throws(()=>verify({...f.env,GITHUB_SHA:head},f.dir),/PRODUCT_OR_LIVE_TEST_SOURCE_DIFFERS/);
});
