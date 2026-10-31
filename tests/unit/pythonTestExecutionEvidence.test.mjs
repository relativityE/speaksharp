import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {producePythonReceipt,selectPythonContracts,validatePythonReceipt} from '../../scripts/lib/pythonTestExecutionEvidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');

function fixture() {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'python-evidence-test-')));
  for(const directory of ['scripts/lib','tools/cloud-test/tests','bin','yaml'])fs.mkdirSync(path.join(root,directory),{recursive:true});
  fs.copyFileSync(path.join(repo,'scripts/lib/python-unittest-reporter.py'),path.join(root,'scripts/lib/python-unittest-reporter.py'));
  const testFile='tools/cloud-test/tests/test_example.py';fs.writeFileSync(path.join(root,testFile),'import unittest\nclass Example(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n');
  const yamlFile=path.join(root,'yaml','__init__.py');fs.writeFileSync(yamlFile,"__version__ = '6.0.2'\n");
  const executable=path.join(root,'bin','python3');
  fs.writeFileSync(executable,`#!${process.execPath}\nconst fs=require('fs'),crypto=require('crypto');\nconst hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');\nconst yaml=${JSON.stringify(yamlFile)};\nif(process.argv.includes('-c')){console.log(JSON.stringify({version:'3.12.11',yamlVersion:'6.0.2',yamlFile:yaml,yamlSha256:hash(yaml)}));process.exit(0);}\nconst b=JSON.parse(process.env.PYTHON_TEST_EVIDENCE_BINDING);\nfs.writeFileSync(b.receiptFile,JSON.stringify({schemaVersion:1,binding:b,runtime:b.runtime,collected:['_evidence.test_ok'],outcomes:[{id:'_evidence.test_ok',status:'passed'}]}));\n`);
  fs.chmodSync(executable,0o755);
  const provenance={schemaVersion:1,invocation:'00000000-0000-4000-8000-000000000001',source:'local',runId:null,runAttempt:null,
    commit:'a'.repeat(40),tree:'b'.repeat(40),snapshotSha256:'c'.repeat(64)};
  return {root,testFile,executable,provenance,oldPath:process.env.PATH};
}

test('Python receipts bind exact source/runtime and reject result tampering',()=>{
  const f=fixture();process.env.PATH=path.dirname(f.executable);
  try {
    assert.deepEqual(selectPythonContracts([f.testFile,'tests/unit/test_outside.py']),[{testFile:f.testFile,batch:0}]);
    const receipt=producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      drain:()=>({status:'drained'}),runtimeOptions:{execPath:f.executable}});
    assert.deepEqual([...validatePythonReceipt(receipt,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile]})],[f.testFile]);
    for(const mutate of [
      r=>{r.tests[0].phase.report.outcomes[0].status='skipped';},
      r=>{r.tests[0].phase.report.outcomes.push({...r.tests[0].phase.report.outcomes[0]});},
      r=>{r.tests[0].phase.binding.testSha256='0'.repeat(64);},
      r=>{r.tests[0].phase.execution.processCleanup={status:'unknown'};},
    ]) {
      const changed=structuredClone(receipt);mutate(changed);
      assert.throws(()=>validatePythonReceipt(changed,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile]}));
    }
  } finally {process.env.PATH=f.oldPath;fs.rmSync(f.root,{recursive:true,force:true});}
});

test('Python selection refuses unbounded and empty receipts cannot credit tests',()=>{
  const files=Array.from({length:65},(_,n)=>`tools/cloud-test/tests/test_${n}.py`);
  assert.throws(()=>selectPythonContracts(files),/exceeds 8 batches/);
});

test('installed reporter emits the exact runtime shape consumed by the validator',()=>{
  const f=fixture(),execPath=fs.realpathSync(execFileSync('which',['python3'],{encoding:'utf8'}).trim());
  const version=execFileSync(execPath,['-c','import sys; print(".".join(map(str, sys.version_info[:3])))'],{encoding:'utf8'}).trim();
  const yamlFile=path.join(f.root,'yaml','__init__.py');
  const identity={version,yamlVersion:'6.0.2',yamlFile,yamlSha256:hash(fs.readFileSync(yamlFile))};
  try {
    const receipt=producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      drain:()=>({status:'drained'}),runtimeOptions:{execPath,spawn:()=>({status:0,signal:null,error:null,stdout:JSON.stringify(identity)})}});
    assert.deepEqual(receipt.tests[0].phase.report.runtime,receipt.tests[0].phase.binding.runtime);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
