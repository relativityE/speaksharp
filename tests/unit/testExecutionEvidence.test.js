import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {executionContext,assertProvenance,executionRoute,executionCoverage,validatePilotExecution,
  changedEvidencePaths,readCurrentQuality,testEnvironment,validateVitestExecution,sourceIdentity} from '../../scripts/lib/testExecutionEvidence.mjs';
import {runtimeIdentity,canonicalPath} from '../../scripts/efficacy-reporter.mjs';
import {TEST_EFFICACY_CONTRACTS,MEANINGFUL_COVERAGE_MANIFEST} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';
import {dependencyPaths} from '../../scripts/run-test-efficacy.mjs';
const {test}=process.env.NODE_TEST_CONTEXT?await import('node:test'):await import('vitest');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const context=()=>executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
const contract=TEST_EFFICACY_CONTRACTS[0];

// Synthetic in-memory receipts exercise validation only; no runtime/product PASS is claimed.
function pilot(expected) {
  const names=contract.mutants.map(mutant=>mutant.assertion).sort();
  // Independent construction from the real file inventory and literal reviewed rewrites.
  // Do not call the consumer's expected-input implementation to manufacture its own oracle.
  const inventory=[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--exclude=/apt-bundle/'],
    {cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))].sort().filter(file=>fs.existsSync(path.join(root,file)))
    .map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]);
  const original=fs.readFileSync(path.join(root,contract.sourceFile),'utf8');
  const sourceFor={
    baseline:original,restored:original,
    'semantic-control':original.replace("if (value.trim() === '') return false;","if ('' === value.trim()) return false;")
      .replace('return Number.isFinite(n);','return (Number.isFinite(n));'),
    'blank-is-zero':original.replace("if (value.trim() === '') return false;","if (value.trim() === '') return true;"),
    'nonfinite-is-valid':original.replace('return Number.isFinite(n);','return true;'),
  };
  const phase=(label,mutant)=>{
    const inputSha256=hash(JSON.stringify(inventory.map(([file,digest])=>[file,file===contract.sourceFile?hash(sourceFor[label]):digest])));
    const binding={runId:'synthetic-run',phaseId:randomUUID(),phase:label,inputSha256,
      repoLockSha256:hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml'))),
      command:['node','vitest','run',contract.testFile],cwd:root,testFile:path.join(root,contract.testFile),
      runtime:{adapter:'vitest-3.2.4-raw-v1'}};
    const source=fs.readFileSync(binding.testFile,'utf8');
    const line=mutant?source.slice(0,source.indexOf(mutant.assertionAnchor)).split('\n').length:0;
    const tasks=names.map((name,index)=>({id:`test-${index}`,parentId:'file',name,type:'test',mode:'run',result:{
      state:name===mutant?.assertion?'fail':'pass',hooks:{},errors:name===mutant?.assertion?
        [{name:'AssertionError',message:'synthetic',stack:`${binding.testFile}:${line}:1`}]:[]}}));
    const report={success:!mutant,numTotalTests:2,numPassedTests:mutant?1:2,numFailedTests:mutant?1:0,
      numPendingTests:0,numTodoTests:0,testResults:[{status:mutant?'failed':'passed',assertionResults:tasks.map(task=>({
        fullName:task.name,status:task.result.state==='pass'?'passed':'failed',failureMessages:task.result.errors.map(()=> 'AssertionError: expected true to be false')}))}]};
    const envelope={schemaVersion:2,binding,observed:{command:binding.command,cwd:binding.cwd,runtime:binding.runtime},
      collectionCalls:1,finishedCalls:1,endCalls:1,timedOut:false,
      collected:[{file:binding.testFile,tests:tasks.map(({id,name,mode})=>({id,name,mode}))}],
      finished:{files:[{file:binding.testFile,tasks:[...tasks,{id:'file',parentId:null,type:'suite',mode:'run',
        result:{state:mutant?'fail':'pass',hooks:{},errors:[]}}]}],errors:[]},ended:{errors:[],reason:mutant?'failed':'passed'}};
    return {binding,envelope,report,names,inputSha256,execution:{status:mutant?1:0,signal:null,error:null}};
  };
  const result={id:contract.id,testFile:contract.testFile,sourceFile:contract.sourceFile,
    testSha256:hash(fs.readFileSync(path.join(root,contract.testFile))),sourceSha256:hash(fs.readFileSync(path.join(root,contract.sourceFile))),
    baseline:phase('baseline'),control:phase('semantic-control'),mutants:contract.mutants.map(m=>phase(m.id,m)),restored:phase('restored')};
  return {provenance:expected,commit:expected.commit,tree:expected.tree,snapshotSha256:expected.snapshotSha256,
    runId:'synthetic-run',status:'executed',contracts:[result]};
}

