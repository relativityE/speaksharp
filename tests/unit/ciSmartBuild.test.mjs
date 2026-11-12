import { URL } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';
const here=new URL('../../scripts/',import.meta.url).pathname;
test('fresh producer, verified restore, changed plugin/glob/dependency force rebuild',t=>{
 const base=mkdtempSync(join(tmpdir(),'smart-build-e2e-')),root=join(base,'repo');mkdirSync(root);t.after(()=>rmSync(base,{recursive:true,force:true}));
 const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 for(const f of ['ci-smart-build.mjs','ci-build-inputs.mjs']) {mkdirSync(join(root,'scripts'),{recursive:true});cpSync(join(here,f),join(root,'scripts',f));}
 // Auth/digest transport is separately tested against adversarial API fixtures.
 // This fixture exercises the real restore/extract/input/output/build control path.
 put('scripts/ci-build-artifact-client.mjs',`import fs from 'node:fs'; export async function findTrustedBuild({token}) { if(!token)return null; return { archive:fs.readFileSync(${JSON.stringify(join(base,'cache.zip'))}), origin:JSON.parse(fs.readFileSync(${JSON.stringify(join(base,'origin.json'))},'utf8')) }; }`);
 put('scripts/model-evaluator/runtime-bindings.mjs',`export async function verifyProjectRuntimeBindings(){console.log('runtime-guard');}`);
 put('scripts/validate-env.mjs',`console.log('env-guard');`);
 put('frontend/vite.config.mjs','// fixture');put('pnpm-lock.yaml','lock');put('node_modules/pkg/index.js','dep');
 put('bin/pnpm',`#!/usr/bin/env node\nconst fs=require('fs');if(process.argv.includes('--version')){console.log('10.29.1');process.exit(0);}console.log('REAL_BUILD');fs.mkdirSync('frontend/dist',{recursive:true});for(const name of ['index.html','private-dropin.html'])fs.writeFileSync('frontend/dist/'+name,'window.__APP_RELEASE__="'+process.env.GITHUB_SHA+'";');fs.writeFileSync('frontend/dist/unchanged.js','same compiled bytes');`);chmodSync(join(root,'bin/pnpm'),0o755);
 const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,CI:'true',GITHUB_ACTIONS:'true',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'a/b',GITHUB_REPOSITORY_ID:'7',GITHUB_OUTPUT:join(base,'output'),GITHUB_TOKEN:''};
 function run(overrides={}) {const r=spawnSync(process.execPath,['scripts/ci-smart-build.mjs'],{cwd:root,env:{...env,...overrides},encoding:'utf8'});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
 const first=run();assert(first.includes('REAL_BUILD'));assert(first.includes('runtime-guard'));
 const receipt=JSON.parse(readFileSync(join(root,'.ci-build-cache/receipt.json'),'utf8'));
 writeFileSync(join(base,'origin.json'),JSON.stringify({repository:'a/b',sourceSha:'a'.repeat(40),runId:12,attempt:1,artifactId:34}));
 execFileSync('python3',['-c',`import pathlib,zipfile,sys\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w') as z:\n for p in root.rglob('*'):\n  if p.is_file():z.write(p,p.relative_to(root))`,join(root,'.ci-build-cache'),join(base,'cache.zip')]);
 const next='b'.repeat(40),hit=run({GITHUB_TOKEN:'fake',GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:next,GITHUB_RUN_ID:'13'});
 assert(hit.includes('Reused verified test build'),hit);assert(!hit.includes('REAL_BUILD'));assert(hit.includes('runtime-guard'));assert(hit.includes('env-guard'));
 for(const f of ['index.html','private-dropin.html'])assert(readFileSync(join(root,'frontend/dist',f),'utf8').includes(next));
 assert.equal(readFileSync(join(root,'frontend/dist/unchanged.js'),'utf8'),'same compiled bytes');
 for(const path of ['frontend/src/newGlob.tsx','scripts/plugin-read.json','node_modules/pkg/index.js']) {put(path,'new input');const miss=run({GITHUB_TOKEN:'fake',GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:next,GITHUB_RUN_ID:'13'});assert(miss.includes('REAL_BUILD'),path+' '+miss);}
 execFileSync('python3',['-c',`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('../escaped','bad')`,join(base,'cache.zip')]);
 const malicious=run({GITHUB_TOKEN:'fake',GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:next});assert(malicious.includes('REAL_BUILD'));
 assert.match(receipt.key,/^[a-f0-9]{64}$/);
});
