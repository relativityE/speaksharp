import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';

const {test}=process.env.NODE_TEST_CONTEXT?await import('node:test'):await import('vitest');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const guardName='Require existing database password before preflight CLI setup';
const targets=[
  {file:'.github/workflows/canary.yml',job:'migration-readiness'},
  {file:'.github/workflows/migrations-preflight.yml',job:'preflight'},
];

function source(target) {
  const document=yaml.load(fs.readFileSync(path.join(root,target.file),'utf8'));
  const job=document.jobs[target.job];
  const guards=job.steps.filter(step=>step.name===guardName);
  assert.equal(guards.length,1,`${target.file}: one early password guard is required`);
  return {document,job,guard:guards[0]};
}

for(const target of targets) {
  test(`${target.file}: guard runs before CLI setup/link without new injection or weaker release gates`,()=>{
    const {document,job,guard}=source(target);
    const index=job.steps.indexOf(guard);
    assert.ok(index>job.steps.findIndex(step=>step.uses?.startsWith('actions/checkout@')));
    assert.ok(index<job.steps.findIndex(step=>step.uses?.startsWith('supabase/setup-cli@')));
    assert.ok(index<job.steps.findIndex(step=>/\bsupabase\s+link\b/.test(step.run??'')));
    assert.equal(guard.if,undefined,'a missing password must not skip the guard');
    assert.equal(guard['continue-on-error'],undefined);
    assert.equal(guard.env,undefined,'this change does not introduce a credential injection');
    assert.equal(job.env.SUPABASE_DB_PASSWORD,undefined);
    assert.doesNotMatch(guard.run,/\b(?:supabase|curl|wget)\s|set\s+-x/);
    if(target.job==='migration-readiness') {
      assert.equal(job.needs,'release-binding');
      assert.equal(job.steps[0].with.ref,'${{ needs.release-binding.outputs.release_sha }}');
    } else {
      assert.ok(Object.hasOwn(document.on,'workflow_dispatch'));
      assert.equal(document.on.schedule,undefined);
    }
  });

  for(const state of ['absent','empty','present']) {
    test(`${target.file}: actual YAML shell with ${state} synthetic password controls downstream admission`,()=>{
      const {guard}=source(target);
      assert.equal(typeof guard.run,'string');
      // Deliberately omit the user's credentials, token environment and shell startup files.
      const env={PATH:process.env.PATH??'/usr/bin:/bin'};
      const synthetic='synthetic-only-preflight-password-control';
      if(state!=='absent')env.SUPABASE_DB_PASSWORD=state==='present'?synthetic:'';
      const result=spawnSync('bash',['--noprofile','--norc','-c',`${guard.run}\nprintf 'DOWNSTREAM_ADMISSION_REACHED\\n'`],{
        env,encoding:'utf8',timeout:5000,
      });
      assert.equal(result.error,undefined);
      assert.equal(result.signal,null);
      assert.equal(result.status,state==='present'?0:1);
      const output=`${result.stdout}${result.stderr}`;
      assert.equal(output.includes(synthetic),false,'the supplied value must never be logged');
      assert.equal(output.includes('DOWNSTREAM_ADMISSION_REACHED'),state==='present');
      assert.equal(output.includes('Preflight existing database password injection present'),state==='present');
      assert.equal(output.includes('refusing preflight CLI setup'),state!=='present');
    });
  }
}
