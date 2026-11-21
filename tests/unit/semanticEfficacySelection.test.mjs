import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {executionContext,executionCoverage,requiredSemanticContracts} from '../../scripts/lib/testExecutionEvidence.mjs';
import {selectContracts} from '../../scripts/run-test-efficacy.mjs';

const inputs=[
  'backend/supabase/migrations/20261117105700_practice_privacy_choices_1835.sql',
  'tests/live/rwt-save-retry-recovery.live.spec.ts',
];
const run=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

for(const input of inputs) test(`source-only ${input} requires the unchanged save-consent contract`,()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-source-')));
  try {
    const target=path.join(root,input);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,'test fixture baseline\n');
    run(root,['init']); run(root,['add','.']);
    run(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline']);
    const base=run(root,['rev-parse','HEAD']);
    fs.appendFileSync(target,'source-only change\n');
    assert.deepEqual(selectContracts(root,[input]).map(contract=>contract.id),
      input.endsWith('.sql')?['save-consent-boundary','coaching-consent-boundary']:['save-consent-boundary','retry-save-single-owned-take','retry-save-cleanup-finalization']);
    const expected=executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    assert.equal(executionCoverage([],{root,expected,base}).pilot.status,'NOT RUN');
    const receipt={...expected,provenance:expected,base,status:'executed',contracts:[{id:'analytics-truth'}]};
    assert.throws(()=>executionCoverage([],{root,expected,base,pilot:receipt}),/Wrong required semantic contract set/);
    for(const contracts of [[],[{id:'save-consent-boundary'},{id:'analytics-truth'}]]) {
      assert.throws(()=>executionCoverage([],{root,expected,base,pilot:{...receipt,contracts}}),/Wrong required semantic contract set/);
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('scope selection still covers analytics, and empty no-base never narrows the inventory',()=>{
  assert.deepEqual(requiredSemanticContracts(['README.md']),[]);
  assert.deepEqual(requiredSemanticContracts(['frontend/src/utils/metricValidity.ts']).map(c=>c.id),['analytics-truth']);
  assert.deepEqual(requiredSemanticContracts(['frontend/src/lib/storage.ts']).map(c=>c.id),['analytics-truth','save-consent-boundary']);
  assert.deepEqual(requiredSemanticContracts(['scripts/private-corpus-acceptance.mjs']).map(c=>c.id),['analytics-truth','private-stop-finalization-truth']);
  assert.deepEqual(requiredSemanticContracts(null).map(c=>c.id),['analytics-truth','save-consent-boundary','coaching-consent-boundary','retry-save-single-owned-take','retry-save-cleanup-finalization','private-stop-finalization-truth']);
});

test('an Edge consent reader change requires the unchanged native Deno consumer',async()=>{
  const {changedEvidencePaths}=await import('../../scripts/lib/testExecutionEvidence.mjs');
  const {COACHING_EDGE_TEST,selectNativeContracts}=await import('../../scripts/lib/nativeTestExecutionEvidence.mjs');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-edge-source-')));
  try {
    const reader='backend/supabase/functions/get-ai-suggestions/practicePrivacy.ts';
    for(const file of [reader,COACHING_EDGE_TEST]) {
      const target=path.join(root,file);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,'synthetic fixture only\n');
    }
    run(root,['init']); run(root,['add','.']);
    run(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline']);
    const base=run(root,['rev-parse','HEAD']);
    assert.deepEqual(changedEvidencePaths(root,base),[]);
    fs.appendFileSync(path.join(root,reader),'changed Edge authority\n');
    assert.deepEqual(changedEvidencePaths(root,base),[COACHING_EDGE_TEST]);
    assert.deepEqual(selectNativeContracts(root,changedEvidencePaths(root,base)),
      [{testFile:COACHING_EDGE_TEST,runner:'deno',helpers:[],batch:0}]);
    const expected=executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const coverage=executionCoverage([COACHING_EDGE_TEST],{root,expected,base});
    assert.equal(coverage.status,'INCOMPLETE');
    assert.equal(coverage.rows[0].status,'NOT RUN');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('a source-only Retry Save change requires the unchanged browser control',async()=>{
  const {changedEvidencePaths,executionRoute}=await import('../../scripts/lib/testExecutionEvidence.mjs');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-retry-browser-')));
  try {
    const source='tests/live/rwt-save-retry-recovery.live.spec.ts';
    const browser='tests/e2e/rwt-j4a-save-no-forward.e2e.spec.ts';
    for(const file of [source,browser]) {
      const target=path.join(root,file);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,'synthetic fixture only\n');
    }
    run(root,['init']); run(root,['add','.']);
    run(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline']);
    const base=run(root,['rev-parse','HEAD']);
    assert.deepEqual(changedEvidencePaths(root,base),[]);
    fs.appendFileSync(path.join(root,source),'change the route only\n');
    const files=changedEvidencePaths(root,base);
    assert.deepEqual(files,[browser,source]);
    assert.equal(executionRoute(browser,root).runner,'playwright');
    const expected=executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    assert.equal(executionCoverage(files,{root,expected,base}).rows.find(row=>row.file===browser).status,'NOT RUN');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('coaching evaluator-only changes require the real offline Deno coaching controls',async()=>{
  const {changedEvidencePaths,executionRoute}=await import('../../scripts/lib/testExecutionEvidence.mjs');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-coaching-oracle-')));
  try {
    const dir='backend/supabase/functions/get-ai-suggestions/evaluation/';
    const evaluator=dir+'evaluator.ts', check=dir+'coachingBotChecks.test.ts';
    for(const file of [evaluator,check]) {
      const target=path.join(root,file);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,'synthetic fixture only\n');
    }
    run(root,['init']); run(root,['add','.']);
    run(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline']);
    const base=run(root,['rev-parse','HEAD']);
    assert.deepEqual(changedEvidencePaths(root,base),[]);
    fs.appendFileSync(path.join(root,evaluator),'changed evaluation only\n');
    assert.deepEqual(changedEvidencePaths(root,base),[check]);
    assert.equal(executionRoute(check,root).runner,'deno');
    const expected=executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    assert.equal(executionCoverage([check],{root,expected,base}).rows[0].status,'NOT RUN');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('enrolled changed controls include real imports, runner configuration and conservative route fallbacks', async()=>{
  const {changedEvidencePaths,semanticChangedInputs}=await import('../../scripts/lib/testExecutionEvidence.mjs');
  const {COACHING_EDGE_TEST}=await import('../../scripts/lib/nativeTestExecutionEvidence.mjs');
  const edge='backend/supabase/functions/get-ai-suggestions/';
  const live='tests/live/helpers/';
  const inputs=[
    [edge+'providerRetry.ts','coaching-consent-boundary'],
    [edge+'contract.json','coaching-consent-boundary'],
    ['backend/supabase/functions/_shared/cors.ts','coaching-consent-boundary'],
    [edge+'providers/newUnclassifiedInput.ts','coaching-consent-boundary'],
    [live+'rwtWatchdog.ts','retry-save-cleanup-finalization'],
    [live+'rwtDocumentIdentity.ts','retry-save-cleanup-finalization'],
    [live+'rwtCoachingEvidence.ts','retry-save-single-owned-take'],
    ['frontend/src/lib/supabaseClient.ts','save-consent-boundary'],
    ['frontend/src/services/recordingLease.ts','save-consent-boundary'],
    ['frontend/src/services/progress/practiceAgainIntent.ts','save-consent-boundary'],
    ['frontend/tests/test-utils/practicePrivacy.ts','save-consent-boundary'],
  ];
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-dependency-')));
  const source='frontend/src/lib/storage.ts';
  const consumer='frontend/src/lib/__tests__/storageConsent1835.test.ts';
  const dependency='isolated/independent-input.ts';
  const make=(file,body='baseline\n')=>{
    const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);
  };
  try {
    for(const [file] of inputs)make(file);
    for(const file of [COACHING_EDGE_TEST,'README.md','vitest.config.mjs','frontend/vitest.config.mjs',
      'scripts/lib/helperExecutionEvidence.mjs','scripts/lib/softwareQualityEvidenceQualification.mjs','tests/unit/rwtCleanupFinalizationEfficacy.test.ts',consumer,dependency]) make(file);
    make(source,"import '../../../isolated/independent-input.ts';\n");
    const setupInput='isolated/setup-input.ts';
    make('frontend/tests/setup.ts',"import '../../isolated/setup-input.ts';\n");
    make(setupInput);
    run(root,['init']); run(root,['add','.']);
    run(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline']);
    const base=run(root,['rev-parse','HEAD']);
    const exercise=(file,fn)=>{fs.appendFileSync(path.join(root,file),'change\n');try{fn();}finally{run(root,['restore','--',file]);}};
    const check=(file,wanted)=>exercise(file,()=>{
      const exact=semanticChangedInputs(root,base);
      assert.deepEqual(exact,[file]);
      const producer=selectContracts(root,exact).map(x=>x.id);
      const validator=requiredSemanticContracts(exact,root).map(x=>x.id);
      assert.deepEqual(validator,producer);
      assert.ok(producer.includes(wanted),file);
      if(file.startsWith('backend/'))assert.ok(changedEvidencePaths(root,base).includes(COACHING_EDGE_TEST),file);
    });
    for(const [file,id] of [...inputs,[dependency,'save-consent-boundary']]) check(file,id);
    for(const file of ['vitest.config.mjs','frontend/vitest.config.mjs','scripts/lib/helperExecutionEvidence.mjs',
      'scripts/lib/softwareQualityEvidenceQualification.mjs','frontend/tests/setup.ts',setupInput]) exercise(file,()=>assert.equal(
      selectContracts(root,semanticChangedInputs(root,base)).length,6,file));
    exercise('README.md',()=>assert.deepEqual(selectContracts(root,semanticChangedInputs(root,base)).map(x=>x.id),[]));
    const replacement='isolated/renamed-input.ts';
    run(root,['mv',dependency,replacement]);
    assert.deepEqual(semanticChangedInputs(root,base),[dependency,replacement]);
    assert.ok(selectContracts(root,semanticChangedInputs(root,base)).some(x=>x.id==='save-consent-boundary'),
      'an unresolved enrolled local import must not suppress its actual consumer');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('a newly registered contract is never silently dropped by the legacy ID dispatch',()=>{
  const extra={id:'new-unclassified-contract',sourceFile:'new/source.ts',testFile:'new/test.ts'};
  assert.deepEqual(requiredSemanticContracts(['trigger/unknown.ts'],null,[extra]),[extra]);
  assert.deepEqual(requiredSemanticContracts([],null,[extra]),[]);
});
