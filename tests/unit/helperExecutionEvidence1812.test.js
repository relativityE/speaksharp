import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {HELPER_CONTRACTS, validateHelperCoverage} from '../../scripts/lib/helperExecutionEvidence.mjs';
import {runVitestHelperExecution,dependencyPaths} from '../../scripts/run-test-efficacy.mjs';
import {executionContext, validateVitestExecution} from '../../scripts/lib/testExecutionEvidence.mjs';
import {TEST_EFFICACY_CONTRACTS} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';
const {test: frameworkTest} = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const test = (name, run) => process.env.NODE_TEST_CONTEXT
  ? frameworkTest(name, {timeout:120_000}, run) : frameworkTest(name, run, 120_000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = HELPER_CONTRACTS[0];

function recoveryClassFixture() {
  const f=fixture();
  const helper='tests/live/helpers/rwtRecoveryCapture.ts';
  const consumer='tests/unit/rwtRecoveryCapture1593.test.ts';
  const source=`export class SessionCreateBinding {
    onRequest() { return 5; }
    binding() { return this.readBinding(); }
    private readBinding() { return 5; }
    detach() { return 5; }
  }
  export function recoveryFenceRow() { return 5; }\n`;
  const testSource=`import {test,expect} from 'vitest';
    import {SessionCreateBinding,recoveryFenceRow} from '../live/helpers/rwtRecoveryCapture';
    test('named recovery callables compute the independent expected value',()=>{
      const binding=new SessionCreateBinding();
      expect(binding.onRequest()).toBe(5);expect(binding.binding()).toBe(5);
      expect(binding.detach()).toBe(5);expect(recoveryFenceRow()).toBe(5);
    });\n`;
  f.write(helper,source);f.write(consumer,testSource);
  return {...f,helper,consumer,source,testSource};
}

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
  test('INSTALLED async class methods with duplicate names retain exact owner and mapped spans',()=>{
    const f=recoveryClassFixture();
    try {
      const source=f.source.replace('onRequest() {','async onRequest() {')
        + '\nexport class Neighbor { async onRequest() { return 5; } }\n';
      const consumer=f.testSource.replace('SessionCreateBinding,recoveryFenceRow','SessionCreateBinding,recoveryFenceRow,Neighbor')
        .replace("value',()=>{", "value',async()=>{")
        .replace('expect(binding.onRequest())','expect(await binding.onRequest())')
        .replace('const binding=new SessionCreateBinding();', 'const binding=new SessionCreateBinding(); expect(await new Neighbor().onRequest()).toBe(5);');
      f.write(f.helper,source);f.write(f.consumer,consumer);
      let expected;
      const run=()=>{ expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()}); return runVitestHelperExecution({root:f.directory,base:f.git(['rev-parse','HEAD']),provenance:expected}); };
      const receipt=run();
      assert.ok(validateVitestExecution(receipt,expected,f.directory).has(f.helper));
      const phase=receipt.tests.find(item=>item.phase.binding?.helperFile===f.helper)?.phase ?? receipt.tests[1].phase;
      const raw=structuredClone(phase.helperCoverage.raw);
      const file=Object.keys(raw.report)[0];
      const own=Object.values(raw.report[file].fnMap).find(fn=>fn.name==='onRequest' && fn.loc.start.line===2);
      assert.ok(own);
      own.loc.start.column++;
      raw.conversions[0].converted=structuredClone(raw.report);
      assert.throws(()=>validateHelperCoverage(raw,phase.binding,f.directory),/Invalid remapped callable span/);
      // The neighbor still passes, but cannot lend its execution to the named owner.
      f.write(f.consumer,consumer.replace('expect(await binding.onRequest()).toBe(5);','expect(5).toBe(5);'));
      assert.throws(run,/Uncalled helper|Helper remapped callable not executed/);
    } finally { f.clean(); }
  });
}
