#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEST_EFFICACY_CONTRACTS, qualifyEfficacyPhase } from './lib/softwareQualityEvidenceQualification.mjs';
import { canonicalPath, runtimeIdentity } from './efficacy-reporter.mjs';
import { executionContext, testEnvironment, pilotAffectedByPaths, changedEvidencePaths, executionRoute } from './lib/testExecutionEvidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
// Vitest setup imports application modules outside the contract's direct import closure.
// Conservatively select the bounded pilot for every frontend source change.

export function mutateBytes(bytes, anchor, replacement) {
  const source = bytes.toString('utf8');
  if (!anchor || anchor === replacement || source.split(anchor).length !== 2) {
    throw new Error('Mutation anchor missing, ambiguous, or no-op');
  }
  const mutated = Buffer.from(source.replace(anchor, () => replacement));
  if (mutated.equals(bytes)) throw new Error('Mutation did not change bytes');
  return mutated;
}

// Resolve the registered test's local import closure, including type imports. An unresolved
// local dependency fails closed; external packages are covered by lockfile/config triggers.
export function dependencyPaths(root, entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const content = fs.readFileSync(path.join(root, entry), 'utf8');
  const imports = content.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g);
  for (const [, specifier] of imports) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    const stem = specifier.startsWith('@/') ? `frontend/src/${specifier.slice(2)}` : path.posix.join(path.posix.dirname(entry), specifier);
    const resolved = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx'].map(suffix => stem + suffix)
      .find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
    if (!resolved) throw new Error(`Unresolved contract dependency: ${entry}: ${specifier}`);
    if (/\.[cm]?[jt]sx?$/.test(resolved)) dependencyPaths(root, resolved, seen);
    else seen.add(resolved);
  }
  return seen;
}

export function selectContracts(root, changedPaths) {
  return TEST_EFFICACY_CONTRACTS.filter(contract => {
    const dependencies = dependencyPaths(root, contract.testFile);
    return pilotAffectedByPaths(changedPaths) || changedPaths.some(file => dependencies.has(file));
  });
}

function snapshot(root) {
  // Exclude only the untracked root CI package cache, never tracked source paths.
  const files = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--exclude=/apt-bundle/']).split('\0').filter(Boolean);
  const entries = [...new Set(files)].sort().map(file => {
    const location = path.join(root, file);
    if (!fs.existsSync(location)) return [file, 'deleted'];
    const stat = fs.lstatSync(location);
    if (!stat.isFile()) throw new Error(`Unsupported snapshot entry: ${file}`);
    return [file, hash(fs.readFileSync(location)), stat.mode & 0o777];
  });
  return { entries, digest: hash(JSON.stringify(entries)) };
}

// Execution-only proof never grants mutation-efficacy credit. One file per phase keeps
// collection unambiguous; the bounded budget fails closed instead of truncating selection.
export function runVitestExecution(options = {}) {
  return runTestEfficacy({...options, executionOnly:true});
}

