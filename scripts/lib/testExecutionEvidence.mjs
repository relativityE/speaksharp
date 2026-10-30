import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TEST_EFFICACY_CONTRACTS, qualifyEfficacyPhase } from './softwareQualityEvidenceQualification.mjs';
import { canonicalPath, runtimeIdentity } from '../efficacy-reporter.mjs';
import {HELPER_CONTRACTS,registeredHelper,helperApplicability, HELPER_CONFIG, validateHelperCoverage} from './helperExecutionEvidence.mjs';
import {registeredSourceContract,sourceContractApplicability,SOURCE_CONSUMER,validateSourceContractWitness} from './sourceContractEvidence.mjs';
import {validatePlaywrightExecution} from './playwrightExecutionEvidence.mjs';
import {nativeTestRoute,validateNativeReceipt,SQL_CONSUMER,SQL_INPUTS,sqlSourceBinding,validateSqlWitness} from './nativeTestExecutionEvidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('git', args, {cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
function sourceEntries(root) {
  // CI materializes this untracked package cache before testing. Git exclusions
  // apply only to --others: tracked paths remain source even under this directory.
  const files=[...new Set(git(root,['ls-files','-z','--cached','--others','--exclude-standard','--exclude=/apt-bundle/']).split('\0').filter(Boolean))].sort();
  const entries=files.map(file=> {
    const target=path.join(root,file);
    if (!fs.existsSync(target)) return [file,'deleted'];
    const stat=fs.lstatSync(target);
    if (!stat.isFile()) throw new Error(`Unsupported source entry: ${file}`);
    return [file,hash(fs.readFileSync(target)),stat.mode & 0o777];
  });
  return entries;
}
export function sourceIdentity(root) {
  return {commit:git(root,['rev-parse','HEAD']),tree:git(root,['rev-parse','HEAD^{tree}']),snapshotSha256:hash(JSON.stringify(sourceEntries(root)))};
}

// Resolve once in the invoking controller and pass the exact commit to both producers.
// Missing PR/push context must not silently turn a bounded comparison into the whole repository.
export function resolveComparisonBase(root, env=process.env) {
  const explicit=env.TEST_EFFICACY_BASE;
  if (explicit && explicit!=='0'.repeat(40)) {
    if (!/^[a-f0-9]{40}$/.test(explicit)) throw new Error('Diff base must be an exact commit SHA');
    const resolved=git(root,['rev-parse','--verify',`${explicit}^{commit}`]);
    if (resolved!==explicit) throw new Error('Diff base must name the commit itself');
    git(root,['merge-base','--is-ancestor',explicit,'HEAD']);
    return explicit;
  }
  if (env.GITHUB_ACTIONS==='true' && env.GITHUB_EVENT_NAME!=='workflow_dispatch') {
    throw new Error('Exact event comparison base required');
  }
  const branch=env.TEST_EFFICACY_DEFAULT_BRANCH || 'main';
  // check-ref-format validates the branch without interpreting it as a revision or option.
  git(root,['check-ref-format',`refs/heads/${branch}`]);
  try {
    const tip=git(root,['rev-parse','--verify',`refs/remotes/origin/${branch}^{commit}`]);
    const head=git(root,['rev-parse','HEAD']);
    const common=git(root,['merge-base','HEAD',tip]);
    // A manual main run compares its last change; a feature run compares its fork point.
    return common===head ? git(root,['rev-parse','--verify','HEAD^1']) : common;
  } catch (cause) {
    throw new Error('Exact comparison base unavailable; provide TEST_EFFICACY_BASE or fetched default-branch history', {cause});
  }
}

export function executionContext(root, env=process.env) {
  const invocation=env.SOFTWARE_QUALITY_INVOCATION;
  if (!invocation || !/^[a-f0-9-]{36}$/.test(invocation)) throw new Error('Fresh SOFTWARE_QUALITY_INVOCATION required');
  const identity=sourceIdentity(root);
  const ci=env.GITHUB_ACTIONS==='true';
  if (ci && (!/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '')
    || env.GITHUB_SHA!==identity.commit)) throw new Error('Missing or wrong-head CI run/attempt identity');
  return {schemaVersion:1,invocation,source:ci?'github-actions':'local',
    runId:ci?env.GITHUB_RUN_ID:null,runAttempt:ci?env.GITHUB_RUN_ATTEMPT:null,...identity};
}

