import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEnvironment, snapshotBuildInputs, releaseWrappers, safeOutputPath } from './ci-build-inputs.mjs';
import { findTrustedBuild } from './ci-build-artifact-client.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const root = process.cwd(), cache = join(root, '.ci-build-cache'), dist = join(root, 'frontend/dist');
function inventory(dir, prefix='') {
  const rows=[];
  for(const name of readdirSync(dir).sort()) {
    const path=join(dir,name), relative=safeOutputPath(prefix?`${prefix}/${name}`:name), stat=lstatSync(path);
    if(stat.isSymbolicLink()) throw Error('BUILD_REUSE_OUTPUT_LINK');
    if(stat.isDirectory()) rows.push(...inventory(path,relative));
    else if(stat.isFile()) rows.push([relative,stat.mode&0o777,digest(readFileSync(path))]);
    else throw Error('BUILD_REUSE_OUTPUT_SPECIAL');
  }
  return rows;
}
function wrappers(dir, oldSha, newSha) {
  return releaseWrappers(Object.fromEntries(['index.html','private-dropin.html'].map(p=>[p,readFileSync(join(dir,p),'utf8')])), oldSha,newSha);
}
function build(env) {
  const result=spawnSync('pnpm',['ci:build'],{cwd:root,env,stdio:'inherit'});
  if(result.error || result.status!==0) process.exit(result.status || 1);
}
// This wrapper is deliberately CI-only; never clear a developer's local caches.
if(process.env.CI!=='true' || process.env.GITHUB_ACTIONS!=='true' || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'')) throw Error('BUILD_REUSE_CI_ONLY');
let env, key, toolchain, eligible=false, reused=false;
try {
  env=buildEnvironment(process.env);
  // Vite/compiler caches are not trusted inputs and cannot supply stale code.
  for(const path of ['node_modules/.vite','node_modules/.cache']) rmSync(join(root,path),{recursive:true,force:true});
  // These guards still execute on every cache hit, before any restored code is used.
  execFileSync(process.execPath,['scripts/validate-env.mjs'],{cwd:root,env,stdio:'inherit'});
  const { verifyProjectRuntimeBindings } = await import('./model-evaluator/runtime-bindings.mjs');
  await verifyProjectRuntimeBindings(root);
  toolchain={nodeHash:digest(readFileSync(process.execPath)),node:process.version,pnpm:execFileSync('pnpm',['--version'],{env,encoding:'utf8'}).trim(),platform:process.platform,arch:process.arch};
  key=snapshotBuildInputs(root,env,toolchain);
  eligible=true;
} catch { console.log('Build reuse unavailable: conservative fresh build.'); }
if(eligible) {
  try {
    const hit=await findTrustedBuild({repository:process.env.GITHUB_REPOSITORY,repositoryId:Number(process.env.GITHUB_REPOSITORY_ID),key,token:process.env.GITHUB_TOKEN});
    if(hit) {
      rmSync(cache,{recursive:true,force:true});mkdirSync(cache);
      writeFileSync(join(cache,'source.zip'),hit.archive);
      // Reject traversal, symlinks, duplicate names, special files and zip bombs
      // before extracting anything. Only owned staging paths can be written.
      execFileSync('python3',['-c',`
import os, stat, sys, zipfile
source, target = sys.argv[1:]
with zipfile.ZipFile(source) as archive:
    entries = archive.infolist(); seen = set(); total = 0
    if len(entries) > 20000: raise ValueError('archive count')
    for item in entries:
        name = item.filename.rstrip('/')
        if not name or name in seen or '\\\\' in name or name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/')): raise ValueError('archive path')
        seen.add(name)
        if name != 'receipt.json' and name != 'dist' and not name.startswith('dist/'): raise ValueError('archive scope')
        mode = item.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR): raise ValueError('archive type')
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
        os.chmod(path, (item.external_attr >> 16) & 0o777 or 0o644)
`,join(cache,'source.zip'),join(cache,'restored')]);
      const receipt=JSON.parse(readFileSync(join(cache,'restored/receipt.json'),'utf8'));
      const origin=hit.origin, source=join(cache,'restored/dist');
      if(receipt.schema!==2 || receipt.key!==key || receipt.repository!==origin.repository || receipt.sourceSha!==origin.sourceSha || receipt.runId!==String(origin.runId) || receipt.attempt!==String(origin.attempt)
        || JSON.stringify(inventory(source))!==JSON.stringify(receipt.files) || snapshotBuildInputs(root,env,toolchain)!==key) throw Error('BUILD_REUSE_BINDING');
      const rebound=wrappers(source,origin.sourceSha,env.GITHUB_SHA);
      rmSync(dist,{recursive:true,force:true});cpSync(source,dist,{recursive:true});
      for(const [path,html] of Object.entries(rebound)) writeFileSync(join(dist,path),html);
      reused=true;
      console.log(`Reused verified test build from run ${origin.runId}, artifact ${origin.artifactId}; release ${env.GITHUB_SHA}.`);
    }
  } catch { console.log('Trusted matching artifact unavailable: conservative fresh build.'); }
}
if(!reused) build(eligible?env:process.env);
// Preserve ordinary build artifacts and all downstream checks regardless of hit.
// Only successful protected-main producers may publish reusable input receipts.
if(eligible && ['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) && process.env.GITHUB_REF==='refs/heads/main') {
  try {
    if(snapshotBuildInputs(root,env,toolchain)!==key) throw Error('BUILD_REUSE_BUILD_MUTATED_INPUT');
    wrappers(dist,env.GITHUB_SHA,env.GITHUB_SHA);
    const files=inventory(dist);
    rmSync(cache,{recursive:true,force:true});mkdirSync(cache);cpSync(dist,join(cache,'dist'),{recursive:true});
    writeFileSync(join(cache,'receipt.json'),JSON.stringify({schema:2,key,repository:process.env.GITHUB_REPOSITORY,sourceSha:env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,files}));
    appendFileSync(process.env.GITHUB_OUTPUT,`cache_name=build-reuse-v1-${key}-attempt-${process.env.GITHUB_RUN_ATTEMPT}\n`);
  } catch { console.log('Build succeeded; reuse receipt not published because inputs were uncertain.'); }
}
