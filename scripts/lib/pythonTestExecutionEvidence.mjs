import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {NATIVE_BATCH_SIZE,NATIVE_MAX_BATCHES,executionBatchIdentity,reconcileExecutionBatches} from './nativeTestExecutionEvidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
export const PYTHON_REPORTER='scripts/lib/python-unittest-reporter.py';

function regular(root,file) {
  if(typeof file!=='string'||path.isAbsolute(file)||file.includes('\\')||path.posix.normalize(file)!==file||file.startsWith('../'))fail('Invalid Python evidence path');
  const target=path.join(root,file),stat=fs.lstatSync(target,{throwIfNoEntry:false});
  if(!stat?.isFile()||fs.realpathSync(target)!==target)fail('Aliased or missing Python evidence source');
  return target;
}

function absoluteFile(file,label) {
  if(typeof file!=='string'||!path.isAbsolute(file))fail(`NOT RUN: ${label} is required`);
  const real=fs.realpathSync(file),stat=fs.lstatSync(real);
  if(real!==file||!stat.isFile())fail(`Aliased or missing ${label}`);
  return {path:real,sha256:hash(fs.readFileSync(real))};
}
function directoryManifest(directory,label) {
  if(typeof directory!=='string'||!path.isAbsolute(directory))fail(`NOT RUN: ${label} is required`);
  const real=fs.realpathSync(directory);
  if(real!==directory||!fs.lstatSync(real).isDirectory())fail(`Aliased or missing ${label}`);
  const files=[];
  const walk=(current,prefix='')=>{
    for(const name of fs.readdirSync(current).sort()) {
      const target=path.join(current,name),relative=prefix?`${prefix}/${name}`:name,stat=fs.lstatSync(target);
      if(stat.isSymbolicLink())fail(`Aliased ${label} entry`);
      if(stat.isDirectory())walk(target,relative);
      else if(stat.isFile())files.push({name:relative,sha256:hash(fs.readFileSync(target))});
      else fail(`Unsupported ${label} entry`);
      if(files.length>4096)fail(`${label} inventory is unbounded`);
    }
  };walk(real);
  if(!files.length)fail(`Empty ${label}`);
  return {path:real,files};
}
export function pythonEnvironment(environment=process.env) {
  if(environment.CT_REQUIRE_INTEGRATION!=='1')fail('NOT RUN: CT_REQUIRE_INTEGRATION=1 is required');
  const files=Object.fromEntries(['CLOUD_TEST_YML','CT_PROOF_FILE','CT_CHROME','CT_BROWSER_RECEIPT']
    .map(name=>[name,absoluteFile(environment[name],name)]));
  return {literal:{CT_REQUIRE_INTEGRATION:'1'},files,
    directories:{CT_EXISTING_PDFJS_DIR:directoryManifest(environment.CT_EXISTING_PDFJS_DIR,'CT_EXISTING_PDFJS_DIR')}};
}

export function pythonTestRoute(file) {
  return /^tools\/cloud-test\/(?:.*\/)?test_[^/]+\.py$/.test(file)
    ?{runner:'python-unittest',consumer:file,applicable:true}:null;
}

export function selectPythonContracts(files) {
  const contracts=[...new Set(files.filter(file=>pythonTestRoute(file)))].sort().map(testFile=>({testFile}));
  if(contracts.length>NATIVE_BATCH_SIZE*NATIVE_MAX_BATCHES)fail(`NOT RUN: Python execution exceeds ${NATIVE_MAX_BATCHES} batches of ${NATIVE_BATCH_SIZE} files`);
  return contracts.map((contract,index)=>({...contract,batch:Math.floor(index/NATIVE_BATCH_SIZE)}));
}

function executable(name,env=process.env) {
  for(const directory of (env.PATH??'').split(path.delimiter)) {
    if(!path.isAbsolute(directory))continue;
    const candidate=path.join(directory,name);
    try{fs.accessSync(candidate,fs.constants.X_OK);return fs.realpathSync(candidate);}catch{/* continue */}
  }
  fail('NOT RUN: installed Python 3.12 runtime unavailable');
}