export function assertProvenance(actual, expected) {
  if (expected?.schemaVersion!==1 || !expected.invocation
    || !/^[a-f0-9]{40}$/.test(expected.commit || '') || !/^[a-f0-9]{40}$/.test(expected.tree || '')
    || !/^[a-f0-9]{64}$/.test(expected.snapshotSha256 || '') || !['local','github-actions'].includes(expected.source)
    || (expected.source==='github-actions' && (!/^\d+$/.test(expected.runId || '') || !/^\d+$/.test(expected.runAttempt || '')))
    || !actual || Object.keys(expected).some(key=>actual[key]!==expected[key])) {
    throw new Error('Missing, stale, wrong-head or wrong-attempt evidence provenance');
  }
}

// No inherited tokens, proxy settings, NODE_OPTIONS/NODE_PATH, package-manager hooks or PATH.
// Fixed mock values match frontend/tests/setup.ts; they are not credentials.
export function testEnvironment(directory, binding, envelopeFile) {
  const home=path.join(directory,'.efficacy-home');
  const temp=path.join(directory,'.efficacy-tmp');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(temp,{recursive:true});
  return {PATH:[path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter),
    HOME:home,USERPROFILE:home,TMPDIR:temp,TMP:temp,TEMP:temp,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',
    CI:'true',NODE_ENV:'test',NODE_V8_COVERAGE:'',VITEST_MAX_FORKS:'1',
    VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_ANON_KEY:'test-anon-key',
    TEST_EFFICACY_BINDING:JSON.stringify(binding),TEST_EFFICACY_ENVELOPE:envelopeFile};
}

// One immutable data input, not a generic exemption for fixtures. Its consumer must actually
// execute the named old/current workflow control and return a phase-bound consumption witness.
const workflowFixture = Object.freeze({
  fixtureFile:'tests/fixtures/efficacy/service-level-evidence.adfeab34.yml',
  testFile:'tests/unit/testExecutionEvidence.test.js',
  assertion:'INSTALLED upload layout → workflow staging → maintained paired command preserves CI origin and new invocation',
  sha256:'bbe2873647d2c3f922c70d10fb9f05b4b4e360106a19bb0de00c64b771a0db56',
});
const retentionPinsFixture = Object.freeze({
  fixtureFile:'tests/db/retention-owner-matrix-pins.json',
  testFile:'tests/unit/retentionCurrentContractMatrix.test.js',
  assertion:'retention pin fixture is consumed by the actual workflow resolver with failure controls',
  sha256:'e2284ebe3a3b499df71da7a5c24ab577e34affa3fe5e23c4cfa0955eaf22d95c',
  consumerSha256:'a5284e74aae74495c7ddd747c437c1ee0dc5b2e2899c9220a31c5c90172dcbec',
  workflowFile:'.github/workflows/retention-current-contract-matrix.yml', protocol:'retention-pins',
  workflowSha256:'1531c95c1fa19558fba0eecf34a76e9c66073a1f5f41785d1461b7045a1d02b7',
  resolverSha256:'63935ffc8708aba82aa2721b224cd4da3c3a2e3d19b748477ec469d6478fdfd3',
});
export const registeredFixture = file => file === workflowFixture.fixtureFile ? workflowFixture
  : file === retentionPinsFixture.fixtureFile ? retentionPinsFixture : null;

