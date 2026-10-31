import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {executionContext,assertProvenance,executionRoute,executionCoverage,validatePilotExecution,
  changedEvidencePaths,readCurrentQuality,testEnvironment,validateVitestExecution,sourceIdentity,resolveComparisonBase,
  registeredFixture,fixtureSourceBinding,fixturePackageManagerIdentity,validateFixtureWitness} from '../../scripts/lib/testExecutionEvidence.mjs';
import {runtimeIdentity,canonicalPath} from '../../scripts/efficacy-reporter.mjs';
import {TEST_EFFICACY_CONTRACTS,MEANINGFUL_COVERAGE_MANIFEST} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';
import {dependencyPaths,runVitestExecution,selectExecutionContracts} from '../../scripts/run-test-efficacy.mjs';
import {HELPER_CONTRACTS} from '../../scripts/lib/helperExecutionEvidence.mjs';
import {executionBatchIdentity} from '../../scripts/lib/nativeTestExecutionEvidence.mjs';
const framework=process.env.NODE_TEST_CONTEXT?await import('node:test'):await import('vitest');
const {test:registerTest}=framework;
const fixtureConsumer=registeredFixture('tests/fixtures/efficacy/service-level-evidence.adfeab34.yml');
// A dedicated fixture phase has one explicit consumer contract. Ordinary execution still
// registers the complete file; this is not a skipped-test waiver or a reduced global gate.
const test=(name,...args)=>{
  if(process.env.TEST_EFFICACY_SERVICE_CALLER_FIXTURE!=='1' || name===fixtureConsumer.assertion) return registerTest(name,...args);
};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('retention pin input requires its exact reviewed consumer and complete schema2 observations',()=>{
  const file='tests/db/retention-owner-matrix-pins.json',contract=registeredFixture(file);
  assert.equal(contract.testFile,'tests/unit/retentionCurrentContractMatrix.test.js');
  assert.equal(executionRoute(file,root).runner,'vitest-fixture');
  assert.equal(registeredFixture(file.replace('pins','unknown')),null);
  const f=executionFixture(true);
  try {
    for(const name of [file,contract.testFile,contract.workflowFile])f.write(name,fs.readFileSync(path.join(root,name)));
    const binding={cwd:f.dir,phaseId:randomUUID()};
    binding.fixture={fixtureFile:file,testFile:contract.testFile,sourceBinding:fixtureSourceBinding(f.dir,file),
      witnessFile:path.join(f.dir,`.fixture-${binding.phaseId}.json`)};
    const bytes=fs.readFileSync(path.join(root,file)),pins=JSON.parse(bytes);
    const workflow=fs.readFileSync(path.join(root,contract.workflowFile),'utf8');
    const raw={schemaVersion:2,phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding)),
      fixtureFile:file,fixtureSha256:hash(bytes),assertion:contract.assertion,
      workflowSha256:hash(workflow),resolverSha256:'63935ffc8708aba82aa2721b224cd4da3c3a2e3d19b748477ec469d6478fdfd3',
      observations:pins.versions.map(pin=>({major:pin.major,status:0,signal:null,error:null,refused:false,
        output:`version=${pin.version}\nsha256=${pin.sha256}\n`})),
      unknown:{major:99,status:1,signal:null,error:null,refused:true,output:null},
      malformed:{major:15,status:1,signal:null,error:null,refused:true,output:null}};
    const report={testResults:[{assertionResults:[{fullName:contract.assertion,status:'passed'}]}]};
    const envelope={finished:{files:[{tasks:[{type:'test',name:contract.assertion,result:{state:'pass'}}]}]}};
    const verify=(value=raw)=>validateFixtureWitness(value,binding,f.dir,report,envelope);
    assert.equal(verify(),file);
    for(const change of [value=>{value.schemaVersion=1;},value=>{value.phaseId='other';},
      value=>{value.bindingSha256='a'.repeat(64);},value=>{value.workflowSha256='b'.repeat(64);},
      value=>{value.resolverSha256='c'.repeat(64);},value=>{value.observations.pop();},
      value=>{value.observations[0].output='invented output';},value=>{value.unknown.status=0;},
      value=>{value.malformed.refused=false;}]) {
      const changed=structuredClone(raw);change(changed);assert.throws(()=>verify(changed),/retention pin consumption witness/);
    }
    assert.throws(()=>verify(null),/retention pin consumption witness/);
    assert.throws(()=>validateFixtureWitness(raw,binding,f.dir,{testResults:[]},envelope),/consumer was not executed/);
    f.write(contract.testFile,'// forged consumer\n');
    assert.throws(()=>verify(),/consumer bytes differ/);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('routes approved source contracts separately from actual live execution',()=>{
  for(const file of ['tests/canary/smoke.canary.spec.ts',
    'tests/live/rwt-open-mic-first-session.live.spec.ts','tests/fixtures/rwt/rwt-fixtures.manifest.json']) {
    const route=executionRoute(file,root);
    assert.equal(route?.runner,'vitest-source-contract',`${file} needs an explicit source-only contract`);
    assert.equal(route.liveExecution,'NOT RUN');
  }
  assert.equal(executionRoute('tests/live/unregistered-helper.ts',root),null);
  assert.equal(executionRoute('tests/fixtures/unconsumed.json',root),null);
  assert.equal(executionRoute('tests/live/unregistered.live.spec.ts',root).runner,'playwright-live');
});
test('deduplicates bound helper consumers within eight phases and batches a ninth instead of dropping it',()=>{
  // A planner fixture represents the receiving shape, not a claim that future
  // callables/consumers already exist on the main-branch baseline.
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'receiving-phase-plan-')));
  const write=(file,source)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),source);};
  try {
  write('package.json','{}');fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
  const pairs=[
    ['tests/canary/canaryStopSaveOracle.ts','tests/unit/canaryStopSaveOracle.test.ts'],
    ['tests/e2e/canaryLanding.ts','tests/e2e/__tests__/canaryLanding.test.ts'],
    ['tests/live/helpers/rwtJourney.ts','tests/unit/progressReaderUrlPredicates.test.ts'],
    ['tests/live/helpers/rwtOracles.ts','tests/unit/rwtReadbackBindingReasons1258.test.ts'],
    ['tests/live/helpers/rwtStepDiagnostics.ts','tests/unit/rwtStepDiagnostics1258.test.ts'],
  ];
  for(const [helperFile,testFile] of pairs) {
    const contract=HELPER_CONTRACTS.find(item=>item.helperFile===helperFile);
    write(helperFile,contract.callables.map(name=>`export function ${name}() { return true; }`).join('\n'));
    write(testFile,'// planning identity only, no execution credit\n');
  }
  write('tests/unit/sourceContractEvidence.test.js','// planning consumer only\n');
  write('tests/canary/smoke.canary.spec.ts',"import {collectCanaryStopSave,isOwnedStopSettledInPage,startOwnerId} from './canaryStopSaveOracle';\n");
  const files=[...pairs.flat(),'tests/unit/humanTestCdpTarget.test.js','tests/unit/rwtReadbackActionBinding1570.test.ts','tests/canary/smoke.canary.spec.ts'];
  const selected=selectExecutionContracts(dir,files);
  assert.equal(selected.length,8);
  assert.equal(selected.filter(item=>item.helper && item.consumerExecution).length,5);
  assert.equal(new Set(selected.map(item=>item.testFile)).size,8);
  assert.deepEqual(selected.map(item=>item.batch),[0,0,0,0,0,0,0,0]);
  const ninth=selectExecutionContracts(dir,[...files,'tests/unit/extra.test.ts']);
  assert.equal(ninth.length,9);
  assert.ok(ninth.some(item=>item.testFile==='tests/unit/extra.test.ts'),'the ninth contract is batched, not trimmed');
  assert.deepEqual(ninth.map(item=>item.batch),[0,0,0,0,0,0,0,0,1]);
  const overflow=Array.from({length:56},(_,n)=>`tests/unit/overflow-${String(n).padStart(2,'0')}.test.ts`);
  assert.equal(selectExecutionContracts(dir,[...files,...overflow]).length,64);
  assert.throws(()=>selectExecutionContracts(dir,[...files,...overflow,'tests/unit/extra.test.ts']),
    /NOT RUN: changed Vitest execution exceeds 8 batches of 8 files/);
  const helperOnly=selectExecutionContracts(dir,[pairs[0][0]]);
  assert.equal(helperOnly.length,1);assert.equal(helperOnly[0].consumerExecution,undefined);
  assert.deepEqual(selectExecutionContracts(dir,['tests/live/helpers/unregistered.ts']),[]);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
const hash=value=>createHash('sha256').update(value).digest('hex');
const context=()=>executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
const contract=TEST_EFFICACY_CONTRACTS[0];

// Synthetic in-memory receipts exercise validation only; no runtime/product PASS is claimed.
function pilot(expected, receiptRoot=root) {
  const names=contract.mutants.map(mutant=>mutant.assertion).sort();
  // Independent construction from the real file inventory and literal reviewed rewrites.
  // Do not call the consumer's expected-input implementation to manufacture its own oracle.
  const inventory=[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--exclude=/apt-bundle/'],
    {cwd:receiptRoot,encoding:'utf8'}).split('\0').filter(Boolean))].sort().filter(file=>fs.existsSync(path.join(receiptRoot,file)))
    .map(file=>[file,hash(fs.readFileSync(path.join(receiptRoot,file)))]);
  const original=fs.readFileSync(path.join(receiptRoot,contract.sourceFile),'utf8');
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
      repoLockSha256:hash(fs.readFileSync(path.join(receiptRoot,'pnpm-lock.yaml'))),
      command:['node','vitest','run',contract.testFile],cwd:receiptRoot,testFile:path.join(receiptRoot,contract.testFile),
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
    testSha256:hash(fs.readFileSync(path.join(receiptRoot,contract.testFile))),sourceSha256:hash(fs.readFileSync(path.join(receiptRoot,contract.sourceFile))),
    baseline:phase('baseline'),control:phase('semantic-control'),mutants:contract.mutants.map(m=>phase(m.id,m)),restored:phase('restored')};
  return {provenance:expected,commit:expected.commit,tree:expected.tree,snapshotSha256:expected.snapshotSha256,
    runId:'synthetic-run',status:'executed',contracts:[result]};
}

