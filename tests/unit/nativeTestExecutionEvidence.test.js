// @vitest-environment node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {NATIVE_REPORTER,NATIVE_HELPERS,SQL_INPUTS,SQL_CONSUMER,nativeTestRoute,selectNativeContracts,executionBatchIdentity,reconcileExecutionBatches,
  nativeCommand,nativeWarmupCommand,nativeRuntime,validateWarmup,nativeChildTracker,produceNativePhase,validateNativePhase,validateNativeReceipt,
  parseDenoJunit,validateNativeCallables,nativeDenoPolicy,nativeEnvironment,validateSyntheticSource,sqlSourceBinding,validateSqlWitness} from '../../scripts/lib/nativeTestExecutionEvidence.mjs';
import {drainOwnedPhase,dependencyPaths,initializeCopyRepository,cleanupOwnedCopy,selectExecutionContracts} from '../../scripts/run-test-efficacy.mjs';
import {testEnvironment,executionContext,sourceIdentity,executionRoute} from '../../scripts/lib/testExecutionEvidence.mjs';
const {test}=process.env.NODE_TEST_CONTEXT?await import('node:test'):await import('vitest');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const provenance={schemaVersion:1,invocation:randomUUID(),source:'github-actions',runId:'901',runAttempt:'2',
  commit:'a'.repeat(40),tree:'b'.repeat(40),snapshotSha256:'c'.repeat(64)};
const inputSha256='d'.repeat(64),runId=randomUUID();

test('bounded native routes retain explicit planner/protocol and fixture-only claims',()=>{
  const paths=[...NATIVE_HELPERS.map(item=>item.file),...NATIVE_HELPERS.map(item=>item.consumer),
    'backend/supabase/functions/account-closure/completion-execution.test.ts'];
  const contracts=selectNativeContracts(root,paths);
  assert.equal(contracts.length,6);
  assert.equal(contracts.filter(item=>item.runner==='node-test').length,5);
  for(const item of NATIVE_HELPERS) {
    assert.equal(nativeTestRoute(item.file,root).consumer,item.consumer);
    assert.match(nativeTestRoute(item.file,root).claim,/NOT RUN/);
    assert.ok(!item.callables.includes('runMainClosureProof'));
  }
  assert.equal(nativeTestRoute('tests/db/unknown-runner.mjs',root),null);
  const sql=selectExecutionContracts(root,[...SQL_INPUTS,SQL_CONSUMER]);
  assert.equal(sql.length,1);assert.deepEqual(sql[0].sqlFiles,SQL_INPUTS);
});

test('edited-take helper maps only to its exact protocol test and refuses source/count drift',()=>{
  const helper=NATIVE_HELPERS.find(item=>item.file==='tests/db/retention-edited-take-full-chain.mjs');
  assert.deepEqual(helper.callables,['observeEditedTakeRace','finalizeEditedTakeProof','createEditedTakePeer']);
  assert.equal(helper.consumer,'tests/db/retention-edited-take-full-chain.test.mjs');
  assert.match(helper.claim,/fake-process transport controls only; native DB\/Docker replay NOT RUN/);
  assert.equal(nativeTestRoute(helper.file.replace('full-chain','other'),root),null);
  const f=fixture(`import test from 'node:test'; import assert from 'node:assert/strict';
    import {observeEditedTakeRace,finalizeEditedTakeProof,createEditedTakePeer} from './retention-edited-take-full-chain.mjs';
    test('all registered protocol callables execute',()=>{
      assert.equal(observeEditedTakeRace(),1);assert.equal(finalizeEditedTakeProof(),2);assert.equal(createEditedTakePeer(),3);
    });`);
  try {
    fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
    f.write(helper.file,'export function observeEditedTakeRace(){return 1;}\nexport function finalizeEditedTakeProof(){return 2;}\nexport function createEditedTakePeer(){return 3;}\n');
    f.contract.helpers=[helper.file];
    const phase=f.run();
    assert.deepEqual(validateNativeCallables(phase.coverage,phase.binding,f.dir,[helper.file]),[helper.file]);
    for(const change of [
      rows=>{for(const report of rows)for(const script of report.result)for(const fn of script.functions)for(const range of fn.ranges)range.count=0;},
      rows=>{for(const report of rows)for(const script of report.result)script.url=script.url.replace('edited-take','wrong-take');},
    ]) {
      const raw=structuredClone(phase.coverage);change(raw);
      assert.throws(()=>validateNativeCallables(raw,phase.binding,f.dir,[helper.file]));
    }
    f.write(helper.file,'\n '+fs.readFileSync(path.join(f.dir,helper.file),'utf8'));
    assert.throws(()=>validateNativeCallables(phase.coverage,phase.binding,f.dir,[helper.file]));
  }finally{f.clean();}
});