export function fixturePackageManagerIdentity(root, env=process.env) {
  const pin=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).packageManager;
  const version=/^pnpm@(\d+\.\d+\.\d+)$/.exec(pin || '')?.[1];
  if(!version) throw new Error('Unsupported fixture package-manager pin');
  // Resolve installed bytes only. Corepack's supported v1 cache is read, never populated or downloaded.
  const corepackHome=env.COREPACK_HOME ?? path.join(env.XDG_CACHE_HOME ?? env.LOCALAPPDATA
    ?? path.join(os.homedir(),process.platform==='win32'?'AppData/Local':'.cache'),'node/corepack');
  const candidates=[env.npm_execpath,...(env.PATH || '').split(path.delimiter).filter(path.isAbsolute).map(p=>path.join(p,'pnpm')),
    path.join(corepackHome,'v1','pnpm',version,'bin/pnpm.cjs')];
  for(const candidate of candidates) {
    if(!candidate || !path.isAbsolute(candidate)) continue;
    try {
      const entry=fs.realpathSync(candidate);
      const packageFile=path.join(path.dirname(entry),'../package.json');
      const bytes=fs.readFileSync(packageFile),metadata=JSON.parse(bytes);
      if(metadata.name!=='pnpm' || metadata.version!==version || path.basename(entry)!=='pnpm.cjs') continue;
      return {entry,version,entrySha256:hash(fs.readFileSync(entry)),packageSha256:hash(bytes)};
    } catch { /* An uninstalled or non-pnpm candidate is not a usable runtime. */ }
  }
  throw new Error('NOT RUN: pinned installed pnpm runtime unavailable for fixture consumer');
}

export function fixtureSourceBinding(root, fixtureFile) {
  const contract=registeredFixture(fixtureFile);
  if(!contract) throw new Error('Unregistered fixture input');
  const sources=[contract.fixtureFile,contract.testFile,...(contract.workflowFile?[contract.workflowFile]:[])].map(file=>{
    const target=path.join(root,file);
    if(!fs.lstatSync(target).isFile() || fs.realpathSync(target)!==target) throw new Error('Aliased fixture input or consumer');
    return {file,sha256:hash(fs.readFileSync(target))};
  });
  if(sources[0].sha256!==contract.sha256) throw new Error('Historical fixture bytes differ from the pinned input');
  if(contract.protocol==='retention-pins') {
    if(sources[1].sha256!==contract.consumerSha256)throw new Error('Reviewed retention fixture consumer bytes differ');
    if(sources[2].sha256!==contract.workflowSha256)throw new Error('Reviewed retention workflow bytes differ');
    const execPath=fs.realpathSync(process.execPath);
    return {sources,node:{execPath,version:process.version,sha256:hash(fs.readFileSync(execPath))}};
  }
  return {sources,packageManager:fixturePackageManagerIdentity(root)};
}

export function validateFixtureWitness(raw,binding,root,report,envelope) {
  const contract=registeredFixture(binding?.fixture?.fixtureFile);
  if(!contract || binding.fixture.testFile!==contract.testFile
    || binding.fixture.witnessFile!==path.join(binding.cwd,`.fixture-${binding.phaseId}.json`)
    || JSON.stringify(binding.fixture.sourceBinding)!==JSON.stringify(fixtureSourceBinding(root,contract.fixtureFile))) {
    throw new Error('Wrong or stale fixture/consumer/runtime binding');
  }
  const assertions=report?.testResults?.flatMap(file=>file.assertionResults || []) || [];
  const matches=assertions.filter(test=>test.fullName===contract.assertion);
  const tasks=envelope?.finished?.files?.flatMap(file=>file.tasks || [])
    .filter(task=>task.type==='test' && task.name===contract.assertion) || [];
  const validCount=contract.protocol==='retention-pins'
    ? assertions.length>0 && assertions.every(test=>test.status==='passed') : assertions.length===1;
  if(!validCount || matches.length!==1 || matches[0].status!=='passed' || tasks.length!==1 || tasks[0].result?.state!=='pass') {
    throw new Error('Registered fixture consumer was not executed successfully');
  }
  if(contract.protocol==='retention-pins') {
    const pins=JSON.parse(fs.readFileSync(path.join(root,contract.fixtureFile),'utf8'));
    const expected=pins.versions.map(pin=>({major:pin.major,status:0,signal:null,error:null,refused:false,
      output:`version=${pin.version}\nsha256=${pin.sha256}\n`}));
    const refused=major=>({major,status:1,signal:null,error:null,refused:true,output:null});
    if(raw?.schemaVersion!==2 || raw.phaseId!==binding.phaseId || raw.bindingSha256!==hash(JSON.stringify(binding))
      || raw.fixtureFile!==contract.fixtureFile || raw.fixtureSha256!==contract.sha256 || raw.assertion!==contract.assertion
      || raw.workflowSha256!==contract.workflowSha256 || raw.resolverSha256!==contract.resolverSha256
      || JSON.stringify(raw.observations)!==JSON.stringify(expected)
      || JSON.stringify(raw.unknown)!==JSON.stringify(refused(99))
      || JSON.stringify(raw.malformed)!==JSON.stringify(refused(pins.versions[0].major))) {
      throw new Error('Missing or invalid actual retention pin consumption witness');
    }
    return contract.fixtureFile;
  }
  if(raw?.schemaVersion!==1 || raw.phaseId!==binding.phaseId || raw.bindingSha256!==hash(JSON.stringify(binding))
    || raw.fixtureFile!==contract.fixtureFile || raw.fixtureSha256!==contract.sha256 || raw.assertion!==contract.assertion
    || raw.old?.status!==1 || raw.old?.signal!==null || raw.old?.error!==null
    || !/Metrics artifact not found/.test(raw.old?.stderr || '')
    || raw.current?.status!==0 || raw.current?.signal!==null || raw.current?.error!==null) {
    throw new Error('Missing or invalid actual fixture consumption witness');
  }
  return contract.fixtureFile;
}

