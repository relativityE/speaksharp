import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {HELPER_CONTRACTS, helperRuntimeIdentity, helperSourceBinding, helperCoverageOptions, validateHelperCoverage,normalizedHelperWorkerFunctions,validateRawHelperFunctions} from '../../scripts/lib/helperExecutionEvidence.mjs';
import {runVitestHelperExecution,runVitestExecution,dependencyPaths} from '../../scripts/run-test-efficacy.mjs';
import {executionContext, validateVitestExecution,executionRoute,executionCoverage,changedEvidencePaths,readCurrentQuality} from '../../scripts/lib/testExecutionEvidence.mjs';
import {TEST_EFFICACY_CONTRACTS,MEANINGFUL_COVERAGE_MANIFEST} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';
const {test} = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = HELPER_CONTRACTS[0];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('registers explicit canary and reader callable consumers without a generic helper exemption',()=>{
  for(const [helperFile,testFile] of [
    ['tests/canary/canaryStopSaveOracle.ts','tests/unit/canaryStopSaveOracle.test.ts'],
    ['tests/e2e/canaryLanding.ts','tests/e2e/__tests__/canaryLanding.test.ts'],
    ['tests/live/helpers/rwtJourney.ts','tests/unit/progressReaderUrlPredicates.test.ts'],
    ['tests/live/helpers/rwtOracles.ts','tests/unit/rwtReadbackBindingReasons1258.test.ts'],
    ['tests/live/helpers/rwtStepDiagnostics.ts','tests/unit/rwtStepDiagnostics1258.test.ts'],
    ['tests/live/helpers/rwtFillerReference.ts','tests/unit/rwtFillerReference1258.test.ts'],
    ['tests/live/helpers/returningSignInAttempt.ts','tests/unit/returningSignInAttempt1495.test.ts'],
    ['tests/live/helpers/repeatMetricWording.ts','tests/unit/repeatMetricWording1548.test.ts'],
  ]) {
    const found=HELPER_CONTRACTS.find(item=>item.helperFile===helperFile);
    assert.equal(found?.testFile,testFile,`${helperFile} requires its actual consumer`);
    assert.ok(found.callables.length>0);
  }
  assert.equal(HELPER_CONTRACTS.some(item=>item.helperFile==='tests/live/helpers/unregistered.ts'),false);
});
test('replays the provider normalizer on raw equal-count adjacent ranges without changing call counts',()=>{
  const raw=[{scriptId:'1',url:'file:///independent-helper.js',functions:[{functionName:'loop',isBlockCoverage:true,ranges:[
    {startOffset:0,endOffset:100,count:3},
    {startOffset:10,endOffset:30,count:8},
    {startOffset:30,endOffset:60,count:8},
  ]}]}];
  const before=structuredClone(raw);
  const normalized=normalizedHelperWorkerFunctions(root,raw);
  assert.deepEqual(raw,before,'normalization must not mutate retained worker evidence');
  assert.deepEqual(normalized[0].ranges,[{startOffset:0,endOffset:100,count:3},{startOffset:10,endOffset:60,count:8}]);
  const altered=structuredClone(raw);altered[0].functions[0].ranges[0].count=4;
  assert.notDeepEqual(normalizedHelperWorkerFunctions(root,altered),normalized);
  const identity=helperRuntimeIdentity(root).normalizer;
  assert.equal(identity.version,'1.0.2');
  assert.ok(identity.sources.some(file=>file.file==='merge.js' && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(identity.sources.some(file=>file.file==='normalize.js'));
});

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

test('recovery registration requires the exact class methods and actual named consumer',()=>{
  const selected=HELPER_CONTRACTS.find(item=>item.helperFile==='tests/live/helpers/rwtRecoveryCapture.ts');
  assert.equal(selected?.testFile,'tests/unit/rwtRecoveryCapture1593.test.ts');
  assert.deepEqual(selected?.callables,['SessionCreateBinding#onRequest','SessionCreateBinding#binding',
    'SessionCreateBinding#readBinding','SessionCreateBinding#detach','recoveryFenceRow']);
  const f=recoveryClassFixture();
  try {
    assert.equal(executionRoute(f.helper,f.directory).applicable,true);
    for(const edit of [
      source=>source.replace('class SessionCreateBinding','class AnotherBinding'),
      source=>source.replace('private readBinding()','private otherBinding()'),
      source=>source.replace('private readBinding()','static readBinding()'),
      source=>source.replace('private readBinding()','get readBinding()'),
      source=>source.replace('private readBinding()','private ["readBinding"]()'),
      source=>source+'\nexport class SessionCreateBinding { readBinding() { return 5; } }',
    ]) {
      f.write(f.helper,edit(f.source));
      const route=executionRoute(f.helper,f.directory);
      assert.equal(route.applicable,false,'a neighboring/renamed/static/ambiguous method cannot borrow the edge');
    }
    f.write(f.helper,f.source);fs.rmSync(path.join(f.directory,f.consumer));
    assert.equal(executionRoute(f.helper,f.directory).applicable,false,'consumer presence is mandatory');
  } finally {f.clean();}
});

function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'helper-evidence-')));
  const write = (name, content) => {fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true}); fs.writeFileSync(path.join(directory,name),content);};
  const files = ['scripts/lib/helperExecutionEvidence.mjs','scripts/lib/sourceContractEvidence.mjs','scripts/efficacy-helper-vitest.config.mjs',
    'scripts/lib/testExecutionEvidence.mjs','scripts/lib/softwareQualityEvidenceQualification.mjs',
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

test('baseline landing with no receiving callable remains explicitly unsupported',()=>{
  const f=fixture();
  try {
    f.write('tests/e2e/canaryLanding.ts','export function isExpectedAuthLanding(actual,expected) { return actual===expected; }\n');
    f.write('tests/e2e/__tests__/canaryLanding.test.ts','// baseline consumer, no receiving callable\n');
    const route=executionRoute('tests/e2e/canaryLanding.ts',f.directory);
    assert.equal(route.applicable,false);assert.match(route.unavailableReason,/isProgressRoutePathname/);
  } finally {f.clean();}
});

test('baseline journey without its registered consumer remains explicitly unsupported',()=>{
  const f=fixture();
  try {
    f.write('tests/live/helpers/rwtJourney.ts','export async function analyticsThroughActions() {}\nexport async function backFromProgressRestoresSession() {}\n');
    const route=executionRoute('tests/live/helpers/rwtJourney.ts',f.directory);
    assert.equal(route.applicable,false);assert.match(route.unavailableReason,/consumer/);
  } finally {f.clean();}
});

test('unsupported-only producer retains required paths and independently refuses empty-success or stale inventory',()=>{
  const f=fixture();
  try {
    const base=f.git(['rev-parse','HEAD']);
    const file='tests/e2e/canaryLanding.ts';
    f.write(file,'export function isExpectedAuthLanding() { return true; }\n');
    const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
    const receipt=runVitestExecution({root:f.directory,base,provenance:expected});
    assert.equal(receipt.status,'incomplete');assert.deepEqual(receipt.tests,[]);
    assert.deepEqual(receipt.unavailable.map(item=>item.file),[file]);
    assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)],[]);
    const files=changedEvidencePaths(f.directory,base);
    const coverage=executionCoverage(files,{root:f.directory,base,expected,execution:receipt});
    assert.equal(coverage.status,'INCOMPLETE');assert.equal(coverage.rows[0].status,'NOT RUN');
    const output=path.join(f.directory,'test-results/forged-quality.json');
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({provenance:expected,overallStatus:'QUALIFIED',testExecution:receipt,executionCoverage:coverage}));
    assert.throws(()=>readCurrentQuality(output,expected,f.directory,base),/UNCOVERED\/NOT RUN/);
    for(const corrupt of [r=>{r.status='executed';},r=>{r.unavailable=[];},r=>{r.unavailable[0].reason='other';},
      r=>{r.executionKind='unknown';},r=>{r.provenance={...r.provenance,runAttempt:'wrong'};}]) {
      const candidate=structuredClone(receipt);corrupt(candidate);
      assert.throws(()=>validateVitestExecution(candidate,expected,f.directory));
    }
    // Restoring the receiving callable changes the real snapshot; its old
    // refusal receipt cannot be reused as proof for that changed source.
    f.write(file,'export function isExpectedAuthLanding() { return true; }\nexport function isProgressRoutePathname() { return true; }\n');
    assert.throws(()=>validateVitestExecution(receipt,expected,f.directory),/snapshot changed/);
  } finally {f.clean();}
});

