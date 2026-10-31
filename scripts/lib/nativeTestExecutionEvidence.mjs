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
export const REAL_BROWSER_TEST='tools/cloud-test/tests/node/proof/real-browser-r15.test.cjs';
export const SQL_CONSUMER='tests/unit/accountCompletionBillingSettlement.test.ts';
export const SQL_INPUTS=Object.freeze([
  'backend/supabase/migrations/20261027192550_account_completion_billing_settlement.sql',
  'tests/db/account-completion-billing-full-chain-invariants.sql',
]);
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
]);
const fail=message=>{throw new Error(message);};
function regular(root,file) {
  if(typeof file!=='string'||path.isAbsolute(file)||file.includes('\\')||path.posix.normalize(file)!==file||file.startsWith('../'))fail('Invalid native evidence path');
  const target=path.join(root,file);
  if(!fs.lstatSync(target).isFile()||fs.realpathSync(target)!==target)fail('Aliased native evidence source');
  return target;
}
export const nativeHelper=file=>NATIVE_HELPERS.find(item=>item.file===file);
export function nativeTestRoute(file,root) {
  const helper=nativeHelper(file);
  if(helper)return {runner:'node-test-helper',consumer:helper.consumer,claim:helper.claim};
  if(SQL_INPUTS.includes(file))return {runner:'vitest-sql',consumer:SQL_CONSUMER,claim:'actual SQL consumed in PGlite fixture; native database NOT RUN'};
  if(/^backend\/supabase\/functions\/.*(?:\.test|_test)\.ts$/.test(file))return {runner:'deno',consumer:file};
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
  return binding.runtime.runner==='deno'
    ?[binding.runtime.execPath,'test','--config','backend/supabase/functions/deno.json','--cached-only','--frozen',
      '--lock=backend/supabase/functions/deno.lock','--node-modules-dir=none','--no-prompt','--deny-net',
      ...(nativeDenoPolicy(file).environment.names.length?['--allow-env=GEMINI_API_KEY']:['--deny-env']),
      '--deny-read','--deny-write','--deny-run',
      '--reporter=junit',file]
    :[binding.runtime.execPath,...(typedHelper?['--experimental-strip-types']:[]),
      '--test','--test-concurrency=1',`--test-reporter=./${NATIVE_REPORTER}`,file];
}
export function nativeWarmupCommand(binding) {
  if(binding.runtime.runner!=='deno')fail('Only Deno has an import warmup');
  return nativeCommand(binding).map(arg=>arg==='--allow-env=GEMINI_API_KEY'?'--deny-env':arg)
    .filter(arg=>arg!=='--cached-only').toSpliced(2,0,'--no-run');
}
const coachingTest='backend/supabase/functions/get-ai-suggestions/index.test.ts';
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
]);
export function nativeDenoPolicy(file) {
  return {schemaVersion:1,testFile:file,environment:{names:file===coachingTest?['GEMINI_API_KEY']:[],
    initial:'absent',inherit:false,syntheticValue:file===coachingTest?'test-key':null,reinject:false},
    network:'denied',read:'denied',write:'denied',run:'denied',prompt:'denied',warmupEnvironment:'denied'};
}
export function validateSyntheticSource(root,file) {
  if(file!==coachingTest)return null;
  const profile=coachingProfiles.find(candidate=>{
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
  if(contract.testFile!==REAL_BROWSER_TEST)return null;
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
    else if(stat.isFile())entries.push({file:relative,sha256:hash(fs.readFileSync(target))});
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
    const launcher=binary('python3'),{result:identity}=children.run([launcher,'-I','-c',
      'import hashlib,json,pathlib,sys; p=pathlib.Path(sys.executable).resolve(); print(json.dumps({"path":str(p),"version":".".join(map(str,sys.version_info[:3])),"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}))'],
    {encoding:'utf8',timeout:identityTimeoutMs,killSignal:'SIGKILL',detached:true,
      env:{PATH:path.dirname(launcher),LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}});
    let runtime;try{runtime=JSON.parse(identity.stdout);}catch{fail('NOT RUN: malformed proof-generation Python identity');}
    if(identity.status!==0||identity.signal||identity.error||!/^3\.12\.\d+$/.test(runtime.version)
      ||fs.realpathSync(runtime.path)!==runtime.path||hash(fs.readFileSync(runtime.path))!==runtime.sha256)
      fail('NOT RUN: bound Python 3.12 proof-generation runtime unavailable');
    const python=runtime.path,generator=regular(root,'tools/cloud-test/scripts/proof_prep_cases.py');
    const command=[python,'-I',generator,'--out',out,'--packet',path.join(root,'tools/cloud-test/harness')];
    const {result}=children.run(command,{cwd:path.join(root,'tools/cloud-test'),encoding:'utf8',timeout:generatorTimeoutMs,
      killSignal:'SIGKILL',detached:true,
      env:{PATH:[path.dirname(python),'/usr/bin','/bin'].join(path.delimiter),HOME:parent,CT_EXISTING_PDFJS_DIR:pdf,
        LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',CI:'true'}});
    if(result.status!==0||result.signal||result.error)fail('NOT RUN: independent r15 proof generation failed');
    return {runtime,command:['<BOUND_PYTHON>','-I','tools/cloud-test/scripts/proof_prep_cases.py','--out','<OWNED_OUTPUT>',
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
export function parseDenoJunit(raw,binding,root) {
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
export function sqlSourceBinding(root) {
  return SQL_INPUTS.map(file=>({file,sha256:hash(fs.readFileSync(regular(root,file)))}));
}
export function validateSqlWitness(raw,binding,root) {
  const consumed=sqlSourceBinding(root).map(item=>({...item,beforeSha256:item.sha256,afterSha256:item.sha256}));
  if(raw?.schemaVersion!==1||raw.phaseId!==binding.phaseId||raw.bindingSha256!==hash(JSON.stringify(binding))
    ||raw.consumer!==SQL_CONSUMER||JSON.stringify(raw.consumed)!==JSON.stringify(consumed))fail('Missing, stale or changed-SQL consumption witness');
  return SQL_INPUTS;
}
export function produceNativePhase({root,cwd,contract,provenance,inputSha256,sourceCopyCommit,runId,environment,drain,children=nativeChildTracker(drain)}) {
  const runtime=nativeRuntime(root,contract.runner),coverageDirectory=fs.mkdtempSync(path.join(cwd,'.native-coverage-'));
  const binding={phase:'native-execution',phaseId:randomUUID(),runId,provenance,cwd,testFile:contract.testFile,batch:contract.batch,
    helpers:[...contract.helpers],inputSha256,sourceCopyCommit,runtime,coverageDirectory,
    repoLockSha256:hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))};
  if(contract.runner==='deno') {
    binding.syntheticSource=validateSyntheticSource(root,contract.testFile);
    binding.permissionPolicy=nativeDenoPolicy(contract.testFile);
  }
  const proofCases=phaseProofCasesBinding(contract,environment,binding.phaseId,root);if(proofCases)binding.proofCases=proofCases;
  const browser=nativeBrowserBinding(contract,environment);if(browser)binding.browser=browser;
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
  if(phase.execution?.status!==0||phase.execution.signal!==null||phase.execution.error!==null
    ||phase.execution.processCleanup?.status!=='drained')fail('Native execution failed or did not drain');
  if(contract.runner==='deno') {
    if(JSON.stringify(b.permissionPolicy)!==JSON.stringify(nativeDenoPolicy(contract.testFile)))fail('Wrong native test permission policy');
    if(JSON.stringify(b.syntheticSource)!==JSON.stringify(validateSyntheticSource(root,contract.testFile)))fail('Wrong native synthetic source profile');
    validateWarmup(phase.warmup,b);
  }
  else if(phase.warmup||b.cacheDirectory)fail('Unexpected Node warmup/cache');
  const counts=contract.runner==='deno'?parseDenoJunit(phase.stdout,b,root):parseNodeEvents(phase.stdout,b);
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
