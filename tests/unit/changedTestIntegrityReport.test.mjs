import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {inspectChangedTest} from '../../scripts/lib/changedTestIntegrityReport.mjs';

const fixturePath='tests/unit/pilot.test.ts';

test('labels literal empty callbacks but does not invent a finding for indirect, throw, or unsupported forms',()=>{
  const result=inspectChangedTest(fixturePath,`
import {test as verify, expect as check} from 'vitest';
import nodeAssert from 'node:assert/strict';
import {ok as boundOk} from 'node:assert';
verify('empty comment-only body', () => { /* fake expect(1).toBe(1) */ });
verify('empty bare return', async function () { ; return; });
verify('indirect helper', () => assertComplexApplicationOutcome());
verify('direct node assert', () => nodeAssert.equal(actual(),1));
verify('named node assert', () => boundOk(actual()));
verify('conditional throw', () => { if (!outcome()) throw Error('wrong row'); });
verify('matcher syntax only', () => check(actual()).toBe(1));
verify('unconsumed expect', () => check(actual()));
verify('matcher count is not an outcome', () => check.assertions(1));
verify('shadowed assertion name', () => { const check = writeSideEffect; check(actual()); });
verify('nested function not executed', () => { const checkLater=()=>check(actual()).toBe(1); });
verify.skip('explicit skip', () => check(actual()).toBe(1));
verify.each(cases)('table case shape', () => {});
function unrelated(verify) { verify('shadowed runner name', () => {}); }
`);
  assert.equal(result.runner,'VITEST_SOURCE_CANDIDATE');
  assert.deepEqual(result.cases.map(({code})=>code),[
    'EMPTY_CALLBACK','EMPTY_CALLBACK','UNKNOWN','ASSERTION_FORM_OBSERVED','ASSERTION_FORM_OBSERVED',
    'UNKNOWN','ASSERTION_FORM_OBSERVED','UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN','EXPLICIT_RUNNER_MODIFIER','UNKNOWN',
  ]);
  for(const file of ['tests/unit/node.test.mjs','tests/live/browser.spec.ts','tests/test-support/other.test.ts'])
    assert.equal(inspectChangedTest(file,'test("empty",()=>{});').runner,'UNKNOWN');
  assert.equal(inspectChangedTest(fixturePath,'test("global registration",()=>{});').runner,'UNKNOWN');
  assert.equal(inspectChangedTest('tests/unit/node.test.mjs',`
    import test from 'node:test';
    test('known empty syntax, unsupported runner', {timeout:200}, () => {});
  `).runner,'UNKNOWN');
  assert.equal(inspectChangedTest(fixturePath,'import {test} from "vitest"; test(').runner,'UNKNOWN');
});

test('calibrates literal trailing timeout and dead assertion forms without requiring inline assertions',()=>{
  const result=inspectChangedTest(fixturePath,`
import {test as verify, expect as check} from 'vitest';
import assertion from 'node:assert/strict';
verify('timed node assertion', () => assertion.equal(actual(),1), 5000);
verify('timed helper-only behavior', () => verifiesOwnedWrite(), 800);
verify('timed conditional throw', () => { if (!observe()) throw Error('no receipt'); }, 400);
verify('timed empty', () => { /* no work */ }, 100);
verify('dynamic timeout remains unknown', () => {}, timeout());
verify('invalid literal timeout remains unknown', () => {}, 0.5);
verify('dead branch only', () => { if (false) check(actual()).toBe(1); });
verify('dead else only', () => { if (true) prepare(); else check(actual()).toBe(1); });
verify('living else', () => { if (false) prepare(); else assertion.equal(actual(),1); });
verify('living conditional throw without assert', () => { if (!observe()) throw Error('no receipt'); });
`);
  assert.deepEqual(result.cases.map(({code})=>code),[
    'ASSERTION_FORM_OBSERVED','UNKNOWN','UNKNOWN','EMPTY_CALLBACK','UNKNOWN','UNKNOWN','UNKNOWN',
    'UNKNOWN','ASSERTION_FORM_OBSERVED','UNKNOWN',
  ]);
});

