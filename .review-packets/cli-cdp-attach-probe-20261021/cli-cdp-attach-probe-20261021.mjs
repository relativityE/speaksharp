import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readlinkSync, writeFileSync } from 'node:fs';
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
  if(ws.protocol!=='ws:' || ws.hostname!=='127.0.0.1' || ws.port!=='9222' || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(ws.pathname) || ws.username || ws.password || ws.search || ws.hash)
    throw Error('NONLOCAL_BROWSER_ENDPOINT_REFUSED');
  return ws.href;
}
export async function discoverBrowser(fetchImpl=fetch) {
  const response=await fetchImpl(ENDPOINT+'/json/version',{redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!response.ok) throw Error('CDP_VERSION_HTTP_'+response.status);
  const version=await response.json();
  return {version,webSocketUrl:validateEndpoint(version)};
}
export function verifyOwner() {
  const listing=execFileSync('lsof',['-nP','-iTCP:9222','-sTCP:LISTEN','-Fpn'],{encoding:'utf8',timeout:2000});
  const pids=[...new Set([...listing.matchAll(/^p(\d+)$/gm)].map(m=>m[1]))];
  const addresses=[...listing.matchAll(/^n(.+)$/gm)].map(m=>m[1]);
  if(pids.length!==1 || !addresses.length || addresses.some(a=>a!=='127.0.0.1:9222')) throw Error('OWNER_LISTENER_MISMATCH');
  const command=execFileSync('ps',['-p',pids[0],'-o','command='],{encoding:'utf8',timeout:2000}).trim();
  const profile='/Users/fibonacci/speaksharp-eval-profile';
  const expected='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir='+profile+' --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1';
  if(command!==expected || !readlinkSync(profile+'/SingletonLock').endsWith('-'+pids[0])) throw Error('OWNER_PROFILE_PID_MISMATCH');
  return {verifiedUtc:new Date().toISOString(),pid:Number(pids[0]),listener:'127.0.0.1:9222',profile,
    commandMatches:true,singletonLockMatches:true,provenance:'PO current chat Im up; command ownership receipt Slack1792604022.349099',
    signedOut:'PO attestation; profile contents not inspected'};
}
const bounded=(promise,ms,label)=>{
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TIMEOUT_'+label)),ms);})])
    .finally(()=>clearTimeout(timer));
};
// Injected dependencies allow ownership/failure controls without a real browser.
export async function runAttachProbe({memory,version,connect,origin,inspect,report,timeoutMs=30000}) {
  if(availableMemory(memory)<FLOOR) throw Error('HOLD_RESOURCE_HEADROOM_BELOW_2GIB');
  const websocket=validateEndpoint(version);
  const end=Date.now()+timeoutMs, reserve=Math.min(3000,timeoutMs/4);
  const step=(promise,cap,label)=>bounded(promise,Math.max(1,Math.min(cap,end-reserve-Date.now())),label);
  let context;
  try {
    report.stage='CDP_CONNECT';
    const browser=await step(connect(websocket),5000,'CONNECT');
    report.browserVersion=browser.version();
    if(report.browserVersion!==version.Browser.slice('Chrome/'.length)) throw Error('ATTACHED_BROWSER_VERSION_MISMATCH');
    report.stage='CREATE_OWNED_CONTEXT';
    report.ownedContextRequested=true;
    let contextTimedOut=false;
    const creating=browser.newContext().then(async created=>{
      if(contextTimedOut){await created.close();return null;}
      return created;
    });
    try {context=await step(creating,5000,'CONTEXT');}
    catch(error){contextTimedOut=true;report.contextCreationCleanup='UNVERIFIED_IF_REQUEST_COMPLETES_AFTER_DISCONNECT';throw error;}
    report.ownedContextCreated=true;
    await step(context.route('**/*',route=>{
      const url=route.request().url();
      return url.startsWith(origin+'/')?route.continue():route.abort();
    }),5000,'ROUTE_SETUP');
    const page=await step(context.newPage(),5000,'PAGE');
    page.on('crash',()=>{report.pageCrash=true;});
    page.on('pageerror',error=>{report.pageErrors.push(error.message);});
    report.stage='OWNED_PAGE';
    await step(page.goto(origin,{timeout:5000}),5000,'NAVIGATION');
    report.result=await step(inspect(page),8000,'ADAPTER_WORKER');
    for(const arm of ['page','worker']) {
      const adapter=report.result[arm];
      if(adapter?.available!==true || adapter.fallback!==false || adapter.f16!==true)
        throw Error('HARDWARE_F16_GATE_FAILED_'+arm);
    }
    if(report.pageCrash || report.pageErrors.length) throw Error('OWNED_PAGE_ERROR');
    report.stage='MODEL_FREE_ATTACH_PASS';
  } finally {
    if(context) {
      await bounded(context.close(),Math.max(1,Math.min(3000,end-Date.now())),'OWNED_CONTEXT_CLOSE');
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
    personalTabsEnumerated:false,pageErrors:[],stage:'MEMORY_PREFLIGHT',overallBudgetMs:45000};
  const hardDeadline=setTimeout(()=>{
    report.status='FAIL_OVERALL_DEADLINE';report.finishedUtc=new Date().toISOString();
    report.cleanupVerified=false;report.transportCleanup='PROBE_PROCESS_EXIT_ONLY_OWNER_BROWSER_UNTOUCHED';
    writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});process.exit(1);
  },45000);
  let server;
  try {
    report.memoryPressure=execFileSync('memory_pressure',['-Q'],{encoding:'utf8',timeout:2000}).trim();
    report.availableBytes=availableMemory(report.memoryPressure);
    if(report.availableBytes<FLOOR) throw Error('HOLD_RESOURCE_HEADROOM_BELOW_2GIB');
    report.owner=verifyOwner();
    const {version}=await bounded(discoverBrowser(),4000,'VERSION');
    report.endpointVersion=version.Browser;
    server=createServer((req,res)=>{
      if(req.url!=='/'){res.writeHead(404);res.end();return;}
      res.setHeader('Cross-Origin-Opener-Policy','same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>SpeakSharp owned model-free CDP check</title>');
    });
    await bounded(new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}),3000,'SERVER_SETUP');
    const origin='http://127.0.0.1:'+server.address().port;
    const {chromium}=await bounded(import('/private/tmp/speaksharp-cli-product-models-20261020/node_modules/playwright/index.mjs'),3000,'SDK_IMPORT');
    const ownerBeforeConnect=verifyOwner();
    if(ownerBeforeConnect.pid!==report.owner.pid) throw Error('OWNER_PROCESS_CHANGED_BEFORE_CONNECT');
    await runAttachProbe({memory:report.memoryPressure,version,origin,inspect,report,
      connect:endpoint=>chromium.connectOverCDP(endpoint,{timeout:5000})});
    report.status='PASS_MODEL_FREE_ATTACH_ONLY';
  } catch(error) {report.status=String(error).includes('HOLD_')?'HOLD':'FAIL';report.error=String(error);}
  finally {
    server?.closeAllConnections();server?.close();
    report.finishedUtc=new Date().toISOString();writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});clearTimeout(hardDeadline);
  }
  console.log(JSON.stringify({out,status:report.status,stage:report.stage,result:report.result,error:report.error}));
  // Explicit exit closes only this probe's sockets, never the owner browser.
  process.exit(report.status==='PASS_MODEL_FREE_ATTACH_ONLY'?0:report.status==='HOLD'?2:1);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
