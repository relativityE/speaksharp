import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {openModelBrowser} from '/private/tmp/speaksharp-cli-persistent-context-20261022/scripts/model-evaluator/browser-session.ts';
import {launchOwnedPersistent} from '/private/tmp/speaksharp-cli-persistent-context-20261022/scripts/model-evaluator/persistent-browser.ts';
import {localCdpOwner} from '/private/tmp/speaksharp-cli-persistent-context-20261022/scripts/model-evaluator/cdp-browser.ts';

const out=process.argv[2];if(!out)throw Error('Output required');
const profile='/private/tmp/speaksharp-eval-owned-quota-'+Date.now();
const report:any={startedUtc:new Date().toISOString(),modelCalls:0,providerCalls:0,
  cacheApiWrites:0,profile,profileDisposition:'RETAINED',status:'PENDING',arms:[]};
const retain=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Model-free evaluator storage validation</title>');});
let active:Awaited<ReturnType<typeof openModelBrowser>>|undefined;
const ownedPids=()=>execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'})
  .split('\n').filter(line=>line.includes('--user-data-dir='+profile)).map(line=>Number(line.trim().split(/\s/)[0]));
const watchdog=setTimeout(()=>{report.error='TOTAL_VALIDATION_TIMEOUT';report.status='FAIL';retain();
  void active?.close().finally(()=>process.exit(2));},45000);
try{
  report.borrowedOwnerBefore=localCdpOwner();
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No loopback origin');
  const origin=`http://127.0.0.1:${address.port}`;report.origin=origin;
  for(const mode of ['ephemeral','persistent'] as const){
    active=await openModelBrowser(mode==='ephemeral'
      ?{headless:false,cdpEndpoint:'http://127.0.0.1:9222'}:{headless:false,persistentProfile:profile});
    const row:any={mode,before:active.evidence()};report.arms.push(row);retain();
    const context=active.page.context();
    await context.route('**/*',route=>route.request().url()===origin+'/'?route.continue():route.abort());
    await active.page.goto(origin,{timeout:5000});
    row.publicStorage=await active.page.evaluate(async()=>({origin:location.origin,
      estimate:await navigator.storage.estimate(),persisted:await navigator.storage.persisted()}));
    const cdp=await context.newCDPSession(active.page);
    try{row.actualStorage=await cdp.send('Storage.getUsageAndQuota',{origin});}finally{await cdp.detach();}
    if(mode==='persistent'){row.ownedBrowserPidsBeforeClose=ownedPids();assert.ok(row.ownedBrowserPidsBeforeClose.length);}
    await active.close();row.after=active.evidence();active=undefined;
    assert.equal(row.after.ownedContextState,'CLOSED');
    if(mode==='persistent'){row.ownedBrowserPidsAfterClose=ownedPids();assert.deepEqual(row.ownedBrowserPidsAfterClose,[]);}
    assert.deepEqual(localCdpOwner(),report.borrowedOwnerBefore);
    retain();
  }
  let reuseError:string|undefined;
  try{await launchOwnedPersistent(profile,false);}catch(error){reuseError=String(error);}
  assert.match(reuseError??'',/EEXIST/);report.profileReuse={status:'REFUSED',error:reuseError};
  const [ephemeral,persistent]=report.arms;
  report.requiredBytes={llama:710619226,smol:972833253};
  assert.ok(ephemeral.actualStorage.quota<report.requiredBytes.llama);
  assert.ok(persistent.actualStorage.quota>report.requiredBytes.smol);
  assert.equal(ephemeral.actualStorage.overrideActive,false);assert.equal(persistent.actualStorage.overrideActive,false);
  report.borrowedOwnerAfter=localCdpOwner();assert.deepEqual(report.borrowedOwnerAfter,report.borrowedOwnerBefore);
  report.status='PASS_MODEL_FREE_QUOTA_COUNTERFACTUAL';
}catch(error){report.status='FAIL';report.error=String(error);}
finally{
  if(active){try{await active.close();}catch(error){report.cleanupError=String(error);report.status='FAIL';}}
  server.closeAllConnections();server.close();clearTimeout(watchdog);
  report.finishedUtc=new Date().toISOString();retain();
  console.log(JSON.stringify({status:report.status,error:report.error??null,out}));
  process.exit(report.status==='PASS_MODEL_FREE_QUOTA_COUNTERFACTUAL'?0:1);
}