test('renamed callable or removed consumer cannot borrow an available helper route',()=>{
  const f=fixture();
  try {
    assert.equal(executionRoute(contract.helperFile,f.directory).applicable,true);
    const original=fs.readFileSync(path.join(f.directory,contract.helperFile),'utf8');
    f.write(contract.helperFile,original.replace(contract.callables[0],`renamed_${contract.callables[0]}`));
    assert.equal(executionRoute(contract.helperFile,f.directory).applicable,false);
    f.write(contract.helperFile,original);fs.unlinkSync(path.join(f.directory,contract.testFile));
    assert.equal(executionRoute(contract.helperFile,f.directory).applicable,false);
  } finally {f.clean();}
});

// Explicitly synthetic: these fixtures test the validation boundary, never prove
// a real worker ran. Installed-runtime controls below retain genuine provider output.
function synthetic(prepare = () => {}) {
  const f = fixture();
  prepare(f);
  const cwd = f.directory;
  const source = fs.readFileSync(path.join(cwd,contract.helperFile),'utf8');
  const filename = path.join(cwd,contract.helperFile);
  const url = pathToFileURL(filename).href;
  const binding = {phaseId:randomUUID(),cwd,coverageDirectory:path.join(cwd,'.helper-coverage-fixture'),
    helper:{...contract,sourceBinding:helperSourceBinding(cwd,contract)}};
  const functions=contract.callables.map(name=>{const start=source.indexOf(`function ${name}`);return {functionName:name,isBlockCoverage:true,
    ranges:[{startOffset:start,endOffset:source.indexOf('\n',start),count:1}]};});
  const fnMap=Object.fromEntries(contract.callables.map((name,i)=>[String(i),{name,loc:{start:{line:i+1,column:7},end:{line:i+1,column:source.split('\n')[i].length}}}]));
  const {TraceMap,encodedMappings}=createRequire(path.join(root,'package.json'))('@jridgewell/trace-mapping');
  const map={version:3,sources:[url],sourcesContent:[source],names:[],mappings:source.split('\n')
    .map((line,row)=>Array.from({length:line.length+1},(_,column)=>[column,0,row,column]))};
  map.mappings=encodedMappings(new TraceMap(map));
  const conversion={filename:url,wrapperLength:0,sources:{originalSource:source,source,
    sourceMap:{sourcemap:map}},functions,
    converted:{[filename]:{path:filename,fnMap,f:{0:1,1:1,2:1}}}};
  conversion.beforeRemap={originalSourceSha256:hash(source),generatedSourceSha256:hash(source),
    sourceMapSha256:hash(JSON.stringify(conversion.sources.sourceMap)),functionsSha256:hash(JSON.stringify(functions))};
  const raw={schemaVersion:1,phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding)),
    options:{include:[contract.helperFile],exclude:[contract.testFile],reporter:[['json',{}]],reportsDirectory:binding.coverageDirectory,
      reportOnFailure:true,ignoreClassMethods:[],experimentalAstAwareRemapping:false,
      converter:binding.helper.sourceBinding.runtime,remappingMode:'legacy-v8-to-istanbul'},
    report:structuredClone(conversion.converted),
    frames:[{testFiles:[path.join(cwd,contract.testFile)],rawTestFiles:[contract.testFile],transformMode:'ssr',producer:{workerPid:123,
      phaseId:binding.phaseId,bindingSha256:hash(JSON.stringify(binding))},result:[{url,functions:structuredClone(functions)}]}],
    conversions:[conversion]};
  return {...f,binding,raw};
}

