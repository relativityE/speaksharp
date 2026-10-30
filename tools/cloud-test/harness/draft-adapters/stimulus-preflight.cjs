#!/usr/bin/env node
'use strict';
// r15 stimulus preflight. OFFLINE: loopback page only, no product traffic, no account, no credential. Proves, with the SAME Chrome binary, the SAME permission policy and the SAME media bytes the run
// will use, that every selected Start-pressing case can reach its trigger BEFORE any run budget is spent:
//   * the bound media is a real capture device stream the page acquires (granted),
//   * an ungranted request is denied with NotAllowedError (the AHT-12 stimulus),
//   * a launch with no capture device gives NotFoundError (the R5 failure mode), so the control is meaningful,
//   * speech is audible on the stream, and for Focus fixtures the REAL WAV is aligned with its reviewed point windows (estimated fixture position at the first tapped sample is about 0).
// Usage: node stimulus-preflight.cjs --plan <plan.json> --chrome <chrome executable> --out <new receipt file>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),cp=require('node:child_process');
const core=require('../bundle/harness/campaign-core.cjs');
const observer=require('./browser-observers.cjs');
const timing=require('./audio-timing.cjs');
const manifest=require('./oracles/pure/fixture-manifest.json');
const activityRef=require('./fixture-activity.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const PAGE='<!doctype html><html><head><meta charset="utf-8"><title>stimulus</title></head><body><script>window.__go=async(recordAfterMs)=>{try{await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){}if(recordAfterMs!==null)setTimeout(()=>document.documentElement.setAttribute("data-runtime-state","RECORDING"),recordAfterMs);return true;};</script></body></html>';
const OUTCOME={NotAllowedError:'not-allowed',NotFoundError:'not-found',granted:'granted'};
function args(argv){const a={};if(argv.length%2)throw new Error('explicit key/value arguments required');for(let i=0;i<argv.length;i+=2){const k=argv[i];if(!['--plan','--chrome','--out'].includes(k)||k in a)throw new Error('unknown/repeated argument '+k);a[k]=argv[i+1];}for(const k of ['--plan','--chrome','--out'])if(!a[k])throw new Error(k+' required');return a;}
async function runMany(chromium,chrome,{mediaFile,mode,scenarios,observeMs}){
  const flags=['--no-sandbox','--deny-permission-prompts'];
  if(mode==='fake-device')flags.push('--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+mediaFile,'--autoplay-policy=no-user-gesture-required');
  const browser=await chromium.launch({executablePath:chrome,args:flags});
  const srv=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(PAGE);});await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  try{
    const url=`http://127.0.0.1:${srv.address().port}/`;
    const started=await Promise.all(scenarios.map(async sc=>{const ctx=await browser.newContext();const page=await ctx.newPage();await observer.install(page);await page.goto(url);if(sc.grant)await ctx.grantPermissions(['microphone'],{origin:new URL(url).origin});await page.evaluate(ms=>window.__go(ms),sc.recordAfterMs===undefined?null:sc.recordAfterMs);return {sc,page};}));
    await started[0].page.waitForTimeout(observeMs);
    const out={};
    for(const {sc,page} of started)out[sc.name]={timing:await observer.audioTiming(page),mic:await observer.mic(page),live:await page.evaluate(()=>{const s=window.__rwtMicStreams__||[];return s.length?s[0].getAudioTracks().every(t=>t.readyState==='live'):null;})};
    return out;
  }finally{await browser.close();await new Promise(r=>srv.close(r));}
}
async function main(argv){
  const a=args(argv);
  const plan=JSON.parse(fs.readFileSync(a['--plan'],'utf8'));
  const bundle=path.resolve(__dirname,'../bundle');
  const selected=core.selectedOrder(plan);
  const need=[];
  for(const c of plan.cases){
    if(!selected.includes(c.id))continue;
    const cfg=JSON.parse(fs.readFileSync(c.configFile,'utf8'));
    const driver=require(path.resolve(c.driverFile));
    if(typeof driver.requiresCaptureDevice==='function'&&driver.requiresCaptureDevice(cfg)){
      if(!c.mediaFile||sha(fs.readFileSync(c.mediaFile))!==c.mediaSha256)throw new Error('BLOCKED_SETUP: '+c.id+' needs a capture device but its plan media is missing or its bytes differ from mediaSha256');
      need.push({id:c.id,mediaFile:c.mediaFile,mediaSha256:c.mediaSha256,fixture:cfg.fixture?.name||null});
    }
  }
  const {chromium}=require(require.resolve('playwright',{paths:[process.cwd()]}));
  const results={};
  const byMedia=new Map();for(const n of need){if(!byMedia.has(n.mediaSha256))byMedia.set(n.mediaSha256,{file:n.mediaFile,ids:[]});byMedia.get(n.mediaSha256).ids.push(n);}
  const noDevice=need.length?await runMany(chromium,a['--chrome'],{mode:'no-device',observeMs:2500,scenarios:[{name:'granted',grant:true,recordAfterMs:null},{name:'ungranted',grant:false,recordAfterMs:null}]}):null;
  for(const [m,g] of byMedia){
    const f=g.ids.map(x=>manifest.fixtures[x.fixture]).find(x=>x&&Array.isArray(x.pointAudioWindows));
    const r=await runMany(chromium,a['--chrome'],{mediaFile:g.file,mode:'fake-device',observeMs:f?26000:14000,scenarios:[{name:'granted',grant:true,recordAfterMs:300},{name:'ungranted',grant:false,recordAfterMs:300}]});
    const act=timing.activity(r.granted.timing?.energy,r.granted.timing?.tapStartMs);
    const active=act?act.act.reduce((x,y)=>x+y,0):0;
    for(const n of g.ids){
      const fx=manifest.fixtures[n.fixture];
      // The reference is the REAL fixture's own activity pattern (draft-adapters/fixture-activity.json, bound to the WAV sha256), not a mask of the point windows alone.
      const ref=activityRef.fixtures[n.fixture];let alignment={status:'not-applicable',estimateSec:null};
      if(ref&&ref.wavSha256===m&&act){
        const e=timing.estimateRef(act.act,ref.bits),loop=ref.bins*ref.binMs/1000,p0=e.p0>loop-1?e.p0-loop:e.p0;
        alignment={status:e.ambiguous||e.score<=0?'indeterminate':Math.abs(p0)<=0.8?'aligned':'misaligned',estimateSec:Math.round(p0*100)/100,expectedSec:0};
        if(alignment.status==='aligned'&&fx&&Array.isArray(fx.pointAudioWindows)){const an=timing.analyze({timing:r.granted.timing,windows:fx.pointAudioWindows,loopSec:loop,reference:ref.bits});if(an.conclusion!=='opening-reached-recording')alignment.status='misaligned';}
      }
      const granted=r.granted.mic?.log?.[0]?.outcome==='granted'&&r.granted.live===true;
      results[n.id]={mediaSha256:m,captureGranted:granted,ungrantedOutcome:OUTCOME[r.ungranted.mic?.log?.[0]?.outcome]||'other',noDeviceOutcome:OUTCOME[noDevice?.granted?.mic?.log?.[0]?.outcome]||'other',noDeviceUngrantedOutcome:OUTCOME[noDevice?.ungranted?.mic?.log?.[0]?.outcome]||'other',speechDetected:active>=5,alignment,ready:false};
      const c=results[n.id];c.ready=c.captureGranted&&c.noDeviceOutcome==='not-found'&&c.speechDetected&&(activityRef.fixtures[n.fixture]?c.alignment.status==='aligned':true)&&(n.id!=='AHT-12'||c.ungrantedOutcome==='not-allowed');
    }
  }
  const ver=(()=>{try{return cp.execFileSync(a['--chrome'],['--version'],{encoding:'utf8',timeout:20000}).trim().replace(/[^A-Za-z0-9 .]/g,'').slice(0,60);}catch{return 'unavailable';}})();
  const receipt={schema:'speaksharp.stimulus-preflight.v1',createdAt:new Date().toISOString(),productTraffic:0,scope:'loopback only; same Chrome binary, permission policy and media bytes as the run; no product host, account or credential',
    codeManifestSha256:sha(fs.readFileSync(path.join(bundle,'CODE.sha256'))),chrome:{executableName:path.basename(a['--chrome']),version:ver},selected,casesRequiringDevice:need.map(n=>n.id),cases:results};
  fs.writeFileSync(a['--out'],JSON.stringify(receipt,null,1)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({ready:Object.values(results).every(c=>c.ready),cases:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.ready])),out:a['--out']}));
  return Object.values(results).every(c=>c.ready)?0:78;
}
if(require.main===module)main(process.argv.slice(2)).then(c=>process.exitCode=c,e=>{console.error('BLOCKED_SETUP: '+e.message);process.exitCode=78;});
module.exports={main};
