import { URL } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const here = new URL('../../scripts/', import.meta.url).pathname;
const zip = (dir, out) => execFileSync('python3', ['-I', '-c', `import pathlib,zipfile,sys\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w') as z:\n for p in sorted(root.rglob('*')):\n  if p.is_file():z.write(p,p.relative_to(root))`, dir, out]);

// The real smart-build, trace, inputs and origin code; only the GitHub API client is a fixture (it is tested
// separately against adversarial API responses). The fixture build is traced by the real strace.
test('traced producer, verified reuse on unchanged inputs, rebuild on every kind of input change', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'smart-build-e2e-')), root = join(base, 'repo'); mkdirSync(root);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const put = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
  for (const f of ['ci-smart-build.mjs', 'ci-build-inputs.mjs', 'ci-build-trace.mjs']) { mkdirSync(join(root, 'scripts'), { recursive: true }); cpSync(join(here, f), join(root, 'scripts', f)); }
  put('scripts/ci-build-artifact-client.mjs', `import fs from 'node:fs';
const read = (p) => JSON.parse(fs.readFileSync(${JSON.stringify(join(base, 'origin.json'))}, 'utf8'));
export async function* trustedMainRuns({ token }) { if (token) yield { run: { id: 12, run_attempt: 1 }, workflow: { id: 5 } }; }
export async function downloadTrustedArtifact(_options, { name }) {
  const file = name === 'build-artifacts' ? 'output.zip' : name === 'smart-build-receipt-v1-attempt-1' ? 'receipt.zip' : null;
  if (!file || !fs.existsSync(${JSON.stringify(base)} + '/' + file)) return null;
  return { archive: fs.readFileSync(${JSON.stringify(base)} + '/' + file), origin: { ...read(), artifactId: file === 'output.zip' ? 35 : 34 } };
}`);
  put('scripts/model-evaluator/runtime-bindings.mjs', `export async function verifyProjectRuntimeBindings(){console.log('runtime-guard');}`);
  put('scripts/validate-env.mjs', `console.log('env-guard');`);
  put('frontend/src/app.js', 'export const app = 1;'); put('frontend/src/util.js', 'unread'); put('tests/unit/x.test.js', 'test');
  // #1837: pin the fake pnpm to CommonJS; the nearest package.json may be ESM.
  put('bin/package.json', '{"type":"commonjs"}\n');
  put('bin/pnpm', `#!/usr/bin/env node
const fs=require('fs');if(process.argv.includes('--version')){console.log('10.29.1');process.exit(0);}
console.log('REAL_BUILD');fs.readdirSync('frontend/src');fs.existsSync('.env.local');
const app=fs.readFileSync('frontend/src/app.js','utf8');fs.rmSync('frontend/dist',{recursive:true,force:true});fs.mkdirSync('frontend/dist',{recursive:true});
for(const name of ['index.html','private-dropin.html'])fs.writeFileSync('frontend/dist/'+name,'window.__APP_RELEASE__="'+process.env.GITHUB_SHA+'";'+(process.env.VITE_X||''));
fs.writeFileSync('frontend/dist/app.js',app);`);
  chmodSync(join(root, 'bin/pnpm'), 0o755);
  const env = { PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME, CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '12',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'a/b', GITHUB_REPOSITORY_ID: '7', GITHUB_OUTPUT: join(base, 'output'), GITHUB_TOKEN: '',
    // Explicit, so Node does not pass a covered test run's NODE_V8_COVERAGE on to the traced build.
    NODE_V8_COVERAGE: '' };
  const run = (overrides = {}) => { writeFileSync(join(base, 'output'), ''); const r = spawnSync(process.execPath, ['scripts/ci-smart-build.mjs'], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr + '\n' + r.stdout); return r.stdout; };
  const next = 'b'.repeat(40), consumer = { GITHUB_TOKEN: 'fake', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge', GITHUB_SHA: next, GITHUB_RUN_ID: '13' };

  // A real work tree, so the producer's completeness floor (tracked TypeScript under frontend/src, the entry
  // page and both package manifests) is computed with git, as on a runner.
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const produced = run();
  assert(produced.includes('REAL_BUILD') && produced.includes('runtime-guard') && produced.includes('Smart-build receipt'), produced);
  assert.match(readFileSync(join(base, 'output'), 'utf8'), /receipt_name=smart-build-receipt-v1-attempt-1/);
  const receipt = JSON.parse(readFileSync(join(root, '.ci-build-cache/receipt.json'), 'utf8'));
  const names = new Set(receipt.manifest.map(([n]) => n));
  for (const n of ['@root/frontend/src/app.js', '@root/frontend/src', '@root/.env.local', '@root/bin/pnpm']) assert(names.has(n), n);
  assert(!names.has('@root/frontend/src/util.js') && !names.has('@root/tests/unit/x.test.js'));
  writeFileSync(join(base, 'origin.json'), JSON.stringify({ repository: 'a/b', sourceSha: 'a'.repeat(40), runId: 12, attempt: 1 }));
  mkdirSync(join(base, 'receipt')); cpSync(join(root, '.ci-build-cache/receipt.json'), join(base, 'receipt/receipt.json'));
  zip(join(base, 'receipt'), join(base, 'receipt.zip')); zip(join(root, 'frontend/dist'), join(base, 'output.zip'));

  const reuse = () => { rmSync(join(root, 'frontend/dist'), { recursive: true, force: true }); return run(consumer); };
  let out = reuse();
  assert(out.includes('Reused the verified build') && !out.includes('REAL_BUILD') && out.includes('env-guard') && out.includes('runtime-guard'), out);
  for (const f of ['index.html', 'private-dropin.html']) assert(readFileSync(join(root, 'frontend/dist', f), 'utf8').includes(next));
  assert.equal(readFileSync(join(root, 'frontend/dist/app.js'), 'utf8'), 'export const app = 1;');
  assert.match(readFileSync(join(base, 'output'), 'utf8'), /reused=true/);
  put('tests/unit/x.test.js', 'changed test'); put('frontend/src/util.js', 'changed but never read');
  assert(reuse().includes('Reused the verified build'), 'files the build never read do not force a rebuild');

  const rebuilds = (label, change, undo, overrides = {}) => {
    change();
    try { rmSync(join(root, 'frontend/dist'), { recursive: true, force: true }); const o = run({ ...consumer, ...overrides }); assert(o.includes('REAL_BUILD') && !o.includes('Reused'), `${label}\n${o}`); }
    finally { undo(); }
  };
  rebuilds('a read file changed', () => put('frontend/src/app.js', 'export const app = 2;'), () => put('frontend/src/app.js', 'export const app = 1;'));
  rebuilds('a file added to a listed directory', () => put('frontend/src/new.js', 'x'), () => unlinkSync(join(root, 'frontend/src/new.js')));
  rebuilds('a probed absent file now exists', () => put('.env.local', 'VITE_X=1'), () => unlinkSync(join(root, '.env.local')));
  rebuilds('the build tool changed', () => put('bin/pnpm', `${readFileSync(join(root, 'bin/pnpm'), 'utf8')}\n// changed`), () => put('bin/pnpm', readFileSync(join(root, 'bin/pnpm'), 'utf8').replace(/\n\/\/ changed$/, '')));
  rebuilds('the build environment changed', () => {}, () => {}, { VITE_X: 'different' });
  const output = readFileSync(join(base, 'output.zip'));
  rebuilds('output differs from the receipt inventory', () => { mkdirSync(join(base, 'tampered')); execFileSync('python3', ['-I', '-c', `import zipfile,sys\nsrc=zipfile.ZipFile(sys.argv[1]);dst=zipfile.ZipFile(sys.argv[2],'w')\nfor i in src.infolist():dst.writestr(i, src.read(i) if i.filename!='app.js' else b'poisoned')\ndst.close()`, join(base, 'output.zip'), join(base, 'tampered/o.zip')]); cpSync(join(base, 'tampered/o.zip'), join(base, 'output.zip')); }, () => writeFileSync(join(base, 'output.zip'), output));
  rebuilds('archive traversal', () => execFileSync('python3', ['-I', '-c', `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('../escaped','bad')`, join(base, 'output.zip')]), () => writeFileSync(join(base, 'output.zip'), output));
  const origin = readFileSync(join(base, 'origin.json'));
  rebuilds('a receipt bound to another commit', () => writeFileSync(join(base, 'origin.json'), JSON.stringify({ repository: 'a/b', sourceSha: 'c'.repeat(40), runId: 12, attempt: 1 })), () => writeFileSync(join(base, 'origin.json'), origin));
  assert(reuse().includes('Reused the verified build'), 'every undo restores the hit');

  // #1837 completeness floor: a tracked frontend source the traced build never read means the trace is
  // incomplete for this app, so the producer publishes no receipt (and nothing can ever be reused against it).
  put('frontend/src/unread.ts', 'export const unread = 1;'); git('add', 'frontend/src/unread.ts');
  try {
    rmSync(join(root, 'frontend/dist'), { recursive: true, force: true });
    const floor = run();
    assert(floor.includes('REAL_BUILD') && floor.includes('missed 1 required build input(s): frontend/src/unread.ts') && !floor.includes('Smart-build receipt'), floor);
    assert.doesNotMatch(readFileSync(join(base, 'output'), 'utf8'), /receipt_name=/);
  } finally { git('rm', '-q', '--cached', 'frontend/src/unread.ts'); unlinkSync(join(root, 'frontend/src/unread.ts')); }
  assert(run().includes('Smart-build receipt'), 'the receipt returns once every required input is read');

  // Negative control for Sam's #1837 finding: a /tmp file the build reads but did not create is not recorded in
  // the receipt, so a consumer could never notice it changed. The producer must refuse to publish a receipt.
  const pnpm = readFileSync(join(root, 'bin/pnpm'), 'utf8'), tempInput = join(base, 'generated-before-build.txt');
  writeFileSync(tempInput, 'one');
  const withBuild = (code) => put('bin/pnpm', pnpm.replace("console.log('REAL_BUILD');", `console.log('REAL_BUILD');${code}`));
  try {
    withBuild(`fs.readFileSync(${JSON.stringify(tempInput)});`);
    rmSync(join(root, 'frontend/dist'), { recursive: true, force: true });
    const stale = run();
    assert(stale.includes('REAL_BUILD') && stale.includes(`build read a temporary path it did not create: ${tempInput}`) && !stale.includes('Smart-build receipt'), stale);
    assert.doesNotMatch(readFileSync(join(base, 'output'), 'utf8'), /receipt_name=/);
    // A temporary file the build itself writes and reads back is not an input, and the receipt is published.
    withBuild(`const d=fs.mkdtempSync(require('path').join(require('os').tmpdir(),'fake-build-'));fs.writeFileSync(d+'/part','x');fs.readFileSync(d+'/part');fs.rmSync(d,{recursive:true});`);
    const own = run();
    assert(own.includes('REAL_BUILD') && own.includes('Smart-build receipt'), own);
  } finally { put('bin/pnpm', pnpm); }
});

