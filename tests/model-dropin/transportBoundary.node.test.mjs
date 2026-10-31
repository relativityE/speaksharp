import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {URL} from 'node:url';
import {chromium} from 'playwright';
import {fetchAdmittedResponse} from './transportBoundary.ts';
import {groupState} from './ownedCleanup.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {constants as bufferConstants} from 'node:buffer';
import {indexCachedAssets,startVerifiedAssetHttpServer,installChunkedCachedModelFetch,comparisonInitPage,CACHE_CHUNK_BYTES,CACHE_DIRECT_MAX_BYTES} from './cachedModelAssets.ts';
import {injectAlignedFixtureAudio} from '../live/helpers/fixtureAudioStream.ts';
import {fileURLToPath} from 'node:url';
async function listen(handler){const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,origin:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}
test('actual installed Chrome refuses every redirect before forwarding, including cached transfers',{timeout:30_000},async t=>{
  let forbiddenHits=0;let cacheHits=0;let originalPinnedHits=0;
  const target=await listen((_req,res)=>{forbiddenHits++;res.end('forbidden target');});
  const cache=await listen((req,res)=>{cacheHits++;res.setHeader('Access-Control-Allow-Origin','*');
    if(req.url==='/redirect'){res.writeHead(307,{Location:target.origin+'/leak'});res.end();}else res.end('synthetic verified bytes');});
  const app=await listen((req,res)=>{
    if(req.url.startsWith('/redirect/')){res.writeHead(Number(req.url.split('/').pop()),{Location:target.origin+'/leak'});res.end();}
    else if(req.url==='/pin'||req.url==='/bad-pin'){originalPinnedHits++;res.end('must not fetch original pin');}
    else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>controlled transport fixture</title>');}
  });
  let browser;
  let browserServer;
  try{
    browserServer=await chromium.launchServer({channel:'chrome',headless:true,chromiumSandbox:true});
    assert.equal(groupState(browserServer.process().pid),'live');
    browser=await chromium.connect(browserServer.wsEndpoint());
    t.diagnostic('installed isolated Chrome '+browser.version()+'; explicit browser process group is live');
    const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
    const rejected=[];let assetAdmissions=0;
    const budget={admit:({url})=>{assert.equal(new URL(url).origin,app.origin);},admitCachedAsset:()=>{assetAdmissions++;},
      rejectTransport:code=>{rejected.push(code);throw Error(code);}};
    const delivery={lookup:url=>url===app.origin+'/pin'?cache.origin+'/bytes':url===app.origin+'/bad-pin'?cache.origin+'/redirect':null,
      permits:url=>new URL(url).origin===cache.origin};
    await context.route('**/*',async route=>{
      let response;
      try{response=await fetchAdmittedResponse(route,budget,delivery);await route.fulfill({response});}
      catch{await route.abort();}finally{await response?.dispose();}
    });
    await page.goto(app.origin+'/seed');
    for(const status of [301,302,303,307,308]){
      const failed=await page.evaluate(async url=>{try{await globalThis.fetch(url);return false;}catch{return true;}},app.origin+'/redirect/'+status);
      assert.equal(failed,true);assert.equal(forbiddenHits,0);
    }
    const postFailed=await page.evaluate(async url=>{try{await globalThis.fetch(url,{method:'POST',body:'synthetic redirect control'});return false;}catch{return true;}},app.origin+'/redirect/307');
    assert.equal(postFailed,true);assert.equal(forbiddenHits,0);
    const payload=await page.evaluate(async url=>(await globalThis.fetch(url)).text(),app.origin+'/pin');
    assert.equal(payload,'synthetic verified bytes');assert.equal(cacheHits,1);assert.equal(originalPinnedHits,0);assert.equal(assetAdmissions,2);
    const failed=await page.evaluate(async url=>{try{await globalThis.fetch(url);return false;}catch{return true;}},app.origin+'/bad-pin');
    assert.equal(failed,true);assert.equal(cacheHits,2);assert.equal(forbiddenHits,0);assert.equal(assetAdmissions,4);
    assert.deepEqual(rejected,Array(7).fill('bounded_redirect_refused'));
    await context.close();
  }finally{await browser?.close();const pid=browserServer?.process().pid;await browserServer?.close();
    if(pid)assert.equal(groupState(pid),'absent');await app.close();await cache.close();await target.close();}
});
test('actual Chrome reassembles bounded verified-cache ranges without large base64 bodies or original-host fetches',{timeout:30_000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'cache-range-control-'));const body='abcdefghijklmnopqrstuvwxyz';const file=join(directory,'synthetic.bin');await writeFile(file,body);
  let originalHits=0;const app=await listen((req,res)=>{if(req.url==='/asset.bin')originalHits++;res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>range control</title>');});
  const pin={url:app.origin+'/asset.bin',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
  const index=await indexCachedAssets([pin],[{...pin,file}]);const cache=await startVerifiedAssetHttpServer(index,app.origin);
  let browserServer;let browser;
  try{
    assert(4*Math.ceil(CACHE_DIRECT_MAX_BYTES/3)<bufferConstants.MAX_STRING_LENGTH);assert(CACHE_CHUNK_BYTES<CACHE_DIRECT_MAX_BYTES);
    browserServer=await chromium.launchServer({channel:'chrome',headless:true,chromiumSandbox:true});browser=await chromium.connect(browserServer.wsEndpoint());
    const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();let admissions=0;
    const budget={admit:({url})=>assert.equal(new URL(url).origin,app.origin),admitCachedAsset:()=>admissions++,rejectTransport:code=>{throw Error(code);}};
    await context.route('**/*',async route=>{let response;try{response=await fetchAdmittedResponse(route,budget,cache);await route.fulfill({response});}finally{await response?.dispose();}});
    const fixture=fileURLToPath(new URL('../evidence/fixtures/corpus/fixture-001.wav',import.meta.url));
    const oldPage=await context.newPage();const oldErrors=[];oldPage.on('pageerror',error=>oldErrors.push(error.message));
    await injectAlignedFixtureAudio(oldPage,fixture,{playback:'controlled-once'});await oldPage.goto(app.origin+'/seed');
    assert(oldErrors.some(message=>message.includes('__name')),'old serialized fixture reproduces missing closure');
    assert.equal(await oldPage.evaluate(()=>navigator.mediaDevices.getUserMedia.toString().includes('__ss_fixtureGumCalls__')),false);
    await oldPage.close();
    const fixturePage=comparisonInitPage(page);
    await fixturePage.addInitScript(installChunkedCachedModelFetch,{assets:[{url:pin.url,bytes:pin.bytes}],chunkBytes:4});
    await injectAlignedFixtureAudio(fixturePage,fixture,{playback:'controlled-once'});
    await page.goto(app.origin+'/seed');
    assert.equal(await page.evaluate(()=>typeof window.__ss_playFixtureOnce__==='function'&&navigator.mediaDevices.getUserMedia.toString().includes('__ss_fixtureGumCalls__')),true);
    const result=await page.evaluate(async url=>{const r=await fetch(url);return {status:r.status,length:r.headers.get('Content-Length'),text:await r.text()};},pin.url);
    assert.deepEqual(result,{status:200,length:String(pin.bytes),text:body});assert.equal(originalHits,0);assert.equal(admissions,14);
    assert.equal(cache.snapshot().cacheResponseCount,7);assert.equal(cache.snapshot().scheduledResponseBytes,pin.bytes);
    for(const range of ['bytes=0-999','bytes=0-1,3-4','bytes=-1','bytes=2-1']){
      const response=await fetch(cache.lookup(pin.url),{headers:{Range:range}});assert.equal(response.status,416);
    }
    assert.equal((await fetch(new URL('/unlisted',cache.lookup(pin.url)))).status,403);
    await context.close();t.diagnostic('real browser range assembly, seven admitted transfers, exact hash-compatible bytes, invalid/multi/out-of-bounds ranges refused');
  }finally{await browser?.close();const pid=browserServer?.process().pid;await browserServer?.close();if(pid)assert.equal(groupState(pid),'absent');await cache.close();await app.close();await rm(directory,{recursive:true,force:true});}
});
