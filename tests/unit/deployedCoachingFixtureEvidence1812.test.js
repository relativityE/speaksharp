import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {HELPER_CONTRACTS} from '../../scripts/lib/helperExecutionEvidence.mjs';
import {runVitestExecution,dependencyPaths} from '../../scripts/run-test-efficacy.mjs';
import {executionContext, validateVitestExecution, registeredFixture, fixtureSourceBinding, validateFixtureWitness} from '../../scripts/lib/testExecutionEvidence.mjs';
import {TEST_EFFICACY_CONTRACTS} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';
const {test: frameworkTest} = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const test = (name, run) => process.env.NODE_TEST_CONTEXT
  ? frameworkTest(name, {timeout:120_000}, run) : frameworkTest(name, run, 120_000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = HELPER_CONTRACTS[0];

function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'helper-evidence-')));
  const write = (name, content) => {fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true}); fs.writeFileSync(path.join(directory,name),content);};
  const files = ['scripts/lib/helperExecutionEvidence.mjs','scripts/lib/sourceContractEvidence.mjs','scripts/efficacy-helper-vitest.config.mjs',
    'scripts/lib/testExecutionEvidence.mjs','scripts/lib/nativeTestExecutionEvidence.mjs','scripts/lib/pythonTestExecutionEvidence.mjs','scripts/lib/python-unittest-reporter.py','scripts/lib/playwrightExecutionEvidence.mjs','scripts/lib/softwareQualityEvidenceQualification.mjs',
    'scripts/run-test-efficacy.mjs','scripts/efficacy-reporter.mjs','scripts/write-software-quality-evidence.mjs','scripts/coverage-thresholds.mjs',
    'pnpm-lock.yaml','package.json',...dependencyPaths(root,TEST_EFFICACY_CONTRACTS[0].testFile)];
  for (const file of files) write(file,fs.readFileSync(path.join(root,file)));
  write('.gitignore','node_modules\ntest-results/\nproduct_release/evidence/\n');
  write('frontend/vitest.config.mjs',`export default {test:{environment:'node',include:['tests/unit/**/*.test.ts'],pool:'forks',maxWorkers:1,minWorkers:1}};\n`);
  write(contract.helperFile,contract.callables.map(name=>`export function ${name}(a = 2, b = 3) { return a + b; }`).join('\n')+'\n');
  write(contract.testFile,`import {test,expect} from 'vitest';\nimport {${contract.callables.join(',')}} from '../live/helpers/rwtMarkerObserver';\n`
    +contract.callables.map(name=>`test('${name} computes the independently expected sum',()=>expect(${name}(2,3)).toBe(5));`).join('\n')+'\n');
  fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
  const git = args => execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init']);git(['add','.']);git(['-c','user.name=Helper fixture','-c','user.email=helper@example.invalid','commit','--no-gpg-sign','-m','fixture']);
  return {directory,write,git,clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}



{
  test('INSTALLED deployed coaching fixture uses actual readers and refuses forged or stale witnesses',()=>{
    const f=fixture();
    const file='tests/live/helpers/deployedCoachingContract.json';
    const selected=registeredFixture(file);
    try {
      for(const name of [...dependencyPaths(root,selected.testFile),'backend/supabase/functions/get-ai-suggestions/providerRetry.ts','tests/fixtures/rwt/rwt-fixtures.manifest.json']) f.write(name,fs.readFileSync(path.join(root,name)));
      // Only this exact fixture is new relative to the baseline: no unrelated helper credit.
      f.git(['add','.']);f.git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--no-gpg-sign','-m','consumer']);
      f.write(file,fs.readFileSync(path.join(root,file)));
      const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      const receipt=runVitestExecution({root:f.directory,base:f.git(['rev-parse','HEAD']),provenance:expected});
      assert.ok(validateVitestExecution(receipt,expected,f.directory).has(file));
      const phase=receipt.tests.find(item=>item.fixtureFile===file).phase;
      const validate=raw=>validateFixtureWitness(raw,phase.binding,f.directory,phase.report,phase.envelope);
      assert.equal(validate(phase.fixtureWitness),file);
      for(const mutate of [
        r=>{r.phaseId='wrong';},r=>{r.fixtureSha256='0'.repeat(64);},r=>{r.bindingSha256='0'.repeat(64);},
        r=>{r.positive.reads.pop();},r=>{r.positive.ceiling.what_worked=239;},
        r=>{r.positive.model='wrong';},r=>{r.ceilingNegative='PASS';},
        r=>{r.promptNegative=r.positive.promptHash;},r=>{r.malformedRejected=false;},
      ]) {const bad=structuredClone(phase.fixtureWitness);mutate(bad);assert.throws(()=>validate(bad),/invalid actual deployed/);}
      assert.throws(()=>validate(undefined),/invalid actual deployed/);
      const reader=selected.readers[0].file;
      f.write(reader,fs.readFileSync(path.join(f.directory,reader),'utf8')+'\n// changed reader\n');
      assert.throws(()=>fixtureSourceBinding(f.directory,file),/consumer\/reader bytes differ/);
    } finally {f.clean();}
  });
}