test('raw duplicate full-span ranges cannot normalize zero-call worker evidence into called credit',()=>{
  const f=synthetic();
  try {
    const raw=structuredClone(f.raw);
    const range=raw.frames[0].result[0].functions[0].ranges[0];
    raw.frames[0].result[0].functions[0].ranges=[{...range,count:0},{...range,count:1}];
    assert.throws(()=>validateHelperCoverage(raw,f.binding,f.directory),/raw helper/);
  } finally {f.clean();}
});

test('raw span validation rejects invalid counts, crossings, ordering and duplicate functions before normalization',()=>{
  const fn={functionName:'independentLoop',isBlockCoverage:true,ranges:[
    {startOffset:0,endOffset:100,count:2},
    {startOffset:10,endOffset:40,count:7},
    {startOffset:15,endOffset:20,count:3},
    {startOffset:40,endOffset:70,count:7},
  ]};
  assert.equal(validateRawHelperFunctions([fn],100).get('0:100').count,2);
  for(const change of [
    x=>{x[0].ranges[1].count=-1;},x=>{x[0].ranges[1].count=NaN;},
    x=>{x[0].ranges[1].count=Infinity;},x=>{x[0].ranges[1].count=1.5;},
    x=>{x[0].ranges[1].endOffset=101;},x=>{x[0].ranges[1].startOffset=-1;},
    x=>{x[0].ranges[1].startOffset=10.5;},x=>{x[0].ranges[1].endOffset=10;},
    x=>{x[0].ranges[2].endOffset=50;},x=>{x[0].ranges[3].startOffset=5;},
    x=>{x[0].ranges[0].count=0;},x=>{x[0].ranges[1].count=0;},
    x=>{x[0].isBlockCoverage=false;},x=>{x.push(structuredClone(x[0]));},
    x=>{x[0].ranges.splice(1,0,{...x[0].ranges[0]});},
  ]) {
    const invalid=[structuredClone(fn)];change(invalid);
    assert.throws(()=>validateRawHelperFunctions(invalid,100),/raw helper/);
    assert.throws(()=>normalizedHelperWorkerFunctions(root,[{url:'file:///loop.js',functions:invalid}],100),/raw helper/);
  }
});

