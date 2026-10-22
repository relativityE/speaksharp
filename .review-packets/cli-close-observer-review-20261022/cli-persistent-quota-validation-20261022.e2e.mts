import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readlink} from 'node:fs/promises';
import {observeOwnedClose} from './cli-owned-close-observer-20261022.mjs';
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
const execute=promisify(execFile);
const scanOwned=async(known:number[])=>{
  const {stdout}=await execute('ps',['-axo','pid=,command='],{encoding:'utf8',timeout:1000,maxBuffer:4*1024*1024});
  const lines=stdout.split('\n');
  const existing=new Set(lines.map(line=>Number(line.trim().split(/\s/)[0])));
  const profileMatches=lines.filter(line=>line.includes('--user-data-dir='+profile))
    .map(line=>Number(line.trim().split(/\s/)[0]));
  return {complete:true,pids:known.filter(pid=>existing.has(pid)),profileMatches,checkedUtc:new Date().toISOString()};
};
const verifyBorrowed=async()=>{
  const expected=report.borrowedOwnerBefore;
  const {stdout:list}=await execute('lsof',['-nP','-iTCP:9222','-sTCP:LISTEN','-Fpn'],{encoding:'utf8',timeout:1000});
  const pids=[...new Set([...list.matchAll(/^p(\d+)$/gm)].map(m=>Number(m[1])))];
  const listeners=[...list.matchAll(/^n(.+)$/gm)].map(m=>m[1]);
  assert.deepEqual(pids,[expected.pid]);assert.ok(listeners.length);assert.ok(listeners.every(s=>s===expected.listener));
  const {stdout:command}=await execute('ps',['-p',String(expected.pid),'-o','command='],{encoding:'utf8',timeout:1000});
  assert.equal(command.trim(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir='+expected.profile+' --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1');
  assert.ok((await readlink(expected.profile+'/SingletonLock')).endsWith('-'+expected.pid));
  return {status:'UNCHANGED',owner:expected,checkedUtc:new Date().toISOString()};
};
async function closePersistent(row:any){
  const session=active!;
  let known:number[]=row.ownedBrowserPidsBeforeClose??[];
  if(!known.length){try{known=ownedPids();}catch(error){row.preCloseProcessScanError=String(error);}}
  row.ownedBrowserPidsBeforeClose=known;retain();
  const receipt=await observeOwnedClose({target:session.page.context(),close:()=>session.close(),
    evidence:()=>session.evidence(),scanOwned:async()=>({...await scanOwned(known),complete:known.length>0}),verifyBorrowed,
    observerMs:5000,pollMs:100,checkMs:1000,
    retain:value=>{row.closeObservation=value;retain();}});
  row.after=session.evidence();row.ownedBrowserPidsAfterClose=receipt.ownedExit.pids??null;
  active=undefined;retain();
  if(receipt.deadline.status!=='PASS')throw Error(receipt.deadline.error??'CLOSE_DEADLINE_NOT_VERIFIED');
  assert.equal(receipt.actualClose.status,'RESOLVED');assert.equal(receipt.ownedExit.status,'ABSENT');
  assert.equal(receipt.borrowedOwner.status,'UNCHANGED');
}
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
    if(mode==='persistent')await closePersistent(row);
    else{await active.close();row.after=active.evidence();active=undefined;}
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
  if(active){try{
    const row=report.arms.at(-1);
    if(row?.mode==='persistent')await closePersistent(row);else await active.close();
  }catch(error){report.cleanupError=String(error);report.status='FAIL';}}
  server.closeAllConnections();server.close();clearTimeout(watchdog);
  report.finishedUtc=new Date().toISOString();retain();
  console.log(JSON.stringify({status:report.status,error:report.error??null,out}));
  process.exit(report.status==='PASS_MODEL_FREE_QUOTA_COUNTERFACTUAL'?0:1);
}
