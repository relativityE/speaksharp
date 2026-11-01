import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PYTHON_INPUT_CONTRACTS,producePythonReceipt,selectPythonContracts,validatePythonReceipt} from '../../scripts/lib/pythonTestExecutionEvidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');

function realRuntimeOptions(f) {
  const execPath=fs.realpathSync(execFileSync('which',['python3'],{encoding:'utf8'}).trim());
  const version=execFileSync(execPath,['-c','import sys; print(".".join(map(str, sys.version_info[:3])))'],{encoding:'utf8'}).trim();
  const yamlFile=path.join(f.root,'yaml','__init__.py');
  const realExec=fs.realpathSync(execFileSync(execPath,['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).trim());
  const identity={execPath:realExec,executableSha256:hash(fs.readFileSync(realExec)),version,yamlVersion:'6.0.2',yamlFile,yamlSha256:hash(fs.readFileSync(yamlFile))};
  return {execPath,spawn:()=>({status:0,signal:null,error:null,stdout:JSON.stringify(identity)})};
}

function fixture() {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'python-evidence-test-')));
  for(const directory of ['scripts/lib','tools/cloud-test/tests','bin','yaml','pdfjs'])fs.mkdirSync(path.join(root,directory),{recursive:true});
  fs.copyFileSync(path.join(repo,'scripts/lib/python-unittest-reporter.py'),path.join(root,'scripts/lib/python-unittest-reporter.py'));
  const testFile='tools/cloud-test/tests/test_example.py';fs.writeFileSync(path.join(root,testFile),'import unittest\nclass Example(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n');
  const yamlFile=path.join(root,'yaml','__init__.py');fs.writeFileSync(yamlFile,"__version__ = '6.0.2'\n");
  const executable=path.join(root,'bin','python3.cjs');
  fs.writeFileSync(executable,`#!${process.execPath}\nconst fs=require('fs'),crypto=require('crypto');\nconst hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');\nconst yaml=${JSON.stringify(yamlFile)};\nif(process.argv.includes('-c')){console.log(JSON.stringify({execPath:process.argv[1],executableSha256:hash(process.argv[1]),version:'3.12.11',yamlVersion:'6.0.2',yamlFile:yaml,yamlSha256:hash(yaml)}));process.exit(0);}\nconst b=JSON.parse(process.env.PYTHON_TEST_EVIDENCE_BINDING);\nfs.writeFileSync(b.receiptFile,JSON.stringify({schemaVersion:1,binding:b,runtime:b.runtime,collected:['_evidence.test_ok'],outcomes:[{id:'_evidence.test_ok',status:'passed'}],sourceReads:b.sourceFiles??[]}));\n`);
  fs.chmodSync(executable,0o755);
  fs.symlinkSync(path.basename(executable),path.join(root,'bin','python3'));
  const environment={CT_REQUIRE_INTEGRATION:'1'};
  for(const name of ['CLOUD_TEST_YML','CT_PROOF_FILE','CT_BROWSER_RECEIPT']) {
    const file=path.join(root,name.toLowerCase());fs.writeFileSync(file,name);environment[name]=file;
  }
  const browser=path.join(root,'bin','chrome');fs.writeFileSync(browser,'installed browser');fs.chmodSync(browser,0o755);
  environment.CT_CHROME=browser;environment.CT_EXISTING_PDFJS_DIR=path.join(root,'pdfjs');
  fs.writeFileSync(path.join(environment.CT_EXISTING_PDFJS_DIR,'package.json'),'{}');
  const provenance={schemaVersion:1,invocation:'00000000-0000-4000-8000-000000000001',source:'local',runId:null,runAttempt:null,
    commit:'a'.repeat(40),tree:'b'.repeat(40),snapshotSha256:'c'.repeat(64)};
  return {root,testFile,executable,provenance,environment,oldPath:process.env.PATH};
}

test('Python receipts bind exact source/runtime and reject result tampering',()=>{
  const f=fixture();process.env.PATH=[path.dirname(f.executable),f.oldPath].join(path.delimiter);
  try {
    assert.deepEqual(selectPythonContracts([f.testFile,'tests/unit/test_outside.py']),[{testFile:f.testFile,consumerExecution:true,batch:0}]);
    const receipt=producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      environment:f.environment,drain:()=>({status:'drained'}),runtimeOptions:{execPath:f.executable}});
    assert.deepEqual([...validatePythonReceipt(receipt,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,
      files:[f.testFile],environment:f.environment})],[f.testFile]);
    for(const mutate of [
      r=>{r.tests[0].phase.report.outcomes[0].status='skipped';},
      r=>{r.tests[0].phase.report.outcomes.push({...r.tests[0].phase.report.outcomes[0]});},
      r=>{r.tests[0].phase.binding.testSha256='0'.repeat(64);},
      r=>{r.tests[0].phase.execution.processCleanup={status:'unknown'};},
    ]) {
      const changed=structuredClone(receipt);mutate(changed);
      assert.throws(()=>validatePythonReceipt(changed,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,
        files:[f.testFile],environment:f.environment}));
    }
  } finally {process.env.PATH=f.oldPath;fs.rmSync(f.root,{recursive:true,force:true});}
});

