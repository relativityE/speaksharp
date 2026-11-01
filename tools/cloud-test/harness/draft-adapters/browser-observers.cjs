'use strict';
const crypto=require('node:crypto');
// Passive browser observers ported from rwtJourney:526 and rwtAdverse:89 at main70e.
// No microphone acquisition, request, route mutation, transcript capture, or provider access is initiated here.
async function install(page,{pcmBoundaries=false,objectivePublications=false}={}) {
  await page.addInitScript(options => {
    if(options.pcmBoundaries===true)window.__PRIVATE_PCM_RECEIPTS_ENABLED__=true;
    if(options.objectivePublications===true)window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__=true;
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
  },{pcmBoundaries:pcmBoundaries===true,objectivePublications:objectivePublications===true});
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
const pcmHash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function identityOf(capture){
 if(!capture||typeof capture!=='object'||Array.isArray(capture)||capture.schema!=='speaksharp.pcm-boundaries.v1'||!PCM_UUID.test(capture.captureId||'')||typeof capture.createdAtMs!=='number'||!Number.isFinite(capture.createdAtMs)||capture.createdAtMs<0)return null;
 return {captureId:capture.captureId,createdAtMs:capture.createdAtMs};
}
function failedPcmSelection(code,count){return {schema:'pcm-boundary-diagnostics.v2',diagnosticOnly:true,selectionStatus:'failed',selectionCode:code,captureCountObserved:count};}
function sanitizePcmBoundaryReceipts(value,{baseline}={}){
 if(!Array.isArray(value)||value.length<1||value.length>2)return null;
 const identities=value.map(identityOf);if(identities.some(x=>!x))return failedPcmSelection('PCM_CAPTURE_IDENTITY_INVALID',value.length);
 const baselineIds=new Set(Array.isArray(baseline?.captureIds)?baseline.captureIds:[]),observedAtMs=baseline?.observedAtMs;
 if(!Number.isFinite(observedAtMs)||[...baselineIds].some(id=>!PCM_UUID.test(id)))return failedPcmSelection('PCM_PRESTART_BASELINE_INVALID',value.length);
 const candidates=value.filter((capture,i)=>!baselineIds.has(identities[i].captureId)&&identities[i].createdAtMs>=observedAtMs);
 if(candidates.length!==1)return failedPcmSelection(candidates.length?'PCM_CURRENT_CAPTURE_AMBIGUOUS':'PCM_CURRENT_CAPTURE_MISSING',value.length);
 const capture=candidates[0],identity=identityOf(capture),domainRows=Object.fromEntries(PCM_DOMAINS.map(domain=>[domain,[]]));let structureValid=true,allReceiptsHashed=true,allLineageComplete=true,allSpansCurrentCapture=true,allSpansHaveCoordinates=true;
 const sampleRateHz=Number.isSafeInteger(capture.sampleRateHz)&&capture.sampleRateHz>=8000&&capture.sampleRateHz<=96000?capture.sampleRateHz:null;
 if(sampleRateHz===null||capture.format!=='Float32LE'||capture.meaning!=='observed-boundary-inputs-not-proof-of-recognizer-output-or-accepted-focus-points'||typeof capture.complete!=='boolean'||typeof capture.workletClosed!=='boolean'||typeof capture.listenerClosed!=='boolean'||!Number.isSafeInteger(capture.pendingHashes)||capture.pendingHashes<0||!Array.isArray(capture.problems)||capture.problems.some(x=>!PCM_PROBLEMS.has(x))||!Array.isArray(capture.receipts)||capture.receipts.length>2048)structureValid=false;
 const normalized=[];
 if(Array.isArray(capture.receipts)&&capture.receipts.length<=2048)for(let i=0;i<capture.receipts.length;i++){
  const row=capture.receipts[i];let rowValid=!!row&&typeof row==='object'&&!Array.isArray(row)&&PCM_DOMAINS.includes(row.domain)&&row.ordinal===i&&Number.isSafeInteger(row.samples)&&row.samples>0&&row.bytes===row.samples*4&&typeof row.atMs==='number'&&Number.isFinite(row.atMs)&&row.atMs>=0&&['pending','hashed','unavailable'].includes(row.status)&&(row.sha256===null||PCM_SHA.test(row.sha256||''))&&typeof row.lineageComplete==='boolean'&&Array.isArray(row.spans)&&row.spans.length<=256;
  let spanSamples=0;const spans=[];
  if(rowValid)for(const span of row.spans){const spanValid=!!span&&typeof span==='object'&&!Array.isArray(span)&&(span.captureId===null||PCM_UUID.test(span.captureId||''))&&(span.start===null||(Number.isSafeInteger(span.start)&&span.start>=0))&&Number.isSafeInteger(span.samples)&&span.samples>0&&(span.start===null||Number.isSafeInteger(span.start+span.samples))&&Array.isArray(span.operations)&&span.operations.length<=32&&span.operations.every(x=>PCM_OPERATIONS.has(x));if(!spanValid){rowValid=false;break;}spanSamples+=span.samples;if(span.captureId!==identity.captureId)allSpansCurrentCapture=false;if(span.captureId===null||span.start===null)allSpansHaveCoordinates=false;spans.push([span.captureId,span.start,span.samples,span.operations]);}
  if(rowValid&&spanSamples!==row.samples)rowValid=false;
  if(!rowValid){structureValid=false;continue;}
  allReceiptsHashed&&=row.status==='hashed'&&PCM_SHA.test(row.sha256||'');allLineageComplete&&=row.lineageComplete===true;domainRows[row.domain].push(row);normalized.push([row.domain,row.ordinal,row.samples,row.bytes,row.atMs,row.sha256,row.status,row.lineageComplete,spans]);
 }
 const allDomainsPresent=PCM_DOMAINS.every(domain=>domainRows[domain].length>0),problemMask=Array.isArray(capture.problems)?capture.problems.reduce((mask,problem)=>mask|(1<<[...PCM_PROBLEMS].indexOf(problem)),0):0;
 const validatedComplete=structureValid&&capture.workletClosed===true&&capture.listenerClosed===true&&capture.pendingHashes===0&&problemMask===0&&allDomainsPresent&&allReceiptsHashed&&allLineageComplete&&allSpansCurrentCapture&&allSpansHaveCoordinates&&normalized.length===capture.receipts.length;
 const contradiction=capture.complete===true&&!validatedComplete;
 const summaries=PCM_DOMAINS.map(domain=>{const rows=domainRows[domain],ordered=rows.map(r=>[r.ordinal,r.samples,r.bytes,r.sha256]),lineage=rows.map(r=>[r.ordinal,r.spans.map(s=>[s.captureId,s.start,s.samples,s.operations])]);return {domain,receiptCount:rows.length,sampleCount:rows.reduce((n,r)=>n+r.samples,0),byteCount:rows.reduce((n,r)=>n+r.bytes,0),firstAtMs:rows.length?Math.min(...rows.map(r=>r.atMs)):null,lastAtMs:rows.length?Math.max(...rows.map(r=>r.atMs)):null,orderedPcmSha256:pcmHash(JSON.stringify([domain,ordered])),orderedLineageSha256:pcmHash(JSON.stringify([domain,lineage]))};});
 return {schema:'pcm-boundary-diagnostics.v2',diagnosticOnly:true,selectionStatus:'passed',selectionCode:'PCM_CURRENT_CAPTURE_SELECTED',captureCountObserved:value.length,selectedCapture:{captureDigest:pcmHash(identity.captureId),createdAtMs:identity.createdAtMs,sampleRateHz,declaredComplete:capture.complete===true,validatedComplete,contradiction,workletClosed:capture.workletClosed===true,listenerClosed:capture.listenerClosed===true,pendingHashes:Number.isSafeInteger(capture.pendingHashes)?capture.pendingHashes:null,problemMask,receiptCount:Array.isArray(capture.receipts)?capture.receipts.length:null,validatedReceiptCount:normalized.length,allDomainsPresent,allReceiptsHashed,allLineageComplete,allSpansCurrentCapture,allSpansHaveCoordinates,receiptChainSha256:pcmHash(JSON.stringify(normalized)),domains:summaries}};
}
async function pcmBoundaryBaseline(page){
 try{return await page.evaluate(async()=>{const read=window.__PRIVATE_PCM_RECEIPTS__?.read;if(typeof read!=='function')return {observedAtMs:performance.now(),captureIds:[]};const rows=await read();return {observedAtMs:performance.now(),captureIds:Array.isArray(rows)?rows.map(row=>row?.captureId).filter(id=>typeof id==='string'):[]};});}catch{return null;}
}
async function pcmBoundaries(page,baseline){
 let value;
 try{value=await page.evaluate(async()=>typeof window.__PRIVATE_PCM_RECEIPTS__?.read==='function'?await window.__PRIVATE_PCM_RECEIPTS__.read():null);}catch{return null;}
 return sanitizePcmBoundaryReceipts(value,{baseline});
}
const OBJECTIVE_STATUSES=new Set(['covered','partial','missing']);
function objectiveStatusSha256(statuses){return pcmHash(JSON.stringify(['speaksharp.objective-publication.statuses.v1',statuses]));}
function failedObjectiveSelection(code,count){return {schema:'objective-publication-diagnostic.v1',diagnosticOnly:true,selectionStatus:'failed',selectionCode:code,witnessCountObserved:count,validated:false};}
function sanitizeObjectivePublications(value,{baseline,sessionId,expectedStatuses,domStatuses}={}){
 if(!Array.isArray(value)||value.length>2)return null;
 const baselineSequence=baseline?.sequence,observedAtMs=baseline?.observedAtMs;
 if(!Number.isSafeInteger(baselineSequence)||baselineSequence<0||!Number.isFinite(observedAtMs)||observedAtMs<0)return failedObjectiveSelection('OBJECTIVE_PRESTART_BASELINE_INVALID',value.length);
 const normalized=[];
 for(const row of value){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!=='speaksharp.objective-publication.v1'||!Number.isSafeInteger(row.sequence)||row.sequence<1||!Number.isFinite(row.createdAtMs)||row.createdAtMs<0||!PCM_SHA.test(row.sessionSha256||'')||!PCM_SHA.test(row.statusChainSha256||'')||!Number.isSafeInteger(row.pointCount)||row.pointCount<1||!Number.isSafeInteger(row.coveredCount)||row.coveredCount<0||!Number.isSafeInteger(row.partialCount)||row.partialCount<0||!Number.isSafeInteger(row.missingCount)||row.missingCount<0||row.coveredCount+row.partialCount+row.missingCount!==row.pointCount)return failedObjectiveSelection('OBJECTIVE_WITNESS_INVALID',value.length);
  normalized.push({sequence:row.sequence,createdAtMs:row.createdAtMs,sessionSha256:row.sessionSha256,statusChainSha256:row.statusChainSha256,pointCount:row.pointCount,coveredCount:row.coveredCount,partialCount:row.partialCount,missingCount:row.missingCount});
 }
 const candidates=normalized.filter(row=>row.sequence>baselineSequence&&row.createdAtMs>=observedAtMs);
 if(candidates.length!==1)return failedObjectiveSelection(candidates.length?'OBJECTIVE_CURRENT_PUBLICATION_AMBIGUOUS':'OBJECTIVE_CURRENT_PUBLICATION_MISSING',value.length);
 const selected=candidates[0],expected=Array.isArray(expectedStatuses)&&expectedStatuses.length&&expectedStatuses.every(s=>OBJECTIVE_STATUSES.has(s))?expectedStatuses:null,dom=Array.isArray(domStatuses)&&domStatuses.length&&domStatuses.every(s=>OBJECTIVE_STATUSES.has(s))?domStatuses:null;
 if(typeof sessionId!=='string'||!sessionId||!expected||!dom)return failedObjectiveSelection('OBJECTIVE_COMPARISON_INPUT_INVALID',value.length);
 const counts=statuses=>({coveredCount:statuses.filter(s=>s==='covered').length,partialCount:statuses.filter(s=>s==='partial').length,missingCount:statuses.filter(s=>s==='missing').length}),expectedCounts=counts(expected),domCounts=counts(dom);
 const currentTakeMatched=selected.sessionSha256===pcmHash(sessionId),fixtureStatusMatched=selected.statusChainSha256===objectiveStatusSha256(expected),domStatusMatched=selected.statusChainSha256===objectiveStatusSha256(dom),countMatched=selected.pointCount===expected.length&&selected.pointCount===dom.length&&selected.coveredCount===expectedCounts.coveredCount&&selected.partialCount===expectedCounts.partialCount&&selected.missingCount===expectedCounts.missingCount&&selected.coveredCount===domCounts.coveredCount&&selected.partialCount===domCounts.partialCount&&selected.missingCount===domCounts.missingCount;
 const validated=currentTakeMatched&&fixtureStatusMatched&&domStatusMatched&&countMatched;
 return {schema:'objective-publication-diagnostic.v1',diagnosticOnly:true,selectionStatus:'passed',selectionCode:'OBJECTIVE_CURRENT_PUBLICATION_SELECTED',witnessCountObserved:value.length,validated,currentTakeMatched,fixtureStatusMatched,domStatusMatched,countMatched,selected:{sequence:selected.sequence,createdAtMs:selected.createdAtMs,pointCount:selected.pointCount,coveredCount:selected.coveredCount,partialCount:selected.partialCount,missingCount:selected.missingCount,witnessSha256:pcmHash(JSON.stringify(selected))}};
}
async function objectivePublicationBaseline(page){
 try{return await page.evaluate(async()=>{const read=window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read,rows=typeof read==='function'?await read():[];return {observedAtMs:performance.now(),sequence:Array.isArray(rows)?Math.max(0,...rows.map(row=>Number.isSafeInteger(row?.sequence)?row.sequence:0)):0};});}catch{return null;}
}
async function objectivePublication(page,baseline,sessionId,expectedStatuses,domStatuses){
 let value;try{value=await page.evaluate(async()=>typeof window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read==='function'?await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__.read():[]);}catch{return null;}
 return sanitizeObjectivePublications(value,{baseline,sessionId,expectedStatuses,domStatuses});
}
module.exports={install,mic,armStates,states,audioTiming,pcmBoundaryBaseline,pcmBoundaries,sanitizePcmBoundaryReceipts,objectivePublicationBaseline,objectivePublication,sanitizeObjectivePublications};