// Explicit examples, not a purported product inventory. Other SQL/fixture paths are UNCOVERED.
const sqlConsumers = {
  'tests/db/focus-points-trial-capability-bootstrap.sql': {runner:'vitest-pglite',consumer:'tests/db/focus-points-trial-capability.integration.test.ts'},
  'tests/db/focus-points-trial-capability-matrix.sql': {runner:'vitest-pglite',consumer:'tests/db/focus-points-trial-capability.integration.test.ts'},
  'tests/db/account-closure-full-chain.sql': {runner:'node-postgres',consumer:'tests/db/account-closure-full-chain.mjs'},
  'tests/db/account-closure-denial-control.sql': {runner:'node-postgres',consumer:'tests/db/account-closure-full-chain.mjs'},
};
export function executionRoute(file, root) {
  const fixture=registeredFixture(file);
  if(fixture) return {runner:'vitest-fixture',consumer:fixture.testFile,config:'frontend/vitest.config.mjs'};
  const helper = registeredHelper(file);
  if (helper) {
    const availability=helperApplicability(root,file);
    return {runner:'vitest-helper',consumer:helper.testFile,config:HELPER_CONFIG,applicable:availability.supported,
      ...(!availability.supported?{unavailableReason:availability.reason}:{})};
  }
  if (registeredSourceContract(file)) {
    const availability=sourceContractApplicability(root,file);
    return {runner:'vitest-source-contract',consumer:SOURCE_CONSUMER,config:'frontend/vitest.config.mjs',liveExecution:'NOT RUN',
      applicable:availability.supported,...(!availability.supported?{unavailableReason:availability.reason}:{})};
  }
  const native=nativeTestRoute(file,root);
  if(native)return native;
  if (sqlConsumers[file]) return sqlConsumers[file];
  if (file.endsWith('.sql')) return null;
  if (/^backend\/supabase\/functions\/.*(?:\.test|_test)\.ts$/.test(file)) {
    return {runner:'deno',consumer:file,config:'backend/supabase/functions/deno.json'};
  }
  // The cloud-test package's Python controls have a runner but no approved CI runtime yet: routed, never credited.
  if (/^tools\/cloud-test\/(?:.*\/)?test_[^/]+\.py$/.test(file)) {
    return {runner:'python-unittest',consumer:file,applicable:false,unavailableReason:'NOT RUN: no approved Python runtime binding'};
  }
  if (/^tests\/e2e\/.*\.spec\.[jt]s$/.test(file)) return {runner:'playwright',consumer:file,config:'playwright.config.ts'};
  if (/^tests\/live\/.*\.spec\.[jt]s$/.test(file)) return {runner:'playwright-live',consumer:file,config:'playwright.live.config.ts'};
  if (/\.test\.mjs$/.test(file) && fs.existsSync(path.join(root,file))
    && /from\s+['"]node:test['"]/.test(fs.readFileSync(path.join(root,file),'utf8'))) {
    return {runner:'node-test',consumer:file};
  }
  // Mirrors the explicit include/exclude extensions in frontend/vitest.config.mjs.
  if (/^(frontend\/(src|tests)\/|tests\/).*\.test\.[jt]sx?$/.test(file)) {
    return {runner:'vitest',consumer:file,config:'frontend/vitest.config.mjs'};
  }
  return null;
}

function changedPaths(root, base) {
  if (base && !/^[a-f0-9]{40}$/.test(base)) throw new Error('Diff base must be an exact commit SHA');
  const all=git(root,['ls-files','-z','--cached','--others','--exclude-standard','--exclude=/apt-bundle/']).split('\0');
  const files=base && !/^0+$/.test(base) ? [
    ...git(root,['diff','--name-only','-z',base,'HEAD']).split('\0'),
    ...git(root,['diff','--name-only','-z','HEAD']).split('\0'),
    ...git(root,['ls-files','-z','--others','--exclude-standard','--exclude=/apt-bundle/']).split('\0'),
  ] : all;
  return [...new Set(files.filter(Boolean))].sort();
}
export function changedEvidencePaths(root, base) {
  // Deletions still affect raw change/pilot applicability, but cannot be executed.
  // lstat retains malformed existing entries (including dangling links) for refusal.
  // Python unittest modules are named test_*.py; outside tests/ they were silently omitted, not reported UNCOVERED.
  return changedPaths(root,base).filter(file=>/^(tests\/|frontend\/tests\/|backend\/supabase\/functions\/.*(?:test|fixture))|\/(?:__tests__|__mocks__|fixtures|mocks)\/|\.(?:test|spec)\.|\.sql$|(?:^|\/)test_[^/]+\.py$/.test(file)
    && fs.lstatSync(path.join(root,file),{throwIfNoEntry:false})!==undefined);
}

export function executionRequiredFiles(root,base,kind='changed-evidence') {
  if(kind==='changed-evidence') return changedEvidencePaths(root,base);
  if(kind!=='registered-helpers') throw new Error('Unknown execution selection kind');
  return HELPER_CONTRACTS.map(contract=>contract.helperFile)
    .filter(file=>fs.lstatSync(path.join(root,file),{throwIfNoEntry:false})!==undefined).sort();
}

export function unavailableExecutionInputs(root,files) {
  return [...new Set(files)].sort().flatMap(file=>{
    const route=executionRoute(file,root);
    return route?.applicable===false?[{file,reason:route.unavailableReason}]:[];
  });
}
// Shared conservative policy; the consumer supplies the actual Git diff, not receipt claims.
export function pilotAffectedByPaths(files) {
  return files===null || files.some(file=>/^(scripts\/|tests\/unit\/testEfficacy\.test\.js$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|frontend\/(src\/|package\.json|vitest\.config\.mjs|tsconfig[^/]*\.json|tests\/)|\.github\/)/.test(file));
}
function expectedPhaseInputs(root, expected, contract) {
  const entries=sourceEntries(root);
  if (hash(JSON.stringify(entries))!==expected.snapshotSha256) throw new Error('Reviewed source snapshot changed');
  const original=fs.readFileSync(path.join(root,contract.sourceFile));
  const transform=(bytes,change)=>{
    const source=bytes.toString('utf8');
    if (!change.anchor || change.anchor===change.replacement || source.split(change.anchor).length!==2) {
      throw new Error('Invalid registered transformation');
    }
    return Buffer.from(source.replace(change.anchor,()=>change.replacement));
  };
  const neutral=contract.control.reduce(transform,original);
  const mutations=contract.mutants.map(change=>transform(original,change));
  const sourceHashes=[original,neutral,...mutations,original].map(hash);
  if (new Set(sourceHashes.slice(0,-1)).size!==4) throw new Error('Registered phases do not change distinct source bytes');
  return sourceHashes.map(sourceHash=>hash(JSON.stringify(entries.filter(([,digest])=>digest!=='deleted')
    .map(([file,digest])=>[file,file===contract.sourceFile?sourceHash:digest]))));
}

export function validatePilotExecution(receipt, expected, root) {
  assertProvenance(receipt?.provenance,expected);
  for (const key of ['commit','tree','snapshotSha256']) {
    if (receipt[key]!==expected[key]) throw new Error(`Pilot ${key} differs from source`);
  }
  if (receipt.status!=='executed' || receipt.contracts?.length!==1) throw new Error('Pilot NOT RUN or missing');
  const contract=TEST_EFFICACY_CONTRACTS[0];
  const result=receipt.contracts[0];
  if (result.id!==contract.id || result.testFile!==contract.testFile || result.sourceFile!==contract.sourceFile
    || result.testSha256!==hash(fs.readFileSync(path.join(root,contract.testFile)))
    || result.sourceSha256!==hash(fs.readFileSync(path.join(root,contract.sourceFile)))) throw new Error('Wrong pilot source/test identity');
  const phases=[result.baseline,result.control,...(result.mutants || []),result.restored];
  const labels=['baseline','semantic-control',...contract.mutants.map(m=>m.id),'restored'];
  if (phases.length!==5 || phases.some((phase,index)=>phase?.binding?.phase!==labels[index])
    || new Set(phases.map(phase=>phase.binding.phaseId)).size!==5) throw new Error('Missing/duplicate pilot phases');
  const expectedInputs=expectedPhaseInputs(root,expected,contract);
  for (let index=0;index<phases.length;index++) {
    const phase=phases[index];const mutant=index===2||index===3?contract.mutants[index-2]:null;
    const binding=phase.binding;
    if (phase.inputSha256!==expectedInputs[index] || binding.inputSha256!==expectedInputs[index]) {
      throw new Error(`Phase bytes do not match registered transformation: ${labels[index]}`);
    }
    if (binding.runId!==receipt.runId || binding.command?.at(-1)!==contract.testFile
      || phase.inputSha256!==binding.inputSha256
      || JSON.stringify(binding.runtime)!==JSON.stringify(result.baseline.binding.runtime)
      || binding.repoLockSha256!==hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))) throw new Error('Wrong phase command/run/lock identity');
    let assertionLocation;
    if (mutant) {
      const source=fs.readFileSync(path.join(root,contract.testFile),'utf8');
      if (source.split(mutant.assertionAnchor).length!==2) throw new Error('Assertion anchor mismatch');
      assertionLocation=source.slice(0,source.indexOf(mutant.assertionAnchor)).split('\n').length;
    }
    // Replays raw evidence, not a claimed PASS, filename list, job ID or neighboring suite count.
    if (!phase.execution || phase.execution.status!==(mutant?1:0)) throw new Error('Missing/failed subprocess execution evidence');
    qualifyEfficacyPhase(phase.report,phase.execution,{envelope:phase.envelope,binding,
      assertion:mutant?.assertion,assertionLocation,baselineNames:result.baseline.names});
  }
  if (result.baseline.inputSha256!==result.restored.inputSha256) throw new Error('Restoration identity mismatch');
  return contract.testFile;
}