test('real Python reporter credits only the exact input actually consumed by its selected test',()=>{
  const f=fixture(),contract=PYTHON_INPUT_CONTRACTS.find(item=>item.inputFile.endsWith('plan-facts.PLACEHOLDER.json'));
  try {
    const consumer=`import unittest\nfrom pathlib import Path\nclass Input(unittest.TestCase):\n def test_reads_input(self):\n  source=Path(__file__).resolve().parents[3]/${JSON.stringify(contract.inputFile)}\n  self.assertEqual(source.read_text(), '{"fixture":true}\\n')\n`;
    for(const [file,bytes] of [[contract.inputFile,'{"fixture":true}\n'],[contract.testFile,consumer]]) {
      fs.mkdirSync(path.dirname(path.join(f.root,file)),{recursive:true});fs.writeFileSync(path.join(f.root,file),bytes);
    }
    const files=[contract.inputFile],selected=selectPythonContracts(files);
    assert.deepEqual(selected,[{testFile:contract.testFile,sourceFiles:[contract.inputFile],batch:0}]);
    const receipt=producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files,batch:0,
      environment:f.environment,drain:()=>({status:'drained'}),runtimeOptions:realRuntimeOptions(f)});
    assert.deepEqual([...validatePythonReceipt(receipt,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,
      files,environment:f.environment,runtimeOptions:realRuntimeOptions(f)})],[contract.inputFile]);
    assert.deepEqual(receipt.tests[0].phase.report.sourceReads,receipt.tests[0].phase.binding.sourceFiles);
    const stale=structuredClone(receipt);stale.tests[0].phase.report.sourceReads[0].sha256='0'.repeat(64);
    assert.throws(()=>validatePythonReceipt(stale,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,
      files,environment:f.environment,runtimeOptions:realRuntimeOptions(f)}),/consumption absent/);
    fs.writeFileSync(path.join(f.root,contract.inputFile),'{"fixture":"changed"}\n');
    assert.throws(()=>validatePythonReceipt(receipt,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,
      files,environment:f.environment,runtimeOptions:realRuntimeOptions(f)}),/source|binding/i);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});

test('real Python reporter refuses non-consumption and substituted input reads',()=>{
  const contract=PYTHON_INPUT_CONTRACTS.find(item=>item.inputFile.endsWith('plan-facts.PLACEHOLDER.json'));
  for(const mode of ['non-consumption','substitution']) {
    const f=fixture();
    try {
      fs.mkdirSync(path.dirname(path.join(f.root,contract.inputFile)),{recursive:true});
      fs.mkdirSync(path.dirname(path.join(f.root,contract.testFile)),{recursive:true});
      fs.writeFileSync(path.join(f.root,contract.inputFile),'{"fixture":true}\n');
      fs.writeFileSync(path.join(f.root,'substitute.json'),'{"fixture":true}\n');
      const operation=mode==='non-consumption'?'self.assertTrue(True)':"self.assertEqual((Path(__file__).resolve().parents[3]/'substitute.json').read_text(), '{\\\"fixture\\\":true}\\n')";
      fs.writeFileSync(path.join(f.root,contract.testFile),`import unittest\nfrom pathlib import Path\nclass Input(unittest.TestCase):\n def test_operation(self): ${operation}\n`);
      assert.throws(()=>producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[contract.inputFile],batch:0,
        environment:f.environment,drain:()=>({status:'drained'}),runtimeOptions:realRuntimeOptions(f)}),/consumption absent/);
    } finally {fs.rmSync(f.root,{recursive:true,force:true});}
  }
});