test('typed fixture-audio helper credits all six harness callables from stripped-TS V8 offsets only',()=>{
  const helper=NATIVE_HELPERS.find(item=>item.file==='tests/live/helpers/fixtureAudioStream.ts');
  assert.equal(helper.consumer,'tests/live/helpers/fixtureAudioStream.node.test.mjs');
  assert.match(helper.claim,/fake browser objects in node:vm; browser\/audio\/model NOT RUN/);
  assert.equal(nativeTestRoute(helper.file,root).runner,'node-test-helper');
  assert.equal(nativeTestRoute('tests/live/helpers/otherAudioStream.ts',root),null);
  const names=helper.callables;
  const f=fixture(`import test from 'node:test'; import assert from 'node:assert/strict';
    import {${names.join(',')}} from '../live/helpers/fixtureAudioStream.ts';
    test('all registered harness callables execute',async()=>{
      assert.deepEqual(await Promise.all([${names.map(name=>`${name}({n:1})`).join(',')}]),[1,2,3,4,5,6]);
    });`);
  try {
    fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
    f.write(helper.file,"import type {Page} from '@playwright/test';\ninterface State {n: number}\n"
      +names.map((name,n)=>`export async function ${name}(page: State, timeoutMs: number = 1): Promise<number> {return page.n+${n}+timeoutMs-1;}\n`).join(''));
    f.contract.helpers=[helper.file];
    const phase=f.run();
    assert.deepEqual(validateNativeCallables(phase.coverage,phase.binding,f.dir,[helper.file]),[helper.file]);
    // Witness of the hosted runtime's executed bytes: the module range ends exactly after Node's sourceURL suffix.
    const source=fs.readFileSync(path.join(f.dir,helper.file),'utf8'),url=pathToFileURL(path.join(phase.binding.cwd,helper.file)).href;
    const modules=phase.coverage.flatMap(report=>report.result??[]).filter(script=>script.url===url)
      .flatMap(script=>script.functions).filter(fn=>fn.functionName==='');
    assert.deepEqual([...new Set(modules.map(fn=>fn.ranges[0].endOffset))],[`${source}\n\n//# sourceURL=${url}`.length]);
    for(const change of [
      rows=>{for(const report of rows)for(const script of report.result)for(const fn of script.functions)if(fn.functionName===names[5])for(const range of fn.ranges)range.count=0;},
      rows=>{for(const report of rows)for(const script of report.result)for(const fn of script.functions)if(fn.functionName==='')fn.ranges[0].endOffset++;},
      rows=>{for(const report of rows)for(const script of report.result)script.url=script.url.replace('fixtureAudioStream.ts','fixtureAudioStream.js');},
      rows=>{for(const report of rows)for(const script of report.result)script.functions=script.functions.filter(fn=>fn.functionName==='');},
    ]) {
      const raw=structuredClone(phase.coverage);change(raw);
      assert.throws(()=>validateNativeCallables(raw,phase.binding,f.dir,[helper.file]),/NOT RUN|Missing|Malformed/);
    }
    const overrun=structuredClone(phase.coverage);
    for(const report of overrun)for(const script of report.result??[])for(const fn of script.functions)if(fn.functionName==='')fn.ranges[0].endOffset++;
    assert.throws(()=>validateNativeCallables(overrun,phase.binding,f.dir,[helper.file]),error=>{
      const detail=JSON.parse(error.message.slice(error.message.indexOf('{')));
      assert.equal(detail.predicate,'beyond-executed-length');assert.equal(detail.function,'<module>');
      assert.equal(detail.sourceSha256,createHash('sha256').update(source).digest('hex'));assert.equal(detail.sourceLength,source.length);
      assert.equal(detail.node,phase.binding.runtime.version);assert.equal(detail.range[1],detail.executedLength+1);
      return true;
    });
    f.write(helper.file,'\n '+fs.readFileSync(path.join(f.dir,helper.file),'utf8'));
    assert.throws(()=>validateNativeCallables(phase.coverage,phase.binding,f.dir,[helper.file]),/callable NOT RUN/);
  }finally{f.clean();}
});

test('retention owner helper executes actual offline guards and rejects import-only coverage',()=>{
  const helper=NATIVE_HELPERS.find(item=>item.file==='tests/db/content-free-retention-evidence.realpg.mjs');
  assert.equal(helper.consumer,'tests/db/retention-owner-matrix.test.mjs');
  assert.match(helper.claim,/protocol guards only; native database NOT RUN/);
  const f=fixture(fs.readFileSync(path.join(root,helper.consumer),'utf8'));
  try {
    fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
    for(const file of dependencyPaths(root,helper.file))f.write(file,fs.readFileSync(path.join(root,file)));
    f.contract.helpers=[helper.file];
    const phase=f.run();
    const checked=validateNativePhase(phase,{root:f.dir,provenance,inputSha256,runId,contract:f.contract});
    assert.equal(checked.counts.assertions,56);
    assert.deepEqual(checked.helpers,[helper.file]);
    for(const change of [rows=>rows.splice(0),rows=>{
      for(const report of rows)for(const script of report.result)for(const fn of script.functions)for(const range of fn.ranges)range.count=0;
    }]) {
      const raw=structuredClone(phase.coverage);change(raw);
      assert.throws(()=>validateNativeCallables(raw,phase.binding,f.dir,[helper.file]));
    }
    f.write(f.file,"import test from 'node:test';import assert from 'node:assert/strict';import './content-free-retention-evidence.realpg.mjs';test('import alone is not callable execution',()=>assert.equal(1,1));");
    assert.throws(f.run,/Native callable NOT RUN/);
  }finally{f.clean();}
});

function xml(cases='<testcase name="actual assertion" classname="./backend/supabase/functions/fixture.test.ts"/>',attrs='tests="1" failures="0" errors="0" disabled="0"') {
  return `<?xml version="1.0"?><testsuites><testsuite name="./backend/supabase/functions/fixture.test.ts" ${attrs}>${cases}</testsuite></testsuites>`;
}
const denoBinding={cwd:root,testFile:'backend/supabase/functions/fixture.test.ts'};
test('Deno parses real-shaped JUnit with the actually installed jsdom-relative saxes parser',()=>{
  const require=createRequire(path.join(root,'node_modules/jsdom/package.json'));
  assert.equal(JSON.parse(fs.readFileSync(require.resolve('saxes/package.json'))).version,'6.0.0');
  assert.deepEqual(parseDenoJunit(xml(),denoBinding,root),{collected:1,assertions:1});
});
for(const [name,raw] of [
  ['absent',''],['truncated',xml().slice(0,-10)],['invalid entity',xml().replace('actual assertion','&missing;')],
  ['wrong file',xml().replaceAll('fixture.test.ts','other.test.ts')],['zero tests',xml('','tests="0" failures="0" errors="0"')],
  ['failed',xml().replace('failures="0"','failures="1"')],['error',xml().replace('errors="0"','errors="1"')],
  ['skipped element',xml('<testcase name="skipped" classname="./backend/supabase/functions/fixture.test.ts"><skipped/></testcase>')],
  ['disabled',xml().replace('disabled="0"','disabled="1"')],['mismatched count',xml().replace('tests="1"','tests="2"')],
  ['doctype','<!DOCTYPE testsuites [<!ENTITY x "fake">]>'+xml().replace('<?xml version="1.0"?>','')],
  ['sibling outside suite',xml('').replace('</testsuite></testsuites>',
    '</testsuite><testcase name="actual assertion" classname="./backend/supabase/functions/fixture.test.ts"/></testsuites>')],
  ['nested inside system-out',xml('<system-out><testcase name="actual assertion" classname="./backend/supabase/functions/fixture.test.ts"/></system-out>')],
])test(`Deno ${name} receipt is refused`,()=>assert.throws(()=>parseDenoJunit(raw,denoBinding,root),/JUnit/));

