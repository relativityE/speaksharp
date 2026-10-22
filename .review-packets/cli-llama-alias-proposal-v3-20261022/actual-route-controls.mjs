// Execute the actual proposed manifest loop/HTTP/egress handlers, extracted
// from the complete candidate. No engine initialization or generation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join,basename} from 'node:path';
import {createServer,request} from 'node:http';
import {connectLocalCdp,localCdpOwner} from '/private/tmp/speaksharp-cli-raw-output-20261021/scripts/model-evaluator/cdp-browser.ts';
const require=createRequire('/private/tmp/speaksharp-cli-raw-output-20261021/package.json');
const {transformSync}=require('esbuild');const {chromium}=require('playwright');
const base='/Users/fibonacci/SW_Dev/delivery-support/cli-llama-alias-proposal-v3-20261022';
const source=await readFile(base+'/runner-proposed.mts','utf8');
const before=await readFile(base+'/runner-before.mts','utf8');
const sha=data=>createHash('sha256').update(data).digest('hex');
const cacheRoot='/private/tmp/speaksharp-model-assets-1304';
const assets=JSON.parse(await readFile(cacheRoot+'/verified-manifest.json','utf8'));
const region=(text,start,end)=>{const i=text.indexOf(start);assert.ok(i>=0);const j=text.indexOf(end,i);assert.ok(j>i);return text.slice(i,j);};
const loop=region(source,'  const routes=new Map','  report.verifiedAssets=verified;');
const compile=text=>transformSync(text,{loader:'ts',target:'esnext'}).code;
const build=new Function(compile(`async function build(assets,kind,cacheRoot,resolve,join,basename,readFile,sha){${loop}\nreturn {routes,verified};}`)+'\nreturn build;')();
const handler=region(source,'  const server=createServer','  await new Promise<void>(done=>server.listen');
const serve=new Function(compile(`function serve(createServer,createReadStream,routes){${handler}\nreturn server;}`)+'\nreturn serve;')();
const routeCallback=region(source,"  await deadline(context.route('**/*',", "),10000,'CONTEXT_ROUTE');")
  .slice("  await deadline(context.route('**/*',".length);
const egress=new Function('origin','violations','return ('+routeCallback+');');
const report={startedUtc:new Date().toISOString(),sourceSha256:sha(source),preimageSha256:sha(before),
  extracted:{loopSha256:sha(loop),serverSha256:sha(handler),egressSha256:sha(routeCallback)},
  engineLoads:0,generationCalls:0,providerCalls:0,status:'FAIL',http:[]};
