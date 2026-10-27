// @vitest-environment node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {NATIVE_REPORTER,NATIVE_HELPERS,SQL_INPUTS,SQL_CONSUMER,nativeTestRoute,selectNativeContracts,
  nativeCommand,nativeWarmupCommand,validateWarmup,produceNativePhase,validateNativePhase,validateNativeReceipt,
  parseDenoJunit,validateNativeCallables,sqlSourceBinding,validateSqlWitness} from '../../scripts/lib/nativeTestExecutionEvidence.mjs';
import {drainOwnedPhase,selectExecutionContracts} from '../../scripts/run-test-efficacy.mjs';
import {testEnvironment} from '../../scripts/lib/testExecutionEvidence.mjs';
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
  assert.equal(contracts.length,3);
  assert.equal(contracts.filter(item=>item.runner==='node-test').length,2);
  for(const item of NATIVE_HELPERS) {
    assert.equal(nativeTestRoute(item.file,root).consumer,item.consumer);
    assert.match(nativeTestRoute(item.file,root).claim,/NOT RUN/);
    assert.ok(!item.callables.includes('runMainClosureProof'));
  }
  assert.equal(nativeTestRoute('tests/db/unknown-runner.mjs',root),null);
  const sql=selectExecutionContracts(root,[...SQL_INPUTS,SQL_CONSUMER]);
  assert.equal(sql.length,1);assert.deepEqual(sql[0].sqlFiles,SQL_INPUTS);
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
])test(`Deno ${name} receipt is refused`,()=>assert.throws(()=>parseDenoJunit(raw,denoBinding,root),/JUnit/));

function fixture(source="import test from 'node:test'; import assert from 'node:assert/strict'; test('actual assertion',()=>assert.equal(2+3,5));") {
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-evidence-control-')));
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),bytes);};
  write('package.json','{"type":"module"}');write('pnpm-lock.yaml','synthetic immutable lock');
  write(NATIVE_REPORTER,fs.readFileSync(path.join(root,NATIVE_REPORTER)));
  const file='tests/db/actual.test.mjs';write(file,source);
  const contract={testFile:file,runner:'node-test',helpers:[]};
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
      status:'executed',tests:[{testFile:f.file,testSha256:hash(fs.readFileSync(path.join(f.dir,f.file))),phase}]};
    assert.deepEqual([...validateNativeReceipt(receipt,{root:f.dir,provenance,inputSha256,files:[f.file]})],[f.file]);
    for(const change of [r=>{r.tests=[];},r=>{r.tests.push(r.tests[0]);},r=>{r.tests[0].testSha256='0'.repeat(64);},r=>{r.provenance.runAttempt='3';}]) {
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
  for(const helper of NATIVE_HELPERS) {
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
});