test('routes Node .mjs, Vitest, Playwright, Deno and inspected SQL consumers separately',()=>{
  assert.equal(executionRoute('tests/db/account-closure-full-chain-main-u1-plan.test.mjs',root).runner,'node-test');
  assert.equal(executionRoute('tests/db/focus-points-trial-capability.integration.test.ts',root).runner,'vitest');
  assert.equal(executionRoute('tests/e2e/analytics-truth.e2e.spec.ts',root).runner,'playwright');
  assert.equal(executionRoute('backend/supabase/functions/example/index_test.ts',root).runner,'deno');
  assert.equal(executionRoute('tests/db/focus-points-trial-capability-matrix.sql',root).consumer,'tests/db/focus-points-trial-capability.integration.test.ts');
  assert.equal(executionRoute('tests/db/unregistered.sql',root),null);
});

test('claimed filenames/run ID or neighboring suite cannot qualify SQL or Node tests',()=>{
  const expected=context();
  const paths=['tests/db/account-closure-full-chain.sql','tests/db/account-closure-full-chain-main-u1-plan.test.mjs','tests/db/unknown.sql'];
  const coverage=executionCoverage(paths,{root,expected,pilot:{status:'pass',runId:'123',testFiles:paths}});
  assert.deepEqual(coverage.rows.map(row=>row.status),['NOT RUN','NOT RUN','UNCOVERED']);
  assert.equal(coverage.status,'INCOMPLETE');
});

test('replays all five raw phases for the narrow pilot and never credits neighboring SQL',()=>{
  const expected=context();const receipt=pilot(expected);
  assert.equal(validatePilotExecution(receipt,expected,root),contract.testFile);
  const coverage=executionCoverage([contract.testFile,'tests/db/focus-points-trial-capability-matrix.sql'],{root,expected,pilot:receipt});
  assert.deepEqual(coverage.rows.map(row=>row.status),['EXECUTED','NOT RUN']);
});

test('consumer derives all five phase inputs, rejecting same-input and incorrect mutant receipts',()=>{
  const expected=context();const correct=pilot(expected);const result=correct.contracts[0];
  assert.equal(validatePilotExecution(correct,expected,root),contract.testFile);
  assert.equal(result.baseline.inputSha256,result.restored.inputSha256);
  assert.equal(new Set([result.baseline,result.control,...result.mutants].map(phase=>phase.inputSha256)).size,4);
  for (const alteration of ['same-input','swapped-mutants','wrong-control','wrong-restored','other-file-change']) {
    const receipt=structuredClone(correct);const candidate=receipt.contracts[0];
    const set=(phase,digest)=>{phase.inputSha256=digest;phase.binding.inputSha256=digest;phase.envelope.binding.inputSha256=digest;};
    if (alteration==='same-input') for(const phase of [candidate.control,...candidate.mutants]) set(phase,candidate.baseline.inputSha256);
    if (alteration==='swapped-mutants') set(candidate.mutants[0],candidate.mutants[1].inputSha256);
    if (alteration==='wrong-control') set(candidate.control,hash('unregistered neutral rewrite'));
    if (alteration==='wrong-restored') set(candidate.restored,candidate.control.inputSha256);
    if (alteration==='other-file-change') set(candidate.mutants[0],hash('correct seam plus unregistered test edit'));
    assert.throws(()=>validatePilotExecution(receipt,expected,root),/Phase bytes do not match registered transformation/,alteration);
  }
});

