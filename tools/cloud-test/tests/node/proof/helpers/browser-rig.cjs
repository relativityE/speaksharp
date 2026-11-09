'use strict';
// Ported from the harness proof workspace (harness-proof-workspace.zip sha256 9fc02fd68a8d272d61817bcb2fc6fa662b69e11b08c22d3389e78aaf0f9566cd), tests/helpers/browser-rig.cjs; only the path, pin and browser bindings below changed.
// Real-Chromium rig for the r14 negative controls: loopback page, synthetic WAV at the real fixture windows, the REAL observer.install/mic/audioTiming code.
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
// Packet under test: the vendored harness, or a temp copy named by CT_PROOF_PACKET (mutation controls). The harness bytes are never written.
const P=process.env.CT_PROOF_PACKET||require('node:path').resolve(__dirname,'..','..','..','..','harness');
const S=null;
const observer=require(P+'/draft-adapters/browser-observers.cjs');
const {chromium}=require('playwright');
// Same Chrome for Testing binary the guarded lane runs (browser.json sourceExecutable); the lane also passes --deny-permission-prompts.
// The pinned, hash-verified Chrome for Testing the cloud-test job installs (CT_CHROME); never a fallback browser.
const CHROME=process.env.CT_CHROME;if(!CHROME)throw new Error('CT_CHROME (the pinned chromium-1200 binary) is required');
function wavBytes(totalSec,windows,{silent=false}={}){
  const rate=16000,n=Math.round(totalSec*rate),buf=Buffer.alloc(44+n*2);
  buf.write('RIFF',0);buf.writeUInt32LE(36+n*2,4);buf.write('WAVE',8);buf.write('fmt ',12);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++){const t=i/rate;const on=!silent&&windows.some(w=>t>=w[0]&&t<=w[1]);const v=on?Math.round(0.4*32767*Math.sin(2*Math.PI*(300+60*Math.sin(t*3))*t)):0;buf.writeInt16LE(v,44+i*2);}
  return buf;
}
const PAGE='<!doctype html><html><head><meta charset="utf-8"><title>rig</title></head><body><script>window.__go=async(recordAfterMs)=>{try{await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){}if(recordAfterMs!==null)setTimeout(()=>document.documentElement.setAttribute("data-runtime-state","RECORDING"),recordAfterMs);return true;};</script></body></html>';
async function withServer(fn){const srv=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end(PAGE);});await new Promise(r=>srv.listen(0,'127.0.0.1',r));try{return await fn(`http://127.0.0.1:${srv.address().port}/`);}finally{await new Promise(r=>srv.close(r));}}
// mode: 'fake-device' (production-lane flags) | 'no-device' (no capture flags at all). Each scenario gets its OWN context/page (parallel), so one browser launch covers several controls.
async function runMany({wavFile,mode='fake-device',scenarios,observeMs=20000,observerModule=observer}){
  const args=['--no-sandbox','--deny-permission-prompts'];
  if(mode==='fake-device')args.push('--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+wavFile,'--autoplay-policy=no-user-gesture-required');
  const browser=await chromium.launch({executablePath:CHROME,args});
  try{
    return await withServer(async url=>{
      const started=await Promise.all(scenarios.map(async sc=>{
        const context=await browser.newContext();const page=await context.newPage();await observerModule.install(page);
        await page.goto(url);if(sc.grant!==false)await context.grantPermissions(['microphone'],{origin:new URL(url).origin});
        await page.evaluate(ms=>window.__go(ms),sc.recordAfterMs===undefined?null:sc.recordAfterMs);return {sc,page};}));
      await started[0].page.waitForTimeout(observeMs);
      const out={};
      for(const {sc,page} of started)out[sc.name]={timing:await observerModule.audioTiming(page),mic:await observerModule.mic(page),streamLive:await page.evaluate(()=>{const s=window.__rwtMicStreams__||[];return s.length?s[0].getAudioTracks().every(t=>t.readyState==='live'):null;})};
      return out;
    });
  }finally{await browser.close();}
}
function tmpWav(bytes){const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ss-r14-wav-')),'capture.wav');fs.writeFileSync(f,bytes);return f;}
module.exports={wavBytes,tmpWav,runMany,observer,P,S};
