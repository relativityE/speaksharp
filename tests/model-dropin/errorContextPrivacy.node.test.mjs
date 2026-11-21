// Failure artifacts must not carry page content. A failing Playwright test writes error-context.md (a page snapshot)
// unless PLAYWRIGHT_NO_COPY_PROMPT is set; the bounded runner sets it and the in-app config refuses to run without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..','..');
const cli=join(root,'node_modules/@playwright/test/cli.js');
const MARKER='SYNTHETIC-PRIVATE-PAGE-MARKER-7f3c';
const boundBrowser=process.env.CT_CHROME;
const INTENDED_FAILURE='synthetic after-render privacy fixture failure';
const EARLY_FAILURE='synthetic early fixture setup failure';
// The native whole-file cap is 60 s; two browser runs, one no-browser
// adversary, and both config imports have <60 s combined child ceilings.
const BROWSER_TIMEOUT_MS=17_000, EARLY_TIMEOUT_MS=6_000, CONFIG_TIMEOUT_MS=6_000;
const allowedEnv=['PATH','HOME','USERPROFILE','TMPDIR','TEMP','TMP','SYSTEMROOT','WINDIR','PLAYWRIGHT_BROWSERS_PATH'];
const isolatedEnv=()=>Object.fromEntries(allowedEnv.flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));

async function files(dir,{optionalRoot=true,readDirectory=readdir}={}){
  let entries;
  try {entries=await readDirectory(dir,{withFileTypes:true});}
  catch (error) {
    if(optionalRoot && error?.code==='ENOENT')return [];
    throw error;
  }
  const out=[];
  for(const entry of entries){
    const file=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await files(file,{optionalRoot:false,readDirectory}));
    else if(entry.isFile())out.push(file);
    else throw Error('unexpected non-regular entry in browser artifact directory');
  }
  return out;
}

