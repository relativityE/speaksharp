import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEST_EFFICACY_CONTRACTS, qualifyEfficacyPhase as qualifyRawPhase } from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';
import EfficacyReporter, { canonicalPath, runtimeIdentity } from '../../scripts/efficacy-reporter.mjs';
import { mutateBytes, dependencyPaths, selectContracts, runTestEfficacy, runVitestExecution } from '../../scripts/run-test-efficacy.mjs';
import {executionContext,validateVitestExecution} from '../../scripts/lib/testExecutionEvidence.mjs';
import {randomUUID} from 'node:crypto';

// The same dependency-free tests also participate in the existing Vitest unit lane.
const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = TEST_EFFICACY_CONTRACTS[0];
const names = contract.mutants.map(mutant => mutant.assertion).sort();
const baselineReport = () => ({ success: true,
  numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ status: 'passed', assertionResults: names.map(fullName => ({ fullName, status: 'passed', failureMessages: [] })) }] });
const killedReport = () => {
  const report = baselineReport();
  report.success = false;
  report.numPassedTests = 1;
  report.numFailedTests = 1;
  report.testResults[0].status = 'failed';
  Object.assign(report.testResults[0].assertionResults[0], { status: 'failed', failureMessages: ['AssertionError: expected true to be false'] });
  return report;
};

// Explicitly synthetic envelope fixtures, never evidence about installed Vitest or product tests.
function phaseFixture(report) {
  const binding = { runId: 'fixture-run', phaseId: 'fixture-phase', inputSha256: 'fixture-input',
    command: ['node', 'fixture'], cwd: '/fixture', testFile: '/fixture/test.ts',
    runtime: { adapter: 'vitest-3.2.4-raw-v1' } };
  const tasks = report.testResults?.[0]?.assertionResults?.map((test, index) => ({ id: `t${index}`, parentId:'file', type: 'test',
    name: test.fullName, mode: 'run', result: { state: test.status === 'passed' ? 'pass' : 'fail', hooks: {},
      errors: test.status === 'failed' ? [{ name: 'AssertionError', stack: '/fixture/test.ts:42:1' }] : [] } })) || [];
  const envelope = { schemaVersion: 2, binding, observed: { command: binding.command, cwd: binding.cwd, runtime: binding.runtime },
    collectionCalls: 1, finishedCalls: 1, endCalls: 1, timedOut: false,
    collected: [{ file: binding.testFile, tests: tasks.map(({ id, name, mode }) => ({ id, name, mode })) }],
    finished: { files: [{ file: binding.testFile, tasks: [...tasks,{id:'file',parentId:null,type:'suite',mode:'run',
      result:{state:report.success?'pass':'fail',hooks:{},errors:[]}}] }], errors: [] },
    ended: { errors: [], reason: report.success ? 'passed' : 'failed' } };
  return { envelope, binding, assertionLocation: 42 };
}
function qualifyEfficacyPhase(report, execution, options = {}) {
  return qualifyRawPhase(report, execution, { ...phaseFixture(report), ...options });
}

function assertWorkerInterruption(diagnostics) {
  const marker = 'EFFICACY_INJECTED_WORKER_SIGTERM';
  const detail = JSON.stringify(diagnostics);
  assert.match(detail, /EFFICACY_INJECTED_WORKER_SIGTERM/, 'the mutation must reach the intentional worker kill');
  const observed = detail.replaceAll(marker, '');
  assert.ok(diagnostics.signal === 'SIGTERM'
    || /Worker exited unexpectedly|ERR_IPC_CHANNEL_CLOSED/.test(observed),
  'worker interruption must be observed');
}

test('interruption control rejects marker-only diagnostics without an observed worker failure', () => {
  for (const diagnostics of [
    { stderr: 'EFFICACY_INJECTED_WORKER_SIGTERM\n', signal: null },
    { stderr: 'EFFICACY_INJECTED_WORKER_SIGTERM\nSIGTERM requested', signal: null },
  ]) {
    assert.throws(() => assertWorkerInterruption(diagnostics), /worker interruption must be observed/);
  }
});

