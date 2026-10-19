// Local execution transport only. Preserves original runner, model and decoding code.
import { chromium } from './browser-pm-v2-v4-execution/node_modules/playwright/index.mjs';
import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = '/workspace/scratch/561ce7272c04';
const pins = JSON.parse(await readFile(root + '/browser-pm-v2-v4-execution/tests/fixtures/hf-asset-pins.json', 'utf8')).assets;
const log = async (value) => appendFile(root + '/pm-eval-transport.log', JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
const originalLaunch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await originalLaunch(...args);
  browser.on('disconnected', () => { void log({browserDisconnected:true}); });
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...pageArgs) => {
    const page = await newPage(...pageArgs);
    page.on('pageerror', error => { void log({pageError:String(error)}); });
    page.on('console', message => { if (['error','warning'].includes(message.type())) void log({consoleType:message.type(),consoleMessage:message.text()}); });
    page.context().on('requestfailed', request => { void log({failed:request.url(), reason:request.failure()}); });
    await page.context().route('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/*', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      if (!['ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm'].includes(name)) {
        await route.abort('blockedbyclient'); return;
      }
      const body = await readFile(root + '/browser-pm-v2-v4-execution/node_modules/onnxruntime-web/dist/' + name);
      await log({installedRuntimeAsset:name,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});
      await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'},contentType:name.endsWith('.mjs')?'text/javascript':'application/wasm',body});
    });
    await page.context().route('https://huggingface.co/onnx-community/whisper-base.en/resolve/main/**', async route => {
      const key = new URL(route.request().url()).pathname.slice(1);
      const relative = key.split('/resolve/main/')[1];
      const expected = pins[key];
      if (!expected || !relative || relative.includes('..')) {
        await log({unlistedAsset:key,method:route.request().method()});
        await route.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:'Unlisted optional model asset'});
        return;
      }
      const body = await readFile(root + '/pm-v4-base-cache/' + relative);
      const digest = createHash('sha256').update(body).digest('hex');
      if (digest !== (typeof expected === 'string' ? expected : expected.sha256)) throw Error('Cached model hash mismatch: '+key);
      await log({verifiedAsset:key, method:route.request().method(), bytes:body.length, sha256:digest});
      if (process.env.PM_EVAL_CACHE_ORIGIN) {
        await route.fulfill({status:302,headers:{'access-control-allow-origin':'*',location:process.env.PM_EVAL_CACHE_ORIGIN+'/'+relative},body:''});
        return;
      }
      await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-length':String(body.length)},contentType:relative.endsWith('.json')?'application/json':'application/octet-stream',body:route.request().method()==='HEAD'?Buffer.alloc(0):body});
    });
    return page;
  };
  return browser;
};