export function validateVitestExecution(receipt, expected, root) {
  assertProvenance(receipt?.provenance,expected);
  const entries=sourceEntries(root);
  if (hash(JSON.stringify(entries))!==expected.snapshotSha256) throw new Error('Execution source snapshot changed');
  const requiredFiles=executionRequiredFiles(root,receipt.base,receipt.executionKind || 'changed-evidence');
  const unavailable=unavailableExecutionInputs(root,requiredFiles);
  if(JSON.stringify(receipt.unavailable || [])!==JSON.stringify(unavailable)
    || receipt.status!==(unavailable.length?'incomplete':'executed')) throw new Error('Wrong unsupported execution inventory/status');
  if (!Array.isArray(receipt.tests) || !receipt.tests.length && !unavailable.length || !receipt.runId
    || ['commit','tree','snapshotSha256'].some(key=>receipt[key]!==expected[key])) throw new Error('Missing Vitest execution identity');
  const inputSha256=hash(JSON.stringify(entries.filter(([,digest])=>digest!=='deleted').map(([file,digest])=>[file,digest])));
  const runtime=runtimeIdentity(root);
  const files=new Set(); const phases=new Set();
  for (const result of receipt.tests) {
    const {testFile,phase}=result; const binding=phase?.binding;
    const helper = result.helperFile ? registeredHelper(result.helperFile) : null;
    const fixture = result.fixtureFile ? registeredFixture(result.fixtureFile) : null;
    const sourceFiles=result.sourceFiles;
    const sqlFiles=result.sqlFiles;
    const creditedFile = result.helperFile || result.fixtureFile || testFile;
    if ((result.helperFile && (!helper || helper.testFile !== testFile))
      || (result.fixtureFile && (!fixture || fixture.testFile!==testFile || result.helperFile))
      || executionRoute(testFile,root)?.runner!=='vitest' || files.has(creditedFile)
      || TEST_EFFICACY_CONTRACTS.some(c=>c.testFile===testFile)) throw new Error('Wrong/duplicate execution route');
    if(sourceFiles && (helper || fixture || testFile!==SOURCE_CONSUMER || !Array.isArray(sourceFiles)
      || !sourceFiles.length || new Set(sourceFiles).size!==sourceFiles.length
      || sourceFiles.some(file=>!registeredSourceContract(file) || files.has(file)))) throw new Error('Wrong source contract route');
    if (!binding || binding.phase!=='execution' || !binding.phaseId || phases.has(binding.phaseId)
      || binding.runId!==receipt.runId || !path.isAbsolute(binding.cwd || '')
      || binding.testFile!==path.join(binding.cwd,testFile)
      || binding.inputSha256!==inputSha256 || phase.inputSha256!==inputSha256
      || binding.repoLockSha256!==hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))
      || result.testSha256!==hash(fs.readFileSync(path.join(root,testFile)))
      || JSON.stringify(binding.runtime)!==JSON.stringify(runtime)) throw new Error('Wrong execution phase/source/runtime identity');
    assertProvenance(binding.provenance,expected);
    const command=[canonicalPath(process.execPath),path.join(binding.cwd,'node_modules/vitest/vitest.mjs'),
      'run','--config',helper ? HELPER_CONFIG : 'frontend/vitest.config.mjs',`--coverage.enabled=${helper ? 'true' : 'false'}`,'--retry=0','--reporter=json',
      '--reporter=./scripts/efficacy-reporter.mjs',`--outputFile=${path.join(binding.cwd,'efficacy-report.json')}`,testFile];
    if (JSON.stringify(binding.command)!==JSON.stringify(command)
      || phase.report?.testResults?.[0]?.name!==binding.testFile) throw new Error('Wrong execution command/collection identity');
    qualifyEfficacyPhase(phase.report,phase.execution || {},{binding,envelope:phase.envelope});
    if (helper) {
      if (!phase.helperCoverage?.raw || binding.helper?.helperFile !== result.helperFile) throw new Error('Missing helper coverage evidence');
      validateHelperCoverage(phase.helperCoverage.raw,binding,root);
    } else if (binding.helper || phase.helperCoverage) throw new Error('Unexpected helper phase');
    if(fixture) {
      if(binding.fixture?.fixtureFile!==result.fixtureFile) throw new Error('Missing fixture phase binding');
      validateFixtureWitness(phase.fixtureWitness,binding,root,phase.report,phase.envelope);
    } else if(binding.fixture || phase.fixtureWitness) throw new Error('Unexpected fixture phase');
    if(sourceFiles) {
      if(JSON.stringify(binding.sourceContract?.files)!==JSON.stringify(sourceFiles)) throw new Error('Missing source contract phase binding');
      validateSourceContractWitness(phase.sourceContractWitness,binding,root,phase.report,phase.envelope);
      for(const file of sourceFiles) files.add(file);
    } else if(binding.sourceContract || phase.sourceContractWitness) throw new Error('Unexpected source contract phase');
    if(sqlFiles) {
      if(helper||fixture||sourceFiles||testFile!==SQL_CONSUMER||!Array.isArray(sqlFiles)||!sqlFiles.length
        ||new Set(sqlFiles).size!==sqlFiles.length||sqlFiles.some(file=>!SQL_INPUTS.includes(file)||!changedEvidencePaths(root,receipt.base).includes(file))
        ||JSON.stringify(binding.sql?.files)!==JSON.stringify(sqlFiles)
        ||JSON.stringify(binding.sql?.sourceBinding)!==JSON.stringify(sqlSourceBinding(root))
        ||binding.sql?.witnessFile!==path.join(binding.cwd,`.sql-${binding.phaseId}.json`))throw new Error('Wrong SQL fixture source/phase binding');
      validateSqlWitness(phase.sqlWitness,binding,root);
      for(const file of sqlFiles)files.add(file);
    }else if(binding.sql||phase.sqlWitness)throw new Error('Unexpected SQL fixture phase');
    // A helper/source-contract phase really executed its consumer. Share that
    // result only when the same ordinary test is in the changed selection.
    if(result.consumerExecution!==undefined && result.consumerExecution!==true) throw new Error('Invalid consumer execution claim');
    if(result.consumerExecution && (!helper && !sourceFiles || !changedEvidencePaths(root,receipt.base).includes(testFile))) throw new Error('Unselected consumer execution');
    if((!sourceFiles && (!sqlFiles||changedEvidencePaths(root,receipt.base).includes(testFile))) || result.consumerExecution) files.add(creditedFile);
    if(result.consumerExecution) files.add(testFile);
    phases.add(binding.phaseId);
  }
  return files;
}