test('interruption control accepts independent observed worker diagnostics or structured signal', () => {
  for (const diagnostics of [
    { stderr: 'EFFICACY_INJECTED_WORKER_SIGTERM\nError: Worker exited unexpectedly', signal: null },
    { stderr: 'EFFICACY_INJECTED_WORKER_SIGTERM\nError [ERR_IPC_CHANNEL_CLOSED]: Channel closed', signal: null },
    { stderr: 'EFFICACY_INJECTED_WORKER_SIGTERM\n', signal: 'SIGTERM' },
  ]) {
    assert.doesNotThrow(() => assertWorkerInterruption(diagnostics));
  }
  assert.throws(() => assertWorkerInterruption({ stderr: 'ERR_IPC_CHANNEL_CLOSED', signal: null }),
    /mutation must reach the intentional worker kill/);
});

test('accepts collected baseline and designated semantic casualty with identical collection', () => {
  assert.deepEqual(qualifyEfficacyPhase(baselineReport(), { status: 0 }), names);
  assert.deepEqual(qualifyEfficacyPhase(killedReport(), { status: 1 }, { assertion: names[0], baselineNames: names }), names);
});

test('requires phase-consistent JSON and raw suite statuses, including nested suites', () => {
  for (const red of [false,true]) {
    const report=red?killedReport():baselineReport();
    const options=phaseFixture(report);
    const args={...options,...(red?{assertion:names[0],baselineNames:names}:{})};
    assert.deepEqual(qualifyRawPhase(report,{status:red?1:0},args),names);
    report.testResults[0].status=red?'passed':'failed';
    assert.throws(()=>qualifyRawPhase(report,{status:red?1:0},args),/JSON suite status contradicts phase tests/);
    report.testResults[0].status=red?'failed':'passed';
    const tasks=options.envelope.finished.files[0].tasks;
    tasks.at(-1).result.state=red?'pass':'fail';
    assert.throws(()=>qualifyRawPhase(report,{status:red?1:0},args),/Raw suite status contradicts descendant tests/);
    tasks.at(-1).result.state=red?'fail':'pass';
    tasks[0].parentId='nested';
    tasks.push({id:'nested',parentId:'file',type:'suite',mode:'run',result:{state:red?'fail':'pass',hooks:{},errors:[]}});
    assert.deepEqual(qualifyRawPhase(report,{status:red?1:0},args),names);
    tasks.at(-1).result.state=red?'pass':'fail';
    assert.throws(()=>qualifyRawPhase(report,{status:red?1:0},args),/Raw suite status contradicts descendant tests/);
  }
});

test('rejects no-op, missing and ambiguous anchors; preserves literal replacement bytes', () => {
  for (const [source, anchor, replacement] of [['abc', '', 'x'], ['abc', 'b', 'b'], ['abc', 'z', 'x'], ['aba', 'a', 'x']]) {
    assert.throws(() => mutateBytes(Buffer.from(source), anchor, replacement));
  }
  assert.equal(mutateBytes(Buffer.from('abc'), 'b', '$&').toString(), 'a$&c');
});

test('rejects skipped/missing/duplicate collection and inconsistent counts', () => {
  for (const alter of [
    report => { report.testResults = []; },
    report => { report.testResults[0].assertionResults = []; },
    report => { report.testResults[0].assertionResults[0].status = 'pending'; },
    report => { report.testResults[0].assertionResults[0].fullName = names[1]; },
    report => { report.numTotalTests = 3; },
    report => { report.numPendingTests = 1; },
  ]) {
    const report = baselineReport();
    alter(report);
    assert.throws(() => qualifyEfficacyPhase(report, { status: 0 }));
  }
  assert.throws(() => qualifyEfficacyPhase(baselineReport(), { status: 0 }, { baselineNames: ['other'] }));
});

