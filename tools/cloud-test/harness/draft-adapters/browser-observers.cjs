'use strict';
// Passive browser observers ported from rwtJourney:526 and rwtAdverse:89 at main70e.
// No microphone acquisition, request, route mutation, transcript capture, or provider access is initiated here.
async function install(page,{pcmBoundaries=false}={}) {
  await page.addInitScript(pcmBoundariesEnabled => {
    if(pcmBoundariesEnabled===true)window.__PRIVATE_PCM_RECEIPTS_ENABLED__=true;
    const log=[],streams=[],marks=[]; const documentToken=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const media=navigator.mediaDevices;
    const observation={log,streams,documentToken,installed:!!media?.getUserMedia};
    window.__rwtGuardedMicObservation__=observation;
    window.__rwtMicStreams__=streams; window.__rwtMicAcquisitionLog__=log; window.__rwtMicAcquisitions__=marks;
    if(!observation.installed)return;
    const original=media.getUserMedia.bind(media);
    // r14 passive timing probe (no acquisition, no request, no transcript): when the first audio stream resolves and when the product reports RECORDING,
    // plus a coarse RMS envelope tapped from the SAME stream (never connected to an output). It lets the harness place the fixture position at the
    // moment recording began, to tell a clipped opening from a product recognition gap.
    const timing={gumCalledMs:null,gumResolvedMs:null,tapStartMs:null,tapState:'none',energy:[],states:[],perfAtDateNow:[performance.now(),Date.now()]};
    observation.timing=timing;
    const closed=v=>typeof v==='string'&&/^[A-Za-z][A-Za-z_-]{0,31}$/.test(v)?v:'other';
    const noteState=(kind,value)=>{if(timing.states.length<60&&!timing.states.some(s=>s[1]===kind&&s[2]===value))timing.states.push([Math.round(performance.now()),kind,closed(value)]);};
    try{
      const read=()=>{const r=document.documentElement;if(r){const a=r.getAttribute('data-runtime-state'),b=r.getAttribute('data-model-status');if(a)noteState('r',a);if(b)noteState('m',b);}};
      new MutationObserver(read).observe(document,{subtree:true,attributes:true,attributeFilter:['data-runtime-state','data-model-status']});read();
    }catch{/* passive only */}
    const startTap=stream=>{
      if(timing.tapStartMs!==null)return;
      try{
        const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
        const ac=new AC(),src=ac.createMediaStreamSource(stream),an=ac.createAnalyser();an.fftSize=2048;src.connect(an);
        timing.tapStartMs=Math.round(performance.now()*10)/10;timing.tapState=ac.state;if(ac.state==='suspended')ac.resume().then(()=>{timing.tapState=ac.state;},()=>{});
        const buf=new Float32Array(an.fftSize);
        const timer=setInterval(()=>{
          if(timing.energy.length>=1200){clearInterval(timer);return;}
          an.getFloatTimeDomainData(buf);let s=0;for(let i=0;i<buf.length;i++)s+=buf[i]*buf[i];
          timing.energy.push([Math.round(performance.now()*10)/10,Math.round(Math.sqrt(s/buf.length)*10000)/10000]);
        },100);
      }catch{timing.tapState='failed';}
    };
    media.getUserMedia=(constraints)=>{
      const entry=constraints?.audio?{id:log.length,outcome:'pending',at:performance.now()}:null;
      if(entry){log.push(entry);marks.push(Date.now());if(timing.gumCalledMs===null)timing.gumCalledMs=Math.round(performance.now()*10)/10;}
      return original(constraints).then(stream=>{if(entry){streams.push(stream);entry.outcome='granted';if(timing.gumResolvedMs===null){timing.gumResolvedMs=Math.round(performance.now()*10)/10;startTap(stream);}}return stream;},error=>{
        if(entry)entry.outcome=['NotAllowedError','NotFoundError','NotReadableError','AbortError','SecurityError','OverconstrainedError','TypeError'].includes(error?.name)?error.name:'other';
        throw error;
      });
    };
  },pcmBoundaries===true);
}
async function mic(page) {
  return page.evaluate(()=>{
    const o=window.__rwtGuardedMicObservation__;
    if(!o?.installed)return null;
    return {documentToken:o.documentToken,acquisitions:o.log.length,log:o.log.map(x=>({id:x.id,outcome:x.outcome})),liveTracks:o.streams.flatMap(s=>s.getAudioTracks()).filter(t=>t.readyState==='live').length,
      recording:document.documentElement.getAttribute('data-runtime-state')==='RECORDING',recorderVisible:!!document.querySelector('[data-testid="recorder-bar"]')};
  });
}
async function armStates(page,token) {
  return page.evaluate(token=>{
    const root=document.documentElement,states=[root.getAttribute('data-model-status')];
    const record=records=>records.forEach((r,i)=>states.push(i+1<records.length?records[i+1].oldValue:root.getAttribute('data-model-status')));
    const observer=new MutationObserver(record);observer.observe(root,{attributes:true,attributeFilter:['data-model-status'],attributeOldValue:true});
    window.__rwtGuardedModelObservation__={token,states,record,observer};return true;
  },token);
}
async function states(page,token) {
  return page.evaluate(token=>{const o=window.__rwtGuardedModelObservation__;if(!o||o.token!==token)return null;o.record(o.observer.takeRecords());return o.states.slice();},token);
}
async function audioTiming(page) {
  return page.evaluate(()=>{
    const o=window.__rwtGuardedMicObservation__;const t=o?.timing;if(!t)return null;
    return {gumCalledMs:t.gumCalledMs,gumResolvedMs:t.gumResolvedMs,tapStartMs:t.tapStartMs,tapState:t.tapState,energy:t.energy.slice(),states:t.states.slice(),nowMs:Math.round(performance.now()*10)/10,
      acquisitions:o.log.map(x=>({id:x.id,outcome:x.outcome,atMs:Math.round(x.at*10)/10}))};
  });
}
const PCM_DOMAINS=Object.freeze(['worklet_output','listener_delivery','live_decode_input','final_decode_input']);
const PCM_OPERATIONS=new Set(['worklet','replay','listener-copy','speech-confirm','preroll','preonset','live-concat','retry-concat','live-cap','utterance-copy','utterance-concat','utterance-cap','utterance-trim','retry-tail']);
const PCM_PROBLEMS=new Set(['worklet-gap','worklet-metadata','late-frame','capture-changed','overflow','missing-lineage','hash-unavailable']);
const PCM_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PCM_SHA=/^[a-f0-9]{64}$/;
function sanitizePcmBoundaryReceipts(value){
 if(!Array.isArray(value)||value.length<1||value.length>2)return null;
 const captures=[];
 for(const capture of value){
  if(!capture||typeof capture!=='object'||Array.isArray(capture)||capture.schema!=='speaksharp.pcm-boundaries.v1'||!PCM_UUID.test(capture.captureId||'')||!Number.isSafeInteger(capture.sampleRateHz)||capture.sampleRateHz<8000||capture.sampleRateHz>96000||capture.format!=='Float32LE'||capture.meaning!=='observed-boundary-inputs-not-proof-of-recognizer-output-or-accepted-focus-points'||typeof capture.complete!=='boolean'||typeof capture.workletClosed!=='boolean'||typeof capture.listenerClosed!=='boolean'||!Number.isSafeInteger(capture.pendingHashes)||capture.pendingHashes<0||!Array.isArray(capture.problems)||capture.problems.some(x=>!PCM_PROBLEMS.has(x))||!Array.isArray(capture.receipts)||capture.receipts.length>2048)return null;
  const receipts=[];
  for(let i=0;i<capture.receipts.length;i++){
   const row=capture.receipts[i];
   if(!row||typeof row!=='object'||Array.isArray(row)||!PCM_DOMAINS.includes(row.domain)||row.ordinal!==i||!Number.isSafeInteger(row.samples)||row.samples<1||row.bytes!==row.samples*4||typeof row.atMs!=='number'||!Number.isFinite(row.atMs)||row.atMs<0||!['pending','hashed','unavailable'].includes(row.status)||!(row.sha256===null||PCM_SHA.test(row.sha256||''))||typeof row.lineageComplete!=='boolean'||!Array.isArray(row.spans)||row.spans.length>256)return null;
   const spans=[];
   for(const span of row.spans){
    if(!span||typeof span!=='object'||Array.isArray(span)||!(span.captureId===null||PCM_UUID.test(span.captureId||''))||!(span.start===null||(Number.isSafeInteger(span.start)&&span.start>=0))||!Number.isSafeInteger(span.samples)||span.samples<1||!Array.isArray(span.operations)||span.operations.length>32||span.operations.some(x=>!PCM_OPERATIONS.has(x)))return null;
    spans.push({captureId:span.captureId,start:span.start,samples:span.samples,operations:[...span.operations]});
   }
   if(spans.reduce((n,s)=>n+s.samples,0)!==row.samples)return null;
   receipts.push({domain:row.domain,ordinal:row.ordinal,samples:row.samples,bytes:row.bytes,atMs:row.atMs,sha256:row.sha256,status:row.status,spans,lineageComplete:row.lineageComplete});
  }
  if(capture.complete&&(!capture.workletClosed||!capture.listenerClosed||capture.pendingHashes!==0||capture.problems.length||PCM_DOMAINS.some(domain=>!receipts.some(r=>r.domain===domain&&r.status==='hashed'&&r.sha256&&r.lineageComplete))))return null;
  captures.push({schema:capture.schema,captureId:capture.captureId,sampleRateHz:capture.sampleRateHz,format:capture.format,meaning:capture.meaning,complete:capture.complete,workletClosed:capture.workletClosed,listenerClosed:capture.listenerClosed,pendingHashes:capture.pendingHashes,problems:[...capture.problems],receipts});
 }
 return {schema:'speaksharp.pcm-boundary-diagnostics.v1',diagnosticOnly:true,meaning:'observed-boundary-inputs-not-proof-of-recognizer-output-or-accepted-focus-points',captures};
}
async function pcmBoundaries(page){
 let value;
 try{value=await page.evaluate(async()=>typeof window.__PRIVATE_PCM_RECEIPTS__?.read==='function'?await window.__PRIVATE_PCM_RECEIPTS__.read():null);}catch{return null;}
 return sanitizePcmBoundaryReceipts(value);
}
module.exports={install,mic,armStates,states,audioTiming,pcmBoundaries,sanitizePcmBoundaryReceipts};
