import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ENDPOINT = 'http://127.0.0.1:9222';
export const FLOOR = 2 * 1024 ** 3;
export function availableMemory(raw) {
  const total=/system has (\d+)/.exec(raw), free=/free percentage: (\d+)%/.exec(raw);
  if(!total || !free) throw Error('MEMORY_ACCOUNTING_UNAVAILABLE');
  return Number(total[1])*Number(free[1])/100;
}
export function validateEndpoint(version) {
  if(!/^Chrome\/156\./.test(version?.Browser??'')) throw Error('UNEXPECTED_OWNER_BROWSER_VERSION');
  const ws=new URL(version.webSocketDebuggerUrl);
  if(ws.protocol!=='ws:' || ws.hostname!=='127.0.0.1' || ws.port!=='9222' || !ws.pathname.startsWith('/devtools/browser/'))
    throw Error('NONLOCAL_BROWSER_ENDPOINT_REFUSED');
}
const bounded=(promise,ms,label)=>{
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TIMEOUT_'+label)),ms);})])
    .finally(()=>clearTimeout(timer));
};
// Injected dependencies allow ownership/failure controls without a real browser.
export async function runAttachProbe({memory,version,connect,origin,inspect,report}) {
  if(availableMemory(memory)<FLOOR) throw Error('HOLD_RESOURCE_HEADROOM_BELOW_2GIB');
  validateEndpoint(version);
  let context;
  try {
    report.stage='CDP_CONNECT';
    const browser=await bounded(connect(ENDPOINT),5000,'CONNECT');
    report.browserVersion=browser.version();
    report.stage='CREATE_OWNED_CONTEXT';
    context=await bounded(browser.newContext(),5000,'CONTEXT');
    report.ownedContextCreated=true;
    await context.route('**/*',route=>{
      const url=route.request().url();
      return url.startsWith(origin+'/')?route.continue():route.abort();
    });
    const page=await bounded(context.newPage(),5000,'PAGE');
    page.on('crash',()=>{report.pageCrash=true;});
    page.on('pageerror',error=>{report.pageErrors.push(error.message);});
    report.stage='OWNED_PAGE';
    await page.goto(origin,{timeout:5000});
    report.result=await bounded(inspect(page),8000,'ADAPTER_WORKER');
    for(const arm of ['page','worker']) {
      const adapter=report.result[arm];
      if(adapter?.available!==true || adapter.fallback!==false || adapter.f16!==true)
        throw Error('HARDWARE_F16_GATE_FAILED_'+arm);
    }
    if(report.pageCrash || report.pageErrors.length) throw Error('OWNED_PAGE_ERROR');
    report.stage='MODEL_FREE_ATTACH_PASS';
  } finally {
    if(context) {
      await bounded(context.close(),3000,'OWNED_CONTEXT_CLOSE');
      report.ownedContextClosed=true;
    }
    // Never browser.close(), browserServer.close(), process.kill(), or enumerate
    // the owner's contexts/tabs. This standalone process exits to drop its CDP socket.
    report.ownerBrowserCloseOrKillAttempted=false;
    report.transportCleanup='DISCONNECT_BY_STANDALONE_PROBE_EXIT';
  }
}
async function inspect(page) {
  return page.evaluate(async()=>{
    async function adapterInfo() {
      const adapter=await navigator.gpu?.requestAdapter();
      if(!adapter)return {available:false};
      return {available:true,vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,
        fallback:adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
        f16:adapter.features.has('shader-f16')};
    }
    const main=await adapterInfo();
    const source=`self.onmessage=async()=>{try{const a=await navigator.gpu?.requestAdapter();self.postMessage(a?{available:true,vendor:a.info?.vendor,architecture:a.info?.architecture,fallback:a.info?.isFallbackAdapter??a.isFallbackAdapter??null,f16:a.features.has('shader-f16')}:{available:false});}catch(e){self.postMessage({error:String(e)});}}`;
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const worker=new Worker(url);
    try {
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('WORKER_TIMEOUT')),4000);
        worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
        worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};
        worker.postMessage('MODEL_FREE_ADAPTER_CHECK');
      });
      return {page:main,worker:result,crossOriginIsolated:self.crossOriginIsolated};
    } finally {worker.terminate();URL.revokeObjectURL(url);}
  });
}
async function main() {
  const out=process.argv[2];
  if(!/^\/private\/tmp\/cli-cdp-attach-probe-20261021-attempt\d+\.json$/.test(out??'') || existsSync(out))
    throw Error('FRESH_OWNED_RECEIPT_REQUIRED');
  const report={startedUtc:new Date().toISOString(),status:'RUNNING',modelCalls:0,modelAssetRequests:0,
    ownerBrowserProvidedByPO:true,personalTabsEnumerated:false,pageErrors:[],stage:'MEMORY_PREFLIGHT'};
  let server;
  try {
    report.memoryPressure=execFileSync('memory_pressure',['-Q'],{encoding:'utf8',timeout:2000}).trim();
    report.availableBytes=availableMemory(report.memoryPressure);
    if(report.availableBytes<FLOOR) throw Error('HOLD_RESOURCE_HEADROOM_BELOW_2GIB');
    const version=await bounded(fetch(ENDPOINT+'/json/version',{signal:AbortSignal.timeout(3000)}).then(r=>{
      if(!r.ok)throw Error('CDP_VERSION_HTTP_'+r.status);return r.json();
    }),4000,'VERSION');
    validateEndpoint(version);
    report.endpointVersion=version.Browser;
    server=createServer((req,res)=>{
      if(req.url!=='/'){res.writeHead(404);res.end();return;}
      res.setHeader('Cross-Origin-Opener-Policy','same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>SpeakSharp owned model-free CDP check</title>');
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    const {chromium}=await import('/private/tmp/speaksharp-cli-product-models-20261020/node_modules/playwright/index.mjs');
    await runAttachProbe({memory:report.memoryPressure,version,origin,inspect,report,
      connect:endpoint=>chromium.connectOverCDP(endpoint,{timeout:5000})});
    report.status='PASS_MODEL_FREE_ATTACH_ONLY';
  } catch(error) {report.status=String(error).includes('HOLD_')?'HOLD':'FAIL';report.error=String(error);}
  finally {
    server?.closeAllConnections();server?.close();
    report.finishedUtc=new Date().toISOString();writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  console.log(JSON.stringify({out,status:report.status,stage:report.stage,result:report.result,error:report.error}));
  // Explicit exit closes only this probe's sockets, never the owner browser.
  process.exit(report.status==='PASS_MODEL_FREE_ATTACH_ONLY'?0:report.status==='HOLD'?2:1);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
