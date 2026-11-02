import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {NATIVE_BATCH_SIZE,NATIVE_MAX_BATCHES,executionBatchIdentity,reconcileExecutionBatches} from './nativeTestExecutionEvidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
const MAX_RECEIPT_BYTES=2*1024*1024,MAX_RECEIPT_ITEMS=4096,MAX_DIAGNOSTIC_FAILURES=64;
const PHASE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROCESS_SIGNALS=new Set(['SIGHUP','SIGINT','SIGQUIT','SIGILL','SIGTRAP','SIGABRT','SIGBUS','SIGFPE','SIGKILL','SIGUSR1','SIGSEGV','SIGUSR2','SIGPIPE','SIGALRM','SIGTERM','SIGCHLD','SIGCONT','SIGSTOP','SIGTSTP','SIGTTIN','SIGTTOU','SIGURG','SIGXCPU','SIGXFSZ','SIGVTALRM','SIGPROF','SIGWINCH','SIGIO','SIGSYS']);
const PROCESS_ERRORS=new Set(['EACCES','EAGAIN','EBADF','EINTR','EINVAL','EIO','EMFILE','ENFILE','ENOENT','ENOMEM','ENOSPC','ENOTDIR','EPERM','ETIMEDOUT']);
const CLEANUP_STATES=new Set(['drained','not-started','error']);
const OUTCOME_STATES=new Set(['passed','failed','error','skipped','expected-failure','unexpected-success']);
export const PYTHON_REPORTER='scripts/lib/python-unittest-reporter.py';
// Non-test inputs are credited only through the exact Python consumer that reads
// or integrity-checks them.  This is deliberately a closed inventory: an
// unregistered fixture remains UNCOVERED rather than borrowing a nearby suite.
export const PYTHON_INPUT_CONTRACTS=Object.freeze([
  {inputFile:'tools/cloud-test/harness/draft-adapters/source/d100/20260731120000_session_progress_evaluations.sql',testFile:'tools/cloud-test/tests/test_runnable_package.py'},
  {inputFile:'tools/cloud-test/harness/draft-adapters/source/d100/20260731130000_progress_recommendations.sql',testFile:'tools/cloud-test/tests/test_runnable_package.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/accepted-comparison-R5-vs-R4C.json',testFile:'tools/cloud-test/tests/test_pipeline_and_report.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/cloud-test.yml',testFile:'tools/cloud-test/tests/test_workflow_policy.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/full-request.json',testFile:'tools/cloud-test/tests/test_pipeline_and_report.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/nightly-control-plane.yml.proposed',testFile:'tools/cloud-test/tests/test_nightly_regression.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/nightly-request.json',testFile:'tools/cloud-test/tests/test_nightly_regression.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/original-r15-pins.json',testFile:'tools/cloud-test/tests/test_runnable_package.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/partial-request.json',testFile:'tools/cloud-test/tests/test_pipeline_and_report.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/plan-facts.PLACEHOLDER.json',testFile:'tools/cloud-test/tests/test_selected_full_case_route.py'},
  {inputFile:'tools/cloud-test/tests/fixtures/synthetic-history/inputs.v1.json',testFile:'tools/cloud-test/tests/test_full_coverage.py'},
]);

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
  const input=PYTHON_INPUT_CONTRACTS.find(item=>item.inputFile===file);
  if(input)return {runner:'python-unittest-input',consumer:input.testFile,applicable:true};
  return /^tools\/cloud-test\/(?:.*\/)?test_[^/]+\.py$/.test(file)
    ?{runner:'python-unittest',consumer:file,applicable:true}:null;
}