test('completeness floor lists tracked required inputs and refuses an unlistable tree', () => {
  return import(new URL('ci-build-inputs.mjs', `file://${here}`).href).then(({ requiredBuildInputs, missingRequiredInputs }) => {
    const repo = mkdtempSync(join(tmpdir(), 'smart-build-floor-'));
    try {
      const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      git('init', '-q');
      for (const p of ['frontend/index.html', 'frontend/package.json', 'package.json', 'frontend/src/a.ts', 'frontend/src/deep/b.tsx', 'frontend/src/c.js', 'frontend/src/d.md', 'tests/e.ts', 'docs/x.md']) {
        mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), 'x');
      }
      writeFileSync(join(repo, 'frontend/src/untracked.ts'), 'x');
      git('add', '-A', ':!frontend/src/untracked.ts');
      const required = requiredBuildInputs(repo).sort();
      assert.deepEqual(required, ['frontend/index.html', 'frontend/package.json', 'frontend/src/a.ts', 'frontend/src/deep/b.tsx', 'package.json']);
      const manifest = required.map((p) => [`@root/${p}`, 'file', 'h']);
      assert.deepEqual(missingRequiredInputs(manifest, required), []);
      assert.deepEqual(missingRequiredInputs(manifest.slice(1), required), [required[0]]);
      assert.equal(requiredBuildInputs(join(repo, 'missing')), null);
      assert.equal(missingRequiredInputs(manifest, null).length, 1);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