export function executionCoverage(files, {root,expected,pilot,execution,native,playwright,base}={}) {
  const changes=changedPaths(root,base);
  const required=pilotAffectedByPaths(!base || base==='0'.repeat(40)?null:changes);
  let proven=null;
  if (pilot?.status==='executed') proven=validatePilotExecution(pilot,expected,root);
  const executed=['executed','incomplete'].includes(execution?.status)?validateVitestExecution(execution,expected,root):new Set();
  const ordinary=files.filter(file=>executionRoute(file,root)?.runner==='playwright');
  const browser=playwright ? validatePlaywrightExecution(playwright,{root,expected,requiredFiles:ordinary}):new Set();
  let nativeFiles=new Set();
  if(native) {
    assertProvenance(native.provenance,expected);
    if(native.base!==(base||null))throw new Error('Wrong native execution comparison base');
    const entries=sourceEntries(root);
    if(hash(JSON.stringify(entries))!==expected.snapshotSha256)throw new Error('Native source snapshot changed');
    nativeFiles=validateNativeReceipt(native,{root,provenance:expected,files,
      inputSha256:hash(JSON.stringify(entries.filter(([,digest])=>digest!=='deleted').map(([file,digest])=>[file,digest])))});
  }
  if ([...executed].some(file=>!files.includes(file))) throw new Error('Unexpected execution outside changed test selection');
  const rows=files.map(file=> {
    const route=executionRoute(file,root);
    return {file,route,status:executed.has(file) && registeredSourceContract(file)?'SOURCE QUALIFIED':file===proven || executed.has(file) || browser.has(file)||nativeFiles.has(file)?'EXECUTED':route?'NOT RUN':'UNCOVERED',
      ...(registeredSourceContract(file)?{liveExecution:'NOT RUN'}:{}),
      claim:file===proven?'registered analytics-truth faults only':nativeFiles.has(file)?route.claim??'actual native test collection and execution only; not database/live acceptance':browser.has(file)?'ordinary CI shard collection and execution only; not live acceptance':executed.has(file)
        ?registeredSourceContract(file)?'fault-sensitive wiring/fixture contract only; live test body not executed'
          :registeredHelper(file)?'registered source-mapped helper callables executed; not journey acceptance'
          :SQL_INPUTS.includes(file)?'actual SQL consumed in PGlite fixture; native database NOT RUN':registeredFixture(file)?'pinned fixture consumed by its executed workflow control; not journey acceptance':'collection and execution only':null};
  });
  return {scope:'changed tests and fixtures; not a product requirement inventory',
    pilot:{required,status:proven?'EXECUTED':required?'NOT RUN':'NOT APPLICABLE'},
    status:(required && !proven) || rows.some(row=>!['EXECUTED','SOURCE QUALIFIED'].includes(row.status))?'INCOMPLETE':'COMPLETE',rows};
}

export function readCurrentQuality(file, expected, root=process.cwd(), base=process.env.TEST_EFFICACY_BASE) {
  const evidence=JSON.parse(fs.readFileSync(file,'utf8'));
  assertProvenance(evidence.provenance,expected);
  const actualCoverage=executionCoverage(changedEvidencePaths(root,base),{root,expected,pilot:evidence.testEfficacy,execution:evidence.testExecution,native:evidence.nativeTestExecution,playwright:evidence.playwrightExecution,base});
  if (evidence.overallStatus!=='QUALIFIED' || actualCoverage.status!=='COMPLETE'
    || JSON.stringify(actualCoverage)!==JSON.stringify(evidence.executionCoverage)) {
    throw new Error('Quality execution coverage is UNCOVERED/NOT RUN');
  }
  return evidence;
}