export function selectPythonContracts(files) {
  const selected=new Map();
  for(const file of [...new Set(files)].sort()) {
    const route=pythonTestRoute(file);if(!route)continue;
    const contract=selected.get(route.consumer)??{testFile:route.consumer,sourceFiles:[],consumerExecution:false};
    if(route.runner==='python-unittest-input')contract.sourceFiles.push(file);
    else contract.consumerExecution=true;
    selected.set(route.consumer,contract);
  }
  const contracts=[...selected.values()].map(contract=>({testFile:contract.testFile,
    ...(contract.sourceFiles.length?{sourceFiles:contract.sourceFiles}:{}),
    ...(contract.consumerExecution?{consumerExecution:true}:{})}));
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

// Keep failure receipts useful without forwarding arbitrary child output, paths
// outside the selected contract, or environment values. Test IDs come from the
// bound unittest inventory and are admitted only through a small printable
// grammar; anything else is represented as malformed rather than echoed.
export function pythonPhaseDiagnostics(phase,contract) {
  const outcomes=Array.isArray(phase?.report?.outcomes)&&phase.report.outcomes.length<=MAX_RECEIPT_ITEMS
    ?phase.report.outcomes:[];
  const failed=outcomes.map((item,index)=>({item,index})).filter(({item})=>item?.status!=='passed');
  const rawStatus=phase?.execution?.status,rawSignal=phase?.execution?.signal,rawError=phase?.execution?.error;
  const receiptShape=phase?.report===null?'absent':!phase?.report||typeof phase.report!=='object'||Array.isArray(phase.report)
    ||!Array.isArray(phase.report.outcomes)?'invalid':phase.report.outcomes.length>MAX_RECEIPT_ITEMS?'oversized':'bounded';
  return {
    testFile:contract.testFile,
    batch:Number.isInteger(contract.batch)&&contract.batch>=0&&contract.batch<NATIVE_MAX_BATCHES?contract.batch:null,
    phaseId:typeof phase?.binding?.phaseId==='string'&&PHASE_ID.test(phase.binding.phaseId)?phase.binding.phaseId:null,
    status:rawStatus===null?null:Number.isInteger(rawStatus)&&rawStatus>=0&&rawStatus<=255?rawStatus:'invalid',
    signal:rawSignal===null?null:PROCESS_SIGNALS.has(rawSignal)?rawSignal:'invalid',
    error:rawError===null?null:PROCESS_ERRORS.has(rawError)?rawError:'invalid',
    cleanupStatus:CLEANUP_STATES.has(phase?.execution?.processCleanup?.status)?phase.execution.processCleanup.status:'invalid',
    receiptShape,
    failedTests:failed.slice(0,MAX_DIAGNOSTIC_FAILURES).map(({item,index})=>({
      index,
      status:OUTCOME_STATES.has(item?.status)?item.status:'invalid',
      idSha256:typeof item?.id==='string'&&Buffer.byteLength(item.id,'utf8')<=300?hash(item.id):null,
    })),
    failedTestsTruncated:Math.max(0,failed.length-MAX_DIAGNOSTIC_FAILURES),
  };
}

function failPhase(message,phase,contract) {
  const diagnostics=pythonPhaseDiagnostics(phase,contract);
  const error=new Error(`${message}: ${JSON.stringify(diagnostics)}`);
  error.diagnostics=diagnostics;
  throw error;
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
      const sourceFiles=(contract.sourceFiles??[]).map(file=>({file,sha256:hash(fs.readFileSync(regular(root,file)))}));
      const binding={schemaVersion:1,phase:'python-unittest',phaseId,runId,root:fs.realpathSync(root),testFile:contract.testFile,
        testSha256:hash(fs.readFileSync(testFile)),receiptDirectory,receiptFile,base:base??null,provenance,runtime,environment:environmentBinding};
      if(sourceFiles.length)binding.sourceFiles=sourceFiles;
      const command=[runtime.execPath,'-I',regular(root,PYTHON_REPORTER)],result=spawn(command[0],command.slice(1),{
        cwd:root,env:fixedEnvironment(receiptDirectory,binding),encoding:'utf8',timeout:120000,killSignal:'SIGKILL',detached:true,maxBuffer:4*1024*1024});
      let processCleanup;
      try { processCleanup=drain(result); }
      catch { processCleanup={status:'error'}; }
      const execution={status:result.status,signal:result.signal,error:result.error?.code??null,processCleanup};
      if(!fs.existsSync(receiptFile))failPhase('Python execution receipt missing',{binding,command,execution,report:null},contract);
      if(fs.statSync(receiptFile).size>MAX_RECEIPT_BYTES)failPhase('Python execution receipt too large',{binding,command,execution,report:{outcomes:Array(MAX_RECEIPT_ITEMS+1)}},contract);
      let report;
      try { report=JSON.parse(fs.readFileSync(receiptFile,'utf8')); }
      catch { failPhase('Python execution receipt malformed',{binding,command,execution,report:null},contract); }
      const phase={binding,command,execution,report};
      validatePythonPhase(phase,{root,base,provenance,runId,contract,runtime,environment});
      tests.push({testFile:contract.testFile,testSha256:binding.testSha256,
        ...(contract.sourceFiles?{sourceFiles:contract.sourceFiles}:{}),
        ...(contract.consumerExecution?{consumerExecution:true}:{}),phase});
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
    ||!isDeepStrictEqual(b.sourceFiles??[],(contract.sourceFiles??[]).map(file=>({file,sha256:hash(fs.readFileSync(regular(root,file)))})))
    ||!isDeepStrictEqual(b.provenance,provenance)||!isDeepStrictEqual(b.runtime,runtime)
    ||!isDeepStrictEqual(b.environment,pythonEnvironment(environment))
    ||JSON.stringify(phase.command)!==JSON.stringify([runtime.execPath,'-I',regular(root,PYTHON_REPORTER)]))failPhase('Wrong Python source/runtime/provenance/command binding',phase,contract);
  if(phase.execution?.status!==0||phase.execution.signal!==null||phase.execution.error!==null||phase.execution.processCleanup?.status!=='drained')failPhase('Python execution failed or did not drain',phase,contract);
  if(report?.schemaVersion!==1||!isDeepStrictEqual(report.binding,b))failPhase('Python reporter binding is absent or stale',phase,contract);
  if(!isDeepStrictEqual(report.runtime,runtime))failPhase('Python reporter runtime is absent or stale',phase,contract);
  const boundedInventory=Array.isArray(report.collected)&&report.collected.length>0&&report.collected.length<=MAX_RECEIPT_ITEMS
    &&report.collected.every(id=>typeof id==='string'&&Buffer.byteLength(id,'utf8')<=300)
    &&Array.isArray(report.outcomes)&&report.outcomes.length<=MAX_RECEIPT_ITEMS
    &&report.outcomes.every(item=>item&&typeof item==='object'&&typeof item.id==='string'&&Buffer.byteLength(item.id,'utf8')<=300&&OUTCOME_STATES.has(item.status));
  if(!boundedInventory||new Set(report.collected).size!==report.collected.length
    ||report.collected.length>MAX_RECEIPT_ITEMS||!Array.isArray(report.outcomes)||report.outcomes.length>MAX_RECEIPT_ITEMS
    ||report.outcomes.length!==report.collected.length)failPhase('Python collection absent, duplicated or stale',phase,contract);
  if(!isDeepStrictEqual(report.sourceReads??[],b.sourceFiles??[]))failPhase('Python input consumption absent, substituted or stale',phase,contract);
  const outcomes=new Map();
  for(const item of report.outcomes) {
    if(!item||typeof item.id!=='string'||item.status!=='passed'||outcomes.has(item.id))failPhase('Python tests failed, skipped, duplicated or malformed',phase,contract);
    outcomes.set(item.id,item.status);
  }
  if(report.collected.some(id=>!outcomes.has(id))||[...outcomes].some(([id])=>!report.collected.includes(id)))failPhase('Python collected/result inventory differs',phase,contract);
  return contract.testFile;
}

export function validatePythonReceipt(receipts,{root,base,provenance,files,environment=process.env,runtimeOptions}={}) {
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
      const testFile=validatePythonPhase(item.phase,{root,base,provenance,runId:receipt.runId,contract,
        runtime:pythonRuntime(root,runtimeOptions),environment});
      for(const file of contract.sourceFiles??[])credited.add(file);
      if(contract.consumerExecution)credited.add(testFile);
      phases.add(item.phase.binding.phaseId);
    });
  }
  return credited;
}
