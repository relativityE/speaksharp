import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { buildEnvironment,snapshotBuildInputs,releaseWrappers,safeOutputPath } from '../../scripts/ci-build-inputs.mjs';
const toolchain={nodeHash:'a',pnpm:'10',platform:'linux',arch:'x64'};
function fixture(t) {const root=mkdtempSync(join(tmpdir(),'build-inputs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};put('frontend/vite.config.mjs','config');put('pnpm-lock.yaml','lock');put('node_modules/pkg/index.js','installed');return {root,put,key:()=>snapshotBuildInputs(root,{CI:'true',GITHUB_SHA:'a'.repeat(40)},toolchain)};}
test('release commit is not a build content input',t=>{const f=fixture(t);assert.equal(f.key(),snapshotBuildInputs(f.root,{CI:'true',GITHUB_SHA:'b'.repeat(40)},toolchain));});
for(const path of ['frontend/src/newGlobMatch.tsx','scripts/plugin-input.json','untracked-input.json','product_release/docs.md','frontend/tailwind.config.js','node_modules/pkg/index.js','pnpm-lock.yaml','.env.local']) test(`changed or new ${path} invalidates`,t=>{const f=fixture(t),before=f.key();f.put(path,'changed');assert.notEqual(f.key(),before);});
test('toolchain invalidates',t=>{const f=fixture(t);assert.notEqual(f.key(),snapshotBuildInputs(f.root,{CI:'true'}, {...toolchain,pnpm:'11'}));});
test('environment invalidates',t=>{const f=fixture(t);assert.notEqual(f.key(),snapshotBuildInputs(f.root,{CI:'true',VITE_NEW:'different'},toolchain));});
test('external dependency link refuses hit',t=>{const f=fixture(t);symlinkSync('/tmp',join(f.root,'node_modules/external'));assert.throws(f.key,/EXTERNAL_SYMLINK/);});
test('internal dependency bytes covered through store',t=>{const f=fixture(t);f.put('node_modules/.pnpm/pkg/index.js','one');symlinkSync('.pnpm/pkg',join(f.root,'node_modules/linked'));const a=f.key();f.put('node_modules/.pnpm/pkg/index.js','two');assert.notEqual(a,f.key());});
test('build environment strips tokens and volatile metadata',()=>assert.deepEqual(buildEnvironment({PATH:'/bin',CI:'true',VITE_X:'yes',GITHUB_TOKEN:'secret',GITHUB_RUN_ID:'42'}),{PATH:'/bin',CI:'true',VITE_X:'yes'}));
test('side-effecting source-map upload never reuses',()=>assert.throws(()=>buildEnvironment({SENTRY_AUTH_TOKEN:'secret'})));
test('both HTML entry points receive current release',()=>{const old='a'.repeat(40),next='b'.repeat(40),html=`window.__APP_RELEASE__="${old}";`;const out=releaseWrappers({'index.html':html,'private-dropin.html':html},old,next);assert(Object.values(out).every(x=>x.includes(next)&&!x.includes(old)));});
test('missing second wrapper refuses',()=>assert.throws(()=>releaseWrappers({'index.html':''},'a'.repeat(40),'b'.repeat(40))));
for(const path of ['../evil','/abs','a/../../evil','a\\evil','./evil','a//b'])test(`unsafe archive output ${path}`,()=>assert.throws(()=>safeOutputPath(path)));