export function pythonRuntime(root,{execPath=executable('python3'),spawn=spawnSync,
  toolPaths={node:process.execPath,git:executable('git'),bash:executable('bash')}}={}) {
  const script='import hashlib,json,pathlib,sys,yaml; p=pathlib.Path(yaml.__file__).resolve(); e=pathlib.Path(sys.executable).resolve(); print(json.dumps({"execPath":str(e),"executableSha256":hashlib.sha256(e.read_bytes()).hexdigest(),"version":".".join(map(str,sys.version_info[:3])),"yamlVersion":yaml.__version__,"yamlFile":str(p),"yamlSha256":hashlib.sha256(p.read_bytes()).hexdigest()}))';
  const result=spawn(execPath,['-I','-c',script],{encoding:'utf8',timeout:5000,env:{PATH:path.dirname(execPath),LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}});
  if(result.status!==0||result.signal||result.error)fail('NOT RUN: Python/PyYAML runtime identity unavailable');
  let observed;try{observed=JSON.parse(result.stdout);}catch{fail('NOT RUN: malformed Python runtime identity');}
  if(!/^3\.12\.\d+$/.test(observed.version)||observed.yamlVersion!=='6.0.2')fail('NOT RUN: Python 3.12 / PyYAML 6.0.2 required');
  const observedExec=fs.realpathSync(observed.execPath);
  if(observed.execPath!==observedExec||observed.executableSha256!==hash(fs.readFileSync(observedExec)))fail('Changed Python executable identity');
  const yamlFile=fs.realpathSync(observed.yamlFile);
  if(observed.yamlFile!==yamlFile)fail('Aliased Python dependency identity');
  if(observed.yamlSha256!==hash(fs.readFileSync(yamlFile)))fail('Changed Python dependency identity');
  const tools=Object.fromEntries(Object.entries(toolPaths).map(([name,file])=>{
    const resolved=fs.realpathSync(file);return [name,{path:resolved,sha256:hash(fs.readFileSync(resolved))}];
  }));
  return {execPath:observedExec,version:observed.version,executableSha256:observed.executableSha256,
    yamlVersion:observed.yamlVersion,yamlFile,yamlSha256:observed.yamlSha256,
    reporterSha256:hash(fs.readFileSync(regular(root,PYTHON_REPORTER))),tools};
}

function fixedEnvironment(directory,binding) {
  const home=path.join(directory,'home'),temporary=path.join(directory,'tmp');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(temporary,{recursive:true});
  const directories=[path.dirname(binding.runtime.execPath),...Object.values(binding.runtime.tools).map(item=>path.dirname(item.path))];
  const selected={CT_REQUIRE_INTEGRATION:'1'};
  for(const [name,item] of Object.entries(binding.environment.files))selected[name]=item.path;
  for(const [name,item] of Object.entries(binding.environment.directories))selected[name]=item.path;
  return {PATH:[...new Set(directories)].join(path.delimiter),HOME:home,USERPROFILE:home,TMPDIR:temporary,TMP:temporary,TEMP:temporary,...selected,
    LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',CI:'true',PYTHONHASHSEED:'0',PYTHONDONTWRITEBYTECODE:'1',
    PYTHON_TEST_EVIDENCE_BINDING:JSON.stringify(binding)};
}

export function producePythonReceipt({root,base,provenance,files,batch=0,drain,spawn=spawnSync,runtimeOptions,environment=process.env}={}) {
  const contracts=selectPythonContracts(files),count=Math.ceil(contracts.length/NATIVE_BATCH_SIZE);
  if(!Number.isInteger(batch)||batch<0||batch>=Math.max(count,1))fail('NOT RUN: Python batch outside selection');
  const selected=contracts.filter(contract=>contract.batch===batch),runId=randomUUID(),receiptDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'speaksharp-python-evidence-'));
  const runtime=selected.length?pythonRuntime(root,runtimeOptions):null,
    environmentBinding=selected.length?pythonEnvironment(environment):null,tests=[];
  let primaryError;
  try {
    for(const contract of selected) {
      const phaseId=randomUUID(),receiptFile=path.join(receiptDirectory,`${phaseId}.json`),testFile=regular(root,contract.testFile);
      const binding={schemaVersion:1,phase:'python-unittest',phaseId,runId,root:fs.realpathSync(root),testFile:contract.testFile,
        testSha256:hash(fs.readFileSync(testFile)),receiptDirectory,receiptFile,base:base??null,provenance,runtime,environment:environmentBinding};
      const command=[runtime.execPath,'-I',regular(root,PYTHON_REPORTER)],result=spawn(command[0],command.slice(1),{
        cwd:root,env:fixedEnvironment(receiptDirectory,binding),encoding:'utf8',timeout:120000,killSignal:'SIGKILL',detached:true,maxBuffer:4*1024*1024});
      const processCleanup=drain(result);
      if(!fs.existsSync(receiptFile))fail('Python execution receipt missing');
      const report=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
      const phase={binding,command,execution:{status:result.status,signal:result.signal,error:result.error?.code??null,processCleanup},report};
      validatePythonPhase(phase,{root,base,provenance,runId,contract,runtime,environment});
      tests.push({testFile:contract.testFile,testSha256:binding.testSha256,phase});
    }
  } catch(error){primaryError=error;}
  try{fs.rmSync(receiptDirectory,{recursive:true,force:true,maxRetries:3,retryDelay:50});}catch(cleanup){throw new AggregateError(primaryError?[primaryError,cleanup]:[cleanup],'Python evidence cleanup failed');}
  if(primaryError)throw primaryError;
  return {schemaVersion:1,runId,provenance,commit:provenance.commit,tree:provenance.tree,snapshotSha256:provenance.snapshotSha256,
    base:base??null,status:selected.length?'executed':'not-applicable',batch:executionBatchIdentity(contracts,batch),tests};
}

