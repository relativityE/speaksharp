// #1837 smart builds. Reuse a verified main build when nothing it read has changed; otherwise build, traced.
//
// Consumer: the most recent successful main CI runs publish a receipt naming every input their build actually
// observed (scripts/ci-build-trace.mjs). If this checkout matches one receipt entry-for-entry, in the same build
// environment, that run's `build-artifacts` are downloaded through the authenticated API, bound to the run and
// to the receipt's output inventory, and only the release wrapper is rebound to this commit.
// Producer: any build that does not reuse runs `pnpm ci:build` under strace and writes a receipt. Every run
// uploads it, but only a receipt from a successful main push or dispatch can ever be trusted by a consumer.
// Every other gate runs on the result exactly as on a fresh build: unit, e2e, health and evidence all still
// test this commit's output, and no test result, review or evidence is reused.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEnvironment, environmentDigest, missingRequiredInputs, releaseWrappers, requiredBuildInputs, safeOutputPath } from './ci-build-inputs.mjs';
import { downloadTrustedArtifact, trustedMainRuns } from './ci-build-artifact-client.mjs';
import { buildManifest, firstManifestDifference, manifestDigest, parseTrace } from './ci-build-trace.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = process.cwd(), cache = join(root, '.ci-build-cache'), dist = join(root, 'frontend/dist');
const RECEIPT_ARTIFACT = (attempt) => `smart-build-receipt-v1-attempt-${attempt}`;
const OUTPUT_ARTIFACT = 'build-artifacts';
// What the build may write, and therefore never an input: its output, its own caches, the host lock and /tmp.
const outputRoots = ['frontend/dist', '.ci-build-cache', '.host-locks', 'node_modules/.vite', 'node_modules/.vite-temp',
  'node_modules/.cache', 'frontend/node_modules/.vite', 'frontend/node_modules/.vite-temp'].map((p) => join(root, p))
  // /tmp is scratch, unless the checkout itself lives there (only in this script's own tests).
  .concat(root.startsWith('/tmp/') ? [] : ['/tmp']);

function inventory(dir, prefix = '') {
  const rows = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), relative = safeOutputPath(prefix ? `${prefix}/${name}` : name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error('BUILD_REUSE_OUTPUT_LINK');
    if (stat.isDirectory()) rows.push(...inventory(path, relative));
    else if (stat.isFile()) rows.push([relative, digest(readFileSync(path))]);
    else throw Error('BUILD_REUSE_OUTPUT_SPECIAL');
  }
  return rows;
}
const wrappers = (dir, oldSha, newSha) => releaseWrappers(Object.fromEntries(['index.html', 'private-dropin.html'].map((p) => [p, readFileSync(join(dir, p), 'utf8')])), oldSha, newSha);

// Reject traversal, links, duplicates, special files and oversized archives before writing anything.
function extract(zipPath, target, allowed) {
  execFileSync('python3', ['-I', '-c', `
import os, re, stat, sys, zipfile
source, target, allowed = sys.argv[1], sys.argv[2], re.compile(sys.argv[3])
with zipfile.ZipFile(source) as archive:
    entries = archive.infolist(); seen = set(); total = 0
    if len(entries) > 20000: raise ValueError('archive count')
    for item in entries:
        name = item.filename.rstrip('/')
        if not name or name in seen or '\\\\' in name or name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/')): raise ValueError('archive path')
        if not allowed.fullmatch(name): raise ValueError('archive scope')
        seen.add(name)
        if stat.S_IFMT(item.external_attr >> 16) not in (0, stat.S_IFREG, stat.S_IFDIR): raise ValueError('archive type')
        total += item.file_size
        if total > 1024*1024*1024: raise ValueError('archive size')
    for item in entries:
        path = os.path.join(target, item.filename)
        if item.is_dir(): os.makedirs(path, exist_ok=True); continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with archive.open(item) as src, open(path, 'xb') as dst:
            while True:
                block = src.read(1024*1024)
                if not block: break
                dst.write(block)
        os.chmod(path, 0o644)
`, zipPath, target, allowed]);
}

