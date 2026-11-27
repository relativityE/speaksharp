// Native runner observations are execution evidence, never native database or live acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const NATIVE_REPORTER='scripts/lib/nativeTestExecutionEvidence.mjs';
export const PROOF_CASES_TEST='tools/cloud-test/tests/node/proof/harness-fixes-r15.offline.test.cjs';
export const MODEL_PRIVACY_BROWSER_TEST='tests/model-dropin/errorContextPrivacy.node.test.mjs';
export const REAL_BROWSER_TEST='tools/cloud-test/tests/node/proof/real-browser-r15.test.cjs';
export const SQL_CONSUMER='tests/unit/accountCompletionBillingSettlement.test.ts';
export const SQL_INPUTS=Object.freeze([
  'backend/supabase/migrations/20261027192550_account_completion_billing_settlement.sql',
  'tests/db/account-completion-billing-full-chain-invariants.sql',
]);
export const SQL_CONTRACTS=Object.freeze([
  Object.freeze({consumer:SQL_CONSUMER,files:SQL_INPUTS}),
  Object.freeze({consumer:'tests/db/account-coaching-expiry-proposal.integration.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261110173548_account_coaching_local_retirement.sql'])}),
  // #1829 refund follow-up signal: the migration runs in PGlite with Supabase's API roles mirrored.
  Object.freeze({consumer:'tests/unit/stripeRefundFollowups.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261112130000_stripe_refund_followups.sql'])}),
  Object.freeze({consumer:'tests/db/recording-start-abandonment.integration.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql'])}),
  // #1811 feedback fence: the ledger-11 attestation replays the exact migration in PGlite (both catalog contexts); the native
  // PG17 proofs (rwt-feedback-fence-realpg, feedback-fence-postflight-realpg) run in the full-chain proof workflow.
  Object.freeze({consumer:'tests/unit/t2MigrationPostflight.test.js',
    files:Object.freeze(['backend/supabase/migrations/20261114100000_rwt_feedback_fence_1811.sql'])}),
  // #1863 payment wall: the guard suite executes the exact migration over the full PGlite chain and writes its witness;
  // the native database is NOT RUN (no ledger-12 full-chain stage yet).
  Object.freeze({consumer:'tests/db/payment-wall-guards-1863.integration.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261114170000_payment_wall_product_access_1863.sql'])}),
  // #1643 follow-up: the deleted-account save-journal cleanup functions execute over the actual recording/journal chain in PGlite;
  // native lock serialization and the shared live step are the realpg proof in the full-chain proof workflow.
  Object.freeze({consumer:'tests/db/deleted-account-save-journal-cleanup.integration.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261119200000_deleted_account_save_journal_cleanup_1643.sql'])}),
  Object.freeze({consumer:'tests/db/practicePrivacyCurrentChain.integration.test.ts',
    files:Object.freeze([
      'backend/supabase/migrations/20261117105700_practice_privacy_choices_1835.sql',
      'tests/db/fixtures/practice-privacy-choices-1835.sql',
    ])}),
  // #1977: execute the exact migration in PGlite; no live database is involved.
  Object.freeze({consumer:'tests/db/coaching-model-readiness.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261126005433_coaching_model_readiness.sql'])}),
  Object.freeze({consumer:'tests/db/coaching-model-selection-checks.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261127144500_coaching_model_selection_checks.sql'])}),
  // Focus Points partial coverage: the integration suite executes the exact migration over the full PGlite chain, proves the
  // finalize behavior (and its negative cases) as the owning user, and writes its witness. No live database is involved.
  Object.freeze({consumer:'tests/db/objective-evidence-partial-coverage.integration.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261127210000_objective_evidence_partial_coverage.sql'])}),
  // #1827 D2 repeat tip: the catalog gate test executes the exact migration over the shipped PGlite chain and writes its witness;
  // the native database runs in the account-closure full-chain proof workflow (profile main-repeat-tip-134).
  Object.freeze({consumer:'tests/db/repeatTipPostflight.integration.test.ts',
    files:Object.freeze(['backend/supabase/migrations/20261119120000_repeat_practised_tip.sql'])}),
]);
export const sqlContract=file=>SQL_CONTRACTS.find(item=>item.files.includes(file));
export const NATIVE_HELPERS=Object.freeze([
  {file:'tests/db/account-closure-full-chain.mjs',consumer:'tests/db/account-closure-full-chain-main-u1-plan.test.mjs',
    callables:['buildMainU1ReplayPlan','parseMainProofArguments'],claim:'actual planner callables only; Docker replay NOT RUN'},
  {file:'tests/db/t2-native-catalog-proof.mjs',consumer:'tests/db/t2-native-catalog-proof.test.mjs',
    callables:['createNativeT2CatalogProof','record','finish'],claim:'actual observer protocol callables with fake SQL; native database NOT RUN'},
  {file:'tests/db/retention-edited-take-full-chain.mjs',consumer:'tests/db/retention-edited-take-full-chain.test.mjs',
    callables:['observeEditedTakeRace','finalizeEditedTakeProof','createEditedTakePeer'],
    claim:'actual retention controller/oracle and fake-process transport controls only; native DB/Docker replay NOT RUN'},
  {file:'tests/db/content-free-retention-evidence.realpg.mjs',consumer:'tests/db/retention-owner-matrix.test.mjs',
    callables:['assertRetentionOwners','cleanupOwnedRetentionFixture','observeRetentionOwnerRace',
      'ownedRetentionProcessIds','createRetentionLocalPeer','startOwnedRetentionFixture'],
    claim:'actual owner/cleanup/transport protocol guards only; native database NOT RUN'},
  // Node's default type stripping blanks annotations in place, so V8 offsets index the .ts source itself.
  {file:'tests/live/helpers/fixtureAudioStream.ts',consumer:'tests/live/helpers/fixtureAudioStream.node.test.mjs',
    callables:['injectAlignedFixtureAudio','resetFixtureAudioToStart','getFixtureGetUserMediaCalls'],
    claim:'actual harness state-machine callables with fake browser objects in node:vm; browser/audio/model NOT RUN'},
  // A change to the R10 preflight script alone must still run its test, including the spawned CLI entry (run 42059286564).
  {file:'tools/cloud-test/scripts/prerequisite_preflight.cjs',consumer:'tools/cloud-test/tests/prerequisite-preflight.test.cjs',
    callables:['prepare','charge'],claim:'actual preflight callables and script entry with a synthetic fetch; hosted step, credentials and Supabase NOT RUN'},
  // The PO-approved loopback CONNECT egress service (2026-11-08): a change to the script alone must run its controls.
  {file:'tools/cloud-test/scripts/egress_connect_proxy.cjs',consumer:'tools/cloud-test/tests/egress-connect-proxy.test.cjs',
    callables:['createProxy','forbiddenAddress','reviewedPolicy'],
    claim:'actual service callables, the real guard upstreamSocket and the script entry on loopback fixtures; hosted runner and production hosts NOT RUN'},
  // #1760 model comparison runner helpers: the real host-lock barrier, cleanup and launch-ownership code in temporary directories.
  {file:'tests/model-dropin/ownedCleanup.mjs',consumer:'tests/model-dropin/ownedCleanup.node.test.mjs',
    callables:['createCleanupBarrier','awaitOwnedCleanup','launchOwned'],
    claim:'actual cleanup barrier, owned-process cleanup and launch-ownership callables with real child processes; browser and live run NOT RUN'},
  {file:'tests/model-dropin/identityExclusion.mjs',consumer:'tests/model-dropin/identityExclusion.node.test.mjs',
    callables:['assertNotMaintainedIdentity'],claim:'actual maintained-identity refusal with synthetic identifiers; credentials and accounts NOT RUN'},
  // Bounded Supabase CLI installer for the disposable database-proof workflow: stall, retry, digest and version controls
  // against a local fake release server.
  {file:'scripts/ci/install-supabase-cli.mjs',consumer:'tests/unit/installSupabaseCli.test.mjs',
    callables:['installSupabaseCli','downloadOnce'],
    claim:'actual installer callables against a local fake release server; the real GitHub release download and hosted runner NOT RUN'},
  {file:'tools/cloud-test/scripts/resolve_rwt_served_release.mjs',consumer:'tools/cloud-test/tests/rwt_served_release.test.mjs',
    callables:['resolveRwtServedRelease','verifyRwtServedRelease'],
    claim:'actual runtime release identity and compatibility guards with mocked production responses and synthetic Git; deployment and live writes NOT RUN'},
  // #1906 restart and recovery proofs: the runner is spawned as fresh child processes (coverage inherited through the environment).
  {file:'tests/db/save-journal-restart-runner.mjs',consumer:'tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs',
    callables:['createPsqlAdmin','runTeardown','runRecovery','tampered'],
    claim:'actual runner processes (shared teardown and governed recovery entry points) against an owned disposable PostgreSQL; hosted database, GitHub and live runs NOT RUN'},
]);
const fail=message=>{throw new Error(message);};
function regular(root,file) {
  if(typeof file!=='string'||path.isAbsolute(file)||file.includes('\\')||path.posix.normalize(file)!==file||file.startsWith('../'))fail('Invalid native evidence path');
  const target=path.join(root,file);
  if(!fs.lstatSync(target).isFile()||fs.realpathSync(target)!==target)fail('Aliased native evidence source');
  return target;
}
export const nativeHelper=file=>NATIVE_HELPERS.find(item=>item.file===file);
// #1937 (Sam, option A): the real billing qualification suite runs natively under its own pinned profile.
// Its config and lock are pinned by digest, so a changed or added dependency needs review and re-pinning;
// every import resolves only through that frozen lock; the test may read only the checked-in SQL that its
// ephemeral PGlite applies and the locked PGlite package's own data in the owned cache; environment,
// network, writes and subprocesses stay denied. The import cache is prepared first, by the no-run warmup.
export const BILLING_DENO_PROFILE=Object.freeze({
  id:'billing-qualification-1937',
  config:'scripts/billing-qualification/deno.json',configSha256:'f9e269d53f538e5f4377dd463b4acf4baeb11b81bb528a872b831d9e9f791c08',
  lock:'scripts/billing-qualification/deno.lock',lockSha256:'a9c3c91a7172c2a2852c9ef0a9ec07fdc7fd66b35204865c232a3463b62f3b45',
  sqlReads:Object.freeze([
  'tests/db/webhook-lifecycle-bootstrap.sql',
  'tests/db/trial-lifecycle-bootstrap.sql',
  'backend/supabase/migrations/20260521100000_auto_trial_entitlements.sql',
  'backend/supabase/migrations/20260812002000_webhook_lifecycle_completeness_1282.sql',
  'backend/supabase/migrations/20260812039500_webhook_duplicate_snapshot_convergence_1282.sql',
  'backend/supabase/migrations/20260812040000_thirty_day_trial_lifecycle_1282.sql',
  'backend/supabase/migrations/20260812041000_trial_expiry_fail_closed_1282.sql',
  'backend/supabase/migrations/20260812041500_flawless_launch_runtime_convergence_1290.sql',
  'backend/supabase/migrations/20260812041600_trial_commercial_grant_on_conflict_1294.sql',
  'backend/supabase/migrations/20261013180000_account_closure_tokens.sql',
  ]),
  // PGlite loads its own WASM data from its package directory. The version is the one the pinned lock resolves.
  packageReads:Object.freeze(['.native-deno-cache/npm/registry.npmjs.org/@electric-sql/pglite/0.5.5']),
});
export const isBillingDenoTest=file=>typeof file==='string'&&/^scripts\/billing-qualification\/[^/]+\.test\.ts$/.test(file);
const FUNCTIONS_DENO=Object.freeze({config:'backend/supabase/functions/deno.json',lock:'backend/supabase/functions/deno.lock'});
const denoConfig=file=>isBillingDenoTest(file)?BILLING_DENO_PROFILE:FUNCTIONS_DENO;
const lockKey=specifier=>{
  const npm=/^npm:(@[^/@]+\/[^/@]+|[^/@]+)(?:@([^/]+))?(?:\/.*)?$/.exec(specifier);
  return npm?`npm:${npm[1]}@${npm[2]??'*'}`:specifier;
};
// Static closure of the billing test: every local import is followed; every other import must be a node:
// builtin or an entry the pinned lock already resolves. A computed import cannot be checked and is refused.
export function billingImportClosure(root,file) {
  const require=createRequire(path.join(root,'package.json')),ts=require('typescript');
  const local=new Set(),external=new Set(),queue=[file];
  while(queue.length) {
    const entry=queue.shift();
    if(local.has(entry))continue;
    local.add(entry);
    const source=ts.createSourceFile(entry,fs.readFileSync(regular(root,entry),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    if(source.parseDiagnostics.length)fail(`Invalid billing qualification source: ${entry}`);
    const visit=node=>{
      let specifier=null;
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)specifier=node.moduleSpecifier;
      else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword) {
        specifier=node.arguments[0];
        if(node.arguments.length!==1||!ts.isStringLiteral(specifier))fail(`Computed billing qualification import: ${entry}`);
      }
      if(specifier) {
        const text=specifier.text;
        if(text.startsWith('./')||text.startsWith('../')) {
          const target=path.posix.normalize(path.posix.join(path.posix.dirname(entry),text));
          if(target.startsWith('../'))fail(`Billing qualification import escapes checkout: ${entry}: ${text}`);
          queue.push(target);
        } else external.add(text);
      }
      ts.forEachChild(node,visit);
    };visit(source);
  }
  return {local:[...local].sort(),external:[...external].sort()};
}
export function nativeDependencyPin(root,file) {
  if(!isBillingDenoTest(file))return null;
  const profile=BILLING_DENO_PROFILE,digest=entry=>hash(fs.readFileSync(regular(root,entry)));
  if(digest(profile.config)!==profile.configSha256||digest(profile.lock)!==profile.lockSha256)
    fail('Billing qualification Deno config/lock is not the pinned profile');
  const lock=JSON.parse(fs.readFileSync(regular(root,profile.lock),'utf8'));
  const resolved=new Set([...Object.keys(lock.specifiers??{}),...Object.keys(lock.remote??{})]);
  const closure=billingImportClosure(root,file);
  for(const specifier of closure.external)
    if(!/^node:[a-z_/]+$/.test(specifier)&&!resolved.has(lockKey(specifier)))fail(`Unpinned billing qualification import: ${specifier}`);
  return {profile:profile.id,configSha256:profile.configSha256,lockSha256:profile.lockSha256,
    imports:closure.external,reads:profile.sqlReads.map(entry=>({file:entry,sha256:digest(entry)}))};
}
export function nativeTestRoute(file,root) {
  const helper=nativeHelper(file);
  if(helper)return {runner:'node-test-helper',consumer:helper.consumer,claim:helper.claim};
  if(sqlContract(file))return {runner:'vitest-sql',consumer:sqlContract(file).consumer,claim:'actual SQL consumed in PGlite fixture; native database NOT RUN'};
  if(file==='tests/db/account-coaching-local-fence.realpg.mjs'&&fs.existsSync(path.join(root,file))
    &&/\bfrom\s+['"]node:test['"]/.test(fs.readFileSync(regular(root,file),'utf8')))return {runner:'node-test',consumer:file};
  if(/^backend\/supabase\/functions\/.*(?:\.test|_test)\.ts$/.test(file))return {runner:'deno',consumer:file};
  if(isBillingDenoTest(file))return {runner:'deno',consumer:file};
  if(/\.test\.mjs$/.test(file)&&fs.existsSync(path.join(root,file))&&/\bfrom\s+['"]node:test['"]/.test(fs.readFileSync(regular(root,file),'utf8')))return {runner:'node-test',consumer:file};
  // The reviewed cloud-test package only: its CommonJS controls run under node:test. A .cjs that never
  // requires node:test has no runner and stays UNCOVERED rather than being credited by its filename.
  if(/^tools\/cloud-test\/.*\.test\.cjs$/.test(file)&&fs.existsSync(path.join(root,file))
    &&/\brequire\(\s*['"]node:test['"]\s*\)/.test(fs.readFileSync(regular(root,file),'utf8')))return {runner:'node-test',consumer:file};
  return null;
}
export const NATIVE_BATCH_SIZE=8,NATIVE_MAX_BATCHES=8;
// One producer invocation executes one batch. The consumer recomputes the whole selection and requires
// every batch exactly once, so a missing, extra, duplicated or moved contract cannot be credited.
const contractKey=item=>[item.testFile,item.helperFile??null,item.fixtureFile??null,item.sourceFiles??null,
  item.sqlFiles??null,item.consumerExecution??null];
export function executionSelectionDigest(contracts) {
  return hash(JSON.stringify(contracts.map(item=>[...contractKey(item),item.batch])));
}
export function executionBatchIdentity(contracts,index) {
  return {index,count:Math.ceil(contracts.length/NATIVE_BATCH_SIZE),size:NATIVE_BATCH_SIZE,selectionSha256:executionSelectionDigest(contracts)};
}
export function reconcileExecutionBatches(receipts,contracts,lane) {
  const count=Math.ceil(contracts.length/NATIVE_BATCH_SIZE);
  if(!Array.isArray(receipts)||receipts.length!==Math.max(count,1))fail(`Wrong ${lane} execution batch inventory`);
  receipts.forEach((receipt,index)=>{
    if(JSON.stringify(receipt?.batch)!==JSON.stringify(executionBatchIdentity(contracts,index)))fail(`Wrong ${lane} execution batch identity`);
    const expected=contracts.filter(item=>item.batch===index).map(contractKey);
    const actual=(Array.isArray(receipt.tests)?receipt.tests:[]).map(contractKey);
    if(expected.length>NATIVE_BATCH_SIZE||JSON.stringify(actual)!==JSON.stringify(expected))
      fail(`Missing, extra or duplicate ${lane} contracts in batch ${index}`);
  });
}
export function selectNativeContracts(root,files) {
  const tests=new Map();
  for(const file of files) {
    const route=nativeTestRoute(file,root);
    if(!['node-test','node-test-helper','deno'].includes(route?.runner))continue;
    const value=tests.get(route.consumer)??{testFile:route.consumer,runner:route.runner==='deno'?'deno':'node-test',helpers:[]};
    if(route.runner==='node-test-helper')value.helpers.push(file);
    tests.set(route.consumer,value);
  }
  const contracts=[...tests.values()].sort((a,b)=>a.testFile.localeCompare(b.testFile));
  // Each batch keeps the eight-file budget; the fixed ceiling refuses an unbounded selection rather than dropping files.
  if(contracts.length>NATIVE_BATCH_SIZE*NATIVE_MAX_BATCHES)
    fail(`NOT RUN: native execution exceeds ${NATIVE_MAX_BATCHES} batches of ${NATIVE_BATCH_SIZE} files`);
  return contracts.map((contract,n)=>({...contract,batch:Math.floor(n/NATIVE_BATCH_SIZE)}));
}
function binary(name) {
  for(const directory of (process.env.PATH??'').split(path.delimiter)) {
    if(!path.isAbsolute(directory))continue;
    const target=path.join(directory,name);
    try{fs.accessSync(target,fs.constants.X_OK);return fs.realpathSync(target);}catch{/* Installed executables only. */}
  }
  fail(`NOT RUN: installed ${name} runtime unavailable`);
}
function xmlRuntime(root) {
  const require=createRequire(path.join(root,'node_modules/jsdom/package.json'));
  const entry=require.resolve('saxes'),packageFile=require.resolve('saxes/package.json');
  return {entry,version:JSON.parse(fs.readFileSync(packageFile,'utf8')).version,
    entrySha256:hash(fs.readFileSync(entry)),packageSha256:hash(fs.readFileSync(packageFile))};
}
const PYTHON_RECEIPT_CONFORMANCE_TEST='tests/unit/pythonTestExecutionEvidence.test.mjs';
function nativePythonFixtureBinding(contract) {
  if(contract.testFile!==PYTHON_RECEIPT_CONFORMANCE_TEST)return null;
  // Bind the parent runner's installed Python, not the fallback found after
  // the nested Node test correctly switches to its scrubbed environment.
  const launcher=binary('python3');
  const probe=spawnSync(launcher,['-I','-B','-c',
    'import json,pathlib,sys; print(json.dumps({"execPath":str(pathlib.Path(sys.executable).resolve()),"version":".".join(map(str,sys.version_info[:3]))}))'],
    {encoding:'utf8',timeout:5000,env:{PATH:path.dirname(launcher),LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}});
  let observed;
  try { observed=JSON.parse(probe.stdout); } catch { fail('NOT RUN: bound Python fixture runtime unavailable'); }
  if(probe.status!==0||probe.signal||probe.error||!/^3\.12\.\d+$/.test(observed?.version??'')
    ||!path.isAbsolute(observed?.execPath??'')||fs.realpathSync(observed.execPath)!==observed.execPath)
    fail('NOT RUN: bound Python fixture requires an exact installed Python 3.12');
  return {...observed,sha256:hash(fs.readFileSync(observed.execPath))};
}
export function nativeRuntime(root,runner) {
  const execPath=runner==='deno'?binary('deno'):fs.realpathSync(process.execPath);
  const version=runner==='deno'?spawnSync(execPath,['--version'],{encoding:'utf8',timeout:5000,env:{PATH:path.dirname(execPath)}}):null;
  if(version&&(version.status!==0||version.signal||version.error))fail('NOT RUN: Deno runtime identity unavailable');
  return {runner,execPath,executableSha256:hash(fs.readFileSync(execPath)),version:version?version.stdout.trim():process.version,
    platform:process.platform,arch:process.arch,reporterSha256:hash(fs.readFileSync(regular(root,NATIVE_REPORTER))),
    ...(runner==='deno'?{configSha256:hash(fs.readFileSync(regular(root,'backend/supabase/functions/deno.json'))),
      lockSha256:hash(fs.readFileSync(regular(root,'backend/supabase/functions/deno.lock'))),xml:xmlRuntime(root)}:{})};
}
export function nativeCommand(binding) {
  const file=binding.testFile;
  const typedHelper=NATIVE_HELPERS.some(item=>item.consumer===file&&item.file.endsWith('.ts')
    &&Array.isArray(binding.helpers)&&binding.helpers.includes(item.file));
  const policy=binding.runtime.runner==='deno'?nativeDenoPolicy(file):null,config=denoConfig(file);
  return binding.runtime.runner==='deno'
    ?[binding.runtime.execPath,'test','--config',config.config,'--cached-only','--frozen',
      `--lock=${config.lock}`,'--node-modules-dir=none','--no-prompt','--deny-net',
      ...(policy.environment.names.length?[`--allow-env=${policy.environment.names.join(',')}`]:['--deny-env']),
      ...(policy.read==='denied'?['--deny-read']:[`--allow-read=${policy.read.allow.join(',')}`]),'--deny-write','--deny-run',
      '--reporter=junit',file]
    :[binding.runtime.execPath,...(typedHelper?['--experimental-strip-types']:[]),
      '--test','--test-concurrency=1',`--test-reporter=./${NATIVE_REPORTER}`,file];
}
export function nativeWarmupCommand(binding) {
  if(binding.runtime.runner!=='deno')fail('Only Deno has an import warmup');
  return nativeCommand(binding).map(arg=>arg.startsWith('--allow-env=')?'--deny-env':arg.startsWith('--allow-read=')?'--deny-read':arg)
    .filter(arg=>arg!=='--cached-only').toSpliced(2,0,'--no-run');
}
// Checkout reads this name at import time. The rebuilt child environment never
// supplies its value; permission only lets the module observe absence. Network,
// files, child processes and all other environment names remain denied.
const checkoutTest='backend/supabase/functions/stripe-checkout/index.test.ts';
export const COACHING_EDGE_TEST='backend/supabase/functions/get-ai-suggestions/index.test.ts';
export const COACHING_EDGE_CONSENT_CASE='#1905 saved Open Mic and Focus coaching honor owner consent at send and persist';
const COACHING_EFFICACY_PROFILE='coaching-consent-efficacy-1905';
const COACHING_READINESS_EFFICACY_PROFILE='coaching-readiness-efficacy-1977';
const COACHING_BACKOFF_EFFICACY_PROFILE='coaching-readiness-backoff-1986';
const COACHING_NEVER_BLOCKS_PROFILE='coaching-readiness-never-blocks';
export const COACHING_QUALITY_TEST='backend/supabase/functions/get-ai-suggestions/evaluation/coachingBotChecks.test.ts';
const COACHING_WRONG_TAKE_CASE='#1905 wrong-take coaching fails when only one advice section is cross-wired';
const coachingTest=COACHING_EDGE_TEST;
const coachingClosure=Object.freeze({
  'backend/supabase/functions/_shared/cors.ts':'74ab664c710d733534d8e0af433b0c4c48110a2dec1d5436f04f55147225e608',
  'backend/supabase/functions/deno.json':'6e88bc8b0df10b78fb39e1c26492164a351f350d6d4046eca09df4ebebd681a0',
  'backend/supabase/functions/deno.lock':'fdb2c5763d857063bde2fd3560f3f23c35bb11da5843ca2649cd961992c7bfdb',
  'backend/supabase/functions/get-ai-suggestions/index.ts':'21ff4bb8060852777f91d75cb25f19db6495a10ba3c78ee5f03c0906c3ef9448',
  'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'b4f98578977e13d9359bc843a4c286d37f530af49c3f208237317dbfb9f75f30',
  'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'5f5fd7ad5c3e727a801b443429d1d967bfdf97677b497f9a64fd48f689b39fa5',
  'package.json':'0363d0291c1725f9acce27578099a48195e463efd8def276a1282c72597d48c9',
  'pnpm-lock.yaml':'847997ce69bb4fe97c27eafd0ca40c1021fef6ac32adbe4be240a56be3867b55',
});
// Deliberately closed profiles: source changes require explicit re-pinning and review.
// Runtime/config/lock and every local import are included, so aliases/imported
// setters cannot escape a syntax-only check by retaining the expected literal calls.
const coachingProfiles=Object.freeze([
  {id:'main-67d82',files:{...coachingClosure,
    [coachingTest]:'895c8d6c4e92824b8f283b9f178d9781cc6ddecf21527fb597f6f2cd7e857c00',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'2cc6f3988b2dd7abd2efd978cfd3c052325a8b8a044c829a5cdc297c5c9a70e3'}},
  {id:'low-thinking-013101',files:{...coachingClosure,
    [coachingTest]:'658d118f7e82bed32f34f5d20d5d52196b1265eaefb8c64ded6da756d6625042',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2'}},
  {id:'coaching-errors-cors-compatible',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/index.ts':'9da0672ed3c81dd86ff8624565f03b13004e493456965b42a28ad60231f1216b',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'b27cc9bf1b50d4d584528ec31a13270c90c3f9a12c97eec431e7ef1abc392150',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2'}},
  // #1773: the provider call moved behind providers/ (descriptor catalogue, Gemini adapter family, registry), so the handler's local
  // import closure now includes those four modules; the test, decoder, retry and contract bytes are unchanged.
  {id:'coaching-provider-adapter-1773',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/index.ts':'6216addf51bbf99e4c961f79b2ebbe9eba4d24bd4527a311c71c3fff747be877',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'3adb7f8da23d2a00ace89da534fe93c146e647e3c383dde374a0a565b1495882',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb'}},
  // LLM evaluator parity: the coaching test also runs the handler on each Open Mic take of the committed synthetic evaluation set and
  // requires the exact evaluator prompt, so its closure adds the prompt module and that set. Handler, decoder, retry, contract and
  // provider bytes are unchanged from #1773; the key policy (set 'test-key', delete) is unchanged.
  {id:'coaching-llm-evaluator-parity',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/index.ts':'6216addf51bbf99e4c961f79b2ebbe9eba4d24bd4527a311c71c3fff747be877',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'f7a86245794090b3b85d48aa6166fee1af6eee6c5840cefb6e1fa173a4a97995',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1760 after #1792: the LLM evaluator parity closure, with #1760's package.json (its model:import / model:stage-adoption
  // scripts). Every other pin is exactly coaching-llm-evaluator-parity's.
  {id:'coaching-llm-evaluator-parity-model-scripts-1760',files:{...coachingClosure,
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'6216addf51bbf99e4c961f79b2ebbe9eba4d24bd4527a311c71c3fff747be877',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'f7a86245794090b3b85d48aa6166fee1af6eee6c5840cefb6e1fa173a4a97995',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1802: 35 s attempt cap within the unchanged 45 s total provider budget; deterministic handler controls.
  {id:'coaching-attempt-35s-1802',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'dff7b40f6755d96f3fb22bcfa739d8fd5214d99e5c402d49a9cabd1a43b6d30f',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'6216addf51bbf99e4c961f79b2ebbe9eba4d24bd4527a311c71c3fff747be877',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'520b6c61f6640aac7f79cd1b82eddbee115790fcb56b1ca4073c3545046403da',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1643: reviewed local retirement handler and tests; all other import/config pins remain unchanged.
  {id:'coaching-local-retirement-1643',files:{...coachingClosure,
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'a0d5d30397c08440831f1d25022754886bc16cce75e76309014c435a9096196e',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'09e7282279210d5dbedb0cb4c49711cdb4f43cc619d34cb489390f0d1d80ff15',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'7398a3f7910eaab3d76ee2639989851a59c2b5a95996d99a726108ac33eec4e2',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // Coaching model back to gemini-3.6-flash (3.8 answers 503 "high demand"): only the contract's model and the test's pinned
  // model literals change. Every other pin is exactly coaching-local-retirement-1643's; key policy unchanged.
  {id:'coaching-model-gemini-3-6-flash',files:{...coachingClosure,
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'a0d5d30397c08440831f1d25022754886bc16cce75e76309014c435a9096196e',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'6ccd7e9a387aced2745b291ba2ee6dab54feea0196975a0d3d0b36d22e8ccbfc',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1802 revision: 15 s attempt cap on top of the 3.6-flash contract and #1643 handler (main fbd164cd); preserve the historical 35 s profile and all permissions.
  {id:'coaching-attempt-15s-1802',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'eda8685f3f005e3cb774c54cadf8a04e43bb483d68c7a31130fd268b06ff7820',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'a0d5d30397c08440831f1d25022754886bc16cce75e76309014c435a9096196e',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'5b7fc6eddc9e179dc45f478369b2c322ceee199a95c4d8445cc0edeb5c5147be',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1863 payment wall: a saved coaching pair is replayed only after the same check_usage_limit entitlement as new analysis
  // (expired unpaid: 403 payment_required; unverifiable: 503). Only the handler and its test change; every other pin is 15s-1802's.
  {id:'coaching-payment-wall-1863',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'eda8685f3f005e3cb774c54cadf8a04e43bb483d68c7a31130fd268b06ff7820',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'2d1dee328adeef474a8409c58471f2d1040420bdb6d829bda80e6f1917ad0e05',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'a7a0112484f4c673b8b9486859b0f7a1b7f51c7e003e366498a6c4ead7da3be3',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1816 bot checks: C9 first-try latency and C10 truthful failure + Retry run the real handler, so they need the synthetic
  // key and live in this one admitted test (no second file is granted the key). Only the test changes; every other pin
  // is exactly coaching-payment-wall-1863's, and the key policy (set 'test-key', delete) is unchanged.
  {id:'coaching-bot-checks-1816',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'eda8685f3f005e3cb774c54cadf8a04e43bb483d68c7a31130fd268b06ff7820',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'2d1dee328adeef474a8409c58471f2d1040420bdb6d829bda80e6f1917ad0e05',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    [coachingTest]:'c29ed23fd62bae07c1a9a31c28bb533a49993f80ffa4861d46cca6c654ae2859',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1835 on top of #1893: combined privacy and coaching controls in the same admitted test. No permission-policy change.
  {id:'coaching-practice-privacy-1835',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'eda8685f3f005e3cb774c54cadf8a04e43bb483d68c7a31130fd268b06ff7820',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'94ab7590ee5b680e7b1ca791149c884363fbbf88452744c5dc0284be4256fa4d',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    'backend/supabase/functions/get-ai-suggestions/practicePrivacy.ts':'525f36728d57c98ef03261acabb343c55a3a327319c585cf70df80cc76108015',
    [coachingTest]:'8a7afbea0ce33f8fd751041aca8b71691cf5705e792829acfad4e7385940e972',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1899 on top of #1835: the handler rechecks product access before saving coaching (Codex Security P3 r4622877344), and the
  // same admitted test proves it. Only index.ts and the test change; the permission policy is unchanged.
  {id:'coaching-persist-entitlement-1899',files:{...coachingClosure,
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'eda8685f3f005e3cb774c54cadf8a04e43bb483d68c7a31130fd268b06ff7820',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'dd8520de14cc59b630fa8bde4954857650fa259171dc46d729c448ae1cded86d',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    'backend/supabase/functions/get-ai-suggestions/practicePrivacy.ts':'525f36728d57c98ef03261acabb343c55a3a327319c585cf70df80cc76108015',
    [coachingTest]:'97106a06dab78781c00392de92559b32ef6e95b9f96698fdece51ba59b7aa49c',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'dac0b17ee31b82dcbeaf01b7496013e093246843af56bb7382ae5d40f6f3f963',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'f401085b1542bc07b514f793e1b557886ab11f72442313e8c85d89823999d0cb',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a'}},
  // #1977: exact runtime, config and local import closure. The native permission policy is unchanged.
  {id:COACHING_READINESS_EFFICACY_PROFILE,files:{
    'backend/supabase/functions/_shared/cors.ts':'74ab664c710d733534d8e0af433b0c4c48110a2dec1d5436f04f55147225e608',
    'backend/supabase/functions/deno.json':'6e88bc8b0df10b78fb39e1c26492164a351f350d6d4046eca09df4ebebd681a0',
    'backend/supabase/functions/deno.lock':'fdb2c5763d857063bde2fd3560f3f23c35bb11da5843ca2649cd961992c7bfdb',
    'backend/supabase/functions/get-ai-suggestions/contract.json':'70c3099769cf24ac4faf3b4c191e322e50a0f1b34228a3aa72199a8f06adbe1b',
    'backend/supabase/functions/get-ai-suggestions/evaluation/evaluator.ts':'6cc2300713d3393cca7c8c026418214fe5a073c297c48cf5b08c8b8d75470074',
    'backend/supabase/functions/get-ai-suggestions/evaluation/prompt.ts':'16d40c6b1500b535bf45e0d1d07699ab509f68879c39586cf8ebd4363c7f92ee',
    'backend/supabase/functions/get-ai-suggestions/evaluation/transcripts.json':'a4db4fdac8c4e2bd6c113d83c87ed458eac6197d99b1ccc747822bfad52b9a1a',
    'backend/supabase/functions/get-ai-suggestions/index.test.ts':'1dd9896f9ded01f6cdec5459f05ba4cd0f8ebf5b247492f63b3353e80516ec4d',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'45d161bca9e994d0910c22592a230b0ecacd3697e513bb81a8cbe6db76dee3c1',
    'backend/supabase/functions/get-ai-suggestions/modelReadback.ts':'c51e7517265dddb5e30f8e25f85814c21bcee751d5741a3a71c9d7022ce3e9c6',
    'backend/supabase/functions/get-ai-suggestions/modelReadiness.ts':'242aed9faf2c95b6da37650272f9e38bffa066a22b43329c44bc19a6fc3d0a94',
    'backend/supabase/functions/get-ai-suggestions/modelReadinessStore.ts':'78c49dbbe42d123234eae38092f9cce887900a2f6d095706b4dfa30304bb15d1',
    'backend/supabase/functions/get-ai-suggestions/practicePrivacy.ts':'525f36728d57c98ef03261acabb343c55a3a327319c585cf70df80cc76108015',
    'backend/supabase/functions/get-ai-suggestions/providerDecode.ts':'ecc8034bd53bd6b3b88dcbb981a6bf29be8c85d08cd031d0483e2d083e10d2a2',
    'backend/supabase/functions/get-ai-suggestions/providerRetry.ts':'eda8685f3f005e3cb774c54cadf8a04e43bb483d68c7a31130fd268b06ff7820',
    'backend/supabase/functions/get-ai-suggestions/providers/catalog.ts':'59d4a83989239a71085415d9fc3eaa8b3145786db085c8de8abe35cd052eaac1',
    'backend/supabase/functions/get-ai-suggestions/providers/gemini.ts':'fe32c21fa3b35a549813234447f2b19358f8dbd670c5c161fec4ce58427495f1',
    'backend/supabase/functions/get-ai-suggestions/providers/registry.ts':'e5744505a502ecc525a3604dfa8fa687a03dc18a33b9ef9aa9080d4df12571f7',
    'backend/supabase/functions/get-ai-suggestions/providers/types.ts':'ac6303cb3299b142f825be09d9b18ec3d1b3b71f79cfb0982ede8d1af09ad85a',
    'backend/supabase/functions/get-ai-suggestions/readinessQuota.ts':'8cebc384f62221aa5fcdaadbc2d3cc88233a51fdbc4c2e6eb4a59ac7c2a51b8f',
    'package.json':'afaad509e196b4cf0d784a55b47d3f17e51409dcd91d9d7f6a2e341b175eb0ed',
    'pnpm-lock.yaml':'847997ce69bb4fe97c27eafd0ca40c1021fef6ac32adbe4be240a56be3867b55',
  }},
]);
// #1905 adds assertions only. The authority, permission envelope and every import remain pinned.
const coachingEfficacyProfiles=coachingProfiles.filter(item=>item.id==='coaching-persist-entitlement-1899').map(item=>({
  id:COACHING_EFFICACY_PROFILE,files:{...item.files,
    [coachingTest]:'765e7041f7abdbd80790f0ca34cf4f71d7ccffe078a62ae3befdc7c0e0a91449',
  },
}));
// #1986 updates only these five exact files in the reviewed readiness closure.
// The required saved-coaching consent proof and all native permissions stay unchanged.
const coachingBackoffProfiles=coachingProfiles.filter(item=>item.id===COACHING_READINESS_EFFICACY_PROFILE).map(item=>({
  id:COACHING_BACKOFF_EFFICACY_PROFILE,files:{...item.files,
    'backend/supabase/functions/get-ai-suggestions/index.test.ts':'9116c3a671ea720ae93b85af856cc1c96553de75cd83c0873f319a5d82c64720',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'5f29ab52312e42796f528b17ffc72d2daf73fbd4076aa34dc73ee76de5d9682a',
    'backend/supabase/functions/get-ai-suggestions/modelReadback.ts':'95553bad7ef68502db10ff4d5a6333557069b133d9ba3b2fc3a8ded55c78a3e3',
    'backend/supabase/functions/get-ai-suggestions/modelReadiness.ts':'837664c6f1080fc3b89f02ddaaf109211d56bd941a08af9e18ac927197b004b0',
    'backend/supabase/functions/get-ai-suggestions/modelReadinessStore.ts':'3379ffcb9116fe3c10cd1b16509561ee1048404f1961043cb85b9df0c67f139b',
  },
}));
// PO 11-27: a readiness check never refuses coaching; one coaching test per candidate; a model-scoped hint is never shared.
// Pins the current handler, readiness and readback beside the existing consent proof and unchanged native permissions.
const coachingNeverBlocksProfiles=coachingBackoffProfiles.map(item=>({
  id:COACHING_NEVER_BLOCKS_PROFILE,files:{...item.files,
    'backend/supabase/functions/get-ai-suggestions/index.test.ts':'59873abd8fb3a5b840cd0dcb6a6626f7becce3d87a6ef406c04ccc41d274949b',
    'backend/supabase/functions/get-ai-suggestions/index.ts':'bf267e708a0311a60e9d06779134e5ac604087ae6d76c29d2fb03ea4ab8be932',
    'backend/supabase/functions/get-ai-suggestions/modelReadiness.ts':'fe71c8541439876c067cd710d8de1bd1af8daba80a6ed4675ca8df46accba08b',
    'backend/supabase/functions/get-ai-suggestions/modelReadinessStore.ts':'1751ea1a5e7211a5108e73603df4884df0b4f9d9cbfd92721dbc2cf8433aef6b',
    'backend/supabase/functions/get-ai-suggestions/modelReadback.ts':'7f7b168ffb3c4763d557374171a782bd480482ee7170f667f137d3cbb084d60b',
  },
}));
// Pins the exact timeout fallback and request-cancellation wiring with the same synthetic-key permissions.
const coachingTimeoutFallbackProfiles=coachingNeverBlocksProfiles.map(item=>({
  id:'coaching-readiness-timeout-fallback',files:{...item.files,
    'backend/supabase/functions/get-ai-suggestions/index.ts':'bc66dafa576fb488d5629de643625467029a540ff599caee4a71e3dcdb5ab64d',
    'backend/supabase/functions/get-ai-suggestions/modelReadiness.ts':'bd6376ce87b970b159f12e9cf481b5a5f3f87a82c1398218bebe1a5ff508ae74',
  },
}));
export function nativeDenoPolicy(file) {
  const billing=isBillingDenoTest(file);
  return {schemaVersion:1,testFile:file,environment:{names:file===coachingTest?['GEMINI_API_KEY']:file===checkoutTest?['STRIPE_SECRET_KEY']:[],
    initial:'absent',inherit:false,syntheticValue:file===coachingTest?'test-key':null,reinject:false},
    network:'denied',read:billing?{allow:[...BILLING_DENO_PROFILE.sqlReads,...BILLING_DENO_PROFILE.packageReads]}:'denied',
    write:'denied',run:'denied',prompt:'denied',warmupEnvironment:'denied',
    ...(billing?{profile:BILLING_DENO_PROFILE.id,config:BILLING_DENO_PROFILE.config,lock:BILLING_DENO_PROFILE.lock}:{})};
}
export function validateSyntheticSource(root,file) {
  if(file!==coachingTest)return null;
  const profile=[...coachingProfiles,...coachingEfficacyProfiles,...coachingBackoffProfiles,...coachingNeverBlocksProfiles,...coachingTimeoutFallbackProfiles].find(candidate=>{
    try{return Object.entries(candidate.files).every(([entry,digest])=>hash(fs.readFileSync(regular(root,entry)))===digest);}
    catch{return false;}
  });
  if(!profile)fail('Synthetic-key test/import profile is not admitted');
  const require=createRequire(path.join(root,'package.json')),ts=require('typescript');
  const source=ts.createSourceFile(file,fs.readFileSync(regular(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if(source.parseDiagnostics.length)fail('Invalid synthetic-key test source');
  const operations=[];
  const visit=node=>{
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
      &&node.expression.expression.getText(source)==='Deno.env') {
      const operation=node.expression.name.text,args=node.arguments;
      if(!['get','set','delete'].includes(operation)||!ts.isStringLiteral(args[0])||args[0].text!=='GEMINI_API_KEY'
        ||args.length!==(operation==='set'?2:1)
        ||(operation==='set'&&(!ts.isStringLiteral(args[1])||args[1].text!=='test-key')))fail('Synthetic-key source policy violation');
      operations.push(operation);
    }
    ts.forEachChild(node,visit);
  };visit(source);
  if(!operations.includes('set')||!operations.includes('delete'))fail('Synthetic-key initialization/reset absent');
  return {id:profile.id,files:{...profile.files}};
}
export function nativeEnvironment(cwd,environment) {
  // Rebuild from a fixed allowlist even when a caller supplies an inherited secret.
  if(environment?.DENO_DIR)fail('Unowned inherited Deno cache');
  const home=path.join(cwd,'.native-home'),temporary=path.join(cwd,'.native-tmp');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(temporary,{recursive:true});
  return {PATH:[path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter),HOME:home,USERPROFILE:home,
    TMPDIR:temporary,TMP:temporary,TEMP:temporary,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',CI:'true',NODE_ENV:'test'};
}
export function nativeBrowserBinding(contract,environment) {
  if(![REAL_BROWSER_TEST,MODEL_PRIVACY_BROWSER_TEST].includes(contract.testFile))return null;
  const file=environment?.CT_CHROME;
  try {
    if(typeof file!=='string'||!path.isAbsolute(file)||fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())throw new Error();
    fs.accessSync(file,fs.constants.X_OK);
  } catch {fail('NOT RUN: bound CT_CHROME is required for the real-browser proof');}
  return {path:file,sha256:hash(fs.readFileSync(file))};
}
function proofCasesInventory(directory,label='proof-cases') {
  if(typeof directory!=='string'||!path.isAbsolute(directory))fail(`NOT RUN: ${label} directory is required`);
  const real=fs.realpathSync(directory),cases=path.join(real,'cases');
  if(real!==directory||!fs.statSync(real).isDirectory()||fs.realpathSync(cases)!==cases)fail('Aliased proof-cases directory');
  const expected=Array.from({length:15},(_,n)=>`AHT-${String(n+1).padStart(2,'0')}.json`);
  const actual=fs.readdirSync(cases).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail('Proof-cases inventory is incomplete or unexpected');
  return {directory:real,files:expected.map(name=>{
    const file=path.join(cases,name),stat=fs.lstatSync(file);
    if(!stat.isFile()||fs.realpathSync(file)!==file)fail('Aliased proof-case input');
    return {name,sha256:hash(fs.readFileSync(file))};
  })};
}
function proofGenerationSources(root) {
  const entries=[];
  const add=(relative)=>{
    const target=path.join(root,relative),stat=fs.lstatSync(target);
    if(stat.isSymbolicLink())fail('Aliased proof-generation source');
    if(stat.isDirectory())for(const name of fs.readdirSync(target).sort())add(`${relative}/${name}`);
    // Python bytecode in its conventional cache directory is an execution by-product,
    // not reviewed source. Every other file in that directory remains source-bound.
    else if(stat.isFile()) {
      if(/(?:^|\/)__pycache__\/[^/]+\.pyc$/.test(relative))return;
      entries.push({file:relative,sha256:hash(fs.readFileSync(target))});
    }
    else fail('Unsupported proof-generation source');
    if(entries.length>4096)fail('Proof-generation source inventory is unbounded');
  };
  for(const relative of ['tools/cloud-test/scripts/proof_prep_cases.py','tools/cloud-test/scripts/install_pdfjs.py',
    'tools/cloud-test/scripts/_netguard.py','tools/cloud-test/scripts/run_env.py','tools/cloud-test/config/test-config.v1.json',
    'tools/cloud-test/tests/fixtures/full-request.json','tools/cloud-test/tests/fixtures/plan-facts.PLACEHOLDER.json',
    'tools/cloud-test/harness','tools/cloud-test/harness-adapter'])add(relative);
  return entries;
}
function drainGeneratedProofChild(result) {
  if(process.platform==='win32')fail('Owned proof-generation drain requires POSIX process groups');
  const group=result.pid;
  if(!Number.isInteger(group)||group<=1||group===process.pid) {
    if(result.error&&!group)return {status:'not-started'};
    fail('Missing owned proof-generation process-group identity');
  }
  try{process.kill(-group,0);}
  catch(error){
    if(error.code==='ESRCH')return {status:'drained',group,signalled:false,zombies:[]};
    throw new Error('Cannot inspect owned proof-generation process group',{cause:error});
  }
  try{process.kill(-group,'SIGKILL');}
  catch(error){if(error.code!=='ESRCH')throw new Error('Cannot stop owned proof-generation process group',{cause:error});}
  const deadline=Date.now()+1000;
  do {
    const observed=spawnSync('/bin/ps',['-axo','pid=,pgid=,stat='],
      {encoding:'utf8',timeout:1000,maxBuffer:2*1024*1024});
    if(observed.status!==0||observed.signal||observed.error)fail('Cannot observe owned proof-generation process group');
    const members=observed.stdout.trim().split('\n').filter(Boolean).map(line=>{
      const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
      if(!match)fail('Unparseable proof-generation process-group observation');
      return {pid:Number(match[1]),group:Number(match[2]),state:match[3]};
    }).filter(item=>item.group===group);
    if(members.every(item=>/^[ZX]/.test(item.state)))
      return {status:'drained',group,signalled:true,zombies:members.map(item=>item.pid)};
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
  }while(Date.now()<deadline);
  fail('Owned proof-generation process group did not drain within 1000ms');
}
export function generatedProofCases(root,environment,{children=nativeChildTracker(drainGeneratedProofChild),
  identityTimeoutMs=5000,generatorTimeoutMs=120000}={}) {
  const pdf=environment?.CT_EXISTING_PDFJS_DIR;
  if(typeof pdf!=='string'||!path.isAbsolute(pdf)||fs.realpathSync(pdf)!==pdf)fail('NOT RUN: bound CT_EXISTING_PDFJS_DIR is required for proof generation');
  const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'speaksharp-r15-expected-'))),out=path.join(parent,'generated');
  try {
    const launcher=binary('python3'),{result:identity}=children.run([launcher,'-I','-B','-c',
      'import hashlib,json,pathlib,sys; p=pathlib.Path(sys.executable).resolve(); print(json.dumps({"path":str(p),"version":".".join(map(str,sys.version_info[:3])),"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}))'],
    {encoding:'utf8',timeout:identityTimeoutMs,killSignal:'SIGKILL',detached:true,
      env:{PATH:path.dirname(launcher),LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}});
    let runtime;try{runtime=JSON.parse(identity.stdout);}catch{fail('NOT RUN: malformed proof-generation Python identity');}
    if(identity.status!==0||identity.signal||identity.error||!/^3\.12\.\d+$/.test(runtime.version)
      ||fs.realpathSync(runtime.path)!==runtime.path||hash(fs.readFileSync(runtime.path))!==runtime.sha256)
      fail('NOT RUN: bound Python 3.12 proof-generation runtime unavailable');
    const python=runtime.path,generator=regular(root,'tools/cloud-test/scripts/proof_prep_cases.py');
    const command=[python,'-I','-B',generator,'--out',out,'--packet',path.join(root,'tools/cloud-test/harness')];
    const {result}=children.run(command,{cwd:path.join(root,'tools/cloud-test'),encoding:'utf8',timeout:generatorTimeoutMs,
      killSignal:'SIGKILL',detached:true,
      env:{PATH:[path.dirname(python),'/usr/bin','/bin'].join(path.delimiter),HOME:parent,CT_EXISTING_PDFJS_DIR:pdf,
        LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',CI:'true'}});
    if(result.status!==0||result.signal||result.error)fail('NOT RUN: independent r15 proof generation failed');
    return {runtime,command:['<BOUND_PYTHON>','-I','-B','tools/cloud-test/scripts/proof_prep_cases.py','--out','<OWNED_OUTPUT>',
      '--packet','tools/cloud-test/harness'],sources:proofGenerationSources(root),
      files:proofCasesInventory(out,'independently generated proof-cases').files};
  } finally {
    children.assertDrained(parent);
    fs.rmSync(parent,{recursive:true,force:true});
  }
}
export function proofCasesBinding(contract,environment,root,{generate=generatedProofCases}={}) {
  if(contract.testFile!==PROOF_CASES_TEST)return null;
  const directory=environment?.CT_PROOF_CASES_DIR;
  if(typeof directory!=='string'||!path.isAbsolute(directory))fail('NOT RUN: CT_PROOF_CASES_DIR is required for the r15 proof control');
  if(!root)fail('NOT RUN: current source root is required for the r15 proof control');
  const source=proofCasesInventory(directory,'source proof-cases'),generation=generate(root,environment);
  if(JSON.stringify(source.files)!==JSON.stringify(generation.files))fail('Supplied proof-cases differ from current independent generation');
  return {...source,generation};
}
export function phaseProofCasesBinding(contract,environment,phaseId,root,options) {
  const source=proofCasesBinding(contract,environment,root,options);if(!source)return null;
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),`speaksharp-r15-${phaseId}-`))),cases=path.join(directory,'cases');
  fs.mkdirSync(cases);
  for(const item of source.files)fs.copyFileSync(path.join(source.directory,'cases',item.name),path.join(cases,item.name),fs.constants.COPYFILE_EXCL);
  const phase=proofCasesInventory(directory,'phase proof-cases');
  if(JSON.stringify(phase.files)!==JSON.stringify(source.files))fail('Phase proof-cases differ from their bound source');
  return {sourceDirectory:source.directory,sourceFiles:source.files,generation:source.generation,...phase};
}
export function validatePhaseProofCases(contract,binding,root,environment,options) {
  if(contract.testFile!==PROOF_CASES_TEST)return null;
  if(!binding)fail('Missing phase-owned proof-cases binding');
  const source=proofCasesBinding(contract,environment,root,options);
  const phase=proofCasesInventory(binding.directory,'phase proof-cases');
  const expected={sourceDirectory:source.directory,sourceFiles:source.files,generation:source.generation,...phase};
  if(JSON.stringify(source.files)!==JSON.stringify(phase.files))fail('Phase proof-cases differ from their bound source');
  if(JSON.stringify(binding)!==JSON.stringify(expected))fail('Wrong proof-cases generation/source binding');
  return expected;
}
// Runs in Node's real test reporter, observing the runner's raw event stream.
export default async function* nativeReporter(events) {
  yield JSON.stringify({type:'native:binding',binding:JSON.parse(process.env.TEST_EFFICACY_BINDING??'null'),
    cwd:fs.realpathSync(process.cwd()),node:process.version,execPath:fs.realpathSync(process.execPath)})+'\n';
  for await(const event of events)yield JSON.stringify(event)+'\n';
}
export function parseNodeEvents(raw,binding) {
  const events=raw.trim().split('\n').map(line=>JSON.parse(line));
  const header=events.shift();
  if(header?.type!=='native:binding'||JSON.stringify(header.binding)!==JSON.stringify(binding)
    ||header.cwd!==binding.cwd||header.node!==binding.runtime.version||header.execPath!==binding.runtime.execPath)fail('Wrong native reporter binding/runtime');
  const absolute=path.join(binding.cwd,binding.testFile);
  const collected=events.filter(event=>event.type==='test:dequeue'&&event.data?.file===absolute);
  const results=events.filter(event=>['test:pass','test:fail'].includes(event.type));
  if(!collected.length||!results.length||events.some(event=>event.type==='test:fail')
    ||results.some(event=>event.data?.file!==absolute||event.data.skip||event.data.todo))fail('Native Node collection absent, failed, skipped or wrong-file');
  const summaries=events.filter(event=>event.type==='test:summary'&&event.data?.file===undefined);
  // Node 22 emits a summary after draining all tests; do not accept a truncated prefix.
  const assertions=results.filter(event=>event.data?.details?.type!=='suite'&&event.data.name!==absolute
    &&event.data.name!==pathToFileURL(absolute).href&&event.data.name!==binding.testFile
    &&event.data.name!==`./${binding.testFile}`&&event.data.name!==path.basename(binding.testFile)).length;
  const counts=summaries[0]?.data?.counts;
  if(summaries.length!==1||summaries[0].data.success!==true||!assertions
    ||counts?.failed!==0||counts?.skipped!==0||counts?.todo!==0||counts?.cancelled!==0
    ||counts?.tests!==assertions||counts?.passed!==assertions)fail('Native Node terminal summary absent, zero-test or unsuccessful');
  return {collected:collected.length,assertions};
}
export function parseDenoJunit(raw,binding,root,requiredCases=[]) {
  const require=createRequire(path.join(root,'node_modules/jsdom/package.json'));
  const {SaxesParser}=require('saxes');
  const parser=new SaxesParser({xmlns:false});let malformed=false,rootSeen=false;
  const suites=[],cases=[],stack=[];
  parser.on('doctype',()=>{malformed=true;});parser.on('error',()=>{malformed=true;});
  parser.on('opentag',tag=>{
    const parent=stack.at(-1),depth=stack.length;
    if(depth===0){if(!['testsuites','testsuite'].includes(tag.name))malformed=true;rootSeen=true;}
    else if(tag.name==='testsuites')malformed=true;
    if(tag.name==='testsuite') {
      if(depth!==0&&!(depth===1&&parent==='testsuites'))malformed=true;
      suites.push(tag.attributes);
    } else if(tag.name==='testcase') {
      if(parent!=='testsuite'||!((depth===1&&stack[0]==='testsuite')||(depth===2&&stack[0]==='testsuites')))malformed=true;
      cases.push({...tag.attributes});
    } else if(['system-out','system-err'].includes(tag.name)) {
      if(!['testsuite','testcase'].includes(parent))malformed=true;
    } else if(tag.name!=='testsuites')malformed=true;
    stack.push(tag.name);
  });
  parser.on('closetag',tag=>{if(stack.pop()!==tag.name)malformed=true;});
  try{parser.write(raw).close();}catch{malformed=true;}
  const expected=path.join(binding.cwd,binding.testFile),matches=value=>value===binding.testFile||value===`./${binding.testFile}`||value===expected||value===pathToFileURL(expected).href;
  if(malformed||!rootSeen||stack.length!==0||suites.length!==1||!matches(suites[0].name)||!cases.length
    ||Number(suites[0].tests)!==cases.length||Number(suites[0].failures)!==0||Number(suites[0].errors)!==0
    ||Number(suites[0].skipped??0)!==0||Number(suites[0].disabled??0)!==0||cases.some(item=>!item.name||!matches(item.classname)))fail('Deno JUnit collection absent, failed, skipped or wrong-file');
  if(requiredCases.some(name=>cases.filter(item=>item.name===name).length!==1))fail('Deno JUnit required case missing or duplicated');
  return {collected:1,assertions:cases.length};
}
// One tracker spans warmup and test children. Every spawn invalidates drainage
// before it starts; a failed second drain cannot inherit the first child's PASS.
export function nativeChildTracker(drain,{spawn=spawnSync}={}) {
  let drained=true;
  return {
    run(command,options) {
      drained=false;
      const result=spawn(command[0],command.slice(1),options);
      let processCleanup;
      try {
        processCleanup=drain(result);
        if(!['drained','not-started'].includes(processCleanup?.status))fail('Native child drainage unverified');
      }catch(error){error.diagnostics={command,pid:result.pid,status:result.status,signal:result.signal,
        stdout:result.stdout?.toString()??'',stderr:result.stderr?.toString()??''};throw error;}
      drained=true;
      return {result,execution:{status:result.status,signal:result.signal,error:result.error?.code??null,processCleanup}};
    },
    assertDrained(copy) {
      if(!drained) {
        const error=new Error(`Native child cleanup unverified; retained copy: ${copy}`);
        error.retainedCopy=copy;throw error;
      }
    },
  };
}
function callableNodes(root,source,name,file) {
  const require=createRequire(path.join(root,'package.json')),ts=require('typescript'),typed=file.endsWith('.ts');
  const parsed=ts.createSourceFile(typed?'evidence.ts':'evidence.mjs',source,ts.ScriptTarget.Latest,true,
    typed?ts.ScriptKind.TS:ts.ScriptKind.JS),nodes=[];
  if(parsed.parseDiagnostics.length)fail('Invalid native helper syntax');
  const visit=node=>{
    if((ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node))&&node.name?.text===name&&node.body)nodes.push(node);
    ts.forEachChild(node,visit);
  };visit(parsed);
  if(nodes.length!==1)fail(`Unknown or ambiguous native callable ${name}`);
  return nodes[0];
}
export function validateNativeCallables(raw,binding,root,helpers) {
  const credited=[];
  if(helpers.length&&!raw?.length)fail('Missing raw native callable coverage');
  for(const file of helpers) {
    const contract=nativeHelper(file),source=fs.readFileSync(regular(root,file),'utf8');
    const url=pathToFileURL(path.join(binding.cwd,file)).href;
    // Node 22 strip-only loading blanks types in place, then executes `${stripped}\n\n//# sourceURL=${url}`
    // (lib/internal/modules/typescript.js processTypeScriptCode). Ranges are bounded by those exact bytes.
    const executed=file.endsWith('.ts')?`${source}\n\n//# sourceURL=${url}`:source;
    const entries=raw.flatMap(report=>report.result??[]).filter(script=>script.url===url);
    if(!entries.length)fail('Missing actual native helper script coverage');
    for(const script of entries) {
      if(!Array.isArray(script.functions)||!script.functions.length)fail('Malformed raw native callable coverage');
      for(const fn of script.functions) {
        // Same guard, named: the first failing predicate and its range are reported with bounded, content-free identity.
        const shape=typeof fn.functionName!=='string'||typeof fn.isBlockCoverage!=='boolean'||!Array.isArray(fn.ranges)||!fn.ranges.length;
        const predicate=range=>!Number.isSafeInteger(range.count)||range.count<0?'count'
          :!Number.isSafeInteger(range.startOffset)||!Number.isSafeInteger(range.endOffset)||range.startOffset<0||range.startOffset>=range.endOffset?'offsets'
          :range.endOffset>executed.length?'beyond-executed-length'
          :range.startOffset<fn.ranges[0].startOffset||range.endOffset>fn.ranges[0].endOffset?'containment':null;
        const bad=shape?null:fn.ranges.findIndex(range=>predicate(range));
        if(shape||bad>=0) {
          const range=shape?null:fn.ranges[bad];
          fail(`Malformed raw native callable ranges/count: ${JSON.stringify({file,sourceSha256:hash(source),sourceLength:source.length,
            executedLength:executed.length,node:binding.runtime?.version??null,function:typeof fn.functionName==='string'?fn.functionName||'<module>':null,
            predicate:shape?'shape':predicate(range),rangeIndex:shape?null:bad,
            range:range?[range.startOffset,range.endOffset,range.count]:null,outer:shape?null:[fn.ranges[0].startOffset,fn.ranges[0].endOffset]})}`);
        }
      }
    }
    for(const name of contract.callables) {
      const node=callableNodes(root,source,name,file);
      const matches=entries.flatMap(script=>script.functions??[]).filter(fn=>fn.functionName===name&&fn.ranges?.[0]?.count>0
        &&fn.ranges[0].startOffset>=node.getStart()&&fn.ranges[0].startOffset<=node.name.getStart()
        &&fn.ranges[0].endOffset===node.end);
      if(!matches.length)fail(`Native callable NOT RUN: ${file}:${name}`);
    }
    credited.push(file);
  }
  return credited;
}
export function sqlSourceBinding(root,consumer=SQL_CONSUMER) {
  const contract=SQL_CONTRACTS.find(item=>item.consumer===consumer);
  if(!contract)fail('Unregistered SQL consumer');
  return contract.files.map(file=>({file,sha256:hash(fs.readFileSync(regular(root,file)))}));
}
export function validateSqlWitness(raw,binding,root) {
  const consumer=binding.testFile&&path.isAbsolute(binding.testFile)
    ?path.relative(binding.cwd,binding.testFile):binding.testFile??SQL_CONSUMER;
  const consumed=sqlSourceBinding(root,consumer).map(item=>({...item,beforeSha256:item.sha256,afterSha256:item.sha256}));
  if(raw?.schemaVersion!==1||raw.phaseId!==binding.phaseId||raw.bindingSha256!==hash(JSON.stringify(binding))
    ||raw.consumer!==consumer||JSON.stringify(raw.consumed)!==JSON.stringify(consumed))fail('Missing, stale or changed-SQL consumption witness');
  return SQL_CONTRACTS.find(item=>item.consumer===consumer).files;
}
export function produceNativePhase({root,cwd,contract,provenance,inputSha256,sourceCopyCommit,runId,environment,drain,children=nativeChildTracker(drain)}) {
  const runtime=nativeRuntime(root,contract.runner),coverageDirectory=fs.mkdtempSync(path.join(cwd,'.native-coverage-'));
  const binding={phase:'native-execution',phaseId:randomUUID(),runId,provenance,cwd,testFile:contract.testFile,batch:contract.batch,
    helpers:[...contract.helpers],inputSha256,sourceCopyCommit,runtime,coverageDirectory,
    repoLockSha256:hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))};
  if(contract.runner==='deno') {
    binding.syntheticSource=validateSyntheticSource(root,contract.testFile);
    binding.permissionPolicy=nativeDenoPolicy(contract.testFile);
    binding.dependencyPin=nativeDependencyPin(root,contract.testFile);
  }
  const proofCases=phaseProofCasesBinding(contract,environment,binding.phaseId,root);if(proofCases)binding.proofCases=proofCases;
  const browser=nativeBrowserBinding(contract,environment);if(browser)binding.browser=browser;
  const pythonFixture=nativePythonFixtureBinding(contract);if(pythonFixture)binding.pythonFixture=pythonFixture;
  binding.command=nativeCommand(binding);
  const env={...nativeEnvironment(cwd,environment),...(proofCases?{CT_PROOF_CASES_DIR:proofCases.directory}:{}),
    ...(browser?{CT_CHROME:browser.path}:{}),
    TEST_EFFICACY_BINDING:JSON.stringify(binding),NODE_V8_COVERAGE:contract.runner==='node-test'?coverageDirectory:''};
  let warmup;
  if(contract.runner==='deno') {
    // Frozen-lock import acquisition is a separate no-run phase in an owned cache.
    // Actual tests are then cached-only, with no runtime effect permissions.
    binding.cacheDirectory=path.join(cwd,'.native-deno-cache');
    fs.mkdirSync(binding.cacheDirectory,{recursive:true});
    env.DENO_DIR=binding.cacheDirectory;
    env.DENO_NO_PROMPT='1';
    env.TEST_EFFICACY_BINDING=JSON.stringify(binding);
    const command=nativeWarmupCommand(binding),before=nativeRuntime(cwd,contract.runner);
    const {result,execution}=children.run(command,{cwd,env,timeout:60000,killSignal:'SIGKILL',detached:true,
      maxBuffer:4*1024*1024,encoding:'utf8'});
    warmup={command,before,after:nativeRuntime(cwd,contract.runner),cacheDirectory:binding.cacheDirectory,
      stdout:result.stdout??'',stderr:result.stderr??'',execution};
    try{validateWarmup(warmup,binding);}catch(error){error.diagnostics={warmup};throw error;}
  }
  const {result,execution}=children.run(binding.command,{cwd,env,timeout:60000,killSignal:'SIGKILL',
    detached:true,maxBuffer:16*1024*1024,encoding:'utf8'});
  const coverage=contract.runner==='node-test'?fs.readdirSync(coverageDirectory).filter(file=>file.endsWith('.json'))
    .sort().map(file=>JSON.parse(fs.readFileSync(path.join(coverageDirectory,file),'utf8')))
    .map(report=>({...report,result:report.result.filter(script=>contract.helpers.some(file=>script.url===pathToFileURL(path.join(cwd,file)).href))})):[];
  const phase={binding,execution,stdout:result.stdout??'',stderr:result.stderr??'',coverage,...(warmup?{warmup}:{})};
  if(JSON.stringify(nativeRuntime(root,contract.runner))!==JSON.stringify(runtime))fail('Native runtime changed during execution');
  try{validateNativePhase(phase,{root,provenance,inputSha256,runId,contract,environment});}
  catch(error){error.diagnostics=phase;throw error;}
  return phase;
}
export function validateNativePhase(phase,{root,provenance,inputSha256,runId,contract,environment=process.env}) {
  const b=phase?.binding;
  if(!b||b.phase!=='native-execution'||!b.phaseId||b.runId!==runId||!path.isAbsolute(b.cwd??'')
    ||JSON.stringify(b.provenance)!==JSON.stringify(provenance)||b.testFile!==contract.testFile||b.batch!==contract.batch
    ||JSON.stringify(b.helpers)!==JSON.stringify(contract.helpers)
    ||b.inputSha256!==inputSha256||b.repoLockSha256!==hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))
    ||JSON.stringify(b.runtime)!==JSON.stringify(nativeRuntime(root,contract.runner))
    ||JSON.stringify(b.command)!==JSON.stringify(nativeCommand(b)))fail('Wrong native source/runtime/provenance/command binding');
  const expectedProof=validatePhaseProofCases(contract,b.proofCases,root,environment);
  if(JSON.stringify(b.proofCases??null)!==JSON.stringify(expectedProof))fail('Wrong or changed proof-cases binding');
  const expectedBrowser=nativeBrowserBinding(contract,environment);
  if(JSON.stringify(b.browser??null)!==JSON.stringify(expectedBrowser))fail('Wrong or changed native browser binding');
  if(JSON.stringify(b.pythonFixture??null)!==JSON.stringify(nativePythonFixtureBinding(contract)))
    fail('Wrong or changed native Python fixture binding');
  if(phase.execution?.status!==0||phase.execution.signal!==null||phase.execution.error!==null
    ||phase.execution.processCleanup?.status!=='drained')fail('Native execution failed or did not drain');
  if(contract.runner==='deno') {
    if(JSON.stringify(b.permissionPolicy)!==JSON.stringify(nativeDenoPolicy(contract.testFile)))fail('Wrong native test permission policy');
    if(JSON.stringify(b.syntheticSource)!==JSON.stringify(validateSyntheticSource(root,contract.testFile)))fail('Wrong native synthetic source profile');
    if(JSON.stringify(b.dependencyPin)!==JSON.stringify(nativeDependencyPin(root,contract.testFile)))fail('Wrong or unpinned native Deno dependency profile');
    validateWarmup(phase.warmup,b);
  }
  else if(phase.warmup||b.cacheDirectory)fail('Unexpected Node warmup/cache');
  const requiredCases=contract.testFile===COACHING_QUALITY_TEST?[COACHING_WRONG_TAKE_CASE]
    :[COACHING_EFFICACY_PROFILE,COACHING_READINESS_EFFICACY_PROFILE,COACHING_BACKOFF_EFFICACY_PROFILE,COACHING_NEVER_BLOCKS_PROFILE].includes(b.syntheticSource?.id)?[COACHING_EDGE_CONSENT_CASE]:[];
  const counts=contract.runner==='deno'?parseDenoJunit(phase.stdout,b,root,requiredCases):parseNodeEvents(phase.stdout,b);
  if(!counts.assertions)fail('Native zero-test execution');
  return {counts,helpers:validateNativeCallables(phase.coverage,b,root,contract.helpers)};
}
export function validateWarmup(warmup,binding) {
  if(!warmup||binding.cacheDirectory!==path.join(binding.cwd,'.native-deno-cache')
    ||warmup.cacheDirectory!==binding.cacheDirectory||JSON.stringify(warmup.command)!==JSON.stringify(nativeWarmupCommand(binding))
    ||JSON.stringify(warmup.before)!==JSON.stringify(binding.runtime)||JSON.stringify(warmup.after)!==JSON.stringify(binding.runtime)
    ||warmup.execution?.status!==0||warmup.execution.signal!==null||warmup.execution.error!==null
    ||warmup.execution.processCleanup?.status!=='drained')fail('Deno import warmup failed, stale, unowned or changed runtime/config/lock');
}
export function validateNativeReceipt(receipts,{root,provenance,inputSha256,files}) {
  const all=selectNativeContracts(root,files),list=Array.isArray(receipts)?receipts:[receipts];
  reconcileExecutionBatches(list,all,'native');
  const credited=new Set(),phases=new Set(),runs=new Set();
  for(const receipt of list) {
  const selected=all.filter(contract=>contract.batch===receipt.batch.index);
  if(receipt?.schemaVersion!==2||JSON.stringify(receipt.provenance)!==JSON.stringify(provenance)
    ||receipt.commit!==provenance.commit||receipt.tree!==provenance.tree||receipt.snapshotSha256!==provenance.snapshotSha256
    ||!receipt.runId||runs.has(receipt.runId)||!Array.isArray(receipt.tests)||receipt.tests.length!==selected.length
    ||receipt.status!==(selected.length?'executed':'not-applicable'))fail('Wrong native execution receipt inventory/provenance');
  runs.add(receipt.runId);
  for(let n=0;n<selected.length;n++) {
    const contract=selected[n],result=receipt.tests[n];
    if(result.testFile!==contract.testFile||result.testSha256!==hash(fs.readFileSync(regular(root,contract.testFile)))
      ||phases.has(result.phase?.binding?.phaseId))fail('Wrong, stale or duplicate native test source');
    const validated=validateNativePhase(result.phase,{root,provenance,inputSha256,runId:receipt.runId,contract});
    if(files.includes(contract.testFile))credited.add(contract.testFile);
    for(const file of validated.helpers)credited.add(file);
    phases.add(result.phase.binding.phaseId);
  }
  }
  return credited;
}