// Receipt-shape controls need exact maintained source bytes, not every unrelated
// file in this checkout. Production validators still derive the real fixture
// snapshot independently; no cached inventory or weakened receipt is accepted.
function withPilotFixture(check) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pilot-receipt-control-'));
  try {
    for(const file of [contract.sourceFile,contract.testFile,'pnpm-lock.yaml']) {
      const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,fs.readFileSync(path.join(root,file)));
    }
    const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git(['init']);git(['add','.']);
    git(['-c','user.name=Receipt fixture','-c','user.email=fixture@example.invalid','commit','-m','bounded maintained pilot bytes']);
    const expected=executionContext(dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    return check({root:dir,expected});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
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

test('replays all five raw phases for the narrow pilot and never credits neighboring SQL',()=>withPilotFixture(({root,expected})=>{
  const receipt=pilot(expected,root);
  assert.equal(validatePilotExecution(receipt,expected,root),contract.testFile);
  const coverage=executionCoverage([contract.testFile,'tests/db/focus-points-trial-capability-matrix.sql'],{root,expected,pilot:receipt});
  assert.deepEqual(coverage.rows.map(row=>row.status),['EXECUTED','NOT RUN']);
}));

test('bounded receipt fixture retains exact maintained inputs and refuses a changed source snapshot',()=>withPilotFixture(({root:fixtureRoot,expected})=>{
  const files=execFileSync('git',['ls-files','-z'],{cwd:fixtureRoot,encoding:'utf8'}).split('\0').filter(Boolean);
  assert.deepEqual(files.sort(),[contract.sourceFile,contract.testFile,'pnpm-lock.yaml'].sort());
  for(const file of files) assert.deepEqual(fs.readFileSync(path.join(fixtureRoot,file)),fs.readFileSync(path.join(root,file)));
  const receipt=pilot(expected,fixtureRoot);
  assert.equal(validatePilotExecution(receipt,expected,fixtureRoot),contract.testFile);
  fs.appendFileSync(path.join(fixtureRoot,'pnpm-lock.yaml'),'\n# controlled source change\n');
  assert.throws(()=>validatePilotExecution(receipt,expected,fixtureRoot),/Reviewed source snapshot changed/);
}));

test('consumer derives all five phase inputs, rejecting same-input and incorrect mutant receipts',()=>withPilotFixture(({root,expected})=>{
  const correct=pilot(expected,root);const result=correct.contracts[0];
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
}));

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

test('gate-owned Vitest suites remain NOT RUN without their own validated execution receipts',()=>withPilotFixture(({root,expected})=>{
  const files=['tests/unit/testEfficacy.test.js','tests/unit/testExecutionEvidence.test.js','tests/unit/releasePathSkipPropagation.test.js'];
  const coverage=executionCoverage(files,{root,expected,pilot:pilot(expected,root)});
  assert.equal(coverage.pilot.status,'EXECUTED'); // synthetic pilot evidence still cannot cover neighbors
  assert.equal(coverage.status,'INCOMPLETE');
  assert.deepEqual(coverage.rows.map(row=>[row.route.runner,row.status]),files.map(()=>['vitest','NOT RUN']));
}));

test('rejects missing, stale, wrong-head/attempt/source, skipped and failed execution receipts',()=>withPilotFixture(({root,expected})=>{
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
  ]) {const receipt=pilot(expected,root);corrupt(receipt);assert.throws(()=>validatePilotExecution(receipt,expected,root));}
}));

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
    const proofCases=path.join(dir,'proof-cases'),pdfjs=path.join(dir,'pdfjs');fs.mkdirSync(proofCases);fs.mkdirSync(pdfjs);
    const env=testEnvironment(dir,{phaseId:'synthetic'},path.join(dir,'raw.json'),{
      CT_PROOF_CASES_DIR:proofCases,CT_EXISTING_PDFJS_DIR:pdfjs,GITHUB_TOKEN:'not-forwarded',NODE_OPTIONS:'--import=bad'});
    for (const key of ['GITHUB_TOKEN','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS','NODE_PATH','HTTP_PROXY','HTTPS_PROXY','npm_config_registry']) assert.equal(Object.hasOwn(env,key),false);
    assert.equal(env.NODE_ENV,'test');assert.equal(env.VITE_SUPABASE_ANON_KEY,'test-anon-key');
    assert.equal(env.HOME,path.join(dir,'.efficacy-home'));
    assert.equal(env.CT_PROOF_CASES_DIR,proofCases);assert.equal(env.CT_EXISTING_PDFJS_DIR,pdfjs);
    assert.throws(()=>testEnvironment(dir,null,'',{CT_EXISTING_PDFJS_DIR:path.join(dir,'missing')}),/Invalid CT_EXISTING_PDFJS_DIR/);
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