test('rejects survival, wrong casualty, setup failure, crash and generic timeout', () => {
  const options = { assertion: names[0], baselineNames: names };
  assert.throws(() => qualifyEfficacyPhase(baselineReport(), { status: 0 }, options));
  assert.throws(() => qualifyEfficacyPhase(killedReport(), { status: 1 }, { ...options, assertion: 'other' }));
  for (const execution of [{ status: null, signal: 'SIGTERM' }, { status: 1, error: new Error('spawn') },
    { status: 2 }, { status: 1, stderr: 'Unhandled Rejection' }]) {
    assert.throws(() => qualifyEfficacyPhase(killedReport(), execution, options));
  }
  for (const message of ['Error: Cannot find module', 'SyntaxError: unexpected token', 'Test timed out', 'AssertionError: timeout exceeded', 'ReferenceError: expected foo to exist']) {
    const report = killedReport();
    report.testResults[0].assertionResults[0].failureMessages = [message];
    assert.throws(() => qualifyEfficacyPhase(report, { status: 1 }, options));
  }
});

test('ordinary assertion stacks and expected timeout text are not infrastructure timeouts', () => {
  for (const message of [
    'AssertionError: expected true to be false\n    at contract.test.ts:42:1\n    at runWithTimeout (runner/chunk-hooks.js:1863:10)',
    "AssertionError: expected 'timeout' to be 'ready'\n    at contract.test.ts:42:1",
  ]) {
    const report = killedReport();
    report.testResults[0].assertionResults[0].failureMessages = [message];
    assert.deepEqual(qualifyEfficacyPhase(report, { status: 1 }, {
      assertion: names[0], baselineNames: names,
    }), names);
  }
});

test('a structured TimeoutError never qualifies as a semantic assertion', () => {
  const report = killedReport();
  const options = phaseFixture(report);
  const task = options.envelope.finished.files[0].tasks.find(task => task.type === 'test' && task.result.state === 'fail');
  task.result.errors[0].name = 'TimeoutError';
  assert.throws(() => qualifyRawPhase(report, { status: 1 }, {
    ...options, assertion: names[0], baselineNames: names,
  }), /Raw collection or semantic failure mismatch/);
});

test('selects only affected registered contracts and follows transitive dependencies', () => {
  const dependencies = dependencyPaths(root, contract.testFile);
  assert.ok(dependencies.has('frontend/src/contracts/fillerEvidence.ts'));
  assert.equal(selectContracts(root, ['README.md']).length, 0);
  for (const file of [contract.sourceFile, contract.testFile, 'frontend/src/contracts/fillerEvidence.ts', 'pnpm-lock.yaml', '.github/workflows/ci.yml']) {
    assert.deepEqual(selectContracts(root, [file]).map(item => item.id), ['analytics-truth']);
  }
});

