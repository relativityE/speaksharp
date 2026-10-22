// Model-free proposed-fix control; frozen evaluator source remains unchanged.
// No CreateMLCEngine, model weights, GPU request, coaching or provider call.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {connectLocalCdp,localCdpOwner} from '/private/tmp/speaksharp-cli-raw-output-20261021/scripts/model-evaluator/cdp-browser.ts';
const require=createRequire('/private/tmp/speaksharp-cli-raw-output-20261021/package.json');
const {chromium}=require('playwright');
const sdkPath=require.resolve('@mlc-ai/web-llm');
const sdk=readFileSync(sdkPath,'utf8');
const declaration=sdk.match(/function cleanModelUrl\(modelUrl\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(declaration,'actual installed SDK URL normalizer must exist');
const normalize=new Function('return ('+declaration+')')();
const config=readFileSync('/private/tmp/speaksharp-model-assets-1304/llama/mlc-chat-config.json');
const requests=[];
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const status=path==='/'||path==='/assets/llama/mlc-chat-config.json'
    ||path==='/assets/llama/resolve/main/mlc-chat-config.json'?200:404;
  requests.push({path,status});
  res.setHeader('Cache-Control','no-store');
  res.writeHead(status,{'Content-Type':path==='/'?'text/html':'application/json'});
  res.end(path==='/'?'<title>Model-free cache URL control</title>':status===200?config:'not in verified allowlist');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context;
const report={startedUtc:new Date().toISOString(),sdkPath,sdkSha256:createHash('sha256').update(sdk).digest('hex'),
  modelCalls:0,weightsRead:0,providerCalls:0,requests,status:'FAIL'};
try {
  const origin='http://127.0.0.1:'+server.address().port;
  const base=origin+'/assets/llama/';
  const normalized=normalize(base);
  report.urls={declaredBase:base,sdkNormalizedBase:normalized,
    sdkConfig:new URL('mlc-chat-config.json',normalized).href,directConfig:new URL('mlc-chat-config.json',base).href};
  assert.equal(normalized,base+'resolve/main/');
  const attached=await connectLocalCdp({endpoint:'http://127.0.0.1:9222',owner:localCdpOwner,
    connect:ws=>chromium.connectOverCDP(ws,{timeout:5000})});
  report.owner=attached.owner;
  context=await attached.browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();
  await page.goto(origin);
  report.cache=await page.evaluate(async urls=>{
    const name='cli-model-free-url-control';const cache=await caches.open(name);
    const attempt=async url=>{try{await cache.add(url);return {ok:true};}catch(error){return {ok:false,error:String(error)};}};
    const normalized=await attempt(urls.sdkConfig);const good=await attempt(urls.directConfig);
    const unknown=await attempt(new URL('not-allowlisted.json',urls.sdkNormalizedBase).href);
    await caches.delete(name);return {sdkNormalized:normalized,directAllowlisted:good,unknown};
  },report.urls);
  assert.equal(report.cache.sdkNormalized.ok,true);
  assert.equal(report.cache.directAllowlisted.ok,true);
  assert.equal(report.cache.unknown.ok,false);
  assert.match(report.cache.unknown.error,/Request failed/);
  assert.ok(requests.some(row=>row.path==='/assets/llama/resolve/main/mlc-chat-config.json'&&row.status===200));
  assert.ok(requests.some(row=>row.path==='/assets/llama/resolve/main/not-allowlisted.json'&&row.status===404));
  assert.ok(requests.some(row=>row.path==='/assets/llama/mlc-chat-config.json'&&row.status===200));
  report.status='MODEL_FREE_ALIAS_CONTROL_PASS_NOT_MODEL_INFERENCE';
} catch(error){report.error=String(error);}
finally {
  if(context){await context.close();report.ownedContext='CLOSED';}
  await new Promise(resolve=>server.close(resolve));
  report.finishedUtc=new Date().toISOString();
  writeFileSync('/Users/fibonacci/SW_Dev/delivery-support/cli-llama-cache-alias-control-20261022.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify(report));
process.exit(report.status==='MODEL_FREE_ALIAS_CONTROL_PASS_NOT_MODEL_INFERENCE'?0:1);