test('Python selection refuses unbounded and empty receipts cannot credit tests',()=>{
  const files=Array.from({length:65},(_,n)=>`tools/cloud-test/tests/test_${n}.py`);
  assert.throws(()=>selectPythonContracts(files),/exceeds 8 batches/);
  const f=fixture();
  try {
    const receipt=producePythonReceipt({root:f.root,provenance:f.provenance,files:[],batch:0,environment:{},
      drain:()=>({status:'drained'}),runtimeOptions:{execPath:'/missing-python'}});
    assert.equal(receipt.status,'not-applicable');assert.deepEqual(receipt.tests,[]);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});

test('installed reporter emits the exact runtime shape consumed by the validator',()=>{
  const f=fixture(),runtimeOptions=realRuntimeOptions(f);
  try {
    fs.writeFileSync(path.join(f.root,'tools/cloud-test/tests/_fixtures.py'),'VALUE = 7\n');
    fs.writeFileSync(path.join(f.root,f.testFile),'import unittest\nfrom _fixtures import VALUE\nclass Example(unittest.TestCase):\n def test_ok(self): self.assertEqual(VALUE, 7)\n');
    const receipt=producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      environment:f.environment,drain:()=>({status:'drained'}),
      runtimeOptions});
    assert.deepEqual(receipt.tests[0].phase.report.runtime,receipt.tests[0].phase.binding.runtime);
    assert.equal(receipt.tests[0].phase.report.outcomes[0].status,'passed');
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});

test('Python package environment is exact, bounded and revalidated before credit',()=>{
  const f=fixture();process.env.PATH=[path.dirname(f.executable),f.oldPath].join(path.delimiter);
  try {
    const args={root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      environment:f.environment,drain:()=>({status:'drained'}),runtimeOptions:{execPath:f.executable}};
    const receipt=producePythonReceipt(args);
    fs.writeFileSync(f.environment.CT_PROOF_FILE,'changed proof');
    assert.throws(()=>validatePythonReceipt(receipt,{root:f.root,base:'d'.repeat(40),provenance:f.provenance,
      files:[f.testFile],environment:f.environment}),/environment|binding/);
    assert.throws(()=>producePythonReceipt({...args,environment:{...f.environment,CT_REQUIRE_INTEGRATION:'0'}}),/CT_REQUIRE_INTEGRATION/);
  } finally {process.env.PATH=f.oldPath;fs.rmSync(f.root,{recursive:true,force:true});}
});

test('Python execution failures retain only bounded selected-phase diagnostics',()=>{
  const f=fixture();process.env.PATH=[path.dirname(f.executable),f.oldPath].join(path.delimiter);
  try {
    const source=fs.readFileSync(f.executable,'utf8')
      .replace("status:'passed'","status:'failed'")
      .concat("\nconsole.error('DO-NOT-LEAK-CHILD-OUTPUT'); process.exit(7);\n");
    fs.writeFileSync(f.executable,source);fs.chmodSync(f.executable,0o755);
    assert.throws(()=>producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      environment:f.environment,drain:()=>({status:'drained'}),runtimeOptions:{execPath:f.executable}}),error=>{
      assert.match(error.message,/Python execution failed or did not drain/);
      assert.equal(error.diagnostics.testFile,f.testFile);
      assert.equal(error.diagnostics.batch,0);
      assert.equal(error.diagnostics.status,7);
      assert.equal(error.diagnostics.cleanupStatus,'drained');
      assert.deepEqual(error.diagnostics.failedTestIds,['_evidence.test_ok']);
      assert.doesNotMatch(error.message,/DO-NOT-LEAK|PATH|HOME/);
      return true;
    });
  } finally {process.env.PATH=f.oldPath;fs.rmSync(f.root,{recursive:true,force:true});}
});

test('missing Python receipts preserve exit and cleanup state without child output',()=>{
  const f=fixture();process.env.PATH=[path.dirname(f.executable),f.oldPath].join(path.delimiter);
  try {
    assert.throws(()=>producePythonReceipt({root:f.root,base:'d'.repeat(40),provenance:f.provenance,files:[f.testFile],batch:0,
      environment:f.environment,drain:()=>({status:'drained'}),runtimeOptions:{execPath:f.executable},
      spawn:()=>({pid:4242,status:null,signal:'SIGKILL',error:Object.assign(new Error('DO-NOT-LEAK'),{code:'ETIMEDOUT'}),stdout:'PRIVATE',stderr:'PRIVATE'})}),error=>{
      assert.match(error.message,/Python execution receipt missing/);
      assert.equal(error.diagnostics.testFile,f.testFile);
      assert.equal(error.diagnostics.status,null);
      assert.equal(error.diagnostics.signal,'SIGKILL');
      assert.equal(error.diagnostics.error,'ETIMEDOUT');
      assert.equal(error.diagnostics.cleanupStatus,'drained');
      assert.deepEqual(error.diagnostics.failedTestIds,[]);
      assert.doesNotMatch(error.message,/DO-NOT-LEAK|PRIVATE/);
      return true;
    });
  } finally {process.env.PATH=f.oldPath;fs.rmSync(f.root,{recursive:true,force:true});}
});
