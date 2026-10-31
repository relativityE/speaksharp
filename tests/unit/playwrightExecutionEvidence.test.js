import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {replayBlobLifecycle,collectPlaywrightExecution,validatePlaywrightExecution,readBlobReport,digest} from '../../scripts/lib/playwrightExecutionEvidence.mjs';
import {executionContext,executionCoverage} from '../../scripts/lib/testExecutionEvidence.mjs';
const {test}=process.env.NODE_TEST_CONTEXT?await import('node:test'):await import('vitest');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const commit='a'.repeat(40);
const context={repositoryRoot:'/fixture',shard:{current:1,total:4},commit};
function records() {
  return [
    {method:'onBlobReportMetadata',params:{version:2,userAgent:'Playwright/1.57.0 (synthetic)',shard:{current:1,total:4}}},
    {method:'onConfigure',params:{config:{version:'1.57.0',rootDir:'/fixture/tests/e2e',metadata:{ci:{commitHash:commit}}}}},
    {method:'onProject',params:{project:{name:'full-suite',suites:[{entries:[{testId:'test-1',title:'named body',repeatEachIndex:0,location:{file:'named.e2e.spec.ts'}}]}]}}},
    {method:'onBegin'},
    {method:'onTestBegin',params:{testId:'test-1',result:{id:'attempt-1',retry:0}}},
    {method:'onTestEnd',params:{test:{testId:'test-1',expectedStatus:'passed'},result:{id:'attempt-1',status:'passed',errors:[]}}},
    {method:'onEnd',params:{result:{status:'passed'}}},
  ];
}
const replay=events=>replayBlobLifecycle(events.map(event=>JSON.stringify(event)).join('\n'),context);

test('synthetic raw ledger requires collected identity and both matching actual terminal callbacks',()=>{
  assert.deepEqual(replay(records()),[{id:'test-1',file:'tests/e2e/named.e2e.spec.ts',title:'named body'}]);
  assert.throws(()=>replay([records()[0],records()[1],records()[2],records()[3],records().at(-1)]),/Incomplete/);
});

for(const method of ['onBlobReportMetadata','onConfigure','onProject','onBegin','onTestBegin','onTestEnd','onEnd']) {
  test(`raw replay refuses missing or duplicated ${method}`,()=>{
    assert.throws(()=>replay(records().filter(event=>event.method!==method)));
    const events=records();events.splice(events.length-1,0,structuredClone(events.find(event=>event.method===method)));
    assert.throws(()=>replay(events));
  });
}

test('raw replay refuses retry, skip, failed body, errors, wrong attempt and uncollected identity',()=>{
  for(const mutate of [
    events=>{events[4].params.result.retry=1;},
    events=>{events[5].params.result.status='skipped';},
    events=>{events[5].params.test.expectedStatus='failed';},
    events=>{events[5].params.result.status='failed';},
    events=>{events[5].params.result.errors=[{message:'real assertion failure'}];},
    events=>{events[5].params.result.id='another-attempt';},
    events=>{events[4].params.testId='neighboring-test';},
    events=>{events.splice(5,0,{method:'onError',params:{error:{message:'worker died'}}});},
    events=>{events.at(-1).params.result.status='interrupted';},
  ]) {const events=records();mutate(events);assert.throws(()=>replay(events));}
});

test('a caught step rejection earns no failure when the actual test and run both passed',()=>{
  const events=records();
  events.splice(5,0,{method:'onStepEnd',params:{testId:'test-1',resultId:'attempt-1',
    step:{stepId:'step-1',error:{name:'Error',message:'controlled step rejection'}}}});
  assert.equal(replay(events).length,1);
  const failed=structuredClone(events);
  failed.find(event=>event.method==='onTestEnd').params.result.errors=[{message:'uncaught error'}];
  assert.throws(()=>replay(failed));
  const teardown=structuredClone(events);
  teardown.at(-1).params.result.status='failed';
  assert.throws(()=>replay(teardown));
});

test('raw replay refuses stale source/runtime, wrong shard/project and escaped live path',()=>{
  for(const mutate of [
    events=>{events[1].params.config.metadata.ci.commitHash='b'.repeat(40);},
    events=>{events[0].params.userAgent='Playwright/9.0.0';},
    events=>{events[1].params.config.version='9.0.0';},
    events=>{events[0].params.shard.current=2;},
    events=>{events[2].params.project.name='live';},
    events=>{events[2].params.project.suites[0].entries[0].location.file='../live/case.live.spec.ts';},
    events=>{events[2].params.project.suites[0].entries[0].repeatEachIndex=1;},
  ]) {const events=records();mutate(events);assert.throws(()=>replay(events));}
});