let server,context;
function get(port,path,method='GET'){
  return new Promise((resolveResult,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method},res=>{
      const hash=createHash('sha256');let bytes=0;
      res.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});
      res.on('end',()=>resolveResult({path,method,status:res.statusCode,bytes,sha256:hash.digest('hex')}));
      res.on('error',reject);
    });req.on('error',reject);req.end();
  });
}
try {
  const built=await build(assets,'llama',cacheRoot,resolve,join,basename,readFile,sha);
  const {routes,verified}=built;
  assert.equal(verified.length,28);
  assert.equal(routes.size,55);
  const bindings=[];
  for(const asset of verified){
    const direct=`/assets/${asset.group}/${asset.path}`;
    const local=asset.group==='llama-runtime'?join(cacheRoot,basename(asset.path)):join(cacheRoot,asset.group,asset.path);
    assert.equal(routes.get(direct),local);
    const alias=asset.group==='llama'?`/assets/llama/resolve/main/${asset.path}`:null;
    if(alias)assert.equal(routes.get(alias),routes.get(direct));
    bindings.push({...asset,direct,alias,local});
  }
  report.bindings=bindings;
  report.hashVerifiedDiskBytes=verified.reduce((n,a)=>n+a.bytes,0);
  // Actual builder rejects collision and digest drift before serving anything.
  const duplicate=structuredClone(assets);duplicate.assets.push(duplicate.assets.find(a=>a.group==='llama'));
  await assert.rejects(build(duplicate,'llama',cacheRoot,resolve,join,basename,readFile,sha),/route collision/);
  const drift=structuredClone(assets);const altered=drift.assets.find(a=>a.group==='llama');
  altered.verified_sha256='0'.repeat(64);altered.sha256='0'.repeat(64);
  await assert.rejects(build(drift,'llama',cacheRoot,resolve,join,basename,readFile,sha),/asset integrity mismatch/);
  report.builderNegativeControls={duplicateRejected:true,digestDriftRejected:true};
  // Coverage is derived from actual config/weight references, not a hand list.
  const config=JSON.parse(await readFile(cacheRoot+'/llama/mlc-chat-config.json','utf8'));
  const tensors=JSON.parse(await readFile(cacheRoot+'/llama/tensor-cache.json','utf8'));
  const required=['mlc-chat-config.json','tensor-cache.json',...config.tokenizer_files,...tensors.records.map(r=>r.dataPath)];
  assert.equal(new Set(required).size,26);
  for(const name of required)assert.ok(routes.has('/assets/llama/resolve/main/'+name),name);
  assert.ok(routes.has('/assets/llama-runtime/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm'));
  report.referenceCoverage={config:1,tokenizers:config.tokenizer_files.length,weightManifest:1,shards:tensors.records.length,runtimeLibraries:1};
  server=serve(createServer,createReadStream,routes);
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const port=server.address().port;const origin='http://127.0.0.1:'+port;
  // Stream and hash every route response without keeping large weight buffers.
  for(const asset of bindings){
    for(const path of [asset.direct,...(asset.alias?[asset.alias]:[])]){
      const result=await get(port,path);
      assert.equal(result.status,200,path);assert.equal(result.bytes,asset.bytes,path);assert.equal(result.sha256,asset.sha256,path);
      report.http.push(result);
    }
  }
  const refused=[
    ['/assets/llama/resolve/main/unknown.json',404],
    ['/assets/llama/resolve/main/%6dlc-chat-config.json',400],
    ['/assets/llama/resolve/main/%2e%2e/mlc-chat-config.json',400],
    ['/assets/llama/resolve/main/../../mlc-chat-config.json',400],
    ['/assets/llama/resolve/main/%2Fetc%2Fpasswd',400],
    ['/assets/llama/resolve/main/..\\mlc-chat-config.json',400],
    ['/etc/passwd',404],
  ];
  report.rejected=[];
  for(const [path,status] of refused){const result=await get(port,path);assert.equal(result.status,status,path);report.rejected.push(result);}
  const method=await get(port,'/assets/llama/resolve/main/mlc-chat-config.json','POST');assert.equal(method.status,405);
  report.methodControl=method;
  // Same-origin Cache API against the actual extracted HTTP handler.
  const attached=await connectLocalCdp({endpoint:'http://127.0.0.1:9222',owner:localCdpOwner,
    connect:ws=>chromium.connectOverCDP(ws,{timeout:5000})});
  report.owner=attached.owner;context=await attached.browser.newContext();
  const violations=[];await context.route('**/*',egress(origin,violations));
  const page=await context.newPage();await page.goto(origin);
  report.browser=await page.evaluate(async origin=>{
    const name='cli-extracted-map-control';const cache=await caches.open(name);
    await cache.add(origin+'/assets/llama/resolve/main/mlc-chat-config.json');
    await cache.add(origin+'/assets/llama/mlc-chat-config.json');
    const attempt=async(url,options)=>{try{await fetch(url,options);return false;}catch{return true;}};
    const postBlocked=await attempt(origin+'/assets/llama/mlc-chat-config.json',{method:'POST'});
    const foreignBlocked=await attempt('https://not-contacted.invalid/model.json');
    await caches.delete(name);return {normalizedCache:true,directCache:true,postBlocked,foreignBlocked};
  },origin);
  assert.deepEqual(report.browser,{normalizedCache:true,directCache:true,postBlocked:true,foreignBlocked:true});
  assert.equal(violations.length,2);report.egressNegativeControls=violations;
  // Serving did not modify validated cache files; reverify all source digests.
  const after=await build(assets,'llama',cacheRoot,resolve,join,basename,readFile,sha);
  assert.deepEqual(after.verified,verified);
  report.validatedFilesUnchanged=true;
  report.status='ACTUAL_EXTRACTED_ROUTE_BUILDER_CONTROLS_PASS_NOT_ACQUISITION';
}catch(error){report.error=String(error);}
finally{
  if(context){await context.close();report.ownedContext='CLOSED';}
  if(server)await new Promise(done=>{server.closeAllConnections();server.close(done);});
  report.finishedUtc=new Date().toISOString();
  await writeFile(base+'/actual-route-controls.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({status:report.status,error:report.error??null,routes:report.http.length,browser:report.browser,engineLoads:0}));
process.exit(report.status==='ACTUAL_EXTRACTED_ROUTE_BUILDER_CONTROLS_PASS_NOT_ACQUISITION'?0:1);