const cli=fileURLToPath(new URL('../../scripts/test-integrity-audit.mjs',import.meta.url));
test('CLI examines exact changed commit postimages and reports warnings without gating or claiming execution',()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'future-test-integrity-')));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(file,bytes)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);};
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');return git('rev-parse','HEAD');};
  try {
    git('init');
    write('tests/unit/untouched.test.ts',"import {test} from 'vitest';test('existing empty',()=>{});");
    write(fixturePath,"import {test,expect} from 'vitest';test('original',()=>expect(value()).toBe(1));");
    const base=commit();
    write(fixturePath,"import {test} from 'vitest';test('changed no assertions',()=>{});");
    write('tests/live/other.spec.ts',"import {test} from '@playwright/test';test('unclassified runner',()=>{});");
    write('tests/unit/only-data.ts','export const fixture=1;');
    fs.symlinkSync('pilot.test.ts',path.join(root,'tests/unit/link.test.ts'));
    const head=commit();
    // Dirty working copy must not be presented as evidence of the exact head.
    write(fixturePath,"import {test} from 'vitest';test('not the committed test',()=>assertUseful());");
    const run=JSON.parse(execFileSync(process.execPath,[cli,'--changed-report','--base',base,'--head',head],{cwd:root,encoding:'utf8'}));
    assert.equal(run.mode,'REPORT_ONLY');assert.equal(run.execution,'NOT_VERIFIED');
    assert.equal(run.base,base);assert.equal(run.head,head);
    assert.deepEqual(run.files.map(({path})=>path),['tests/live/other.spec.ts','tests/unit/link.test.ts',fixturePath]);
    assert.equal(run.files[0].runner,'UNKNOWN');assert.equal(run.files[1].runner,'UNKNOWN');
    assert.equal(run.files[2].cases[0].title,'changed no assertions');
    assert.equal(run.files[2].cases[0].code,'EMPTY_CALLBACK');

    const context={runId:'345',runAttempt:'2',commit:head};
    const env={...process.env,TEST_EFFICACY_BASE:base,TEST_EFFICACY_HEAD:head,GITHUB_SHA:head,
      GITHUB_RUN_ID:context.runId,GITHUB_RUN_ATTEMPT:context.runAttempt,RUNNER_TEMP:root,GITHUB_STEP_SUMMARY:path.join(root,'summary')};
    const origin={schemaVersion:1,comparisonBase:base,originatingCi:context,qualityProvenance:context};
    const output=()=>spawnSync(process.execPath,[cli,'--changed-ci-report'],{cwd:root,env,encoding:'utf8'});
    for(const mismatch of [{...origin,comparisonBase:head},{...origin,originatingCi:{...context,runAttempt:'1'}}]) {
      write('artifacts/software-quality-input-origin.json',JSON.stringify(mismatch));
      assert.notEqual(output().status,0);
      assert.equal(output().stdout,'');
    }
    write('artifacts/software-quality-input-origin.json',JSON.stringify(origin));
    const valid=output();
    assert.equal(valid.status,0,valid.stderr);
    const advisory=JSON.parse(valid.stdout);
    assert.deepEqual(advisory.originatingCi,context);
    assert.deepEqual(advisory.files[2],{path:fixturePath,runner:'VITEST_SOURCE_CANDIDATE',change:'existing-path-changed',
      counts:{EMPTY_CALLBACK:1},delta:{ASSERTION_FORM_OBSERVED:-1,EMPTY_CALLBACK:1}});
    assert.equal(advisory.files[0].change,'new-path');
    assert.doesNotMatch(valid.stdout,/changed no assertions|unclassified runner|original|source parser/i);

    const ci=fs.readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
    const begin=ci.indexOf('      - name: Report changed test integrity (advisory only)');
    const end=ci.indexOf('      - name: Upload CI Metrics',begin);
    const step=ci.slice(begin,end);
    assert.ok(begin>ci.indexOf('      - name: Bind canonical CI quality inputs')&&end>begin);
    assert.match(step,/continue-on-error: true/);
    assert.match(ci.slice(end),/artifacts\/changed-test-integrity\.json/);
    // Run the actual workflow shell on the fixture with only the CLI path relocated.
    const shell=step.split('        run: |\n')[1].replace(/^ {10}/gm,'')
      .replace('node scripts/test-integrity-audit.mjs',`node '${cli}'`);
    const ciRun=()=>spawnSync('bash',['-c',shell],{cwd:root,env,encoding:'utf8'});
    const ciValid=ciRun();
    assert.equal(ciValid.status,0,ciValid.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'artifacts/changed-test-integrity.json'),'utf8')),advisory);
    write('artifacts/software-quality-input-origin.json',JSON.stringify({...origin,comparisonBase:head}));
    const ciRefused=ciRun();
    assert.equal(ciRefused.status,0,ciRefused.stderr);
    assert.match(ciRefused.stdout,/::warning::Changed-test integrity report unavailable/);
    assert.equal(ciRefused.stderr,'');
    assert.equal(fs.existsSync(path.join(root,'artifacts/changed-test-integrity.json')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