test('manual full evidence receives an exact base on both a feature ref and main',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
  const scriptFor=name=>{
    const block=workflow.split(`- name: ${name}`)[1];
    if(!block) return '';
    return block.split("<<'NODE'\n")[1].split('\n          NODE')[0]
      .split('\n').map(line=>line.slice(10)).join('\n');
  };
  for(const dispatchRef of ['feature','main']) {
    const {dir,git,commit,base,file}=executionFixture();
    try {
      git(['add',file]);const head=commit();
      git(['update-ref','refs/remotes/origin/main',dispatchRef==='main'?head:base]);
      const output=path.join(dir,'job-env');
      const result=spawnSync(process.execPath,['--input-type=module','-e',
        scriptFor('Begin fresh quality evidence attempt')+'\n'+scriptFor('Resolve exact efficacy comparison base')],
      {cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_ENV:output,GITHUB_ACTIONS:'true',
        GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:head,TEST_EFFICACY_BASE:'',TEST_EFFICACY_DEFAULT_BRANCH:'main'}});
      assert.equal(result.status,0,result.stderr);
      const values=Object.fromEntries(fs.readFileSync(output,'utf8').trim().split('\n').map(line=>line.split('=')));
      assert.equal(values.TEST_EFFICACY_BASE,base,`manual ${dispatchRef} must compare the intended exact ancestor`);
      const generation=workflow.split('- name: Generate qualified software quality evidence')[1].split('- name: Upload CI Metrics')[0];
      assert.doesNotMatch(generation,/TEST_EFFICACY_BASE:/,'the writer must not replace the resolved job base with an empty event field');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('comparison resolution preserves explicit event scope and refuses unavailable history',()=>{
  const {dir,git,commit,base,file}=executionFixture();
  try {
    git(['add',file]);commit();
    for(const event of ['pull_request','push','merge_group']) {
      const resolved=resolveComparisonBase(dir,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:event,TEST_EFFICACY_BASE:base});
      assert.equal(resolved,base);
      assert.deepEqual(changedEvidencePaths(dir,resolved),[file],'only the changed test is selected, not the entire repository');
      assert.throws(()=>resolveComparisonBase(dir,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:event}),/Exact event comparison base required/);
    }
    assert.throws(()=>resolveComparisonBase(dir,{TEST_EFFICACY_BASE:'HEAD~1'}),/exact commit SHA/);
    assert.throws(()=>resolveComparisonBase(dir,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch'}),/Exact comparison base unavailable/);
    git(['update-ref','refs/remotes/origin/main',base]);
    assert.equal(resolveComparisonBase(dir,{}),base,'local paired reports use the same bounded fork point');
    assert.throws(()=>resolveComparisonBase(dir,{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request',TEST_EFFICACY_BASE:'0'.repeat(40)}),/Exact event comparison base required/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

if(process.env.GITHUB_ACTIONS==='true' || process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  test('INSTALLED Vitest: maintained service-level command shares fresh quality provenance',()=>{
    const {dir,write,git,commit}=executionFixture(true);
    try {
      write('scripts/write-service-level-evidence.mjs',fs.readFileSync(path.join(root,'scripts/write-service-level-evidence.mjs')));
      git(['add','scripts/write-service-level-evidence.mjs']);const head=commit();
      const scripts=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts;
      const command=scripts['metrics:service-levels'].split(' && ').at(-1).split(' ');
      assert.equal(command[0],'node');
      assert.match(scripts['rc:slo:dry'],/pnpm metrics:service-levels$/);
      const env={...process.env,GITHUB_ACTIONS:'false',TEST_EFFICACY_BASE:head,NODE_V8_COVERAGE:''};
      delete env.SOFTWARE_QUALITY_INVOCATION;
      const result=spawnSync(process.execPath,command.slice(1),{cwd:dir,env,encoding:'utf8',timeout:120000});
      assert.equal(result.error,undefined);
      assert.equal(result.status,0,'maintained report command must work without a shell-owned invocation: '+result.stderr);
      const quality=JSON.parse(fs.readFileSync(path.join(dir,'product_release/evidence/software-quality.latest.json'),'utf8'));
      const service=JSON.parse(fs.readFileSync(path.join(dir,'product_release/evidence/service-levels.latest.json'),'utf8'));
      assert.equal(quality.overallStatus,'QUALIFIED');
      assert.deepEqual(service.provenance,quality.provenance,'both actual producers must share the same fresh invocation/source');
      assert.match(service.provenance.invocation,/^[a-f0-9-]{36}$/);
      assert.deepEqual(quality.executionCoverage.rows.map(row=>row.status),['EXECUTED']);
      assert.equal(service.countsAsReleaseEvidence,false,'missing stress/live inputs are not release acceptance');
      write('scripts/write-service-level-evidence.mjs',"throw new Error('synthetic-service-failure');\n");
      git(['add','scripts/write-service-level-evidence.mjs']);env.TEST_EFFICACY_BASE=commit();
      const failed=spawnSync(process.execPath,command.slice(1),{cwd:dir,env,encoding:'utf8',timeout:120000});
      assert.equal(failed.status,1);assert.match(failed.stderr,/synthetic-service-failure/);
      for(const name of ['software-quality.latest.json','software-quality-summary.latest.md','service-levels.latest.json','service-levels-summary.latest.md']) {
        assert.equal(fs.existsSync(path.join(dir,'product_release/evidence',name)),false,'a failed paired attempt must invalidate both reports');
      }
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
}

// A real Git diff with one non-pilot Vitest test remains present in every acceptance case.
// Runtime=false supplies only inert package bytes for consumer unit controls, never execution.
function executionFixture(installed=false) {
  const dir=canonicalPath(fs.mkdtempSync(path.join(os.tmpdir(),'quality-vitest-execution-')));
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),bytes);};
  for(const file of ['scripts/write-software-quality-evidence.mjs','scripts/run-test-efficacy.mjs',
    'scripts/efficacy-reporter.mjs','scripts/coverage-thresholds.mjs','scripts/lib/testExecutionEvidence.mjs','scripts/lib/nativeTestExecutionEvidence.mjs','scripts/lib/pythonTestExecutionEvidence.mjs','scripts/lib/python-unittest-reporter.py','scripts/lib/playwrightExecutionEvidence.mjs','scripts/lib/helperExecutionEvidence.mjs','scripts/lib/sourceContractEvidence.mjs',
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

function withTrackedExecutionFixture(check) {
  const f=executionFixture();
  try {
    f.git(['add',f.file]);
    return check({...f,base:f.commit()});
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
}

test('deleted ordinary tests remain non-executable across dirty staged and committed snapshots',()=>withTrackedExecutionFixture(f=>{
  fs.rmSync(path.join(f.dir,f.file));
  for(const state of ['dirty','staged','committed']) {
    if(state==='staged') f.git(['add',f.file]);
    if(state==='committed') f.commit();
    let receipt;
    assert.doesNotThrow(()=>{receipt=runVitestExecution({root:f.dir,base:f.base});},
      `deleted obsolete test must not reach the actual controller's absent-file read (${state})`);
    assert.ok(receipt.changedPaths.includes(f.file),'raw deletion applicability is retained');
    assert.equal(receipt.status,'not-applicable');assert.deepEqual(receipt.tests,[]);
    assert.deepEqual(changedEvidencePaths(f.dir,f.base),[]);
    retainServiceControl(`deleted-controller-${state}`,{},
      {scope:'synthetic deletion, actual controller; no executable credit or live run',receipt});
  }
  // Dropping an executable obligation must not drop deleted-source pilot applicability.
  fs.rmSync(path.join(f.dir,contract.sourceFile));
  const expected=executionContext(f.dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
  const coverage=executionCoverage([],{root:f.dir,expected,base:f.base});
  assert.equal(coverage.status,'INCOMPLETE');
  assert.deepEqual(coverage.pilot,{required:true,status:'NOT RUN'});
}));

test('deleted obsolete test does not break the actual quality writer or earn execution credit',()=>withTrackedExecutionFixture(f=>{
  fs.rmSync(path.join(f.dir,f.file));
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'deleted-test-writer-'));
  try {
    const result=spawnSync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{
      cwd:f.dir,env:{...testEnvironment(scratch,null,''),TEST_EFFICACY_BASE:f.base},encoding:'utf8',timeout:60000});
    retainServiceControl('deleted-test-writer',{result});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
    assert.doesNotMatch(result.stderr,/ENOENT/);
    const evidence=JSON.parse(fs.readFileSync(path.join(f.dir,'product_release/evidence/software-quality.latest.json'),'utf8'));
    assert.equal(evidence.overallStatus,'QUALIFIED');
    assert.equal(evidence.testExecution.length,1,'an empty selection still records its one reconciled batch');
    assert.equal(evidence.testExecution[0].status,'not-applicable');assert.equal(evidence.testExecution[0].batch.count,0);
    assert.deepEqual(evidence.testExecution[0].tests,[]);assert.deepEqual(evidence.executionCoverage.rows,[]);
    assert.deepEqual(evidence.executionCoverage.pilot,{required:false,status:'NOT APPLICABLE'});
    retainServiceControl('deleted-test-writer',{result},{quality:evidence});
    // Synthetic metric counts and a removed ordinary test claim no executed test or journey.
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
}));

test('renames and recreated paths retain live execution obligations without receipts',()=>withTrackedExecutionFixture(f=>{
  const destination='tests/unit/renamed-execution.test.js';
  fs.renameSync(path.join(f.dir,f.file),path.join(f.dir,destination));
  for(const state of ['dirty','committed']) {
    if(state==='committed') {f.git(['add','tests']);f.commit();}
    assert.deepEqual(changedEvidencePaths(f.dir,f.base),[destination]);
    const expected=executionContext(f.dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const coverage=executionCoverage([destination],{root:f.dir,expected,base:f.base});
    assert.equal(coverage.status,'INCOMPLETE');assert.equal(coverage.rows[0].status,'NOT RUN');
  }
  f.write(f.file,f.passing);
  const paths=changedEvidencePaths(f.dir,f.base);
  assert.deepEqual(paths,[f.file,destination].sort());
  const expected=executionContext(f.dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
  const coverage=executionCoverage(paths,{root:f.dir,expected,base:f.base});
  assert.equal(coverage.status,'INCOMPLETE');assert.ok(coverage.rows.every(row=>row.status==='NOT RUN'));
}));

test('changed and untracked current tests stay unqualified without execution receipts',()=>withTrackedExecutionFixture(f=>{
  const untracked='tests/unit/untracked-execution.test.js';
  f.write(f.file,`${f.passing}\n// changed tracked input\n`);f.write(untracked,f.passing);
  const paths=changedEvidencePaths(f.dir,f.base);
  assert.deepEqual(paths,[f.file,untracked].sort());
  const expected=executionContext(f.dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
  const coverage=executionCoverage(paths,{root:f.dir,expected,base:f.base});
  assert.equal(coverage.status,'INCOMPLETE');
  assert.deepEqual(coverage.rows.map(row=>[row.file,row.status]),paths.map(file=>[file,'NOT RUN']));
}));

test('existing malformed test paths cannot masquerade as deleted executable inputs',()=>withTrackedExecutionFixture(f=>{
  fs.rmSync(path.join(f.dir,f.file));
  fs.symlinkSync('missing-test-target.js',path.join(f.dir,f.file));
  assert.deepEqual(changedEvidencePaths(f.dir,f.base),[f.file],
    'a dangling symlink exists in the current snapshot and must remain unqualified');
  const expected=executionContext(f.dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
  const coverage=executionCoverage([f.file],{root:f.dir,expected,base:f.base});
  assert.equal(coverage.status,'INCOMPLETE');assert.equal(coverage.rows[0].status,'NOT RUN');
}));

// Execute the checked-in step bodies and upload paths. Only GitHub's download API
// is mocked; report inputs go through run-metrics and both real paired producers.
function workflowStep(source,name) {
  const block=source.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- (?:name|uses):/)[0];
  assert.ok(block,`missing workflow step: ${name}`);
  const run=block.match(/^ {8}run: (.+)$/m);
  assert.ok(run,`missing run body: ${name}`);
  return run[1]==='|' ? block.slice(run.index+run[0].length+1).split('\n')
    .map(line=>line.startsWith('          ')?line.slice(10):line).join('\n').trimEnd() : run[1];
}

function serviceWorkflowFixture({childFailure=false}={}) {
  const fixture=executionFixture(true);
  const {dir,write,git,commit}=fixture;
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ci-quality-download-'));
  const ci=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
  const caller=fs.readFileSync(path.join(root,'.github/workflows/service-level-evidence.yml'),'utf8');
  write('package.json',fs.readFileSync(path.join(root,'package.json')));
  write('scripts/pnpm-only.mjs',fs.readFileSync(path.join(root,'scripts/pnpm-only.mjs')));
  write('scripts/write-service-level-evidence.mjs',childFailure?"throw new Error('controlled-service-child-failure');\n"
    :fs.readFileSync(path.join(root,'scripts/write-service-level-evidence.mjs')));
  write('.gitignore','node_modules\ntest-results/\nproduct_release/evidence/\nartifacts/\nunit-metrics.json\nfrontend/dist/\n');
  write('backend/.keep','synthetic size input\n');write('docs/.keep','synthetic size input\n');
  git(['add','package.json','scripts/pnpm-only.mjs','scripts/write-service-level-evidence.mjs','.gitignore','backend/.keep','docs/.keep']);
  const head=commit();
  // Synthetic shard/browser inputs are never a product PASS. The canonical metrics
  // JSON itself is generated by the actual producer, not hand-built for the consumer.
  write('unit-metrics.json',JSON.stringify({numPassedTests:6,numFailedTests:0,numPendingTests:0,numTotalTests:6,
    testFiles:MEANINGFUL_COVERAGE_MANIFEST.map(item=>item.testFile),skippedTestFiles:[]}));
  write('frontend/coverage/coverage-summary.json',JSON.stringify({total:Object.fromEntries(
    ['statements','branches','functions','lines'].map(key=>[key,{pct:80}]))}));
  write('test-results/playwright/results.json',JSON.stringify({stats:{expected:1,unexpected:0,flaky:0,skipped:0}}));
  write('frontend/dist/index.html','<script type="module" src="/assets/index-fixture.js"></script>');
  write('frontend/dist/assets/index-fixture.js','console.log("fixture");\n'.repeat(200));
  const env={...process.env,NODE_V8_COVERAGE:'',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_SHA:head,GITHUB_RUN_ID:'202',GITHUB_RUN_ATTEMPT:'1',TEST_EFFICACY_BASE:head,
    SOFTWARE_QUALITY_INVOCATION:randomUUID(),GITHUB_ENV:path.join(scratch,'github-env'),RUNNER_TEMP:scratch};
  const run=(body,runEnv=env)=>spawnSync('/bin/bash',['-e','-o','pipefail'],{cwd:dir,input:body,
    env:runEnv,encoding:'utf8',timeout:120000});
  const produced=run(`bash '${path.join(root,'scripts/run-metrics.sh')}'`,{...env,TOTAL_RUNTIME_SECONDS:'1'});
  assert.equal(produced.status,0,produced.stderr);
  write('artifacts/ci-metrics.json',JSON.stringify({totals:{logicalTimeMs:1000}}));
  const quality=run(workflowStep(ci,'Generate qualified software quality evidence'));
  assert.equal(quality.status,0,quality.stderr);
  const originStep=workflowStep(ci,'Bind canonical CI quality inputs');
  const origin=run(originStep);assert.equal(origin.status,0,origin.stderr);
  const upload=ci.split('      - name: Upload CI Metrics\n')[1].split(/\n {2}[^ ]/)[0];
  const paths=upload.match(/ {10}path: \|\n((?: {12}[^\n]*\n)+)/)?.[1]
    .trim().split('\n').map(line=>line.trim());
  assert.ok(paths?.length,'actual upload layout missing');
  const payload=path.join(scratch,'payload');
  for(const file of paths) if(fs.existsSync(path.join(dir,file))) {
    fs.mkdirSync(path.dirname(path.join(payload,file)),{recursive:true});fs.copyFileSync(path.join(dir,file),path.join(payload,file));
  }
  const bin=path.join(scratch,'bin');fs.mkdirSync(bin);
  const binding=JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
  if(binding?.fixture) {
    const manager=binding.fixture.sourceBinding.packageManager;
    assert.equal(hash(fs.readFileSync(manager.entry)),manager.entrySha256);
    // Use the bound, already installed pnpm implementation. No inherited PATH,
    // Corepack download, fake paired command or alternative package manager.
    fs.writeFileSync(path.join(bin,'pnpm'),`#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nconst p=spawnSync(process.execPath,[${JSON.stringify(manager.entry)},...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,COREPACK_ENABLE_NETWORK:'0'}});process.exit(p.status??1);\n`,{mode:0o755});
  }
  fs.writeFileSync(path.join(bin,'gh'),`#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';
const a=process.argv.slice(2);
if(a[0]==='run'&&a[1]==='list')process.stdout.write('202');
else if(a[0]==='run'&&a[1]==='download')fs.cpSync(process.env.FIXTURE_PAYLOAD,a[a.indexOf('--dir')+1],{recursive:true});
else if(a[0]==='api')process.stdout.write(JSON.stringify({id:202,run_attempt:1,head_sha:process.env.GITHUB_SHA,status:'completed',conclusion:'success'}));
else process.exit(91);\n`,{mode:0o755});
  const consumer={...env,GITHUB_RUN_ID:'802',GITHUB_RUN_ATTEMPT:'2',PATH:bin+path.delimiter+process.env.PATH,
    FIXTURE_PAYLOAD:payload,GH_TOKEN:'synthetic-fixture-only',GITHUB_REPOSITORY:'fixture/project'};
  const loadEnv=()=>{if(fs.existsSync(env.GITHUB_ENV))for(const line of fs.readFileSync(env.GITHUB_ENV,'utf8').trim().split('\n')) {
    const split=line.indexOf('=');if(split>0)consumer[line.slice(0,split)]=line.slice(split+1);
  }};
  const outputs=['software-quality.latest.json','software-quality-summary.latest.md','service-levels.latest.json','service-levels-summary.latest.md'];
  return {dir,write,head,payload,consumer,caller,ci,run,loadEnv,outputs,
    clean:()=>{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(scratch,{recursive:true,force:true});}};
}

function retainServiceControl(name,phases,extra={}) {
  const directory=process.env.SERVICE_CALLER_CONTROL_RECEIPT_DIR;
  if(!directory)return;
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,`${name}.json`),JSON.stringify({scope:'synthetic inputs, actual workflow/report scripts; no live run',
    phases:Object.fromEntries(Object.entries(phases).map(([key,value])=>[key,
      {status:value.status,signal:value.signal,error:value.error?.message??null,stdout:value.stdout,stderr:value.stderr}])),...extra},null,2));
}

// Initial CI input construction is fixture setup, not the timed caller assertion.
// In the dedicated phase reuse it through the runner's existing lifecycle hooks:
// hook budget10s, named-test budget5s and controller phase budget60s stay unchanged.
let preparedWorkflowFixture;
if(process.env.TEST_EFFICACY_SERVICE_CALLER_FIXTURE==='1') {
  framework.beforeAll(()=>{preparedWorkflowFixture=serviceWorkflowFixture();});
  framework.afterAll(()=>{preparedWorkflowFixture?.clean();});
}

// Synthetic receipt-shape controls are not runtime proof. The installed writer controls
// below independently exercise the real producer, reporter, consumer and final coverage gate.
function fixtureWitnessControl() {
  const f=executionFixture(true);
  f.write('package.json',fs.readFileSync(path.join(root,'package.json')));
  f.write(fixtureConsumer.fixtureFile,fs.readFileSync(path.join(root,fixtureConsumer.fixtureFile)));
  f.write(fixtureConsumer.testFile,'// synthetic consumer identity only\n');
  const binding={cwd:f.dir,phaseId:randomUUID()};
  binding.fixture={fixtureFile:fixtureConsumer.fixtureFile,testFile:fixtureConsumer.testFile,
    sourceBinding:fixtureSourceBinding(f.dir,fixtureConsumer.fixtureFile),
    witnessFile:path.join(f.dir,`.fixture-${binding.phaseId}.json`)};
  const raw={schemaVersion:1,phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding)),
    fixtureFile:fixtureConsumer.fixtureFile,fixtureSha256:fixtureConsumer.sha256,assertion:fixtureConsumer.assertion,
    old:{status:1,signal:null,error:null,stderr:'Metrics artifact not found'},current:{status:0,signal:null,error:null}};
  const report={testResults:[{assertionResults:[{fullName:fixtureConsumer.assertion,status:'passed'}]}]};
  const envelope={finished:{files:[{tasks:[{type:'test',name:fixtureConsumer.assertion,result:{state:'pass'}}]}]}};
  return {...f,binding,raw,report,envelope,clean:()=>fs.rmSync(f.dir,{recursive:true,force:true})};
}

// This receipt-shape control uses the installed pinned pnpm runtime. Keep it in the
// installed-runtime lane; the ordinary isolated file phase has no inherited runtime cache.
if(process.env.GITHUB_ACTIONS==='true'||process.env.TEST_EFFICACY_REAL_RUNTIME==='1') test('fixture registration is exact; witness rejects stale bytes, runtime, phase, missing execution and invented success',()=>{
  const f=fixtureWitnessControl();
  try {
    const verify=(raw=f.raw,binding=f.binding,report=f.report,envelope=f.envelope)=>
      validateFixtureWitness(raw,binding,f.dir,report,envelope);
    assert.equal(verify(),fixtureConsumer.fixtureFile);
    assert.equal(executionRoute(fixtureConsumer.fixtureFile,f.dir).consumer,fixtureConsumer.testFile);
    assert.equal(executionRoute('tests/fixtures/efficacy/unknown.yml',f.dir),null);
    for(const edit of [raw=>{raw.phaseId=randomUUID();},raw=>{raw.fixtureSha256='a'.repeat(64);},
      raw=>{raw.old.status=0;},raw=>{raw.old.stderr='unrelated loader failure';},raw=>{raw.current.status=1;}]) {
      const raw=structuredClone(f.raw);edit(raw);
      assert.throws(()=>verify(raw),/fixture consumption witness/);
    }
    assert.throws(()=>verify(null),/fixture consumption witness/);
    assert.throws(()=>verify(f.raw,f.binding,{testResults:[]}),/consumer was not executed/);
    assert.throws(()=>verify(f.raw,f.binding,f.report,{finished:{files:[]}}),/consumer was not executed/);
    const changed=structuredClone(f.binding);changed.fixture.sourceBinding.packageManager.entrySha256='b'.repeat(64);
    assert.throws(()=>verify(f.raw,changed),/stale fixture\/consumer\/runtime/);
    f.write(fixtureConsumer.fixtureFile,'changed historical input');
    assert.throws(()=>verify(),/pinned input/);
  } finally {f.clean();}
});

test('fixture runtime must already match the repository pnpm pin; no runtime acquisition or arbitrary selector',()=>{
  const f=executionFixture(true);
  try {
    f.write('package.json',JSON.stringify({packageManager:'pnpm@latest'}));
    assert.throws(()=>fixturePackageManagerIdentity(f.dir,{PATH:''}),/Unsupported fixture package-manager pin/);
    f.write('package.json',JSON.stringify({packageManager:'pnpm@0.0.1'}));
    assert.throws(()=>fixturePackageManagerIdentity(f.dir,{PATH:'',COREPACK_HOME:path.join(f.dir,'empty-cache')}),/installed pnpm runtime unavailable/);
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});

function fixtureWriterProject(weakened=false,preparationFailure=false) {
  const f=executionFixture(true);
  const metrics=JSON.parse(fs.readFileSync(path.join(f.dir,'test-results/metrics.json'),'utf8'));
  metrics.e2e_tests.flaky=0;
  f.write('test-results/metrics.json',JSON.stringify(metrics));
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-writer-environment-'));
  const diagnosticFile=path.join(scratch,'failed-phase.json');
  for(const file of ['package.json','scripts/pnpm-only.mjs','scripts/run-metrics.sh','scripts/write-service-level-evidence.mjs',
    '.github/workflows/ci.yml','.github/workflows/service-level-evidence.yml',fixtureConsumer.testFile]) {
    f.write(file,fs.readFileSync(path.join(root,file)));
  }
  if(weakened) f.write(fixtureConsumer.testFile,`import {test,expect} from 'vitest';\ntest(${JSON.stringify(fixtureConsumer.assertion)},()=>expect(2+3).toBe(5));\n`);
  if(preparationFailure) {
    const source=fs.readFileSync(path.join(f.dir,fixtureConsumer.testFile),'utf8');
    const setup='framework.beforeAll(()=>{preparedWorkflowFixture=serviceWorkflowFixture();});';
    assert.ok(source.includes(setup));
    f.write(fixtureConsumer.testFile,source.replace(setup,"framework.beforeAll(()=>{throw new Error('controlled-fixture-preparation-failure');});"));
    // Observe the existing private diagnostic payload without changing the real
    // producer's decision or publishing diagnostics from the production script.
    const producer='scripts/write-software-quality-evidence.mjs';
    const bytes=fs.readFileSync(path.join(f.dir,producer),'utf8');
    const failed="console.error('[QualityMetrics] Failed to generate software quality evidence:', error);";
    assert.ok(bytes.includes(failed));
    f.write(producer,bytes.replace(failed,failed+`\n  fs.writeFileSync(${JSON.stringify(diagnosticFile)},JSON.stringify(error.diagnostics));`));
  }
  f.git(['add','.']);const base=f.commit();
  // Only the registered data input is new. No historical branch/object exists in this project.
  f.write(fixtureConsumer.fixtureFile,fs.readFileSync(path.join(root,fixtureConsumer.fixtureFile)));
  const environment={...testEnvironment(scratch,null,''),GITHUB_ACTIONS:'true',GITHUB_SHA:base,GITHUB_RUN_ID:'803',GITHUB_RUN_ATTEMPT:'1',
    TEST_EFFICACY_BASE:base,SOFTWARE_QUALITY_INVOCATION:randomUUID(),npm_execpath:fixturePackageManagerIdentity(root).entry};
  const result=spawnSync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{
    cwd:f.dir,env:environment,encoding:'utf8',timeout:65000});
  return {...f,result,base,environment,diagnosticFile,clean:()=>{
    fs.rmSync(f.dir,{recursive:true,force:true});fs.rmSync(scratch,{recursive:true,force:true});
  }};
}

if(process.env.GITHUB_ACTIONS==='true'||process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  test('INSTALLED actual writer credits only the consumed pinned fixture, with one executed workflow-control assertion',()=>{
    const f=fixtureWriterProject();
    try {
      retainServiceControl('registered-fixture-writer',{result:f.result});
      assert.equal(f.result.error,undefined);assert.equal(f.result.status,0,f.result.stderr);
      const evidence=JSON.parse(fs.readFileSync(path.join(f.dir,'product_release/evidence/software-quality.latest.json'),'utf8'));
      assert.equal(evidence.overallStatus,'QUALIFIED');assert.equal(evidence.executionCoverage.status,'COMPLETE');
      assert.equal(evidence.tests.flaky,0);
      assert.deepEqual(evidence.tests.e2e,{passed:1,failed:0,skipped:0,flaky:0,total:1});
      assert.ok(fs.readFileSync(path.join(f.dir,'product_release/evidence/software-quality-summary.latest.md'),'utf8')
        .includes('| Flaky (passed only on retry) | 0 | 0 |'));
      assert.deepEqual(evidence.executionCoverage.rows.map(row=>[row.file,row.status]),[[fixtureConsumer.fixtureFile,'EXECUTED']]);
      assert.equal(evidence.testExecution.length,1);assert.equal(evidence.testExecution[0].batch.count,1);
      const phase=evidence.testExecution[0].tests[0].phase;
      assert.equal(phase.report.numTotalTests,1);assert.equal(phase.report.numPendingTests,0);
      assert.ok(phase.envelope.finished.files.flatMap(file=>file.tasks).some(task=>task.type==='suite'
        && task.result?.hooks?.beforeAll==='pass' && task.result?.hooks?.afterAll==='pass'),
      'actual fixture setup and cleanup must pass through existing hooks outside the five-second named-test budget');
      assert.equal(phase.fixtureWitness.old.status,1);assert.equal(phase.fixtureWitness.current.status,0);
      assert.equal(phase.fixtureWitness.fixtureSha256,fixtureConsumer.sha256);
      assert.equal(readCurrentQuality(path.join(f.dir,'product_release/evidence/software-quality.latest.json'),evidence.provenance,f.dir,f.base).overallStatus,'QUALIFIED');
      retainServiceControl('registered-fixture-writer',{result:f.result},{quality:evidence});
    } finally {f.clean();}
  });
  test('INSTALLED actual writer refuses a passing named consumer that never consumes the fixture',()=>{
    const f=fixtureWriterProject(true);
    try {
      retainServiceControl('unconsumed-fixture-writer',{result:f.result});
      assert.equal(f.result.error,undefined);assert.equal(f.result.status,1);
      assert.match(f.result.stderr,/Missing actual fixture consumption witness/);
      assert.doesNotMatch(f.result.stderr,/Cannot find module|budget exceeds|timed out/);
      assert.equal(fs.existsSync(path.join(f.dir,'product_release/evidence/software-quality.latest.json')),false);
    } finally {f.clean();}
  });
  test('INSTALLED actual writer refuses failed fixture preparation instead of crediting a named consumer',()=>{
    const f=fixtureWriterProject(false,true);
    try {
      assert.equal(f.result.error,undefined);assert.equal(f.result.status,1);
      const raw=JSON.parse(fs.readFileSync(f.diagnosticFile,'utf8'));
      retainServiceControl('failed-fixture-preparation',{result:f.result},{diagnostics:raw});
      assert.equal(raw.status,1);assert.equal(raw.signal,null);assert.equal(raw.error,null);
      assert.ok(raw.envelope.finished.files.flatMap(file=>file.tasks).some(task=>task.type==='suite'
        && task.result?.state==='fail' && task.result.hooks?.beforeAll!=='pass'
        && task.result.errors.some(error=>/controlled-fixture-preparation-failure/.test(error.message))));
      assert.equal(fs.existsSync(path.join(f.dir,'product_release/evidence/software-quality.latest.json')),false);
    } finally {f.clean();}
  });
}

if(process.env.GITHUB_ACTIONS==='true'||process.env.TEST_EFFICACY_REAL_RUNTIME==='1'||process.env.TEST_EFFICACY_SERVICE_CALLER_FIXTURE==='1') {
  test('INSTALLED upload layout → workflow staging → maintained paired command preserves CI origin and new invocation',()=>{
    const f=preparedWorkflowFixture || serviceWorkflowFixture();
    try {
      // Immutable pre-fix bytes from adfeab3441cccb2ef44c94349e1f9d246154ae97,
      // .github/workflows/service-level-evidence.yml. Runtime proof must survive squash/branch deletion.
      const oldBytes=fs.readFileSync(path.join(root,'tests/fixtures/efficacy/service-level-evidence.adfeab34.yml'));
      assert.equal(hash(oldBytes),'bbe2873647d2c3f922c70d10fb9f05b4b4e360106a19bb0de00c64b771a0db56',
        'historical workflow fixture differs from the reviewed pre-fix bytes');
      const old=oldBytes.toString('utf8');
      // Rebind only the old hard-coded download directory into this owned fixture.
      const oldFetch=workflowStep(old,'Fetch software quality evidence from CI')
        .replaceAll('/tmp/speaksharp-ci-metrics',path.join(f.consumer.RUNNER_TEMP,'old-download'));
      assert.equal(f.run(oldFetch,f.consumer).status,0);
      fs.rmSync(path.join(f.dir,'test-results/metrics.json'));
      const casualty=f.run(workflowStep(old,'Generate service-level evidence'),f.consumer);
      assert.equal(casualty.status,1);
      assert.match(casualty.stderr,/Metrics artifact not found/);
      for(const name of f.outputs)assert.equal(fs.existsSync(path.join(f.dir,'product_release/evidence',name)),false);
      assert.equal(f.run(workflowStep(f.caller,'Fetch software quality evidence from CI'),f.consumer).status,0);
      f.loadEnv();
      const staged=f.run(workflowStep(f.caller,'Stage verified CI quality inputs'),f.consumer);
      assert.equal(staged.status,0,staged.stderr);f.loadEnv();
      const result=f.run(workflowStep(f.caller,'Generate service-level evidence'),f.consumer);
      retainServiceControl('old-route-and-fixed-route',{casualty,staged,result});
      assert.equal(result.status,0,result.stderr);
      const read=name=>JSON.parse(fs.readFileSync(path.join(f.dir,'product_release/evidence',name),'utf8'));
      const quality=read('software-quality.latest.json'),service=read('service-levels.latest.json');
      const origin=read('software-quality-input-origin.json');
      assert.deepEqual(quality.provenance,service.provenance);
      assert.equal(quality.provenance.runId,'802');assert.equal(origin.originatingCi.runId,'202');
      assert.equal(origin.regeneratedBy.runId,'802');
      assert.notEqual(quality.provenance.invocation,origin.qualityProvenance.invocation);
      assert.equal(service.countsAsReleaseEvidence,false,'no stress/endurance/live input was run by this fixture');
      const binding=JSON.parse(process.env.TEST_EFFICACY_BINDING || 'null');
      if(binding?.fixture) fs.writeFileSync(binding.fixture.witnessFile,JSON.stringify({schemaVersion:1,
        phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding)),
        fixtureFile:'tests/fixtures/efficacy/service-level-evidence.adfeab34.yml',fixtureSha256:hash(oldBytes),
        assertion:'INSTALLED upload layout → workflow staging → maintained paired command preserves CI origin and new invocation',
        old:{status:casualty.status,signal:casualty.signal,error:casualty.error?.code??null,stderr:casualty.stderr},
        current:{status:result.status,signal:result.signal,error:result.error?.code??null}}));
    } finally {if(!preparedWorkflowFixture) f.clean();}
  });
  for(const mode of ['missing','wrong-head','history','child-failure']) test(`INSTALLED service caller ${mode} leaves no PASS output`,()=>{
    const f=serviceWorkflowFixture({childFailure:mode==='child-failure'});
    try {
      const originPath=path.join(f.payload,'artifacts/software-quality-input-origin.json');
      const origin=JSON.parse(fs.readFileSync(originPath,'utf8'));
      if(mode==='missing')fs.rmSync(path.join(f.payload,'test-results/metrics.json'));
      if(mode==='wrong-head')origin.originatingCi.commit='f'.repeat(40);
      if(mode==='history')origin.comparisonBase='e'.repeat(40);
      fs.writeFileSync(originPath,JSON.stringify(origin));
      const fetch=f.run(workflowStep(f.caller,'Fetch software quality evidence from CI'),f.consumer);
      assert.equal(fetch.status,0,fetch.stderr);f.loadEnv();
      const stage=f.run(workflowStep(f.caller,'Stage verified CI quality inputs'),f.consumer);f.loadEnv();
      const result=f.run(workflowStep(f.caller,'Generate service-level evidence'),f.consumer);
      retainServiceControl(mode,{fetch,stage,result});
      if(mode==='child-failure') {
        assert.equal(stage.status,0,stage.stderr);assert.match(result.stderr,/controlled-service-child-failure/);
      } else assert.equal(stage.status,1,stage.stderr);
      assert.equal(result.status,1,result.stderr);
      for(const name of f.outputs)assert.equal(fs.existsSync(path.join(f.dir,'product_release/evidence',name)),false,name);
    } finally {f.clean();}
  });
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
    const receipt={...expected,provenance:expected,runId:binding.runId,status:'executed',base,executionKind:'changed-evidence',
      batch:executionBatchIdentity(selectExecutionContracts(dir,[file]),0),tests:[{testFile:file,
      testSha256:hash(fs.readFileSync(path.join(dir,file))),phase:{binding,envelope,report,inputSha256,execution:{status:0,signal:null,error:null}}}]};
    assert.deepEqual([...validateVitestExecution(receipt,expected,dir)],[file]);
    assert.equal(executionCoverage([file],{root:dir,base,expected,execution:receipt}).status,'COMPLETE');
    assert.equal(executionCoverage([file],{root:dir,base,expected}).status,'INCOMPLETE');
    // The caller's comparison base and kind bind the batch inventory; a receipt cannot choose its own.
    for(const change of [r=>{r.base='0'.repeat(40);},r=>{r.base=null;},r=>{r.executionKind='registered-helpers';},r=>{delete r.batch;}]) {
      const candidate=structuredClone(receipt);change(candidate);
      assert.throws(()=>executionCoverage([file],{root:dir,base,expected,execution:candidate}),/base\/kind|batch/);
    }
    assert.throws(()=>executionCoverage([file],{root:dir,base:'0'.repeat(40),expected,execution:receipt}),/base\/kind/);
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

// Hosted CI always runs these; local opt-in requires installed Vitest, with no fallback.
if(process.env.GITHUB_ACTIONS==='true' || process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
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
      assert.equal(receipt.testExecution.length,1);
      assert.equal(receipt.testExecution[0].tests[0].phase.report.numTotalTests,1);
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

if(process.env.GITHUB_ACTIONS==='true' || process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  // Asynchronous spawn keeps the worker's event loop free: this file's synchronous writer runs approach Vitest's 60 s RPC limit.
  const runAsync=(command,args,options)=>new Promise(resolve=>{
    const child=spawn(command,args,options);let stdout='',stderr='',error;
    child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
    child.on('error',cause=>{error=cause;});child.on('close',(status,signal)=>resolve({error,status,signal,stdout,stderr}));
  });
  test('INSTALLED Vitest: nine changed tests run as two actual batches through the writer and reconcile only when complete',async()=>{
    runtimeIdentity(root);
    const {dir,write,git,file,passing}=executionFixture(true);
    const evidenceFile=path.join(dir,'product_release/evidence/software-quality.latest.json');
    const files=[file,...Array.from({length:8},(_,n)=>`tests/unit/changed-execution-${n}.test.js`)].sort();
    files.forEach((name,n)=>write(name,passing.replace('changed non-pilot computes','changed non-pilot '+n+' computes')));
    try {
      const head=git(['rev-parse','HEAD']);
      const result=await runAsync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{cwd:dir,timeout:600000,
        env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_SHA:head,GITHUB_RUN_ID:'901',GITHUB_RUN_ATTEMPT:'3',
          TEST_EFFICACY_BASE:head,SOFTWARE_QUALITY_INVOCATION:randomUUID(),NODE_V8_COVERAGE:''}});
      assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
      const evidence=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
      assert.deepEqual(evidence.testExecution.map(receipt=>[receipt.batch.index,receipt.batch.count,receipt.tests.length]),[[0,2,8],[1,2,1]]);
      assert.deepEqual(evidence.testExecution.flatMap(receipt=>receipt.tests.map(item=>item.testFile)),files);
      assert.equal(new Set(evidence.testExecution.map(receipt=>receipt.runId)).size,2);
      assert.deepEqual(evidence.executionCoverage.rows.map(row=>[row.file,row.status]),files.map(name=>[name,'EXECUTED']));
      assert.equal(readCurrentQuality(evidenceFile,evidence.provenance,dir,head).overallStatus,'QUALIFIED');
      for(const [name,change] of [['missing batch',e=>{e.testExecution.pop();}],['duplicate batch',e=>{e.testExecution[1]=structuredClone(e.testExecution[0]);}],
        ['reordered',e=>{e.testExecution.reverse();}],['moved contract',e=>{e.testExecution[1].tests.push(e.testExecution[0].tests.pop());}]]) {
        const candidate=structuredClone(evidence);change(candidate);fs.writeFileSync(evidenceFile,JSON.stringify(candidate));
        assert.throws(()=>readCurrentQuality(evidenceFile,evidence.provenance,dir,head),/batch|Inconsistent|Duplicate|contracts/,name);
      }
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  },600000);

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
      'scripts/lib/testExecutionEvidence.mjs','scripts/lib/nativeTestExecutionEvidence.mjs','scripts/lib/pythonTestExecutionEvidence.mjs','scripts/lib/python-unittest-reporter.py','scripts/lib/playwrightExecutionEvidence.mjs','scripts/lib/helperExecutionEvidence.mjs','scripts/lib/sourceContractEvidence.mjs','scripts/lib/softwareQualityEvidenceQualification.mjs',
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

test('Python unittest modules are inventoried and routed NOT RUN; none is omitted or credited',()=>{
  const f=executionFixture();
  try {
    const python={
      'tools/cloud-test/tests/test_full_plan.py':'import unittest\n',
      'tools/cloud-test/report/tests/test_run_report.py':'import unittest\n',
      'tests/unit/test_outside_package.py':'import unittest\n',
      'tools/cloud-test/scripts/verify_harness.py':'print("not a test module")\n',
    };
    for(const [file,source] of Object.entries(python))f.write(file,source);
    const inventory=changedEvidencePaths(f.dir,f.base);
    // Every test_*.py is an evidence path, including outside tests/; ordinary scripts stay out.
    for(const file of Object.keys(python).filter(file=>/\/test_[^/]+\.py$/.test(file)))assert.ok(inventory.includes(file),file);
    assert.ok(!inventory.includes('tools/cloud-test/scripts/verify_harness.py'));
    // Package modules have an approved, independently validated Python receipt route.
    for(const file of ['tools/cloud-test/tests/test_full_plan.py','tools/cloud-test/report/tests/test_run_report.py']) {
      assert.deepEqual(executionRoute(file,f.dir),{runner:'python-unittest',consumer:file,applicable:true});
    }
    // Outside the reviewed package there is no runner at all: UNCOVERED, not routed.
    assert.equal(executionRoute('tests/unit/test_outside_package.py',f.dir),null);
    // Provenance of the fixture under test, not the hosting checkout (which may hold runner scratch such as .efficacy-tmp/).
    const expected=executionContext(f.dir,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const coverage=executionCoverage(inventory.filter(file=>file.endsWith('.py')),{root:f.dir,expected,base:f.base});
    assert.deepEqual(Object.fromEntries(coverage.rows.map(row=>[row.file,row.status])),{
      'tests/unit/test_outside_package.py':'UNCOVERED',
      'tools/cloud-test/report/tests/test_run_report.py':'NOT RUN',
      'tools/cloud-test/tests/test_full_plan.py':'NOT RUN',
    });
    assert.equal(coverage.status,'INCOMPLETE');
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});