export function runTestEfficacy({ root = process.cwd(), base = process.env.TEST_EFFICACY_BASE, provenance, executionOnly = false } = {}) {
  root = canonicalPath(root);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  if (base && !/^[0-9a-f]{40}$/.test(base)) throw new Error('Efficacy base must be an exact commit SHA');
  // GitHub uses this sentinel for a newly created ref; it is not a resolvable commit.
  if (base === '0'.repeat(40)) base = undefined;
  // Absent base means conservative selection of all registered contracts, never an empty PASS.
  const changed = base ? [...new Set([
    ...git(root, ['diff', '--name-only', '-z', base, 'HEAD']).split('\0'),
    ...git(root, ['diff', '--name-only', '-z', 'HEAD']).split('\0'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '--exclude=/apt-bundle/', '-z']).split('\0'),
  ].filter(Boolean))] : null;
  const selected = executionOnly ? changedEvidencePaths(root,base)
    .filter(file=>executionRoute(file,root)?.runner==='vitest' && !TEST_EFFICACY_CONTRACTS.some(c=>c.testFile===file))
    .map(testFile=>({testFile})) : selectContracts(root, changed);
  if (executionOnly && selected.length > 8) throw new Error('NOT RUN: changed Vitest execution budget exceeds 8 files');
  if (!executionOnly && (selected.length > 1 || selected.some(contract => contract.mutants.length !== 2 || contract.control?.length !== 2))) {
    throw new Error('Efficacy pilot budget: one contract, two mutants, one two-seam semantic control');
  }
  const before = snapshot(root);
  provenance ??= executionContext(root,{SOFTWARE_QUALITY_INVOCATION:randomUUID()});
  if (provenance.commit!==commit || provenance.tree!==tree || provenance.snapshotSha256!==before.digest) {
    throw new Error('Producer context differs from tested source');
  }
  const receipt = { schemaVersion: 2, runId: randomUUID(), scope: executionOnly ? 'changed Vitest collection and execution only' : 'registered analytics-truth faults only',
    provenance,commit, tree, snapshotSha256: before.digest, base: base || null,
    selection: changed === null ? 'all-registered-no-base' : 'affected', changedPaths: changed,
    status: selected.length ? 'executed' : 'not-applicable', contracts: [], tests: [] };
  if (!selected.length) return receipt;
  // /tmp is a symlink on macOS. Compare real paths on both sides of the reporter boundary.
  const temporary = canonicalPath(fs.mkdtempSync(path.join(os.tmpdir(), 'speaksharp-efficacy-')));
  try {
    for (const [file, digest, mode] of before.entries) {
      if (digest === 'deleted') continue;
      const destination = path.join(temporary, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, file), destination);
      fs.chmodSync(destination, mode);
      if (hash(fs.readFileSync(destination)) !== digest) throw new Error('Source changed during copy');
    }
    // Changed gate tests inspect Git. Supply independent metadata derived solely from the
    // copied bytes, never a shared .git or alternates pointer into the original checkout.
    // This synthetic copy commit is NOT the reviewed head; provenance above retains that head.
    const copyEnv = testEnvironment(temporary,null,'');
    const copyGit = args => execFileSync('git',args,{cwd:temporary,env:copyEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    copyGit(['init']);
    copyGit(['-c','core.hooksPath=/dev/null','add','--force','.']);
    copyGit(['-c','core.hooksPath=/dev/null','-c','user.name=Isolated source copy','-c','user.email=copy@example.invalid',
      'commit','--no-gpg-sign','-m','Isolated reviewed source snapshot']);
    const sourceCopyCommit = copyGit(['rev-parse','HEAD']);
    for (const directory of ['node_modules', 'frontend/node_modules']) {
      const dependency = path.join(root, directory);
      if (fs.existsSync(dependency)) fs.symlinkSync(dependency, path.join(temporary, directory), 'dir');
    }
    const executable = path.join(temporary, 'node_modules/vitest/vitest.mjs');
    if (!fs.existsSync(executable)) throw new Error('NOT RUN: installed Vitest dependencies unavailable');
    const runtime = runtimeIdentity(temporary);
    const repoLockSha256 = hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml')));
    const reportFile = path.join(temporary, 'efficacy-report.json');
    const envelopeFile = path.join(temporary, 'efficacy-envelope.json');
    const completedPhases = [];
    const execute = (contract, phase, assertion, baselineNames, assertionAnchor) => {
      let diagnostics;
      try {
      fs.rmSync(reportFile, { force: true });
      fs.rmSync(envelopeFile, { force: true });
      const inputHashes = before.entries.filter(([, digest]) => digest !== 'deleted').map(([file]) =>
        [file, hash(fs.readFileSync(path.join(temporary, file)))]);
      const command = [canonicalPath(process.execPath), executable, 'run', '--config', 'frontend/vitest.config.mjs',
        '--coverage.enabled=false', '--retry=0', '--reporter=json',
        '--reporter=./scripts/efficacy-reporter.mjs', `--outputFile=${reportFile}`, contract.testFile];
      const binding = { runId: receipt.runId, phaseId: randomUUID(), phase,
        provenance, sourceCopyCommit,
        command, cwd: temporary, testFile: canonicalPath(path.join(temporary, contract.testFile)),
        inputSha256: hash(JSON.stringify(inputHashes)), repoLockSha256, runtime };
      const result = spawnSync(command[0], command.slice(1),
      { cwd: temporary, timeout: 60000, killSignal: 'SIGKILL', detached: process.platform !== 'win32',
        maxBuffer: 8 * 1024 * 1024,
        env: testEnvironment(temporary,binding,envelopeFile) });
      if (result.error && result.pid && process.platform !== 'win32') {
        try { process.kill(-result.pid, 'SIGKILL'); }
        catch (error) {
          // ESRCH means the entire process group has already exited.
          if (error.code !== 'ESRCH') throw error;
        }
      }
      for (const [file, digest] of inputHashes) {
        if (hash(fs.readFileSync(path.join(temporary, file))) !== digest) {
          throw new Error(`Input changed during test phase: ${file}`);
        }
      }
      const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
      const envelope = fs.existsSync(envelopeFile) ? JSON.parse(fs.readFileSync(envelopeFile, 'utf8')) : null;
      diagnostics={report,envelope,status:result.status,signal:result.signal,error:result.error?.code || null,
        stdout:result.stdout?.toString() || '',stderr:result.stderr?.toString() || ''};
      let assertionLocation;
      if (assertionAnchor) {
        const testSource = fs.readFileSync(binding.testFile, 'utf8');
        if (testSource.split(assertionAnchor).length !== 2) throw new Error('Assertion anchor missing or ambiguous');
        assertionLocation = testSource.slice(0, testSource.indexOf(assertionAnchor)).split('\n').length;
      }
      if (JSON.stringify(runtimeIdentity(temporary)) !== JSON.stringify(runtime)) throw new Error('Installed runtime changed during phase');
      const names = qualifyEfficacyPhase(report, result, { assertion, baselineNames, envelope, binding, assertionLocation });
      if (canonicalPath(report.testResults[0].name) !== binding.testFile) throw new Error('Wrong contract test file collected');
      completedPhases.push(phase);
      return { names, binding, envelope, execution:{status:result.status,signal:result.signal,error:result.error?.message || null},
        inputSha256: binding.inputSha256, report, reportSha256: hash(JSON.stringify(report)) };
      } catch (cause) {
        const error = new Error(`[${phase}] ${cause.message}`, {cause});
        Object.defineProperty(error,'diagnostics',{value:diagnostics});
        // Bounded diagnostic, not a qualifying receipt. Lets acceptance tests distinguish
        // the intended assertion/skip from an unrelated import/setup exception.
        error.testOutcomes=diagnostics?.report?.testResults?.flatMap(file=>(file.assertionResults || [])
          .map(test=>`${test.fullName} | ${test.status} | ${(test.failureMessages || []).join('; ').slice(0,1000)}`)).slice(0,20);
        error.phase = phase; error.completedPhases = [...completedPhases]; throw error;
      }
    };
    for (const contract of selected) {
      if (executionOnly) {
        receipt.tests.push({testFile:contract.testFile,
          testSha256:hash(fs.readFileSync(path.join(root,contract.testFile))),
          phase:execute(contract,'execution')});
        continue;
      }
      const source = path.join(temporary, contract.sourceFile);
      const original = fs.readFileSync(source);
      const baseline = execute(contract, 'baseline');
      const mutants = [];
      let control;
      try {
        let controlBytes = original;
        for (const change of contract.control) controlBytes = mutateBytes(controlBytes, change.anchor, change.replacement);
        if (controlBytes.equals(original)) throw new Error('Semantic control did not change bytes');
        fs.writeFileSync(source, controlBytes);
        control = execute(contract, 'semantic-control', undefined, baseline.names);
        fs.writeFileSync(source, original);
        for (const mutant of contract.mutants) {
          const bytes = mutateBytes(original, mutant.anchor, mutant.replacement);
          fs.writeFileSync(source, bytes);
          const phase = execute(contract, mutant.id, mutant.assertion, baseline.names, mutant.assertionAnchor);
          mutants.push({ id: mutant.id, assertion: mutant.assertion, sourceSha256: hash(bytes), ...phase });
          fs.writeFileSync(source, original);
        }
      } finally {
        fs.writeFileSync(source, original);
      }
      if (!fs.readFileSync(source).equals(original)) throw new Error('Restoration failed');
      const restored = execute(contract, 'restored', undefined, baseline.names);
      if (restored.inputSha256 !== baseline.inputSha256) throw new Error('Restored input identity differs from baseline');
      // Tests must not mutate any tracked input, even if their final assertions pass.
      for (const [file, digest] of before.entries) {
        if (digest !== 'deleted' && hash(fs.readFileSync(path.join(temporary, file))) !== digest) {
          throw new Error(`Input changed during execution: ${file}`);
        }
      }
      receipt.contracts.push({ id: contract.id, sourceFile: contract.sourceFile,
        sourceSha256: hash(original), testFile: contract.testFile,
        testSha256: hash(fs.readFileSync(path.join(temporary, contract.testFile))), baseline, control, mutants, restored });
    }
    if (snapshot(root).digest !== before.digest) throw new Error('Working tree changed during efficacy run');
    return receipt;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(runTestEfficacy(), null, 2));
  } catch (error) {
    console.error(`[test-efficacy] ${error.message}`);
    process.exitCode = 1;
  }
}