test('synthetic helper receipt requires mapped callable hits, not module/import presence',()=>{
  const f=synthetic();
  try {
    const accepted=validateHelperCoverage(f.raw,f.binding,f.directory);
    assert.deepEqual(accepted.executed.map(item=>item.name),contract.callables);
    f.raw.conversions[0].functions[0].ranges[0].count=0;
    f.raw.frames[0].result[0].functions[0].ranges[0].count=0;
    f.raw.conversions[0].beforeRemap.functionsSha256=hash(JSON.stringify(f.raw.conversions[0].functions));
    assert.throws(()=>validateHelperCoverage(f.raw,f.binding,f.directory),/Uncalled helper/);
  } finally {f.clean();}
});

test('helper coverage config is dedicated, explicit and retains failing-phase output',()=>{
  const f=synthetic();
  try {
    const before=fs.readFileSync(path.join(f.directory,'frontend/vitest.config.mjs'));
    const options=helperCoverageOptions(f.directory,f.binding);
    assert.equal(options.reportOnFailure,true);assert.equal(options.clean,true);
    assert.deepEqual(options.include,[contract.helperFile]);assert.deepEqual(options.reporter,['json']);
    assert.equal(options.thresholds,undefined);
    assert.deepEqual(fs.readFileSync(path.join(f.directory,'frontend/vitest.config.mjs')),before);
  } finally {f.clean();}
});

test('rejects stale phase/worker/config/source-map identities and incomplete or aliased ranges',()=>{
  const f=synthetic();
  try {
    for (const alter of [
      raw=>{raw.phaseId=randomUUID();},raw=>{raw.bindingSha256='wrong';},raw=>{raw.frames=[];},
      raw=>{raw.frames[0].producer.phaseId=randomUUID();},raw=>{raw.frames[0].testFiles=['/other'];},
      raw=>{raw.frames[0].rawTestFiles=['./'+contract.testFile];},
      raw=>{raw.options.reportOnFailure=false;},raw=>{raw.options.ignoreClassMethods=['classifyMarkerTiming'];},
      raw=>{raw.options.converter.normalizer.sources[0].sha256='0'.repeat(64);},
      raw=>{raw.frames[0].result[0].functions[0].ranges[0].count++;},
      raw=>{raw.conversions=[];},raw=>{raw.conversions[0].filename+='?alias';},
      raw=>{raw.conversions[0].sources.sourceMap.sourcemap.sources=['file:///outside.ts'];},
      raw=>{raw.conversions[0].sources.sourceMap.sourcemap.sourcesContent=['wrong'];},
      raw=>{raw.conversions[0].sources.sourceMap.sourcemap.mappings='';},
      raw=>{raw.conversions[0].sources.sourceMap.sourcemap.ignoreList=[0];},
      raw=>{raw.conversions[0].sources.sourceMap.sourcemap.mappings=';AACA;AACA';},
      raw=>{raw.conversions[0].functions[0].ranges[0].endOffset=1e9;},
      raw=>{raw.conversions[0].converted[Object.keys(raw.conversions[0].converted)[0]].f[0]=0;},
      raw=>{raw.report={};},
    ]) {
      const raw=structuredClone(f.raw);alter(raw);
      assert.throws(()=>validateHelperCoverage(raw,f.binding,f.directory));
    }
    f.write(contract.helperFile,fs.readFileSync(path.join(f.directory,contract.helperFile),'utf8')+'// changed\n');
    assert.throws(()=>validateHelperCoverage(f.raw,f.binding,f.directory),/Stale helper/);
  } finally {f.clean();}
});

