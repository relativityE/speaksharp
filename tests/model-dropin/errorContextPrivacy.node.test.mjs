// Failure artifacts must not carry page content. A failing Playwright test writes error-context.md (a page snapshot)
// unless PLAYWRIGHT_NO_COPY_PROMPT is set; the bounded runner sets it and the in-app config refuses to run without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..','..');
const cli=join(root,'node_modules/@playwright/test/cli.js');
const MARKER='SENSITIVE-TRANSCRIPT-MARKER-7f3c';

async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
  const p=join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else out.push(p);}return out;}

async function failingRun(extraEnv){
  const dir=await mkdtemp(join(tmpdir(),'error-context-privacy-'));
  // CommonJS so the temporary spec resolves this checkout's @playwright/test through NODE_PATH.
  await writeFile(join(dir,'marker.spec.cjs'),`const {test,expect}=require('@playwright/test');
test('fails with private page content',async({page})=>{await page.setContent('<p>${MARKER}</p>');expect(1).toBe(2);});`);
  await writeFile(join(dir,'playwright.config.cjs'),`module.exports={testDir:'.',testMatch:'marker.spec.cjs',outputDir:'./out',reporter:[['line']],
  use:{channel:'chrome',headless:true,trace:'off',screenshot:'off',video:'off'}};`);
  const env={...process.env,NODE_PATH:join(root,'node_modules')};delete env.PLAYWRIGHT_NO_COPY_PROMPT;
  const run=spawnSync(process.execPath,[cli,'test','--config',join(dir,'playwright.config.cjs')],{cwd:root,env:{...env,...extraEnv},encoding:'utf8',timeout:90_000});
  const written=await files(join(dir,'out'));
  const leaked=[];for(const f of written)if((await readFile(f)).includes(MARKER))leaked.push(f.slice(dir.length));
  await rm(dir,{recursive:true,force:true});
  return {status:run.status,written:written.map(f=>f.slice(dir.length)),leaked};
}

test('without the setting a failure writes the page content into error-context.md (the control can see a leak)',{timeout:120_000},async()=>{
  const r=await failingRun({});
  assert.notEqual(r.status,0);
  assert.ok(r.written.some(f=>f.endsWith('error-context.md')),JSON.stringify(r.written));
  assert.ok(r.leaked.length>0,'the marker should appear in the unprotected artifact');
});

test('with PLAYWRIGHT_NO_COPY_PROMPT=1 a failure writes no error-context and no artifact holds the page content',{timeout:120_000},async()=>{
  const r=await failingRun({PLAYWRIGHT_NO_COPY_PROMPT:'1'});
  assert.notEqual(r.status,0);
  assert.equal(r.written.some(f=>f.endsWith('error-context.md')),false,JSON.stringify(r.written));
  assert.deepEqual(r.leaked,[]);
});

test('the in-app comparison config refuses to load without the setting',()=>{
  const base={...process.env,EVAL_APP_URL:'http://127.0.0.1:5174',EVAL_PRIVATE_OUTPUT:tmpdir(),EVAL_BROWSER_WS_ENDPOINT:'ws://127.0.0.1:9/x'};
  delete base.PLAYWRIGHT_NO_COPY_PROMPT;
  const load=env=>spawnSync(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),'-e',
    `import(${JSON.stringify(join(root,'tests/model-dropin/playwright.in-app.config.ts'))}).then(()=>console.log('LOADED'),e=>{console.error(String(e));process.exit(3);})`],
    {cwd:root,env,encoding:'utf8',timeout:60_000});
  const refused=load(base);
  assert.equal(refused.status,3);assert.match(refused.stderr,/bounded_error_context_privacy_required/);
  const allowed=load({...base,PLAYWRIGHT_NO_COPY_PROMPT:'1'});
  assert.equal(allowed.status,0,allowed.stderr);assert.match(allowed.stdout,/LOADED/);
});

test('the bounded runner hands the setting to every child it launches',async()=>{
  const source=await readFile(join(root,'tests/model-dropin/run-bounded-comparison.mjs'),'utf8');
  assert.match(source,/const env = \{\.\.\.process\.env, EVAL_PRIVATE_OUTPUT: childOutput, PLAYWRIGHT_NO_COPY_PROMPT: '1'\};/);
  assert.equal((source.match(/env:\{\.\.\.env,/g)||[]).length>=2,true);
});