test('raw replay refuses a terminal callback before its begin or outside the run window',()=>{
  const endedEarly=records();[endedEarly[4],endedEarly[5]]=[endedEarly[5],endedEarly[4]];
  assert.throws(()=>replay(endedEarly));
  const afterRun=records();afterRun.push(afterRun.splice(5,1)[0]);assert.throws(()=>replay(afterRun));
});

function installedFixture() {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ordinary-playwright-receipt-')));
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});fs.writeFileSync(path.join(directory,file),bytes);};
  for(const file of ['scripts/efficacy-playwright-reporter.mjs','scripts/efficacy-reporter.mjs',
    'scripts/lib/playwrightExecutionEvidence.mjs','scripts/lib/testExecutionEvidence.mjs','scripts/lib/nativeTestExecutionEvidence.mjs','scripts/lib/pythonTestExecutionEvidence.mjs','scripts/lib/python-unittest-reporter.py',
    'scripts/lib/helperExecutionEvidence.mjs','scripts/lib/sourceContractEvidence.mjs',
    'scripts/lib/softwareQualityEvidenceQualification.mjs','scripts/coverage-thresholds.mjs']) {
    write(file,fs.readFileSync(path.join(root,file)));
  }
  write('package.json','{"private":true}');
  write('pnpm-lock.yaml',fs.readFileSync(path.join(root,'pnpm-lock.yaml')));
  write('.gitignore','node_modules\nblob-report/\ntest-results/\nartifacts/\n.fixture-home/\n.fixture-temp/\n');
  fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
  fs.mkdirSync(path.join(directory,'.fixture-home'));fs.mkdirSync(path.join(directory,'.fixture-temp'));
  write('playwright.config.cjs',`module.exports={testDir:'./tests/e2e',retries:0,workers:1,projects:[{name:'full-suite'}]};\n`);
  // A fixture must not leave detached Git maintenance racing its owned directory cleanup.
  const git=args=>execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','-c','gc.autoDetach=false',...args],
    {cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=()=>{
    git(['add','.']);git(['-c','user.name=Receipt fixture','-c','user.email=receipt@example.invalid','commit','--allow-empty','-m','synthetic source fixture']);
    return git(['rev-parse','HEAD']);
  };
  git(['init']);const base=commit();
  const files=Array.from({length:4},(_,i)=>`tests/e2e/owned-${i+1}.e2e.spec.js`);
  const body="const {test,expect}=require('@playwright/test'); test('independent arithmetic body',()=>{expect(2+3).toBe(5);});\n";
  files.forEach(file=>write(file,body));commit();
  const environment=()=>({PATH:[path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter),
    HOME:path.join(directory,'.fixture-home'),TMPDIR:path.join(directory,'.fixture-temp'),LANG:'C.UTF-8',TZ:'UTC',
    CI:'true',GITHUB_ACTIONS:'true',GITHUB_JOB:'e2e',GITHUB_RUN_ID:'811',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:git(['rev-parse','HEAD'])});
  const expected=()=>executionContext(directory,{...environment(),SOFTWARE_QUALITY_INVOCATION:randomUUID()});
  const cli=path.join(path.dirname(fs.realpathSync(path.join(root,'node_modules/playwright/package.json'))),'cli.js');
  const run=current=>{
    fs.rmSync(path.join(directory,'blob-report'),{recursive:true,force:true});
    fs.rmSync(path.join(directory,'test-results'),{recursive:true,force:true});
    const result=spawnSync(process.execPath,[cli,'test','--config=playwright.config.cjs','--project=full-suite',
      '--workers=1',`--shard=${current}/4`,'--reporter=blob,./scripts/efficacy-playwright-reporter.mjs','--output=test-results/playwright'],
    {cwd:directory,env:environment(),encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
    const artifact=path.join(directory,`artifacts/shard-report-${current}`);
    fs.rmSync(artifact,{recursive:true,force:true});fs.mkdirSync(artifact,{recursive:true});
    for(const child of ['blob-report','test-results'])if(fs.existsSync(path.join(directory,child))) {
      fs.cpSync(path.join(directory,child),path.join(artifact,child),{recursive:true});
    }
    return result;
  };
  return {directory,write,git,commit,base,files,body,expected,run,clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}

if(process.env.GITHUB_ACTIONS==='true'||process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  // This aggregate control runs thirteen SDK commands plus independent blob decoders.
  // Keep each command's 30s cap; bound the aggregate separately for contended CI hosts.
  test('INSTALLED producer callbacks and original four SDK blobs qualify only ordinary E2E execution',{timeout:120_000},async()=>{
    const f=installedFixture();
    const retain=(label,value)=>{
      const target=process.env.TEST_EFFICACY_CONTROL_OUTDIR;
      if(!target)return;
      assert.ok(path.isAbsolute(target));fs.mkdirSync(target,{recursive:true});
      fs.writeFileSync(path.join(target,`${label}-${randomUUID()}.json`),JSON.stringify(value),{flag:'wx'});
    };
    try {
      for(let shard=1;shard<=4;shard++) {
        const result=f.run(shard);
        assert.equal(result.status,0,`${result.error?.message || ''}\n${result.stdout}\n${result.stderr}`);
      }
      const expected=f.expected();
      const wrapper=collectPlaywrightExecution({root:f.directory,expected,requiredFiles:f.files});
      assert.equal(wrapper.shards.length,4);
      assert.ok(wrapper.shards.every(item=>!Object.hasOwn(item.producer,'invocation')));
      assert.deepEqual([...validatePlaywrightExecution(wrapper,{root:f.directory,expected,requiredFiles:f.files})].sort(),f.files);
      const missing=executionCoverage(f.files,{root:f.directory,base:f.base,expected});
      assert.equal(missing.status,'INCOMPLETE','test totals alone do not qualify changed E2E files');
      const qualified=executionCoverage(f.files,{root:f.directory,base:f.base,expected,playwright:wrapper});
      assert.equal(qualified.status,'COMPLETE');
      assert.ok(qualified.rows.every(row=>row.status==='EXECUTED' && /not live acceptance/.test(row.claim)));
      const withLive=executionCoverage([...f.files,'tests/live/unselected.live.spec.ts'],{root:f.directory,base:f.base,expected,playwright:wrapper});
      assert.equal(withLive.status,'INCOMPLETE');assert.equal(withLive.rows.at(-1).status,'NOT RUN');
      retain('actual-sdk-positive',{scope:'synthetic no-browser arithmetic bodies; actual SDK producer/blob/collector/validator',expected,wrapper,qualified});

      for(const mutate of [
        value=>{value.provenance.invocation=randomUUID();},
        value=>{value.shards.pop();},
        value=>{value.shards[1]=structuredClone(value.shards[0]);},
        value=>{value.shards[0].producer.lineage.runAttempt='3';},
        value=>{value.shards[0].producer.lineage.runId='812';},
        value=>{value.shards[0].producer.source.commit='b'.repeat(40);},
        value=>{value.shards[0].producer.lockSha256='0'.repeat(64);},
        value=>{value.shards[0].producer.runtime.version='9.0.0';},
        value=>{value.shards[0].producer.invocation=expected.invocation;},
        value=>{value.shards[0].blobPath=value.shards[1].blobPath;},
        value=>{value.shards[0].blobBase64=Buffer.from('not a ZIP').toString('base64');},
      ]) {
        const altered=structuredClone(wrapper);mutate(altered);
        assert.throws(()=>validatePlaywrightExecution(altered,{root:f.directory,expected,requiredFiles:f.files}));
      }
      const uncalled=structuredClone(wrapper);uncalled.shards[0].producer.begins=[];
      uncalled.shards[0].receiptSha256=digest(JSON.stringify(uncalled.shards[0].producer));
      assert.throws(()=>validatePlaywrightExecution(uncalled,{root:f.directory,expected,requiredFiles:f.files}),/lifecycle|callbacks/);
      const first=wrapper.shards[0],receipt=path.join(f.directory,first.receiptPath),bytes=fs.readFileSync(receipt);
      fs.unlinkSync(receipt);
      assert.throws(()=>collectPlaywrightExecution({root:f.directory,expected,requiredFiles:f.files}),/Missing/);
      fs.writeFileSync(receipt,bytes);
      const duplicate=path.join(path.dirname(receipt),`playwright-execution-811-2-1-${randomUUID()}.json`);
      fs.writeFileSync(duplicate,bytes);
      assert.throws(()=>collectPlaywrightExecution({root:f.directory,expected,requiredFiles:f.files}),/ambiguous/);
      fs.unlinkSync(duplicate);
      const elsewhere=path.join(f.directory,'.fixture-temp','aliased-receipt.json');fs.writeFileSync(elsewhere,bytes);
      fs.unlinkSync(receipt);fs.symlinkSync(elsewhere,receipt);
      assert.throws(()=>collectPlaywrightExecution({root:f.directory,expected,requiredFiles:f.files}),/Aliased/);
      fs.unlinkSync(receipt);fs.writeFileSync(receipt,bytes);

      // A caught step rejection is an intentional negative control, not a failed test.
      const handledBody=f.body.replace('()=>{expect(2+3).toBe(5);}',
        "async()=>{await test.step('expected rejection',async()=>{throw new Error('controlled step rejection');}).catch(error=>expect(error.message).toBe('controlled step rejection'));expect(2+3).toBe(5);}");
      assert.notEqual(handledBody,f.body);
      f.files.forEach(file=>f.write(file,handledBody));f.commit();
      for(let shard=1;shard<=4;shard++) {
        const result=f.run(shard);
        const directory=path.join(f.directory,`artifacts/shard-report-${shard}/test-results/playwright`);
        const name=fs.readdirSync(directory).find(file=>file.startsWith('playwright-execution-'));
        const producer=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
        const blob=fs.readFileSync(path.join(f.directory,`artifacts/shard-report-${shard}/blob-report`,producer.blob.name));
        retain('actual-sdk-caught-step-attempt',{shard,status:result.status,producer,
          rawLedger:await readBlobReport(f.directory,blob),stdout:result.stdout,stderr:result.stderr});
        assert.equal(result.status,0,`caught step must remain a passing actual SDK test\n${result.stdout}\n${result.stderr}`);
      }
      const handledExpected=f.expected();
      const handled=collectPlaywrightExecution({root:f.directory,expected:handledExpected,requiredFiles:f.files});
      assert.equal(executionCoverage(f.files,{root:f.directory,base:f.base,expected:handledExpected,playwright:handled}).status,'COMPLETE');
      const handledRaw=await readBlobReport(f.directory,Buffer.from(handled.shards[0].blobBase64,'base64'));
      assert.ok(handledRaw.trim().split('\n').map(line=>JSON.parse(line)).some(event=>event.method==='onStepEnd'
        && /controlled step rejection/.test(event.params.step.error?.message || '')));
      retain('actual-sdk-caught-step',{expected:handledExpected,wrapper:handled,rawLedger:handledRaw});

      f.files.forEach(file=>f.write(file,f.body.replace('toBe(5)','toBe(999)')));f.commit();
      const failure=f.run(1);assert.equal(failure.status,1,`${failure.stdout}\n${failure.stderr}`);
      const failedReceiptDir=path.join(f.directory,'artifacts/shard-report-1/test-results/playwright');
      const failedReceiptName=fs.readdirSync(failedReceiptDir).find(name=>name.startsWith('playwright-execution-'));
      const failedProducer=JSON.parse(fs.readFileSync(path.join(failedReceiptDir,failedReceiptName),'utf8'));
      const failedBlob=fs.readFileSync(path.join(f.directory,'artifacts/shard-report-1/blob-report',failedProducer.blob.name));
      const failedLedger=await readBlobReport(f.directory,failedBlob);
      assert.ok(failedLedger.trim().split('\n').map(line=>JSON.parse(line)).some(event=>event.method==='onTestEnd'
        && event.params.result.status==='failed' && event.params.result.errors.some(error=>/999/.test(error.message || ''))),
      'a real raw body assertion must fail; an import/setup error is insufficient');
      assert.throws(()=>collectPlaywrightExecution({root:f.directory,expected:f.expected(),requiredFiles:f.files}));
      retain('actual-sdk-failed-body',{status:failure.status,producer:failedProducer,rawLedger:failedLedger,
        originalBlobBase64:failedBlob.toString('base64'),stdout:failure.stdout,stderr:failure.stderr});
      f.files.forEach(file=>f.write(file,f.body));f.commit();
      for(let shard=1;shard<=4;shard++) {
        const result=f.run(shard);assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
      }
      const restoredExpected=f.expected();
      const restored=collectPlaywrightExecution({root:f.directory,expected:restoredExpected,requiredFiles:f.files});
      assert.equal(restoredExpected.snapshotSha256,expected.snapshotSha256);
      assert.equal(executionCoverage(f.files,{root:f.directory,base:f.base,expected:restoredExpected,playwright:restored}).status,'COMPLETE');
      retain('actual-sdk-restored',{expected:restoredExpected,wrapper:restored});
    } finally {f.clean();}
  });
}