test('helper source symlinks are refused before coverage artifacts are trusted',()=>{
  const f=fixture();
  try {
    const original=path.join(f.directory,contract.helperFile);
    fs.renameSync(original,original+'.preserved');
    fs.symlinkSync(original+'.preserved',original);
    assert.throws(()=>helperSourceBinding(f.directory,contract),/Aliased helper source/);
  } finally {f.clean();}
});

test('coverage ignore directives cannot turn an uncalled function into executed credit',()=>{
  const f=synthetic();
  try {
    for(const directive of ['/* c8 ignore next */','/* v8 ignore start */','/* istanbul ignore next */']) {
      const original=fs.readFileSync(path.join(f.directory,contract.helperFile));
      f.write(contract.helperFile,directive+'\n'+original);
      assert.throws(()=>helperSourceBinding(f.directory,contract),/Coverage-ignore/);
      f.write(contract.helperFile,original);
    }
  } finally {f.clean();}
});

test('self-consistent remapped spans reject out-of-bounds, reversed, empty and wrong-body columns',()=>{
  const f=synthetic();
  try {
    for(const location of [
      {start:{line:1,column:999999},end:{line:1,column:0}},
      {start:{line:1,column:25},end:{line:1,column:7}},
      {start:{line:1,column:7},end:{line:1,column:7}},
      {start:{line:1,column:7},end:{line:1,column:20}},
      {start:{line:1,column:8},end:{line:1,column:f.raw.conversions[0].sources.originalSource.split('\n')[0].length}},
    ]) {
      const raw=structuredClone(f.raw);
      const file=Object.keys(raw.conversions[0].converted)[0];
      raw.conversions[0].converted[file].fnMap['0'].loc=location;
      raw.report=structuredClone(raw.conversions[0].converted);
      assert.throws(()=>validateHelperCoverage(raw,f.binding,f.directory),/Invalid remapped callable span/);
    }
  } finally {f.clean();}
});