export function validatePythonPhase(phase,{root,base,provenance,runId,contract,runtime=pythonRuntime(root),environment=process.env}) {
  const b=phase?.binding,report=phase?.report;
  if(!b||b.schemaVersion!==1||b.phase!=='python-unittest'||b.runId!==runId||!b.phaseId||b.root!==fs.realpathSync(root)
    ||b.testFile!==contract.testFile||b.testSha256!==hash(fs.readFileSync(regular(root,contract.testFile)))||b.base!==(base??null)
    ||!isDeepStrictEqual(b.provenance,provenance)||!isDeepStrictEqual(b.runtime,runtime)
    ||!isDeepStrictEqual(b.environment,pythonEnvironment(environment))
    ||JSON.stringify(phase.command)!==JSON.stringify([runtime.execPath,'-I',regular(root,PYTHON_REPORTER)]))fail('Wrong Python source/runtime/provenance/command binding');
  if(phase.execution?.status!==0||phase.execution.signal!==null||phase.execution.error!==null||phase.execution.processCleanup?.status!=='drained')fail('Python execution failed or did not drain');
  if(report?.schemaVersion!==1||!isDeepStrictEqual(report.binding,b))fail('Python reporter binding is absent or stale');
  if(!isDeepStrictEqual(report.runtime,runtime))fail('Python reporter runtime is absent or stale');
  if(!Array.isArray(report.collected)||!report.collected.length||new Set(report.collected).size!==report.collected.length
    ||!Array.isArray(report.outcomes)||report.outcomes.length!==report.collected.length)fail('Python collection absent, duplicated or stale');
  const outcomes=new Map();
  for(const item of report.outcomes) {
    if(!item||typeof item.id!=='string'||item.status!=='passed'||outcomes.has(item.id))fail('Python tests failed, skipped, duplicated or malformed');
    outcomes.set(item.id,item.status);
  }
  if(report.collected.some(id=>!outcomes.has(id))||[...outcomes].some(([id])=>!report.collected.includes(id)))fail('Python collected/result inventory differs');
  return contract.testFile;
}

export function validatePythonReceipt(receipts,{root,base,provenance,files,environment=process.env}) {
  const contracts=selectPythonContracts(files),list=Array.isArray(receipts)?receipts:[receipts];
  reconcileExecutionBatches(list,contracts,'Python');
  const credited=new Set(),runs=new Set(),phases=new Set();
  for(const receipt of list) {
    const selected=contracts.filter(contract=>contract.batch===receipt.batch.index);
    if(receipt?.schemaVersion!==1||JSON.stringify(receipt.provenance)!==JSON.stringify(provenance)||receipt.commit!==provenance.commit
      ||receipt.tree!==provenance.tree||receipt.snapshotSha256!==provenance.snapshotSha256||receipt.base!==(base??null)
      ||!receipt.runId||runs.has(receipt.runId)||receipt.status!==(selected.length?'executed':'not-applicable')||receipt.tests?.length!==selected.length)fail('Wrong Python receipt inventory/provenance');
    runs.add(receipt.runId);
    selected.forEach((contract,index)=>{
      const item=receipt.tests[index];
      if(item.testFile!==contract.testFile||item.testSha256!==hash(fs.readFileSync(regular(root,contract.testFile)))||phases.has(item.phase?.binding?.phaseId))fail('Wrong or duplicate Python test source');
      credited.add(validatePythonPhase(item.phase,{root,base,provenance,runId:receipt.runId,contract,environment}));phases.add(item.phase.binding.phaseId);
    });
  }
  return credited;
}