for (const file of ['frontend/src/services/transcription/STTRegistry.ts', 'frontend/src/stores/useSessionStore.ts']) {
  test(`selects pilot for setup dependency outside contract import closure: ${file}`, () => {
    assert.equal(dependencyPaths(root, contract.testFile).has(file), false);
    assert.deepEqual(selectContracts(root, [file]).map(item => item.id), ['analytics-truth']);
  });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'efficacy-fixture-'));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  };
  write('.gitignore', 'node_modules\n');
  write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  write('scripts/efficacy-reporter.mjs', fs.readFileSync(path.join(root, 'scripts/efficacy-reporter.mjs')));
  write('node_modules/vitest/package.json', '{"version":"3.2.4"}');
  write('node_modules/@vitest/runner/package.json', '{"version":"3.2.4","main":"index.js"}');
  write('node_modules/@vitest/runner/index.js', '// synthetic fixture only\n');
  write(contract.sourceFile, `function isValidMetric(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') { if (value.trim() === '') return false; }
    const n = Number(value);
    return Number.isFinite(n);
  }`);
  write(contract.testFile, "import '../../utils/metricValidity';\n" + contract.mutants.map(mutant => mutant.assertionAnchor).join('\n'));
  // Synthetic subprocess adapter exercises runner orchestration only. It is deliberately not
  // product Vitest evidence: executes the fixture predicate and emits its assertion results.
  write('node_modules/vitest/vitest.mjs', `
    import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
    import Reporter from '../../scripts/efficacy-reporter.mjs';
    const reporter = new Reporter(); reporter.onInit();
    const source = fs.readFileSync(${JSON.stringify(contract.sourceFile)}, 'utf8');
    const predicate = new Function(source + '; return isValidMetric;')();
    const specs = ${JSON.stringify(contract.mutants.map(mutant => mutant.assertion))};
    const results = specs.map((fullName, index) => {
      try { assert.equal(predicate(index === 0 ? '' : Infinity), false); return {fullName, status:'passed', failureMessages:[]}; }
      catch (error) { return {fullName, status:'failed', failureMessages:[String(error)]}; }
    });
    const failed = results.filter(result => result.status === 'failed').length;
    const report = { success:failed === 0, numTotalTests:2,
      numPassedTests:2-failed, numFailedTests:failed, numPendingTests:0, numTodoTests:0,
      testResults:[{name:path.resolve(${JSON.stringify(contract.testFile)}),status:failed ? 'failed':'passed',assertionResults:results}] };
    fs.writeFileSync(process.argv.find(arg => arg.startsWith('--outputFile=')).slice(13), JSON.stringify(report));
    const tasks = results.map((result,index) => ({ id:'t'+index,type:'test',mode:'run',name:result.fullName }));
    const file = { id:'file',type:'suite',mode:'run',name:'fixture',filepath:path.resolve(${JSON.stringify(contract.testFile)}),tasks };
    reporter.onCollected([file]);
    file.result = {state:failed ? 'fail':'pass',hooks:{},errors:[]};
    tasks.forEach((task,index) => { task.result = { state:results[index].status === 'passed' ? 'pass':'fail', hooks:{},
      errors:results[index].status === 'passed' ? [] : [{name:'AssertionError',message:'fixture assertion',stack:file.filepath+':'+(index+2)+':1'}] }; });
    reporter.onFinished([file],[]); reporter.onTestRunEnd([],[],failed ? 'failed':'passed');
    process.exitCode = failed ? 1 : 0;
  `);
  const git = args => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().trim();
  git(['init']);
  git(['add', '.']);
  git(['-c', 'user.name=Efficacy fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  return { directory, write, git };
}

test('efficacy fixture excludes dependency symlink from Git inventory without allowing source symlinks',()=>{
  const {directory,git}=fixture();
  const external=fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-dependency-link-'));
  try {
    fs.renameSync(path.join(directory,'node_modules'),path.join(external,'dependencies'));
    fs.symlinkSync(path.join(external,'dependencies'),path.join(directory,'node_modules'),'dir');
    const inventory=git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0');
    assert.equal(inventory.some(file=>file==='node_modules'||file.startsWith('node_modules/')),false);
    assert.doesNotThrow(()=>executionContext(directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()}));
    fs.symlinkSync(path.join(external,'dependencies'),path.join(directory,'unexpected-source-link'),'dir');
    assert.throws(()=>executionContext(directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()}),/Unsupported source entry: unexpected-source-link/);
  } finally {fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});}
});