test('actual embedded converter bytes are explicit and a same-lock private installed mutation is refused',()=>{
  let privateProvider;
  const f=synthetic(fixture => {
    const require=createRequire(path.join(root,'package.json'));
    const originalPackage=path.dirname(require.resolve('@vitest/coverage-v8/package.json'));
    const privateModules=path.join(fixture.directory,'private-provider/node_modules');
    privateProvider=path.join(privateModules,'@vitest/coverage-v8');
    fs.mkdirSync(path.dirname(privateProvider),{recursive:true});
    fs.cpSync(originalPackage,privateProvider,{recursive:true});
    // Resolve only this provider from private bytes; the actual installed peers
    // continue to resolve through the fixture's existing dependency tree.
    fs.unlinkSync(path.join(fixture.directory,'node_modules'));
    fs.mkdirSync(path.join(fixture.directory,'node_modules/@vitest'),{recursive:true});
    fs.symlinkSync(privateProvider,path.join(fixture.directory,'node_modules/@vitest/coverage-v8'),'dir');
    for(const name of ['jsdom','typescript','@jridgewell/trace-mapping','@bcoe/v8-coverage','vite-node']) {
      const target=path.join(fixture.directory,'node_modules',name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.symlinkSync(path.dirname(require.resolve(`${name}/package.json`)),target,'dir');
    }
  });
  try {
    const before=helperRuntimeIdentity(f.directory);
    assert.ok(before.converter,'actual embedded converter must have its own explicit byte identity');
    assert.equal(before.converter.kind,'embedded-legacy-v8-to-istanbul');
    assert.equal(before.converter.providerModule,'@vitest/coverage-v8/dist/provider.js');
    assert.match(before.converter.sha256,/^[a-f0-9]{64}$/);
    const originalLock=fs.readFileSync(path.join(f.directory,'pnpm-lock.yaml'));
    const providerFile=path.join(privateProvider,'dist/provider.js');
    const original=fs.readFileSync(providerFile,'utf8');
    const needle='functions.f[`${index}`] = ignore ? 1 : fn.count;';
    assert.equal(original.split(needle).length,2);
    fs.writeFileSync(providerFile,original.replace(needle,'functions.f[`${index}`] = ignore ? 1 : fn.count + 1;'));
    assert.deepEqual(fs.readFileSync(path.join(f.directory,'pnpm-lock.yaml')),originalLock);
    const after=helperRuntimeIdentity(f.directory);
    assert.notEqual(after.converter.sha256,before.converter.sha256);
    assert.throws(()=>validateHelperCoverage(f.raw,f.binding,f.directory),/Stale helper source\/config\/runtime binding/);
    fs.writeFileSync(providerFile,original);
    assert.deepEqual(helperRuntimeIdentity(f.directory),before);
    assert.equal(validateHelperCoverage(f.raw,f.binding,f.directory).executed.length,3);
  } finally {f.clean();}
});

if(process.env.GITHUB_ACTIONS==='true'||process.env.TEST_EFFICACY_REAL_RUNTIME==='1') {
  test('INSTALLED exact recovery class methods require real mapped calls, not a neighboring passing body',()=>{
    const f=recoveryClassFixture();
    const base=f.git(['rev-parse','HEAD']);
    const retain=(name,payload)=>{
      const output=process.env.TEST_EFFICACY_CONTROL_OUTDIR;
      if(!output)return;
      assert.equal(path.isAbsolute(output),true);
      fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,`${name}-${randomUUID()}.json`),JSON.stringify(payload),{flag:'wx'});
    };
    const run=()=>{
      const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      const receipt=runVitestExecution({root:f.directory,base,provenance:expected});
      assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)].sort(),[f.helper,f.consumer].sort());
      return receipt;
    };
    try {
      let first;
      try {first=run();}catch(error){retain('class-positive-refusal',{message:error.message,diagnostics:error.diagnostics});throw error;}
      const executed=first.tests[0].phase.helperCoverage.validated.executed;
      assert.deepEqual(executed.map(item=>item.name),['SessionCreateBinding#onRequest','SessionCreateBinding#binding',
        'SessionCreateBinding#readBinding','SessionCreateBinding#detach','recoveryFenceRow']);
      assert.ok(executed.every(item=>item.count>0));
      retain('class-positive',{scope:'synthetic class, actual installed V8 provider and independent validator; no journey acceptance',receipt:first});
      f.write(f.consumer,f.testSource.replace('expect(binding.binding()).toBe(5);','expect(2+3).toBe(5);'));
      assert.throws(run,error=>{
        retain('class-uncalled-refusal',{message:error.message,diagnostics:error.diagnostics});
        assert.match(error.message,/Uncalled helper|Helper remapped callable not executed/);
        assert.equal(error.diagnostics.status,0,'passing consumer is insufficient when the named method was never called');
        assert.equal(error.diagnostics.report.success,true);
        return true;
      });
      f.write(f.consumer,f.testSource);
      f.write(f.helper,f.source.replace('return this.readBinding();','return 5;'));
      assert.throws(run,error=>{
        retain('class-private-method-uncalled',{message:error.message,diagnostics:error.diagnostics});
        assert.match(error.message,/Uncalled helper: SessionCreateBinding#readBinding|Helper remapped callable not executed: SessionCreateBinding#readBinding/);
        assert.equal(error.diagnostics.status,0);
        assert.equal(error.diagnostics.report.success,true,'all public calls passing must not hide an uncalled registered private method');
        return true;
      });
      f.write(f.helper,f.source);
      const restored=run();
      assert.equal(restored.tests[0].phase.inputSha256,first.tests[0].phase.inputSha256);
      retain('class-restored',{receipt:restored});
    }finally{f.clean();}
  });

  test('INSTALLED mixed helper and baseline source retain real supported execution but refuse overall qualification',()=>{
    const f=fixture();
    try {
      const base=f.git(['rev-parse','HEAD']);
      f.write(contract.helperFile,fs.readFileSync(path.join(f.directory,contract.helperFile),'utf8')+'\n');
      const landing='tests/e2e/canaryLanding.ts';
      const source='tests/canary/smoke.canary.spec.ts';
      f.write(landing,'export function isExpectedAuthLanding() { return true; }\n');
      f.write(source,"import {test} from '@playwright/test'; test('baseline',async()=>{});\n");
      const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      for(const [run,kind,unsupported] of [[runVitestExecution,'changed-evidence',[landing,source]],
        [runVitestHelperExecution,'registered-helpers',[landing]]]) {
        const receipt=run({root:f.directory,base,provenance:expected});
        assert.equal(receipt.executionKind,kind);assert.equal(receipt.status,'incomplete');
        assert.deepEqual(receipt.unavailable.map(item=>item.file).sort(),unsupported.sort());
        assert.equal(receipt.tests.length,1);assert.equal(receipt.tests[0].helperFile,contract.helperFile);
        assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)],[contract.helperFile]);
        const coverage=executionCoverage(changedEvidencePaths(f.directory,base),{root:f.directory,base,expected,execution:receipt});
        assert.equal(coverage.rows.find(row=>row.file===contract.helperFile).status,'EXECUTED');
        for(const file of [landing,source]) assert.equal(coverage.rows.find(row=>row.file===file).status,'NOT RUN');
        assert.equal(coverage.status,'INCOMPLETE');
        const forged=structuredClone(receipt);forged.unavailable=[];forged.status='executed';
        assert.throws(()=>validateVitestExecution(forged,expected,f.directory),/unsupported execution inventory/);
      }
    } finally {f.clean();}
  });
  test('INSTALLED typed arrow spans bind only the parameter/declaration and terminal-semicolon boundaries',()=>{
    const f=fixture();
    try {
      f.write(contract.helperFile,contract.callables.map(name=>`export const ${name} = (a: number = 2, b: number = 3): number => {\n  return a + b;\n};`).join('\n')+'\n');
      const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      const receipt=runVitestHelperExecution({root:f.directory,base:f.git(['rev-parse','HEAD']),provenance:expected});
      assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)],[contract.helperFile]);
      for(const alter of [loc=>{loc.start.column++;},loc=>{loc.end.column+=2;}]) {
        const raw=structuredClone(receipt.tests[0].phase.helperCoverage.raw);
        const filename=Object.keys(raw.report)[0];alter(raw.report[filename].fnMap['0'].loc);
        raw.conversions[0].converted=structuredClone(raw.report);
        assert.throws(()=>validateHelperCoverage(raw,receipt.tests[0].phase.binding,f.directory),/Invalid remapped callable span/);
      }
    } finally {f.clean();}
  });
  test('INSTALLED async declarations require the exact mapped declaration boundary',()=>{
    const f=fixture();
    try {
      f.write(contract.helperFile,contract.callables.map(name=>`export async function ${name}(a = 2, b = 3) { return a + b; }`).join('\n')+'\n');
      f.write(contract.testFile,`import {test,expect} from 'vitest';\nimport {${contract.callables.join(',')}} from '../live/helpers/rwtMarkerObserver';\n`
        +contract.callables.map(name=>`test('${name} awaits the actual result',async()=>expect(await ${name}(2,3)).toBe(5));`).join('\n')+'\n');
      const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      const receipt=runVitestHelperExecution({root:f.directory,base:f.git(['rev-parse','HEAD']),provenance:expected});
      assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)],[contract.helperFile]);
      const raw=structuredClone(receipt.tests[0].phase.helperCoverage.raw);
      const filename=Object.keys(raw.report)[0];
      raw.report[filename].fnMap['0'].loc.start.column++;
      raw.conversions[0].converted=structuredClone(raw.report);
      assert.throws(()=>validateHelperCoverage(raw,receipt.tests[0].phase.binding,f.directory),/Invalid remapped callable span/);
    } finally {f.clean();}
  });
  test('INSTALLED arrow callables retain real V8 ranges, exact mapped spans and count checks',()=>{
    const f=fixture();
    try {
      f.write(contract.helperFile,contract.callables.map(name=>`export const ${name} = (a = 2, b = 3) => a + b;`).join('\n')+'\n');
      const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
      const receipt=runVitestHelperExecution({root:f.directory,base:f.git(['rev-parse','HEAD']),provenance:expected});
      assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)],[contract.helperFile]);
      assert.equal(receipt.tests[0].phase.helperCoverage.validated.executed.length,3);
      const raw=structuredClone(receipt.tests[0].phase.helperCoverage.raw);
      const binding=receipt.tests[0].phase.binding;
      const filename=Object.keys(raw.report)[0];
      const fn=Object.keys(raw.report[filename].fnMap)[0];
      raw.report[filename].fnMap[fn].loc.start.column++;
      raw.conversions[0].converted=structuredClone(raw.report);
      assert.throws(()=>validateHelperCoverage(raw,binding,f.directory),/Invalid remapped callable span/);
    } finally {f.clean();}
  });
  test('INSTALLED helper provider: actual calls qualify, static reads/type imports/uncalled helper refuse, restoration is exact',()=>{
    const f=fixture();
    try {
      const before=fs.readFileSync(path.join(f.directory,contract.testFile));
      const run=()=>{
        const expected=executionContext(f.directory,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
        let receipt;
        try { receipt=runVitestHelperExecution({root:f.directory,base:f.git(['rev-parse','HEAD']),provenance:expected}); }
        catch(error) {throw new Error(JSON.stringify({message:error.message,diagnostics:error.diagnostics,outcomes:error.testOutcomes}));}
        assert.deepEqual([...validateVitestExecution(receipt,expected,f.directory)],[contract.helperFile]);
        return receipt;
      };
      const first=run();assert.equal(first.tests[0].phase.helperCoverage.validated.executed.length,3);
      for(const code of [
        `import {test,expect} from 'vitest';import {readFileSync} from 'node:fs';test('only reads source',()=>expect(readFileSync('${contract.helperFile}','utf8')).toContain('classifyMarkerTiming'));`,
        `import {test,expect} from 'vitest';import type {} from '../live/helpers/rwtMarkerObserver';test('type only',()=>expect(2+3).toBe(5));`,
        `import {test,expect} from 'vitest';import * as helper from '../live/helpers/rwtMarkerObserver';test('module only',()=>expect(typeof helper.classifyMarkerTiming).toBe('function'));`,
      ]) {
        f.write(contract.testFile,code+'\n');
        assert.throws(run,/Missing\/duplicate helper worker or map|Wrong helper raw range|Missing\/ambiguous helper callable|Uncalled helper|Helper raw range\/worker mismatch/);
      }
      f.write(contract.testFile,before);
      const restored=run();assert.equal(restored.tests[0].phase.inputSha256,first.tests[0].phase.inputSha256);
    } finally {f.clean();}
  });

  test('INSTALLED actual writer: helper calls qualify, source-reading replacement refuses, exact restored source qualifies',()=>{
    const f=fixture();
    const evidence=path.join(f.directory,'product_release/evidence/software-quality.latest.json');
    const original=fs.readFileSync(path.join(f.directory,contract.testFile));
    try {
      f.write('test-results/metrics.json',JSON.stringify({unit_tests:{passed:6,failed:0,skipped:0,total:6,
        testFiles:MEANINGFUL_COVERAGE_MANIFEST.map(item=>item.testFile),skippedTestFiles:[]},
        e2e_tests:{passed:1,failed:0,skipped:0,total:1},coverage:{statements:80,branches:80,functions:80,lines:80},
        performance:{initial_chunk_size:'412K'},total_runtime_seconds:120}));
      const head=f.git(['rev-parse','HEAD']);
      f.write(contract.helperFile,fs.readFileSync(path.join(f.directory,contract.helperFile),'utf8')+'\n');
      const run=()=>{
        try {
          execFileSync(process.execPath,['scripts/write-software-quality-evidence.mjs'],{cwd:f.directory,
            env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_SHA:head,GITHUB_RUN_ID:'902',GITHUB_RUN_ATTEMPT:'1',
              TEST_EFFICACY_BASE:head,SOFTWARE_QUALITY_INVOCATION:randomUUID()},stdio:['ignore','pipe','pipe'],timeout:60000});
          return {status:0,stderr:''};
        } catch(error) {return {status:error.status,stderr:error.stderr?.toString() || String(error)};}
      };
      let result=run();assert.equal(result.status,0,result.stderr);
      let output=JSON.parse(fs.readFileSync(evidence,'utf8'));
      const firstSnapshot=output.provenance.snapshotSha256;
      assert.equal(output.executionCoverage.rows.find(row=>row.file===contract.helperFile)?.status,'EXECUTED');
      f.write(contract.testFile,"import {test,expect} from 'vitest';import {readFileSync} from 'node:fs';test('only reads helper source',()=>expect(readFileSync('tests/live/helpers/rwtMarkerObserver.ts','utf8')).toContain('classifyMarkerTiming'));\n");
      result=run();assert.equal(result.status,1,result.stderr);
      assert.match(result.stderr,/Missing\/duplicate helper worker or map|Uncalled helper|Wrong helper worker provenance/);
      assert.equal(fs.existsSync(evidence),false);
      f.write(contract.testFile,original);
      result=run();assert.equal(result.status,0,result.stderr);
      output=JSON.parse(fs.readFileSync(evidence,'utf8'));
      assert.equal(output.provenance.snapshotSha256,firstSnapshot,'writer restoration has identical source bytes');
      assert.equal(output.executionCoverage.rows.find(row=>row.file===contract.helperFile)?.status,'EXECUTED');
    } finally {f.clean();}
  });
}
