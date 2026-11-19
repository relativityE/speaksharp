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
      input.endsWith('.sql')?['save-consent-boundary','coaching-consent-boundary']:['save-consent-boundary']);
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
  assert.deepEqual(requiredSemanticContracts(null).map(c=>c.id),['analytics-truth','save-consent-boundary','coaching-consent-boundary']);
});