for(const failure of ['throws','unverified'])test(`warmup drain PASS cannot authorize cleanup after actual-child drain ${failure}`,()=>{
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'native-drain-retain-'));
  const evidence=path.join(copy,'owned-evidence.json');fs.writeFileSync(evidence,'retained evidence');
  let drains=0;
  const children=nativeChildTracker(()=>{
    if(++drains===1)return {status:'drained'};
    if(failure==='throws')throw new Error('second child permission denial');
    return {status:'unknown'};
  },{spawn:()=>({pid:1700001,status:0,signal:null,stdout:'actual child output',stderr:''})});
  try {
    children.run(['fixture-runtime','warmup'],{});children.assertDrained(copy);
    assert.throws(()=>children.run(['fixture-runtime','actual-test'],{}),error=>{
      assert.equal(error.diagnostics.pid,1700001);assert.match(error.diagnostics.stdout,/actual child output/);return true;
    });
    assert.throws(()=>children.assertDrained(copy),error=>error.retainedCopy===copy);
    assert.equal(fs.readFileSync(evidence,'utf8'),'retained evidence');
  }finally{fs.rmSync(copy,{recursive:true,force:true});}
});

function fixture(source="import test from 'node:test'; import assert from 'node:assert/strict'; test('actual assertion',()=>assert.equal(2+3,5));") {
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-evidence-control-')));
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),bytes);};
  write('package.json','{"type":"module"}');write('pnpm-lock.yaml','synthetic immutable lock');
  write(NATIVE_REPORTER,fs.readFileSync(path.join(root,NATIVE_REPORTER)));
  const file='tests/db/actual.test.mjs';write(file,source);
  const contract={testFile:file,runner:'node-test',helpers:[],batch:0};
  const run=()=>produceNativePhase({root:dir,cwd:dir,contract,provenance,inputSha256,runId,sourceCopyCommit:'e'.repeat(40),
    environment:testEnvironment(dir,null,''),drain:drainOwnedPhase});
  return {dir,file,write,contract,run,clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('INSTALLED Node reporter observes actual collection/assertion/drain and rejects altered receipts',()=>{
  const f=fixture();
  try {
    const phase=f.run();
    assert.equal(validateNativePhase(phase,{root:f.dir,provenance,inputSha256,runId,contract:f.contract}).counts.assertions,1);
    assert.equal(phase.execution.processCleanup.status,'drained');
    for(const [name,change] of [
      ['absent events',p=>{p.stdout='';}],['wrong head',p=>{p.binding.provenance.commit='f'.repeat(40);}],
      ['wrong attempt',p=>{p.binding.provenance.runAttempt='3';}],['wrong input',p=>{p.binding.inputSha256='0'.repeat(64);}],
      ['wrong file',p=>{p.binding.testFile='tests/db/other.test.mjs';}],['wrong runtime',p=>{p.binding.runtime.version='wrong';}],
      ['filtered command',p=>{p.binding.command.push('--test-name-pattern=absent');}],
      ['failed exit',p=>{p.execution.status=1;}],['skipped drain',p=>{p.execution.processCleanup.status='unknown';}],
    ]) {
      const changed=structuredClone(phase);change(changed);
      assert.throws(()=>validateNativePhase(changed,{root:f.dir,provenance,inputSha256,runId,contract:f.contract}),undefined,name);
    }
    const receipt={schemaVersion:2,runId,provenance,...Object.fromEntries(['commit','tree','snapshotSha256'].map(k=>[k,provenance[k]])),
      status:'executed',batch:executionBatchIdentity(selectNativeContracts(f.dir,[f.file]),0),
      tests:[{testFile:f.file,testSha256:hash(fs.readFileSync(path.join(f.dir,f.file))),phase}]};
    assert.deepEqual([...validateNativeReceipt(receipt,{root:f.dir,provenance,inputSha256,files:[f.file]})],[f.file]);
    for(const change of [r=>{r.tests=[];},r=>{r.tests.push(r.tests[0]);},r=>{r.tests[0].testSha256='0'.repeat(64);},r=>{r.provenance.runAttempt='3';},
      r=>{delete r.batch;},r=>{r.batch.selectionSha256='0'.repeat(64);},r=>{r.batch.index=1;}]) {
      const changed=structuredClone(receipt);change(changed);
      assert.throws(()=>validateNativeReceipt(changed,{root:f.dir,provenance,inputSha256,files:[f.file]}));
    }
  }finally{f.clean();}
});
for(const [name,source] of [
  ['zero',"import 'node:test';"],
  ['skipped',"import test from 'node:test'; test.skip('skipped actual assertion',()=>{});"],
  ['failed',"import test from 'node:test'; import assert from 'node:assert/strict'; test('meaningful assertion',()=>assert.equal(2+3,6));"],
])test(`INSTALLED Node ${name} execution cannot produce a qualifying receipt`,()=>{
  const f=fixture(source);
  try {assert.throws(f.run,error=>{
    if(name==='failed')assert.match(error.diagnostics?.stdout??'',/meaningful assertion/);
    return true;
  });}finally{f.clean();}
});

test('native command has no filter/skip and frozen imports never grant test effect permissions',()=>{
  const command=nativeCommand({runtime:{runner:'deno',execPath:'/installed/deno'},testFile:'actual.test.ts'});
  assert.ok(command.includes('--frozen'));assert.ok(command.includes('--lock=backend/supabase/functions/deno.lock'));
  for(const flag of ['--deny-env','--deny-net','--deny-read','--deny-write','--no-prompt'])assert.ok(command.includes(flag));
  assert.ok(!command.some(arg=>/allow-|filter|permit-no-files|no-check/.test(arg)));
  assert.ok(command.includes('--cached-only'));
  const warmup=nativeWarmupCommand({runtime:{runner:'deno',execPath:'/installed/deno'},testFile:'actual.test.ts'});
  assert.ok(warmup.includes('--no-run'));assert.ok(!warmup.includes('--cached-only'));
});
test('only the exact coaching test receives the named synthetic-key permission; warmup never does',()=>{
  const selected='backend/supabase/functions/get-ai-suggestions/index.test.ts';
  for(const file of [selected,selected.replace('index.test.ts','other.test.ts'),`./${selected}`,'actual.test.ts']) {
    const binding={testFile:file,runtime:{runner:'deno',execPath:'/installed/deno'}};
    const command=nativeCommand(binding),policy=nativeDenoPolicy(file);
    assert.deepEqual(policy.environment.names,file===selected?['GEMINI_API_KEY']:[]);
    assert.equal(command.includes('--allow-env=GEMINI_API_KEY'),file===selected);
    assert.equal(command.includes('--deny-env'),file!==selected);
    for(const flag of ['--deny-net','--deny-read','--deny-write','--deny-run','--no-prompt'])assert.ok(command.includes(flag));
    assert.equal(command.some(flag=>flag==='--allow-env'||flag.includes('OTHER_SECRET')),false);
    const warmup=nativeWarmupCommand(binding);
    assert.ok(warmup.includes('--deny-env'));assert.equal(warmup.some(flag=>flag.startsWith('--allow-env')),false);
  }
});
test('native child drops inherited key/sentinels and never reinjects after the missing-key test',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-env-control-'));
  try {
    const environment=nativeEnvironment(dir,{GEMINI_API_KEY:'inherited-sentinel',OTHER_SECRET:'other-sentinel',
      NODE_OPTIONS:'--import=untrusted',TEST_EFFICACY_BINDING:'forged'});
    for(const name of ['GEMINI_API_KEY','OTHER_SECRET','NODE_OPTIONS','TEST_EFFICACY_BINDING'])assert.equal(name in environment,false);
    assert.equal(Object.values(environment).some(value=>value.includes('sentinel')),false);
    assert.deepEqual(nativeDenoPolicy('backend/supabase/functions/get-ai-suggestions/index.test.ts').environment,
      {names:['GEMINI_API_KEY'],initial:'absent',inherit:false,syntheticValue:'test-key',reinject:false});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('frozen source refuses global, aliased and imported setters even while all expected literal calls remain',()=>{
  const f=fixture(),entry='backend/supabase/functions/get-ai-suggestions/index.test.ts';
  const files=[...new Set([...dependencyPaths(root,entry),'package.json','pnpm-lock.yaml',
    'backend/supabase/functions/deno.json','backend/supabase/functions/deno.lock'])];
  for(const file of files)f.write(file,fs.readFileSync(path.join(root,file)));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
  try {
    const admitted=validateSyntheticSource(f.dir,entry);
    assert.equal(admitted.files[entry],hash(fs.readFileSync(path.join(root,entry))));
    for(const [file,suffix] of [
      [entry,"\nglobalThis.Deno.env.set('GEMINI_API_KEY','unapproved-value');\n"],
      [entry,"\nconst setter=Deno.env.set;setter('GEMINI_API_KEY','unapproved-value');\n"],
      ['backend/supabase/functions/get-ai-suggestions/index.ts',"\nconst environment=Deno.env;environment.set('GEMINI_API_KEY','unapproved-value');\n"],
    ]) {
      const original=fs.readFileSync(path.join(root,file),'utf8');f.write(file,original+suffix);
      assert.throws(()=>validateSyntheticSource(f.dir,entry),/Synthetic-key test\/import profile/);
      f.write(file,original);
    }
    // A caller may alter its returned receipt without mutating the trusted pins.
    admitted.files[entry]='0'.repeat(64);
    assert.equal(validateSyntheticSource(f.dir,entry).files[entry],hash(fs.readFileSync(path.join(root,entry))));
  }finally{f.clean();}
});
test('reviewed coaching error source admits exactly its ten pinned inputs and refuses drift in every input',()=>{
  const f=fixture(),entry='backend/supabase/functions/get-ai-suggestions/index.test.ts';
  const files=[...new Set([...dependencyPaths(root,entry),'package.json','pnpm-lock.yaml',
    'backend/supabase/functions/deno.json','backend/supabase/functions/deno.lock'])];
  for(const file of files)f.write(file,fs.readFileSync(path.join(root,file)));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
  try {
    const admitted=validateSyntheticSource(f.dir,entry);
    assert.equal(admitted.id,'coaching-errors-cors-compatible');
    assert.equal(Object.keys(admitted.files).length,10);
    assert.deepEqual(Object.keys(admitted.files).sort(),files.sort());
    for(const file of files) {
      const original=fs.readFileSync(path.join(root,file));
      assert.equal(admitted.files[file],hash(original));
      f.write(file,Buffer.concat([original,Buffer.from('\n ')]));
      assert.throws(()=>validateSyntheticSource(f.dir,entry),/Synthetic-key test\/import profile/,file);
      f.write(file,original);
    }
    assert.equal(validateSyntheticSource(f.dir,entry).id,'coaching-errors-cors-compatible');
  }finally{f.clean();}
});
test('owned frozen import warmup is separate and cannot disappear, fail, drift or grant test permissions',()=>{
  const binding={cwd:'/owned/copy',cacheDirectory:'/owned/copy/.native-deno-cache',testFile:'actual.test.ts',
    runtime:{runner:'deno',execPath:'/installed/deno',configSha256:'a'.repeat(64),lockSha256:'b'.repeat(64)}};
  const warmup={command:nativeWarmupCommand(binding),cacheDirectory:binding.cacheDirectory,before:binding.runtime,after:binding.runtime,
    execution:{status:0,signal:null,error:null,processCleanup:{status:'drained'}}};
  validateWarmup(warmup,binding);
  assert.throws(()=>validateWarmup(null,binding),/warmup/);
  for(const change of [w=>{w.cacheDirectory='/shared/cache';},w=>{w.command.push('--allow-net');},w=>{w.execution.status=1;},
    w=>{w.after.lockSha256='c'.repeat(64);},w=>{w.before.configSha256='c'.repeat(64);},w=>{w.execution.processCleanup.status='unknown';}]) {
    const changed=structuredClone(warmup);change(changed);assert.throws(()=>validateWarmup(changed,binding),/warmup/);
  }
});
test('INSTALLED actual helper calls retain exact V8 ranges; import-only, wrong source and zero-count ranges fail',()=>{
  const helper=NATIVE_HELPERS[0];
  const f=fixture("import test from 'node:test'; import assert from 'node:assert/strict'; import {buildMainU1ReplayPlan,parseMainProofArguments} from './account-closure-full-chain.mjs'; test('actually calls both planner functions',()=>{assert.equal(buildMainU1ReplayPlan(),7);assert.equal(parseMainProofArguments(),8);});");
  try {
    fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
    f.write(helper.file,'export function buildMainU1ReplayPlan(){return 7;}\nexport function parseMainProofArguments(){return 8;}\n');
    f.contract.helpers=[helper.file];
    const phase=f.run();
    assert.deepEqual(validateNativeCallables(phase.coverage,phase.binding,f.dir,[helper.file]),[helper.file]);
    for(const change of [r=>{r[0].result=[];},r=>{for(const report of r)for(const script of report.result)for(const fn of script.functions)for(const range of fn.ranges)range.count=0;},
      r=>{for(const report of r)for(const script of report.result)script.url=script.url.replace('account-closure-full-chain','unrelated');},
      r=>{for(const report of r)for(const script of report.result)for(const fn of script.functions)for(const range of fn.ranges)range.endOffset++;},
      r=>{for(const report of r)for(const script of report.result)for(const fn of script.functions)for(const range of fn.ranges)range.count=String(range.count);},
      r=>{for(const report of r)for(const script of report.result)for(const fn of script.functions)for(const range of fn.ranges)range.startOffset=-1;}]) {
      const raw=structuredClone(phase.coverage);change(raw);assert.throws(()=>validateNativeCallables(raw,phase.binding,f.dir,[helper.file]));
    }
  }finally{f.clean();}
});
test('import-only raw helper coverage cannot claim planner or observer execution',()=>{
  const binding={cwd:root};
  // The typed fixture-audio helper's import-only refusal runs against its own reviewed source below.
  for(const helper of NATIVE_HELPERS.filter(item=>item.file.endsWith('.mjs'))) {
    const raw=[{result:[{url:pathToFileURL(path.join(root,helper.file)).href,
      functions:[{functionName:'',isBlockCoverage:true,ranges:[{startOffset:0,endOffset:fs.readFileSync(path.join(root,helper.file),'utf8').length,count:1}]}]}]}];
    assert.throws(()=>validateNativeCallables(raw,binding,root,[helper.file]),/callable NOT RUN/);
    assert.throws(()=>validateNativeCallables([],binding,root,[helper.file]),/Missing/);
  }
});
test('SQL execution witness binds both actual consumed sources and both sides of execution',()=>{
  const binding={phaseId:randomUUID()};
  const raw={schemaVersion:1,phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding)),consumer:SQL_CONSUMER,
    consumed:sqlSourceBinding(root).map(item=>({...item,beforeSha256:item.sha256,afterSha256:item.sha256}))};
  assert.deepEqual(validateSqlWitness(raw,binding,root),SQL_INPUTS);
  for(const change of [r=>{r.phaseId=randomUUID();},r=>{r.bindingSha256='a'.repeat(64);},r=>{r.consumed=[];},
    r=>{r.consumed[0].sha256='0'.repeat(64);},r=>{r.consumed[1].afterSha256='0'.repeat(64);},r=>{r.consumed.reverse();}]) {
    const changed=structuredClone(raw);change(changed);assert.throws(()=>validateSqlWitness(changed,binding,root),/SQL consumption witness/);
  }
  assert.throws(()=>validateSqlWitness(null,binding,root),/SQL consumption witness/);
});
test('full-evidence provisions Deno on its own runner; the Edge job is not its runtime',()=>{
  const require=createRequire(path.join(root,'package.json')),yaml=require('yaml');
  const workflow=yaml.parse(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'));
  const steps=workflow.jobs['full-evidence'].steps;
  assert.equal(steps.filter(step=>step.uses==='denoland/setup-deno@v2'&&step.with?.['deno-version']==='v2.x').length,1);
  assert.ok(steps.findIndex(step=>step.uses==='denoland/setup-deno@v2')<steps.findIndex(step=>step.name==='Generate qualified software quality evidence'));
  const conformance=steps.findIndex(step=>step.name==='Prove owned cold Deno conformance');
  assert.ok(conformance>steps.findIndex(step=>step.uses==='denoland/setup-deno@v2'));
  assert.equal(steps[conformance].env.TEST_EFFICACY_DENO_REAL_RUNTIME,'1');
  assert.equal(steps[conformance].run,'node --test tests/unit/nativeTestExecutionEvidence.test.js');
});

test('service caller provisions Deno before any live setup and the paired quality writer',()=>{
  const require=createRequire(path.join(root,'package.json')),yaml=require('yaml');
  const workflow=yaml.parse(fs.readFileSync(path.join(root,'.github/workflows/service-level-evidence.yml'),'utf8'));
  const steps=workflow.jobs['service-level-evidence'].steps;
  const deno=steps.findIndex(step=>step.uses==='denoland/setup-deno@v2');
  assert.equal(steps.filter(step=>step.uses==='denoland/setup-deno@v2').length,1);
  assert.equal(steps[deno].with['deno-version'],'v2.x');
  assert.equal(deno,steps.findIndex(step=>step.name==='Setup Environment')+1);
  assert.ok(deno<steps.findIndex(step=>step.name==='Setup test users'));
  assert.ok(deno<steps.findIndex(step=>String(step.run??'').includes('pnpm metrics:service-levels')));
  assert.equal(steps[deno].if,undefined);
  assert.notEqual(steps[deno]['continue-on-error'],true);
});

// Explicit conformance evidence is independent of changed-file inventory. Unit shards do
// not have Deno; full-evidence explicitly provisions it and selects this real test route.
if(process.env.TEST_EFFICACY_DENO_REAL_RUNTIME==='1') {
  test('INSTALLED Deno enforces synthetic key, missing key and all denied environment/effect boundaries',()=>{
    const f=fixture();
    const file='backend/supabase/functions/get-ai-suggestions/index.test.ts';
    fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
    for(const entry of ['backend/supabase/functions/deno.json','backend/supabase/functions/deno.lock'])f.write(entry,fs.readFileSync(path.join(root,entry)));
    const source=`Deno.test('synthetic key and denied boundaries',async()=>{
      if(Deno.env.get('GEMINI_API_KEY')!==undefined)throw Error('inherited key');
      Deno.env.set('GEMINI_API_KEY','test-key');
      if(Deno.env.get('GEMINI_API_KEY')!=='test-key')throw Error('wrong synthetic key');
      Deno.env.delete('GEMINI_API_KEY');
      if(Deno.env.get('GEMINI_API_KEY')!==undefined)throw Error('missing key reinjected');
      async function denied(effect:()=>unknown){let blocked=false;try{await effect();}catch(error){blocked=error instanceof Deno.errors.NotCapable;}if(!blocked)throw Error('permission broadened');}
      await denied(()=>globalThis.Deno.env.get('OTHER_SECRET'));
      await denied(()=>globalThis.Deno.env.toObject());
      await denied(()=>fetch('https://example.invalid'));
      await denied(()=>Deno.readTextFile('/unreachable'));
      await denied(()=>Deno.writeTextFile('/unreachable','x'));
      await denied(()=>new Deno.Command(${JSON.stringify(process.execPath)}).output());
    });`;
    f.write(file,source);
    const children=nativeChildTracker(drainOwnedPhase),runtime=nativeRuntime(f.dir,'deno');
    try {
      // This deliberately synthetic file is NOT an admitted producer source. Here
      // we test the real Deno permission flags independently of product receipts.
      const binding={runtime,testFile:file,cwd:f.dir},environment=nativeEnvironment(f.dir,{GEMINI_API_KEY:'inherited-sentinel',OTHER_SECRET:'sentinel'});
      environment.DENO_DIR=path.join(f.dir,'.owned-cache');fs.mkdirSync(environment.DENO_DIR);
      for(const command of [nativeWarmupCommand(binding),nativeCommand(binding)]) {
        const {result}=children.run(command,{cwd:f.dir,env:environment,timeout:60000,killSignal:'SIGKILL',detached:true,encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);
        if(!command.includes('--no-run'))assert.equal(parseDenoJunit(result.stdout,binding,f.dir).assertions,1);
      }
      assert.throws(()=>produceNativePhase({root:f.dir,cwd:f.dir,contract:{testFile:file,runner:'deno',helpers:[]},
        provenance,inputSha256,runId,sourceCopyCommit:'e'.repeat(40),environment:{},children}),/Synthetic-key test\/import profile/);
    }finally{children.assertDrained(f.dir);f.clean();}
  });
  test('INSTALLED fixed coaching closure rejects indirect/aliased/imported unapproved setters and forged profile receipts',()=>{
    const f=fixture(),file='backend/supabase/functions/get-ai-suggestions/index.test.ts';
    const files=[...new Set([...dependencyPaths(root,file),'package.json','pnpm-lock.yaml',
      'backend/supabase/functions/deno.json','backend/supabase/functions/deno.lock'])].sort();
    for(const entry of files)f.write(entry,fs.readFileSync(path.join(root,entry)));
    const provenance=executionContext(root,{...process.env,SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const sourceManifest=files.map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
    const inputSha256=hash(JSON.stringify(sourceManifest)),runId=randomUUID();
    const sourceCopyCommit=initializeCopyRepository(f.dir,testEnvironment(f.dir,null,''));
    fs.symlinkSync(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'dir');
    const artifact=path.join(root,'artifacts/metrics/native-coaching-policy-conformance.json');
    fs.rmSync(artifact,{force:true});
    const contract={testFile:file,runner:'deno',helpers:[]},children=nativeChildTracker(drainOwnedPhase);
    const execute=()=>produceNativePhase({root:f.dir,cwd:f.dir,contract,provenance,inputSha256,runId,
      sourceCopyCommit,environment:{GEMINI_API_KEY:'inherited-sentinel'},children});
    let phase;
    try {
      phase=execute();
      assert.ok(validateNativePhase(phase,{root:f.dir,provenance,inputSha256,runId,contract}).counts.assertions>100);
      for(const change of [
        p=>{p.binding.permissionPolicy.environment.names.push('OTHER_SECRET');},
        p=>{p.binding.permissionPolicy.environment.syntheticValue='other';},
        p=>{p.binding.permissionPolicy.environment.inherit=true;},
        p=>{p.binding.permissionPolicy.environment.reinject=true;},
        p=>{p.binding.syntheticSource.files[file]='0'.repeat(64);},
        p=>{p.binding.command=p.binding.command.map(arg=>arg==='--allow-env=GEMINI_API_KEY'?'--allow-env':arg);},
        p=>{p.binding.permissionPolicy.environment.names=[];p.binding.command=p.binding.command.map(arg=>arg==='--allow-env=GEMINI_API_KEY'?'--deny-env':arg);},
        p=>{p.warmup.command=p.warmup.command.map(arg=>arg==='--deny-env'?'--allow-env=GEMINI_API_KEY':arg);},
        p=>{p.binding.testFile=file.replace('index.test.ts','other.test.ts');p.binding.permissionPolicy=nativeDenoPolicy(p.binding.testFile);p.binding.command=nativeCommand(p.binding);},
      ]) {
        const changed=structuredClone(phase);change(changed);
        assert.throws(()=>validateNativePhase(changed,{root:f.dir,provenance,inputSha256,runId,contract}));
      }
      const source=fs.readFileSync(path.join(root,file),'utf8');
      const helper='backend/supabase/functions/get-ai-suggestions/index.ts',originalHelper=fs.readFileSync(path.join(root,helper),'utf8');
      for(const [changedFile,changed] of [
        [file,source+"\nglobalThis.Deno.env.set('GEMINI_API_KEY','unapproved-value');\n"],
        [file,source+"\nconst setter=Deno.env.set;setter('GEMINI_API_KEY','unapproved-value');\n"],
        [helper,originalHelper+"\nglobalThis.Deno.env.set('GEMINI_API_KEY','unapproved-value');\n"],
      ]) {
        f.write(changedFile,changed);assert.throws(execute,/Synthetic-key test\/import profile/);
        f.write(changedFile,fs.readFileSync(path.join(root,changedFile)));
      }
      assert.deepEqual(sourceIdentity(root),{commit:provenance.commit,tree:provenance.tree,snapshotSha256:provenance.snapshotSha256});
    }finally{children.assertDrained(f.dir);f.clean();}
    fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,JSON.stringify({status:'PASS',phase,
      scope:'actual frozen unchanged-main coaching mocks, not provider/Production proof',provenance,sourceManifest,
      copyCleanup:'REMOVED_AFTER_VERIFIED_DRAINS'},null,2)+'\n');
  });
  test('INSTALLED cold Deno executes the unchanged main CORS suite with frozen imports and no effect permissions',()=>{
    const entry='backend/supabase/functions/_shared/cors.test.ts';
    const files=[...new Set([...dependencyPaths(root,entry),NATIVE_REPORTER,'package.json','pnpm-lock.yaml',
      'backend/supabase/functions/deno.json','backend/supabase/functions/deno.lock'])].sort();
    const output=path.join(root,'artifacts/metrics/native-deno-conformance.json');
    fs.rmSync(output,{force:true});
    const provenance=executionContext(root,{...process.env,SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const sourceManifest=files.map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
    const copy=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cold-deno-conformance-')));
    const children=nativeChildTracker(drainOwnedPhase);
    const result={schemaVersion:1,scope:'explicit unchanged-main Deno conformance, not changed-file/native-database/live acceptance',
      provenance,entry,sourceManifest,startedUtc:new Date().toISOString()};
    let failure;
    try {
      for(const item of sourceManifest) {
        const target=path.join(copy,item.file);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.copyFileSync(path.join(root,item.file),target);assert.equal(hash(fs.readFileSync(target)),item.sha256);
      }
      const environment=testEnvironment(copy,null,'');
      const sourceCopyCommit=initializeCopyRepository(copy,environment);
      fs.symlinkSync(path.join(root,'node_modules'),path.join(copy,'node_modules'),'dir');
      const inputSha256=hash(JSON.stringify(sourceManifest.map(item=>[item.file,item.sha256])));
      const contract={testFile:entry,runner:'deno',helpers:[]},runId=randomUUID();
      result.phase=produceNativePhase({root:copy,cwd:copy,contract,provenance,inputSha256,sourceCopyCommit,runId,environment,children});
      result.observed=validateNativePhase(result.phase,{root,provenance,inputSha256,runId,contract}).counts;
      assert.ok(result.observed.assertions>0);
      for(const item of sourceManifest) {
        assert.equal(hash(fs.readFileSync(path.join(copy,item.file))),item.sha256);
        assert.equal(hash(fs.readFileSync(path.join(root,item.file))),item.sha256);
      }
      assert.deepEqual(sourceIdentity(root),{commit:provenance.commit,tree:provenance.tree,snapshotSha256:provenance.snapshotSha256});
    }catch(error){failure=error;result.error=error.message;result.diagnostics=error.diagnostics??null;}
    try {
      children.assertDrained(copy);cleanupOwnedCopy(copy,failure);result.copyCleanup='REMOVED_AFTER_VERIFIED_DRAINS';
    }catch(error){failure=error;result.copyCleanup='RETAINED';result.retainedCopy=copy;result.error=error.message;}
    result.status=failure?'FAIL':'PASS';result.finishedUtc=new Date().toISOString();
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
    if(failure)throw failure;
  });
}

function packageFixture(files) {
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-package-route-')));
  for(const [file,source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),source);
  }
  return {dir,clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const nodeTestCjs="const test=require('node:test');const assert=require('node:assert/strict');test('package control',()=>assert.equal(2+3,5));";

test('cloud-test package node:test .test.cjs routes to native node-test; other .cjs stays unrouted',()=>{
  const f=packageFixture({
    'tools/cloud-test/harness/bundle/selftest/guard-core.test.cjs':nodeTestCjs,
    'tools/cloud-test/harness/bundle/selftest/no-runner.test.cjs':"const assert=require('assert');assert.equal(1,1);",
    'tests/unit/outside-package.test.cjs':nodeTestCjs,
  });
  try {
    assert.equal(nativeTestRoute('tools/cloud-test/harness/bundle/selftest/guard-core.test.cjs',f.dir)?.runner,'node-test');
    assert.equal(executionRoute('tools/cloud-test/harness/bundle/selftest/guard-core.test.cjs',f.dir)?.runner,'node-test');
    // A file that never imports node:test has no actual runner: it must stay UNCOVERED, never default-pass.
    assert.equal(nativeTestRoute('tools/cloud-test/harness/bundle/selftest/no-runner.test.cjs',f.dir),null);
    assert.equal(executionRoute('tools/cloud-test/harness/bundle/selftest/no-runner.test.cjs',f.dir),null);
    // The new route is the reviewed package only, not every .cjs in the repository.
    assert.equal(nativeTestRoute('tests/unit/outside-package.test.cjs',f.dir),null);
  } finally {f.clean();}
});

test('native contracts beyond eight run as deterministic batches of eight with a fixed total ceiling',()=>{
  const files=Object.fromEntries(Array.from({length:9},(_,n)=>[`tools/cloud-test/tests/p${String(n).padStart(2,'0')}.test.cjs`,nodeTestCjs]));
  const f=packageFixture(files);
  try {
    const contracts=selectNativeContracts(f.dir,Object.keys(files).reverse());
    assert.equal(contracts.length,9);
    assert.deepEqual(contracts.map(item=>item.testFile),Object.keys(files));
    assert.deepEqual(contracts.map(item=>item.batch),[0,0,0,0,0,0,0,0,1]);
    for(let batch=0;batch<=1;batch++)assert.ok(contracts.filter(item=>item.batch===batch).length<=8);
  } finally {f.clean();}
  const many=Object.fromEntries(Array.from({length:65},(_,n)=>[`tools/cloud-test/tests/q${String(n).padStart(2,'0')}.test.cjs`,nodeTestCjs]));
  const g=packageFixture(many);
  try {
    assert.throws(()=>selectNativeContracts(g.dir,Object.keys(many)),/NOT RUN: native execution exceeds 8 batches of 8 files/);
  } finally {g.clean();}
});

test('a complete 43-contract package selection fits six batches without trimming, and 64 is the inclusive ceiling',()=>{
  for(const [count,batches] of [[43,6],[64,8]]) {
    const files=Object.fromEntries(Array.from({length:count},(_,n)=>[`tools/cloud-test/harness/bundle/selftest/s${String(n).padStart(2,'0')}.test.cjs`,nodeTestCjs]));
    const f=packageFixture(files);
    try {
      const contracts=selectNativeContracts(f.dir,Object.keys(files));
      // Every selected file is present exactly once: nothing is trimmed to fit the budget.
      assert.deepEqual(contracts.map(item=>item.testFile),Object.keys(files).sort());
      assert.equal(new Set(contracts.map(item=>item.batch)).size,batches);
      for(let batch=0;batch<batches;batch++)assert.ok(contracts.filter(item=>item.batch===batch).length<=8);
    } finally {f.clean();}
  }
});

test('a native phase bound to another batch is refused even when its execution passed',()=>{
  const f=fixture();
  try {
    const contract={...f.contract,batch:0};
    const phase=produceNativePhase({root:f.dir,cwd:f.dir,contract,provenance,inputSha256,runId,sourceCopyCommit:'e'.repeat(40),
      environment:testEnvironment(f.dir,null,''),drain:drainOwnedPhase});
    assert.doesNotThrow(()=>validateNativePhase(phase,{root:f.dir,provenance,inputSha256,runId,contract}));
    assert.throws(()=>validateNativePhase(phase,{root:f.dir,provenance,inputSha256,runId,contract:{...contract,batch:1}}),/Wrong native source/);
    const moved=structuredClone(phase);moved.binding.batch=1;
    assert.throws(()=>validateNativePhase(moved,{root:f.dir,provenance,inputSha256,runId,contract}),/Wrong native source/);
  } finally {f.clean();}
});

test('batch reconciliation requires every batch once with exactly its contracts',()=>{
  const files=Object.fromEntries(Array.from({length:17},(_,n)=>[`tools/cloud-test/tests/r${String(n).padStart(2,'0')}.test.cjs`,nodeTestCjs]));
  const f=packageFixture(files);
  try {
    const contracts=selectNativeContracts(f.dir,Object.keys(files));
    const receipts=[0,1,2].map(index=>({batch:executionBatchIdentity(contracts,index),
      tests:contracts.filter(item=>item.batch===index).map(item=>({testFile:item.testFile}))}));
    assert.deepEqual(receipts.map(item=>item.tests.length),[8,8,1]);
    assert.doesNotThrow(()=>reconcileExecutionBatches(receipts,contracts,'native'));
    for(const [name,change,pattern] of [
      ['missing batch',r=>r.pop(),/batch inventory/],
      ['extra batch',r=>r.push(structuredClone(r[2])),/batch inventory/],
      ['batches reordered',r=>r.reverse(),/batch identity/],
      ['missing contract',r=>r[1].tests.pop(),/Missing, extra or duplicate native contracts in batch 1/],
      ['duplicate contract',r=>r[2].tests.push(r[2].tests[0]),/batch 2/],
      ['contract moved between batches',r=>r[2].tests.push(r[1].tests.pop()),/batch 1/],
      ['contract absent from selection',r=>{r[0].tests[0]={testFile:'tools/cloud-test/tests/unselected.test.cjs'};},/batch 0/],
      ['wrong selection digest',r=>{r[0].batch.selectionSha256='0'.repeat(64);},/batch identity/],
      ['wrong batch size',r=>{r[0].batch.size=9;},/batch identity/],
    ]) {
      const changed=structuredClone(receipts);change(changed);
      assert.throws(()=>reconcileExecutionBatches(changed,contracts,'native'),pattern,name);
    }
    // An empty selection still needs exactly one not-applicable receipt; zero receipts are refused.
    assert.throws(()=>reconcileExecutionBatches([],[],'native'),/batch inventory/);
    assert.doesNotThrow(()=>reconcileExecutionBatches([{batch:executionBatchIdentity([],0),tests:[]}],[],'native'));
  } finally {f.clean();}
});