async function failingRun({protect=false,early=false}={}){
  const dir=await mkdtemp(join(tmpdir(),'error-context-privacy-'));
  try {
    if(process.env.CI==='true')assert.ok(boundBrowser,'CI requires the same-job identity-bound Chromium');
    // Local-only page; never let this browser make an HTTP request.
    await writeFile(join(dir,'marker.spec.cjs'),early ? `const {test,expect}=require('@playwright/test');
test('fails during setup before browser work',async()=>{
  throw Error('${EARLY_FAILURE}');
  expect(1,'${INTENDED_FAILURE}').toBe(2);
});` : `const {test,expect}=require('@playwright/test');
test('fails after rendering synthetic private page content',async({page})=>{
  await page.route('**/*',route=>route.abort());
  await page.setContent('<p>${MARKER}</p>');
  await expect(page.locator('p')).toHaveText('${MARKER}');
  expect(1,'${INTENDED_FAILURE}').toBe(2);
});`);
    await writeFile(join(dir,'playwright.config.cjs'),`module.exports={
  testDir:'.',testMatch:'marker.spec.cjs',outputDir:'./out',reporter:[['json']],
  retries:0,workers:1,use:{browserName:'chromium',headless:true,trace:'off',screenshot:'off',video:'off'
  ${boundBrowser?',launchOptions:'+JSON.stringify({executablePath:boundBrowser}):''}}
};`);
    const env={...isolatedEnv(),NODE_PATH:join(root,'node_modules'),...(protect?{PLAYWRIGHT_NO_COPY_PROMPT:'1'}:{})};
    const run=spawnSync(process.execPath,[cli,'test','--config',join(dir,'playwright.config.cjs')],
      {cwd:root,env,encoding:'utf8',timeout:early?EARLY_TIMEOUT_MS:BROWSER_TIMEOUT_MS});
    assert.equal(run.error,undefined,'browser fixture must launch without spawn errors');
    assert.equal(run.signal,null,'browser fixture must finish without a child signal');
    assert.equal(run.status,1,'browser fixture must exit with one ordinary test failure');
    let report;
    try { report=JSON.parse(run.stdout); } catch { assert.fail('browser fixture did not emit a structured result'); }
    const specs=report.suites?.flatMap(s=>s.specs??[])??[];
    assert.equal(report.errors?.length,0,'collection/setup failures are not the intended browser failure');
    assert.equal(report.stats?.unexpected,1,'exactly one observed test failure is required');
    assert.equal(specs.length,1,'exactly one test must be collected');
    assert.equal(specs[0].tests?.length,1,'exactly one project test must run');
    const results=specs[0].tests[0].results;
    assert.equal(results?.length,1,'exactly one result is required, with no retries');
    assert.equal(results[0].status,'failed','a skip, interruption or timeout is not the intended failure');
    const errors=results[0].errors;
    assert.equal(errors?.length,1,'browser fixture requires exactly one error');
    const message=errors[0]?.message;
    if(early)assert.ok(typeof message==='string'&&message.includes(INTENDED_FAILURE)
      && message.split(/\r?\n/,1)[0]===`Error: ${EARLY_FAILURE}`,
      'setup adversary must contain the expected marker only in the following source frame');
    assert.equal(typeof message==='string'?message.split(/\r?\n/,1)[0]:null,`Error: ${INTENDED_FAILURE}`,
      'the browser must reach the deliberate assertion after rendering the marker');
    const written=await files(join(dir,'out'));
    const leaked=[];for(const f of written)if((await readFile(f)).includes(MARKER))leaked.push(f.slice(dir.length));
    return {written:written.map(f=>f.slice(dir.length)),leaked};
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
}

test('artifact scan tolerates only a missing optional root, not an inaccessible or disappearing directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'error-context-artifact-search-'));
  const out=join(root,'out'),nested=join(out,'nested');
  try {
    assert.deepEqual(await files(out),[]);
    await writeFile(out,'not an artifact directory');
    await assert.rejects(files(out),{code:'ENOTDIR'});
    await rm(out);
    await mkdir(nested,{recursive:true});
    await writeFile(join(nested,'failure.txt'),'synthetic');
    assert.deepEqual(await files(out),[join(nested,'failure.txt')]);
    await assert.rejects(files(out,{readDirectory:async(dir,options)=>{
      if(dir===nested)await rm(nested,{recursive:true});
      return readdir(dir,options);
    }}),{code:'ENOENT'});
    await assert.rejects(files(out,{readDirectory:async()=>{
      throw Object.assign(new Error('synthetic unreadable output'),{code:'EACCES'});
    }}),{code:'EACCES'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a setup failure whose source frame happens to mention the intended assertion is rejected',async()=>{
  await assert.rejects(failingRun({protect:true,early:true}),/the browser must reach the deliberate assertion/);
});

test('without the setting a failure writes the page content into error-context.md (the control can see a leak)',{timeout:25_000},async()=>{
  const r=await failingRun({});
  assert.ok(r.written.some(f=>f.endsWith('error-context.md')),JSON.stringify(r.written));
  assert.ok(r.leaked.length>0,'the marker should appear in the unprotected artifact');
});

test('with PLAYWRIGHT_NO_COPY_PROMPT=1 a failure writes no error-context and no artifact holds the page content',{timeout:25_000},async()=>{
  const r=await failingRun({protect:true});
  assert.equal(r.written.some(f=>f.endsWith('error-context.md')),false,JSON.stringify(r.written));
  assert.deepEqual(r.leaked,[]);
});

test('the in-app comparison config refuses to load without the setting',()=>{
  const base={...isolatedEnv(),EVAL_APP_URL:'http://127.0.0.1:5174',EVAL_PRIVATE_OUTPUT:tmpdir(),EVAL_BROWSER_WS_ENDPOINT:'ws://127.0.0.1:9/x'};
  delete base.PLAYWRIGHT_NO_COPY_PROMPT;
  const load=env=>spawnSync(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),'-e',
    `import(${JSON.stringify(join(root,'tests/model-dropin/playwright.in-app.config.ts'))}).then(()=>console.log('LOADED'),e=>{console.error(String(e));process.exit(3);})`],
    {cwd:root,env,encoding:'utf8',timeout:CONFIG_TIMEOUT_MS});
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