test('source-only diff requires pilot even with empty changed-test rows; unrelated diff does not',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-applicability-'));
  try {
    fs.writeFileSync(path.join(dir,'.gitignore'),'quality.json\n');
    fs.writeFileSync(path.join(dir,'README.md'),'original\n');
    const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
    const base=git(['rev-parse','HEAD']);
    fs.writeFileSync(path.join(dir,'README.md'),'unrelated documentation change\n');
    let expected=executionContext(dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const unrelated=executionCoverage([],{root:dir,expected,base});
    assert.equal(unrelated.status,'COMPLETE');assert.deepEqual(unrelated.pilot,{required:false,status:'NOT APPLICABLE'});
    const file=path.join(dir,'quality.json');
    fs.writeFileSync(file,JSON.stringify({provenance:expected,overallStatus:'QUALIFIED',executionCoverage:unrelated}));
    assert.equal(readCurrentQuality(file,expected,dir,base).overallStatus,'QUALIFIED');
    fs.mkdirSync(path.dirname(path.join(dir,contract.sourceFile)),{recursive:true});
    fs.writeFileSync(path.join(dir,contract.sourceFile),'// changed product source only\n');
    for (const mode of ['untracked','staged','committed']) {
      if(mode==='staged')git(['add',contract.sourceFile]);
      if(mode==='committed')git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','source change']);
      expected=executionContext(dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      assert.deepEqual(changedEvidencePaths(dir,base),[]);
      for (const supplied of [undefined,{status:'not-applicable',changedPaths:[]}]) {
        const coverage=executionCoverage([],{root:dir,expected,base,pilot:supplied});
        assert.equal(coverage.status,'INCOMPLETE');assert.deepEqual(coverage.pilot,{required:true,status:'NOT RUN'});
        fs.writeFileSync(file,JSON.stringify({provenance:expected,overallStatus:'QUALIFIED',executionCoverage:unrelated,testEfficacy:supplied}));
        assert.throws(()=>readCurrentQuality(file,expected,dir,base),/UNCOVERED\/NOT RUN/);
      }
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('gate-owned Vitest suites remain NOT RUN without their own validated execution receipts',()=>{
  const expected=context();
  const files=['tests/unit/testEfficacy.test.js','tests/unit/testExecutionEvidence.test.js','tests/unit/releasePathSkipPropagation.test.js'];
  const coverage=executionCoverage(files,{root,expected,pilot:pilot(expected)});
  assert.equal(coverage.pilot.status,'EXECUTED'); // synthetic pilot evidence still cannot cover neighbors
  assert.equal(coverage.status,'INCOMPLETE');
  assert.deepEqual(coverage.rows.map(row=>[row.route.runner,row.status]),files.map(()=>['vitest','NOT RUN']));
});

test('rejects missing, stale, wrong-head/attempt/source, skipped and failed execution receipts',()=>{
  const expected=context();
  assert.throws(()=>assertProvenance(null,expected));
  for (const key of ['invocation','commit','tree','snapshotSha256','source','runAttempt','runId']) {
    assert.throws(()=>assertProvenance({...expected,[key]:'wrong'},expected));
  }
  for (const corrupt of [
    receipt=>{delete receipt.contracts[0].baseline.execution;},
    receipt=>{receipt.contracts[0].baseline.execution.status=1;},
    receipt=>{receipt.contracts[0].mutants.pop();},
    receipt=>{receipt.contracts[0].restored.binding.phaseId=receipt.contracts[0].baseline.binding.phaseId;},
    receipt=>{receipt.contracts[0].baseline.report.testResults[0].assertionResults[0].status='skipped';},
    receipt=>{receipt.contracts[0].testSha256='wrong';},
    receipt=>{receipt.contracts[0].restored.inputSha256='wrong';},
    receipt=>{receipt.contracts[0].baseline.binding.repoLockSha256='wrong';},
  ]) {const receipt=pilot(expected);corrupt(receipt);assert.throws(()=>validatePilotExecution(receipt,expected,root));}
});

test('producer context requires caller invocation and actual CI head, run and attempt',()=>{
  assert.throws(()=>executionContext(root,{}),/invocation/i);
  const expected=context();
  assert.throws(()=>executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID(),GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:'wrong'}),/wrong-head/);
  const ci=executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID(),GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:expected.commit});
  assert.equal(ci.runAttempt,'2');assert.equal(ci.source,'github-actions');
});

test('changed-path inventory includes SQL and .mjs even though Vitest does not collect them',()=>{
  const files=changedEvidencePaths(root,null);
  assert.ok(files.includes('tests/db/account-closure-full-chain.sql'));
  assert.ok(files.includes('tests/db/account-closure-full-chain-main-u1-plan.test.mjs'));
});

test('consumer rejects a stale otherwise-green output before trusting coverage claims',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-consumer-'));const file=path.join(dir,'quality.json');
  try {
    const expected=context();
    fs.writeFileSync(file,JSON.stringify({provenance:{...expected,invocation:randomUUID()},overallStatus:'QUALIFIED',executionCoverage:{status:'COMPLETE',rows:[]}}));
    assert.throws(()=>readCurrentQuality(file,expected,root),/stale/);
    fs.writeFileSync(file,JSON.stringify({provenance:expected,overallStatus:'QUALIFIED',executionCoverage:{status:'COMPLETE',rows:[]}}));
    assert.throws(()=>readCurrentQuality(file,expected,root),/UNCOVERED/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('explicit child environment excludes host secrets, loaders, proxies and package hooks',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-env-'));
  try {
    const env=testEnvironment(dir,{phaseId:'synthetic'},path.join(dir,'raw.json'));
    for (const key of ['GITHUB_TOKEN','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS','NODE_PATH','HTTP_PROXY','HTTPS_PROXY','npm_config_registry']) assert.equal(Object.hasOwn(env,key),false);
    assert.equal(env.NODE_ENV,'test');assert.equal(env.VITE_SUPABASE_ANON_KEY,'test-anon-key');
    assert.equal(env.HOME,path.join(dir,'.efficacy-home'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('writer invalidates prior output before an imported module parse failure',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-import-'));
  try {
    fs.mkdirSync(path.join(dir,'scripts/lib'),{recursive:true});
    fs.copyFileSync(path.join(root,'scripts/write-software-quality-evidence.mjs'),path.join(dir,'scripts/write-software-quality-evidence.mjs'));
    fs.writeFileSync(path.join(dir,'scripts/lib/softwareQualityEvidenceQualification.mjs'),'invalid module syntax !!!');
    fs.mkdirSync(path.join(dir,'product_release/evidence'),{recursive:true});
    for (const name of ['software-quality.latest.json','software-quality-summary.latest.md']) fs.writeFileSync(path.join(dir,'product_release/evidence',name),'OLD PASS');
    const result=spawnSync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{cwd:dir});
    assert.equal(result.status,1);assert.deepEqual(fs.readdirSync(path.join(dir,'product_release/evidence')),[]);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('CI freshness preamble invalidates prior output even when writer entrypoint cannot parse',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-entry-'));
  try {
    const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
    const block=workflow.split('- name: Begin fresh quality evidence attempt')[1].split('- name: Generate qualified')[0];
    const script=block.split("<<'NODE'\n")[1].split('\n          NODE')[0].split('\n').map(line=>line.slice(10)).join('\n');
    fs.mkdirSync(path.join(dir,'product_release/evidence'),{recursive:true});
    fs.writeFileSync(path.join(dir,'product_release/evidence/software-quality.latest.json'),'OLD PASS');
    execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,env:{...process.env,GITHUB_ENV:path.join(dir,'job-env')}});
    fs.writeFileSync(path.join(dir,'broken.mjs'),'invalid module syntax !!!');
    assert.equal(spawnSync(process.execPath,['broken.mjs'],{cwd:dir}).status,1);
    assert.equal(fs.existsSync(path.join(dir,'product_release/evidence/software-quality.latest.json')),false);
    assert.match(fs.readFileSync(path.join(dir,'job-env'),'utf8'),/^SOFTWARE_QUALITY_INVOCATION=/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('malformed input cannot leave an old quality PASS behind',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-parse-'));
  try {
    fs.mkdirSync(path.join(dir,'product_release/evidence'),{recursive:true});
    fs.mkdirSync(path.join(dir,'test-results'),{recursive:true});
    fs.writeFileSync(path.join(dir,'test-results/metrics.json'),'{broken');
    fs.writeFileSync(path.join(dir,'product_release/evidence/software-quality.latest.json'),'OLD PASS');
    const result=spawnSync(process.execPath,[path.join(root,'scripts/write-software-quality-evidence.mjs')],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/SyntaxError/);
    assert.equal(fs.existsSync(path.join(dir,'product_release/evidence/software-quality.latest.json')),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('service-level consumer refuses missing controller identity and removes old output',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-service-'));
  try {
    fs.mkdirSync(path.join(dir,'product_release/evidence'),{recursive:true});
    for(const name of ['service-levels.latest.json','service-levels-summary.latest.md']) fs.writeFileSync(path.join(dir,'product_release/evidence',name),'OLD PASS');
    const env={...process.env};delete env.SOFTWARE_QUALITY_INVOCATION;
    const result=spawnSync(process.execPath,[path.join(root,'scripts/write-service-level-evidence.mjs')],{cwd:dir,env,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/Fresh SOFTWARE_QUALITY_INVOCATION required/);
    assert.deepEqual(fs.readdirSync(path.join(dir,'product_release/evidence')),[]);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// A real Git diff with one non-pilot Vitest test remains present in every acceptance case.
// Runtime=false supplies only inert package bytes for consumer unit controls, never execution.
function executionFixture(installed=false) {
  const dir=canonicalPath(fs.mkdtempSync(path.join(os.tmpdir(),'quality-vitest-execution-')));
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),bytes);};
  for(const file of ['scripts/write-software-quality-evidence.mjs','scripts/run-test-efficacy.mjs',
    'scripts/efficacy-reporter.mjs','scripts/coverage-thresholds.mjs','scripts/lib/testExecutionEvidence.mjs',
    'scripts/lib/softwareQualityEvidenceQualification.mjs',...dependencyPaths(root,contract.testFile)]) {
    write(file,fs.readFileSync(path.join(root,file)));
  }
  write('.gitignore','node_modules\ntest-results/\nproduct_release/evidence/\n');
  write('pnpm-lock.yaml',fs.readFileSync(path.join(root,'pnpm-lock.yaml')));
  write('frontend/vitest.config.mjs',"export default {test:{environment:'node',include:['tests/unit/*.test.js'],pool:'forks',maxWorkers:1,minWorkers:1}};\n");
  if(installed) fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
  else {
    write('node_modules/vitest/package.json','{"version":"3.2.4"}');
    write('node_modules/vitest/vitest.mjs','// inert synthetic runtime identity, not executable evidence\n');
    write('node_modules/@vitest/runner/package.json','{"version":"3.2.4","main":"index.js"}');
    write('node_modules/@vitest/runner/index.js','// inert synthetic runner\n');
  }
  const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init']);git(['add','.']);
  const commit=()=>{git(['-c','user.name=Execution fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','reviewed fixture']);return git(['rev-parse','HEAD']);};
  const base=commit();
  const file='tests/unit/changed-execution.test.js';
  const passing="import {test,expect} from 'vitest';\nimport {execFileSync} from 'node:child_process';\ntest('changed non-pilot computes an independently expected result',()=>{expect(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()).toMatch(/^[a-f0-9]{40}$/);expect([2,3].reduce((a,b)=>a+b,0)).toBe(5);});\n";
  write(file,passing);
  write('test-results/metrics.json',JSON.stringify({unit_tests:{passed:6,failed:0,skipped:0,total:6,
    testFiles:MEANINGFUL_COVERAGE_MANIFEST.map(item=>item.testFile),skippedTestFiles:[]},
    e2e_tests:{passed:1,failed:0,skipped:0,total:1},coverage:{statements:80,branches:80,functions:80,lines:80},
    performance:{initial_chunk_size:'412K'},total_runtime_seconds:120}));
  return {dir,write,git,commit,base,file,passing};
}

test('generated apt cache is excluded without excluding tracked cache paths or similarly named source',()=>{
  const {dir,write,git}=executionFixture();
  try {
    const baseline=sourceIdentity(dir);
    write('apt-bundle/debs/Packages','generated package index');
    fs.mkdirSync(path.join(dir,'apt-bundle/apt-lists'),{recursive:true});
    fs.symlinkSync('../debs/Packages',path.join(dir,'apt-bundle/apt-lists/runner_Packages'));
    assert.match(git(['ls-files','--others','--exclude-standard']),/apt-bundle\/apt-lists\/runner_Packages/,
      'the CI-like link must really be visible to the former Git inventory');
    assert.deepEqual(sourceIdentity(dir),baseline);
    write('apt-bundle/debs/Packages','cache churn must not change application source');
    assert.deepEqual(sourceIdentity(dir),baseline);
    write('frontend/src/apt-bundle/control.js','export const realSource=1;');
    assert.notEqual(sourceIdentity(dir).snapshotSha256,baseline.snapshotSha256);
    write('apt-bundle/tracked-source.js','export const tracked=1;');
    git(['add','--force','--','apt-bundle/tracked-source.js']);
    const tracked=sourceIdentity(dir);
    write('apt-bundle/tracked-source.js','export const tracked=2;');
    assert.notEqual(sourceIdentity(dir).snapshotSha256,tracked.snapshotSha256,
      'an explicit tracked path must remain bound even under the cache directory');
    fs.symlinkSync('debs/Packages',path.join(dir,'apt-bundle/tracked-link'));
    git(['add','--force','--','apt-bundle/tracked-link']);
    assert.throws(()=>sourceIdentity(dir),/Unsupported source entry: apt-bundle\/tracked-link/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('writer execution fixture excludes dependency symlink from Git inventory without allowing source symlinks',()=>{
  const {dir,git}=executionFixture();
  const external=fs.mkdtempSync(path.join(os.tmpdir(),'writer-dependency-link-'));
  try {
    fs.renameSync(path.join(dir,'node_modules'),path.join(external,'dependencies'));
    fs.symlinkSync(path.join(external,'dependencies'),path.join(dir,'node_modules'),'dir');
    const inventory=git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0');
    assert.equal(inventory.some(file=>file==='node_modules'||file.startsWith('node_modules/')),false);
    assert.doesNotThrow(()=>executionContext(dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()}));
    fs.symlinkSync(path.join(external,'dependencies'),path.join(dir,'unexpected-source-link'),'dir');
    assert.throws(()=>executionContext(dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()}),/Unsupported source entry: unexpected-source-link/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});}
});

test('execution-only consumer binds actual source, runtime, command and controller; unsupported routes stay unqualified',()=>{
  const {dir,base,file}=executionFixture();
  try {
    const expected=executionContext(dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID(),GITHUB_ACTIONS:'true',
      GITHUB_SHA:base,GITHUB_RUN_ID:'901',GITHUB_RUN_ATTEMPT:'3'});
    const entries=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--exclude=/apt-bundle/'],{cwd:dir,encoding:'utf8'})
      .split('\0').filter(Boolean).sort().map(name=>[name,hash(fs.readFileSync(path.join(dir,name)))]);
    const inputSha256=hash(JSON.stringify(entries));const cwd=path.join(dir,'isolated');
    const binding={runId:randomUUID(),phaseId:randomUUID(),phase:'execution',provenance:expected,cwd,
      testFile:path.join(cwd,file),inputSha256,repoLockSha256:hash(fs.readFileSync(path.join(dir,'pnpm-lock.yaml'))),runtime:runtimeIdentity(dir)};
    binding.command=[canonicalPath(process.execPath),path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','--config','frontend/vitest.config.mjs',
      '--coverage.enabled=false','--retry=0','--reporter=json','--reporter=./scripts/efficacy-reporter.mjs',`--outputFile=${path.join(cwd,'efficacy-report.json')}`,file];
    const tasks=[{id:'file',parentId:null,type:'suite',mode:'run',result:{state:'pass',hooks:{},errors:[]}},
      {id:'test',parentId:'file',type:'test',name:'synthetic unit control',mode:'run',result:{state:'pass',hooks:{},errors:[]}}];
    const report={success:true,numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,
      testResults:[{name:binding.testFile,status:'passed',assertionResults:[{fullName:'synthetic unit control',status:'passed',failureMessages:[]}]}]};
    const envelope={schemaVersion:2,binding,observed:{command:binding.command,cwd,runtime:binding.runtime},
      collectionCalls:1,finishedCalls:1,endCalls:1,timedOut:false,collected:[{file:binding.testFile,tests:[{id:'test',name:'synthetic unit control',mode:'run'}]}],
      finished:{files:[{file:binding.testFile,tasks}],errors:[]},ended:{errors:[],reason:'passed'}};
    const receipt={...expected,provenance:expected,runId:binding.runId,status:'executed',tests:[{testFile:file,
      testSha256:hash(fs.readFileSync(path.join(dir,file))),phase:{binding,envelope,report,inputSha256,execution:{status:0,signal:null,error:null}}}]};
    assert.deepEqual([...validateVitestExecution(receipt,expected,dir)],[file]);
    assert.equal(executionCoverage([file],{root:dir,base,expected,execution:receipt}).status,'COMPLETE');
    assert.equal(executionCoverage([file],{root:dir,base,expected}).status,'INCOMPLETE');
    for(const [change,reason] of [
      [r=>{r.provenance={...expected,commit:'a'.repeat(40)};},/provenance/],
      [r=>{r.provenance={...expected,runAttempt:'2'};},/provenance/],
      [r=>{r.tests[0].phase.binding.provenance={...expected,runAttempt:'2'};},/provenance/],
      [r=>{r.tests[0].phase.binding.inputSha256=hash('wrong source');},/phase\/source\/runtime/],
      [r=>{r.tests[0].phase.binding.runtime.node='wrong';},/phase\/source\/runtime/],
      [r=>{r.tests[0].phase.binding.command[3]='--testNamePattern=other';},/command\/collection/],
      [r=>{r.tests[0].phase.envelope.finished.files[0].tasks[1].mode='skip';},/setup\/hook\/suite/],
      [r=>{r.tests[0].phase.execution.status=1;},/process failed/],
      [r=>{delete r.tests[0].phase.envelope;},/raw phase evidence/],
      [r=>{r.tests.push(r.tests[0]);},/duplicate execution route/],
    ]) {const candidate=structuredClone(receipt);change(candidate);assert.throws(()=>validateVitestExecution(candidate,expected,dir),reason);}
    const paths=[file,'tests/e2e/other.spec.ts','backend/supabase/functions/other/index_test.ts','tests/db/account-closure-full-chain.sql'];
    assert.deepEqual(executionCoverage(paths,{root:dir,base,expected,execution:receipt}).rows.map(row=>row.status),['EXECUTED','NOT RUN','NOT RUN','NOT RUN']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// This opt-in requires already installed Vitest; no provisioning or synthetic fallback.
if(process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  test('INSTALLED Vitest: actual writer qualifies a changed non-pilot test, rejects bad evidence, restores GREEN without deleting it',()=>{
    runtimeIdentity(root);
    const fixture=executionFixture(true);const {dir,write,git,commit,file,passing}=fixture;
    const reporter=fs.readFileSync(path.join(dir,'scripts/efficacy-reporter.mjs'),'utf8');
    const evidenceFile=path.join(dir,'product_release/evidence/software-quality.latest.json');
    const run=()=>{const head=git(['rev-parse','HEAD']);return spawnSync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{
      cwd:dir,encoding:'utf8',timeout:120000,env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_SHA:head,GITHUB_RUN_ID:'901',GITHUB_RUN_ATTEMPT:'3',
        TEST_EFFICACY_BASE:head,SOFTWARE_QUALITY_INVOCATION:randomUUID(),NODE_V8_COVERAGE:''}});};
    const green=()=>{const result=run();assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
      const receipt=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
      assert.deepEqual(changedEvidencePaths(dir,git(['rev-parse','HEAD'])),[file]);
      assert.equal(receipt.overallStatus,'QUALIFIED');assert.equal(receipt.testEfficacy.status,'not-applicable');
      assert.deepEqual(receipt.executionCoverage.rows.map(row=>[row.file,row.status,row.claim]),[[file,'EXECUTED','collection and execution only']]);
      assert.equal(receipt.testExecution.tests[0].phase.report.numTotalTests,1);
    };
    try {
      green();
      for(const scenario of ['absent','skipped','failed','wrong-head','wrong-attempt']) {
        write(file,scenario==='skipped'?passing.replace('test(','test.skip('):scenario==='failed'?passing.replace('.toBe(5)','.toBe(6)'):passing);
        let altered=reporter;
        if(scenario==='absent') altered=reporter.replace('write() {','write() { return;');
        if(scenario==='wrong-head') altered=reporter.replace('this.observed =',"this.binding.provenance.commit='"+'a'.repeat(40)+"'; this.observed =");
        if(scenario==='wrong-attempt') altered=reporter.replace('this.observed =',"this.binding.provenance.runAttempt='2'; this.observed =");
        write('scripts/efficacy-reporter.mjs',altered);git(['add','scripts/efficacy-reporter.mjs']);commit();
        const result=run();assert.equal(result.error,undefined);assert.equal(result.status,1,scenario+result.stderr);
        assert.match(result.stderr,/\[execution\]/,scenario);
        const reason=scenario==='failed'?/Efficacy process failed/:scenario==='skipped'?/inconsistent raw phase evidence|setup\/hook\/suite failure/:/inconsistent raw phase evidence/;
        assert.match(result.stderr,reason,scenario);assert.doesNotMatch(result.stderr,/NOT RUN|Unsupported|budget/);
        if(scenario==='failed') {
          assert.match(result.stderr,/changed non-pilot computes an independently expected result/);
          assert.match(result.stderr,/expected 5 to be 6/);
        }
        if(scenario==='skipped') assert.match(result.stderr,/ \| (?:pending|skipped) \| /);
        if(['absent','wrong-head','wrong-attempt'].includes(scenario)) {
          assert.match(result.stderr,/changed non-pilot computes an independently expected result \| passed \|/);
        }
        assert.equal(fs.existsSync(evidenceFile),false,'stale output cannot survive');
        assert.equal(fs.existsSync(path.join(dir,file)),true,'changed test must remain');
        write(file,passing);write('scripts/efficacy-reporter.mjs',reporter);git(['add','scripts/efficacy-reporter.mjs']);commit();green();
      }
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
}

if(process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  test('INSTALLED Vitest: weakening a registered assertion fails the actual writer and thin report, then restores GREEN',()=>{
    const {dir,write,git}=executionFixture(true);
    const evidence=path.join(dir,'product_release/evidence/software-quality.latest.json');
    const original="import {it,expect} from 'vitest';\nimport {isValidMetric} from '../../utils/metricValidity';\n"
      +contract.mutants.map(mutant=>`it(${JSON.stringify(mutant.assertion)},()=>{\n${mutant.assertionAnchor}\n});`).join('\n');
    const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
    const reportSection=workflow.split('\n  report:')[1].split('\n  review-qualification:')[0];
    const reportScript=reportSection.split('        run: |\n')[1].trimEnd().split('\n').map(line=>line.slice(10)).join('\n');
    const report=state=>spawnSync('/bin/bash',['-c',reportScript],{encoding:'utf8',env:{...process.env,
      FULL_REQUIRED:'true',SCOPE_RESULT:'success',UNIT_RESULT:'success',EDGE_RESULT:'success',BUILD_RESULT:'success',
      HEALTH_RESULT:'success',E2E_RESULT:'success',EVIDENCE_RESULT:state}});
    const run=()=>{const head=git(['rev-parse','HEAD']);return spawnSync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{
      cwd:dir,encoding:'utf8',timeout:120000,env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_SHA:head,
        GITHUB_RUN_ID:'902',GITHUB_RUN_ATTEMPT:'1',TEST_EFFICACY_BASE:head,SOFTWARE_QUALITY_INVOCATION:randomUUID()}});};
    const green=()=>{const result=run();assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
      assert.equal(JSON.parse(fs.readFileSync(evidence,'utf8')).testEfficacy.contracts[0].mutants.length,2);
      assert.equal(report('success').status,0);};
    try {
      write('frontend/vitest.config.mjs',`export default {test:{environment:'node',include:[${JSON.stringify(contract.testFile)},'tests/unit/*.test.js'],pool:'forks',maxWorkers:1,minWorkers:1}};`);
      write(contract.testFile,original);
      green();
      // Keep the registered anchor exactly once as a comment: the mutant must survive
      // the weakened assertion, rather than failing merely because its anchor vanished.
      write(contract.testFile,original.replace(contract.mutants[0].assertionAnchor,
        `// ${contract.mutants[0].assertionAnchor}\nexpect(true).toBe(true);`));
      const red=run();assert.equal(red.error,undefined);assert.equal(red.status,1,red.stderr);
      assert.match(red.stderr,/\[blank-is-zero\] Efficacy process failed/);
      assert.doesNotMatch(red.stderr,/NOT RUN|Unsupported|anchor missing|Cannot find module/);
      assert.equal(fs.existsSync(evidence),false,'a weak test cannot leave a stale quality PASS');
      assert.match(fs.readFileSync(path.join(dir,contract.testFile),'utf8'),/expect\(true\)\.toBe\(true\)/);
      const blocked=report('failure');assert.equal(blocked.status,1);assert.match(blocked.stdout+blocked.stderr,/full lane failed/);
      write(contract.testFile,original);green();
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
}

test('CI-invoked writer fails incomplete coverage and succeeds after valid evidence is restored',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quality-ci-enforcement-'));
  try {
    const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
    const step=workflow.split('- name: Generate qualified software quality evidence')[1].split('- name:')[0];
    const command=step.match(/\brun:\s*(node scripts\/write-software-quality-evidence\.mjs)\s*\n/);
    assert.ok(command,'exercise the writer command actually invoked by CI');
    const files=['scripts/write-software-quality-evidence.mjs','scripts/run-test-efficacy.mjs',
      'scripts/efficacy-reporter.mjs','scripts/coverage-thresholds.mjs',
      'scripts/lib/testExecutionEvidence.mjs','scripts/lib/softwareQualityEvidenceQualification.mjs',
      ...dependencyPaths(root,contract.testFile)];
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});
      fs.copyFileSync(path.join(root,file),path.join(dir,file));
    }
    fs.writeFileSync(path.join(dir,'.gitignore'),'test-results/\nproduct_release/evidence/\n');
    const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git(['init']);git(['add','.']);
    git(['-c','user.name=Evidence fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
    const head=git(['rev-parse','HEAD']);
    fs.mkdirSync(path.join(dir,'test-results'),{recursive:true});
    fs.writeFileSync(path.join(dir,'test-results/metrics.json'),JSON.stringify({
      unit_tests:{passed:6,failed:0,skipped:0,total:6,testFiles:MEANINGFUL_COVERAGE_MANIFEST.map(item=>item.testFile),skippedTestFiles:[]},
      e2e_tests:{passed:1,failed:0,skipped:0,total:1},coverage:{statements:80,branches:80,functions:80,lines:80},
      performance:{initial_chunk_size:'412K'},total_runtime_seconds:120,
    }));
    const evidenceFile=path.join(dir,'product_release/evidence/software-quality.latest.json');
    const markdownFile=path.join(dir,'product_release/evidence/software-quality-summary.latest.md');
    const run=()=>spawnSync(process.execPath,[command[1].split(' ')[1]],{cwd:dir,encoding:'utf8',
      env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'9001',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:head,
        TEST_EFFICACY_BASE:head,SOFTWARE_QUALITY_INVOCATION:randomUUID(),NODE_V8_COVERAGE:''}});
    // This positive control has no affected tests and runs no product runtime. Metrics are fixture
    // input; actual writer, qualifier, mapper, provenance, Git diff and subprocess exit are real.
    let result=run();assert.equal(result.status,0,result.stderr);
    let receipt=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
    assert.equal(receipt.overallStatus,'QUALIFIED');
    assert.equal(receipt.testEfficacy.status,'not-applicable');
    assert.deepEqual(receipt.executionCoverage.rows,[]);
    for (const [file,status] of [['tests/db/account-closure-full-chain.sql','NOT RUN'],['tests/db/unregistered-control.sql','UNCOVERED']]) {
      fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});
      fs.writeFileSync(path.join(dir,file),'SELECT 1; -- synthetic changed fixture, never executed\n');
      result=run();
      assert.equal(result.status,1,`${status} must fail the actual CI writer; stdout=${result.stdout}; stderr=${result.stderr}`);
      assert.match(result.stderr,/Unqualified execution coverage/);
      assert.ok(result.stderr.includes(status));
      assert.equal(fs.existsSync(evidenceFile),false,'no accepted/latest receipt after failure');
      assert.equal(fs.existsSync(markdownFile),false,'no stale accepted summary after failure');
      fs.rmSync(path.join(dir,file));
      result=run();assert.equal(result.status,0,result.stderr);
      receipt=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
      assert.equal(receipt.overallStatus,'QUALIFIED');
      assert.deepEqual(receipt.executionCoverage.rows,[]);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