async function reuse({ env, envDigest }) {
  const options = { repository: process.env.GITHUB_REPOSITORY, repositoryId: Number(process.env.GITHUB_REPOSITORY_ID), token: process.env.GITHUB_TOKEN };
  for await (const { run, workflow } of trustedMainRuns(options)) {
    const receiptZip = await downloadTrustedArtifact(options, { run, workflow, name: RECEIPT_ARTIFACT(run.run_attempt), maxBytes: 64 * 1024 * 1024 });
    if (!receiptZip) { console.log(`Main run ${run.id}: no smart-build receipt.`); continue; }
    rmSync(cache, { recursive: true, force: true }); mkdirSync(join(cache, 'receipt'), { recursive: true });
    writeFileSync(join(cache, 'receipt.zip'), receiptZip.archive);
    extract(join(cache, 'receipt.zip'), join(cache, 'receipt'), 'receipt\\.json');
    const receipt = JSON.parse(readFileSync(join(cache, 'receipt/receipt.json'), 'utf8')), origin = receiptZip.origin;
    if (receipt.schema !== 1 || receipt.repository !== origin.repository || receipt.sourceSha !== origin.sourceSha
      || receipt.runId !== String(origin.runId) || receipt.attempt !== String(origin.attempt)
      || receipt.manifestDigest !== manifestDigest(receipt.manifest) || !Array.isArray(receipt.files)) throw Error('BUILD_REUSE_RECEIPT_BINDING');
    if (receipt.environmentDigest !== envDigest) { console.log(`Main run ${run.id}: different build environment.`); continue; }
    const difference = firstManifestDifference(receipt.manifest, { root, outputRoots });
    if (difference) { console.log(`Main run ${run.id} (${origin.sourceSha.slice(0, 7)}): build input changed: ${difference}`); continue; }
    const output = await downloadTrustedArtifact(options, { run, workflow, name: OUTPUT_ARTIFACT, maxBytes: 1024 * 1024 * 1024 });
    if (!output) { console.log(`Main run ${run.id}: build output no longer available.`); continue; }
    writeFileSync(join(cache, 'output.zip'), output.archive);
    extract(join(cache, 'output.zip'), join(cache, 'dist'), '.+');
    if (JSON.stringify(inventory(join(cache, 'dist'))) !== JSON.stringify(receipt.files)) throw Error('BUILD_REUSE_OUTPUT_BINDING');
    const rebound = wrappers(join(cache, 'dist'), origin.sourceSha, env.GITHUB_SHA);
    rmSync(dist, { recursive: true, force: true }); cpSync(join(cache, 'dist'), dist, { recursive: true });
    for (const [path, html] of Object.entries(rebound)) writeFileSync(join(dist, path), html);
    console.log(`Reused the verified build of main ${origin.sourceSha} (run ${origin.runId}, artifact ${output.origin.artifactId}): `
      + `all ${receipt.manifest.length} recorded build inputs are identical here. Release rebound to ${env.GITHUB_SHA}.`);
    return true;
  }
  return false;
}

function tracedBuild(env) {
  rmSync(cache, { recursive: true, force: true }); mkdirSync(cache, { recursive: true });
  const tracePath = join('/tmp', `ci-build-trace-${process.pid}.strace`);
  const strace = spawnSync('strace', ['-V'], { encoding: 'utf8' });
  if (strace.status !== 0) {
    console.log('strace unavailable: building without a receipt.');
    const plain = spawnSync('pnpm', ['ci:build'], { cwd: root, env, stdio: 'inherit' });
    if (plain.error || plain.status !== 0) process.exit(plain.status || 1);
    return null;
  }
  const result = spawnSync('strace', ['-f', '-qq', '-s', '8192', '-y', '-e', 'trace=%file,getdents64,fchdir,connect', '-o', tracePath,
    'pnpm', 'ci:build'], { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
  const trace = parseTrace(readFileSync(tracePath, 'utf8'));
  rmSync(tracePath, { force: true });
  const { manifest, problems } = buildManifest(trace, { root, outputRoots });
  if (!manifest) { console.log(`Build succeeded; no receipt, because the trace cannot be trusted:\n  ${problems.slice(0, 20).join('\n  ')}`); return null; }
  // A manifest that does not describe its own checkout would never be safe to match.
  const self = firstManifestDifference(manifest, { root, outputRoots });
  if (self) { console.log(`Build succeeded; no receipt, because the manifest does not describe this checkout (${self}).`); return null; }
  const missing = missingRequiredInputs(manifest, requiredBuildInputs(root));
  if (missing.length) {
    console.log(`::warning::Build succeeded; no receipt, because the trace missed ${missing.length} required build input(s): ${missing.slice(0, 10).join(', ')}`);
    return null;
  }
  return manifest;
}

// This wrapper is deliberately CI-only; never clear a developer's local caches.
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw Error('BUILD_REUSE_CI_ONLY');
let env;
try { env = buildEnvironment(process.env); } catch (error) {
  console.log(`Smart build unavailable (${error.message}): plain fresh build.`);
  const plain = spawnSync('pnpm', ['ci:build'], { cwd: root, stdio: 'inherit' });
  process.exit(plain.status ?? 1);
}
// Build caches are not trusted inputs and cannot supply stale code.
for (const path of ['node_modules/.vite', 'node_modules/.cache', 'frontend/node_modules/.vite']) rmSync(join(root, path), { recursive: true, force: true });
// These guards run on every path, before any restored output is used.
execFileSync(process.execPath, ['scripts/validate-env.mjs'], { cwd: root, env, stdio: 'inherit' });
const { verifyProjectRuntimeBindings } = await import('./model-evaluator/runtime-bindings.mjs');
await verifyProjectRuntimeBindings(root);
const envDigest = environmentDigest(env);

let reused = false;
try { reused = await reuse({ env, envDigest }); } catch (error) { console.log(`No verified reusable build (${error.message}): fresh traced build.`); }
if (!reused) {
  const manifest = tracedBuild(env);
  if (manifest) {
    wrappers(dist, env.GITHUB_SHA, env.GITHUB_SHA);
    writeFileSync(join(cache, 'receipt.json'), JSON.stringify({ schema: 1, repository: process.env.GITHUB_REPOSITORY, sourceSha: env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, environmentDigest: envDigest,
      manifestDigest: manifestDigest(manifest), manifest, files: inventory(dist) }));
    const outside = manifest.filter(([name]) => !name.startsWith('@root')).length;
    console.log(`Smart-build receipt: ${manifest.length} recorded build inputs (${outside} outside the checkout), manifest ${manifestDigest(manifest)}.`);
    appendFileSync(process.env.GITHUB_OUTPUT, `receipt_name=${RECEIPT_ARTIFACT(process.env.GITHUB_RUN_ATTEMPT)}\n`);
  }
}
appendFileSync(process.env.GITHUB_OUTPUT, `reused=${reused}\n`);