test('synthetic execution-only orchestration binds copy identity and enforces budget; never Vitest qualification',()=>{
  const {directory,write,git}=fixture();
  try {
    const base=git(['rev-parse','HEAD']);const file='tests/unit/nonpilot.test.js';
    write(file,'// synthetic orchestration fixture; not a real Vitest test\n');
    const runner=path.join(directory,'node_modules/vitest/vitest.mjs');
    fs.writeFileSync(runner,fs.readFileSync(runner,'utf8').replaceAll(JSON.stringify(contract.testFile),JSON.stringify(file)));
    const provenance=executionContext(directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const receipt=runVitestExecution({root:directory,base,provenance});
    assert.deepEqual([...validateVitestExecution(receipt,provenance,directory)],[file]);
    assert.equal(receipt.contracts.length,0);
    assert.equal(receipt.tests[0].phase.binding.phase,'execution');
    assert.match(receipt.tests[0].phase.binding.sourceCopyCommit,/^[a-f0-9]{40}$/);
    assert.equal(git(['rev-parse','HEAD']),base,'original Git metadata preserved');
    for(let i=0;i<8;i++)write(`tests/unit/over-budget-${i}.test.js`,'// synthetic budget control\n');
    assert.throws(()=>runVitestExecution({root:directory,base}),/budget exceeds 8 files/);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('executes synthetic fixture baseline, semantic control, two mutations and restoration; never product qualification', () => {
  const { directory } = fixture();
  try {
    const original = fs.readFileSync(path.join(directory, contract.sourceFile));
    const receipt = runTestEfficacy({ root: directory, base: undefined });
    assert.equal(receipt.contracts.length, 1);
    assert.equal(receipt.contracts[0].mutants.length, 2);
    assert.equal(receipt.contracts[0].baseline.report.success, true);
    assert.equal(receipt.contracts[0].restored.report.success, true);
    assert.equal(receipt.contracts[0].control.report.success, true);
    const phases = [receipt.contracts[0].baseline, receipt.contracts[0].control, ...receipt.contracts[0].mutants, receipt.contracts[0].restored];
    assert.equal(new Set(phases.map(phase => phase.binding.phaseId)).size, 5);
    assert.notEqual(receipt.contracts[0].sourceSha256, receipt.contracts[0].mutants[0].sourceSha256);
    assert.deepEqual(fs.readFileSync(path.join(directory, contract.sourceFile)), original);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('refuses a supplied PASS file when dependencies are missing; clean base is not applicable', () => {
  const { directory, write, git } = fixture();
  try {
    fs.rmSync(path.join(directory, 'node_modules'), { recursive: true });
    write('receipt.json', JSON.stringify({ status: 'PASS', commit: git(['rev-parse', 'HEAD']) }));
    assert.throws(() => runTestEfficacy({ root: directory, base: undefined }), /NOT RUN/);
    fs.rmSync(path.join(directory, 'receipt.json'));
    const receipt = runTestEfficacy({ root: directory, base: git(['rev-parse', 'HEAD']) });
    assert.equal(receipt.status, 'not-applicable');
    assert.deepEqual(receipt.contracts, []);
    assert.throws(() => runTestEfficacy({ root: directory, base: 'stale' }), /exact commit/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('mutation CLI rejects identical replacement without touching target', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-cli-'));
  try {
    for (const file of ['source', 'anchor', 'replacement']) fs.writeFileSync(path.join(directory, file), 'same');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/mutate-check.mjs'), ...['source', 'anchor', 'replacement'].map(file => path.join(directory, file))]);
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(path.join(directory, 'source'), 'utf8'), 'same');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('writer removes stale receipts before failing qualification', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'efficacy-stale-'));
  const evidence = path.join(directory, 'product_release/evidence');
  try {
    fs.mkdirSync(evidence, { recursive: true });
    for (const file of ['software-quality.latest.json', 'software-quality-summary.latest.md']) {
      fs.writeFileSync(path.join(evidence, file), 'PASS');
    }
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/write-software-quality-evidence.mjs')], { cwd: directory });
    assert.equal(result.status, 1);
    assert.deepEqual(fs.readdirSync(evidence), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('runner rejects input mutation by tests and never changes original source', () => {
  const { directory } = fixture();
  try {
    const source = path.join(directory, contract.sourceFile);
    const original = fs.readFileSync(source);
    fs.appendFileSync(path.join(directory, 'node_modules/vitest/vitest.mjs'),
      `\nfs.appendFileSync(${JSON.stringify(contract.sourceFile)}, '\\n// changed by test');\n`);
    assert.throws(() => runTestEfficacy({ root: directory, base: undefined }), /Input changed during test phase/);
    assert.deepEqual(fs.readFileSync(source), original);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('rejects hook AssertionErrors carrying the designated test name and message', () => {
  for (const hook of ['beforeEach', 'afterEach', 'beforeAll', 'afterAll']) {
    const report = killedReport();
    const options = phaseFixture(report);
    options.envelope.finished.files[0].tasks[0].result.hooks[hook] = 'run';
    assert.throws(() => qualifyRawPhase(report, {status:1}, {...options,assertion:names[0]}), /hook/);
  }
  const report = killedReport();
  const options = phaseFixture(report);
  // Cleanup may leave hooks marked pass: a hook/cleanup line still is not the registered body.
  options.envelope.finished.files[0].tasks[0].result.errors[0].stack = '/fixture/test.ts:9:1';
  assert.throws(() => qualifyRawPhase(report, {status:1}, {...options,assertion:names[0]}), /assertion body/);
  options.envelope.finished.files[0].tasks[0].result.errors.push({name:'AssertionError',stack:'/fixture/test.ts:42:1'});
  assert.throws(() => qualifyRawPhase(report, {status:1}, {...options,assertion:names[0]}), /assertion body/);
});

test('rejects missing, stale, cross-phase, interrupted and inconsistent envelopes', () => {
  const report = killedReport();
  assert.throws(() => qualifyRawPhase(report, {status:1}, {assertion:names[0]}));
  for (const change of [
    e => { e.binding = {...e.binding,phaseId:'stale'}; },
    e => { e.binding = {...e.binding,runId:'other-run'}; },
    e => { e.observed = {...e.observed,command:['other']}; },
    e => { e.observed = {...e.observed,runtime:{...e.observed.runtime,node:'other'}}; },
    e => { delete e.finished.errors; },
    e => { e.finished.errors = [{name:'AssertionError'}]; },
    e => { e.ended.errors = [{name:'UnhandledRejection'}]; },
    e => { e.ended.reason = 'interrupted'; },
    e => { e.timedOut = true; },
    e => { e.finishedCalls = 0; },
    e => { e.endCalls = 2; },
    e => { e.collectionCalls = 0; },
    e => { e.collected[0].file = '/other'; },
    e => { e.collected[0].tests.pop(); },
    e => { e.finished.files[0].tasks[0].result.errors[0].name = 'SyntaxError'; },
    e => { e.finished.files[0].tasks[0].result.state = 'run'; },
    e => { e.finished.files[0].tasks[0].retry = 1; },
    e => { e.finished.files[0].tasks[0].fails = true; },
    e => { e.finished.files[0].tasks.push({id:'suite',type:'suite',mode:'run',result:{state:'fail',hooks:{},errors:[{name:'AssertionError'}]}}); },
  ]) {
    const options = phaseFixture(report);
    change(options.envelope);
    assert.throws(() => qualifyRawPhase(report, {status:1}, {...options,assertion:names[0]}));
  }
});

test('raw reporter waits for both terminal callbacks in either order and retains hook/errors', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'efficacy-envelope-'));
  const previous = process.env.TEST_EFFICACY_ENVELOPE;
  try {
    process.env.TEST_EFFICACY_ENVELOPE = path.join(directory,'envelope.json');
    const testFile = path.join(directory,'test.ts'); fs.writeFileSync(testFile,'');
    for (const reverse of [false,true]) {
      fs.rmSync(process.env.TEST_EFFICACY_ENVELOPE,{force:true});
      const reporter = new EfficacyReporter();
      reporter.binding = {phaseId:'synthetic'}; reporter.observed = {};
      const file = {id:'file',type:'suite',name:'',mode:'run',filepath:testFile,tasks:[
        {id:'t',type:'test',name:'body',mode:'run',result:{state:'fail',hooks:{beforeEach:'run'},errors:[{name:'AssertionError',message:'hook'}]}},
      ],result:{state:'fail',errors:[]}};
      reporter.onCollected([file]);
      const finish = () => reporter.onFinished([file],[{name:'setup-error'}]);
      const end = () => reporter.onTestRunEnd([],[{name:'unhandled'}],'interrupted');
      (reverse ? end : finish)();
      assert.equal(fs.existsSync(process.env.TEST_EFFICACY_ENVELOPE),false);
      (reverse ? finish : end)();
      const saved=JSON.parse(fs.readFileSync(process.env.TEST_EFFICACY_ENVELOPE,'utf8'));
      assert.equal(saved.finished.files[0].tasks[1].result.hooks.beforeEach,'run');
      assert.equal(saved.finished.errors[0].name,'setup-error');
      assert.equal(saved.ended.reason,'interrupted');
      reporter.onProcessTimeout();
      assert.equal(JSON.parse(fs.readFileSync(process.env.TEST_EFFICACY_ENVELOPE,'utf8')).timedOut,true);
    }
  } finally {
    if (previous === undefined) delete process.env.TEST_EFFICACY_ENVELOPE;
    else process.env.TEST_EFFICACY_ENVELOPE=previous;
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('semantic control preserves metric behavior but rejects a source-text-coupled fixture', () => {
  const { directory } = fixture();
  try {
    const source = fs.readFileSync(path.join(directory,contract.sourceFile));
    let transformed=source;
    for (const change of contract.control) transformed=mutateBytes(transformed,change.anchor,change.replacement);
    const evaluate = bytes => new Function(bytes.toString()+';return isValidMetric;')();
    for (const value of ['', ' ', 0, '0', 42, null, undefined, NaN, Infinity]) {
      assert.equal(evaluate(source)(value),evaluate(transformed)(value));
    }
    const executable=path.join(directory,'node_modules/vitest/vitest.mjs');
    fs.writeFileSync(executable,fs.readFileSync(executable,'utf8').replace(
      'const failed = results.filter',
      `if (!source.includes(${JSON.stringify(contract.control[0].anchor)})) { results[0].status='failed'; results[0].failureMessages=['AssertionError: text changed']; }\nconst failed = results.filter`,
    ));
    assert.throws(() => runTestEfficacy({root:directory,base:null}), /process failed/);
    assert.deepEqual(fs.readFileSync(path.join(directory,contract.sourceFile)),source);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('version adapter fails closed; installed-lock bytes are recorded, not equated with repo lock', () => {
  const { directory,write }=fixture();
  try {
    write('node_modules/.pnpm/lock.yaml','different installed representation\n');
    assert.equal(typeof runtimeIdentity(directory).installedLockSha256,'string');
    write('node_modules/vitest/package.json','{"version":"4.0.0"}');
    assert.throws(() => runtimeIdentity(directory),/Unsupported/);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('all-zero base selects all registered contracts; realpath accepts symlinked workspace', () => {
  const {directory}=fixture();
  const link=directory+'-link';
  try {
    fs.symlinkSync(directory,link,'dir');
    assert.notEqual(path.resolve(link),path.resolve(directory));
    assert.equal(canonicalPath(link),canonicalPath(directory));
    const receipt=runTestEfficacy({root:link,base:'0'.repeat(40)});
    assert.equal(receipt.selection,'all-registered-no-base');
    assert.equal(receipt.contracts.length,1);
  } finally {fs.rmSync(link,{force:true});fs.rmSync(directory,{recursive:true,force:true});}
});

// Explicit opt-in only. No installed-host qualification is implied by the Node-only fixture count.
// Run on a provisioned host: TEST_EFFICACY_REAL_RUNTIME=1 node --test tests/unit/testEfficacy.test.js
if (process.env.TEST_EFFICACY_REAL_RUNTIME === '1') {
  test('INSTALLED Vitest 3.2.4: real fixture phases and adversarial setup/hook/error rejection', () => {
    runtimeIdentity(root); // Missing/wrong runtime fails; never substitutes the synthetic adapter.
    for (const scenario of ['ordinary', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'cleanup', 'import', 'unhandled', 'interruption']) {
      const {directory,write}=fixture();
      try {
        fs.rmSync(path.join(directory,'node_modules'),{recursive:true,force:true});
        fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
        write('frontend/vitest.config.mjs', `export default {test:{environment:'node',setupFiles:['./efficacy-setup.ts']}};`);
        fs.appendFileSync(path.join(directory,contract.sourceFile),'\nexport { isValidMetric };\n');
        write(contract.testFile, "import {it,expect} from 'vitest';\nimport {isValidMetric} from '../../utils/metricValidity';\n"
          + contract.mutants.map(mutant => `it(${JSON.stringify(mutant.assertion)},()=>{\n${mutant.assertionAnchor}\n});`).join('\n'));
        const fail = "if(isValidMetric('')) expect('hook failure').toBe('never');";
        let setup="import {beforeEach,afterEach,beforeAll,afterAll,expect} from 'vitest';\nimport {isValidMetric} from './frontend/src/utils/metricValidity';\n";
        if (['beforeEach','afterEach','beforeAll','afterAll'].includes(scenario)) setup+=`${scenario}(()=>{${fail}});`;
        if (scenario==='cleanup') setup+=`beforeEach(()=>()=>{${fail}});`;
        if (scenario==='import') setup+="import './missing-setup-dependency';";
        if (scenario==='unhandled') setup+="beforeAll(()=>{if(isValidMetric('')) process.emit('unhandledRejection',new Error('adversarial unhandled'));});";
        if (scenario==='interruption') setup+="import {writeSync} from 'node:fs';\nbeforeAll(()=>{if(isValidMetric('')) { writeSync(2,'EFFICACY_INJECTED_WORKER_SIGTERM\\n'); process.kill(process.pid,'SIGTERM'); }});";
        write('efficacy-setup.ts',setup);
        if (scenario==='ordinary') {
          const result=runTestEfficacy({root:directory,base:null});
          assert.equal(result.contracts[0].mutants.length,2);
          assert.equal(result.contracts[0].restored.report.success,true);
        } else {
          const phase=scenario==='import'?'baseline':'blank-is-zero';
          const reasons={
            beforeEach:/Raw task setup\/hook\/suite failure/,
            afterEach:/Raw task setup\/hook\/suite failure/,
            beforeAll:/Raw task setup\/hook\/suite failure/,
            afterAll:/Raw task setup\/hook\/suite failure/,
            cleanup:/^Raw collection or semantic failure mismatch$/,
            import:/Efficacy process failed|Efficacy unhandled runtime\/setup error/,
            unhandled:/Efficacy unhandled runtime\/setup error|Missing, stale, interrupted or inconsistent raw phase evidence/,
            interruption:/Efficacy unhandled runtime\/setup error|Missing, stale, interrupted or inconsistent raw phase evidence/,
          };
          assert.throws(()=>runTestEfficacy({root:directory,base:null}),error=>{
            assert.equal(error.phase,phase,scenario);
            assert.deepEqual(error.completedPhases,phase==='baseline'?[]:['baseline','semantic-control'],scenario);
            assert.match(error.cause.message,reasons[scenario],scenario);
            assert.doesNotMatch(error.cause.message,/NOT RUN|Unsupported|anchor|Source changed/);
            assert.equal(error.diagnostics.error,null,'generic timeout/spawn error is not the intended negative');
            const detail=JSON.stringify(error.diagnostics);
            if(scenario==='import') assert.match(detail,/missing-setup-dependency/);
            else if(scenario==='unhandled') assert.match(detail,/adversarial unhandled/);
            else if(scenario==='interruption') {
              assertWorkerInterruption(error.diagnostics);
            }
            else {
              assert.match(detail,/hook failure/);
              if(scenario==='cleanup') {
                const errors=error.diagnostics.envelope.finished.files.flatMap(file=>file.tasks.flatMap(task=>task.result?.errors || []));
                assert.ok(errors.some(item=>item.name==='AssertionError' && /hook failure/.test(item.message)
                  && /efficacy-setup\.ts:/.test(item.stack)),'intended returned-cleanup AssertionError required');
              }
            }
            return true;
          },scenario);
        }
      } finally {fs.rmSync(directory,{recursive:true,force:true});}
    }
  });
}
