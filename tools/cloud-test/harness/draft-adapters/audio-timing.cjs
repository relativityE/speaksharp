'use strict';
// r14 audio-timing analysis. Pure: no browser, network, filesystem, credentials or clock.
// Question: do the fixture's opening phrases reach the product's recorder, or does Chromium's free-running fake capture play them before RECORDING begins?
// Input comes from browser-observers.audioTiming(page): the first getUserMedia resolution time, the product's RECORDING state time and a coarse RMS envelope
// tapped from the same stream (performance.now() clock, milliseconds). The fixture's reviewed pointAudioWindows (fixture seconds) fix where speech is.
// Method: align the observed speech activity with the fixture's window mask (circular, because the fake device loops the file) to estimate the fixture
// position at the first tapped sample, then advance it to the RECORDING time. The estimate is refused (indeterminate) rather than guessed when the
// envelope is too short, silent, or ambiguous. It is evidence about the STIMULUS; it never produces a product verdict.
const finite=n=>Number.isFinite(n)?n:null;
const round=(n,d=2)=>Number.isFinite(n)?Math.round(n*10**d)/10**d:null;
const BIN_MS=100,MIN_ACTIVE_BINS=5,AMBIGUITY_RATIO=0.9,AMBIGUITY_SEPARATION_SEC=1.5,STEP_SEC=0.1;
function activity(energy,tapStartMs){
  if(!Array.isArray(energy)||energy.length<10||!Number.isFinite(tapStartMs))return null;
  const rms=energy.map(e=>e[1]).filter(Number.isFinite).sort((a,b)=>a-b);if(rms.length<10)return null;
  const p95=rms[Math.floor(rms.length*0.95)],threshold=Math.max(0.003,0.2*p95);
  const last=energy[energy.length-1][0],bins=Math.floor((last-tapStartMs)/BIN_MS)+1;if(!(bins>=10))return null;
  const act=new Array(bins).fill(0);
  for(const [t,v] of energy){const b=Math.floor((t-tapStartMs)/BIN_MS);if(b>=0&&b<bins&&v>=threshold)act[b]=1;}
  return {act,threshold,peak:p95};
}
const inWindow=(p,windows)=>windows.some(w=>p>=w[0]&&p<=w[1]);
function estimate(act,windows,loopSec){
  let best=null,second=null;const scores=[];
  for(let p0=0;p0<loopSec;p0+=STEP_SEC){
    let s=0;for(let i=0;i<act.length;i++){if(!act[i])continue;const p=(p0+i*BIN_MS/1000)%loopSec;s+=inWindow(p,windows)?1:-1.5;}
    scores.push([p0,s]);
  }
  scores.sort((a,b)=>b[1]-a[1]);best=scores[0];
  const circ=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,loopSec-d);};
  second=scores.find(x=>circ(x[0],best[0])>AMBIGUITY_SEPARATION_SEC)||null;
  const ambiguous=!!second&&best[1]>0&&second[1]>=AMBIGUITY_RATIO*best[1];
  return {p0:best[0],score:best[1],ambiguous};
}
// r15: align to the fixture's REAL activity pattern (bits at 100 ms) when it is supplied; the real fixtures also speak between the point windows, so a window-only mask is not a valid reference.
function estimateRef(act,ref){
  const L=ref.length,scores=[];
  for(let s=0;s<L;s++){let sc=0;for(let i=0;i<act.length;i++){const r=ref[(s+i)%L]==='1';if(act[i]&&r)sc+=1;else if(act[i]&&!r)sc-=1;else if(!act[i]&&r)sc-=0.5;}scores.push([s*BIN_MS/1000,sc]);}
  scores.sort((a,b)=>b[1]-a[1]);const loopSec=L*BIN_MS/1000,best=scores[0],circ=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,loopSec-d);};
  const second=scores.find(x=>circ(x[0],best[0])>AMBIGUITY_SEPARATION_SEC)||null;
  return {p0:best[0],score:best[1],ambiguous:!!second&&best[1]>0&&second[1]>=AMBIGUITY_RATIO*best[1]};
}
function analyze({timing,windows,loopSec,reference}){
  const base={diagnosticOnly:true,proxy:'runtime-state-recording',assumesFirstFixturePass:true};
  const w=Array.isArray(windows)?windows.filter(x=>Array.isArray(x)&&Number.isFinite(x[0])&&Number.isFinite(x[1])):[];
  const hasRef=typeof reference==='string'&&/^[01]{50,}$/.test(reference);
  if(!timing||(!w.length&&!hasRef)||!Number.isFinite(loopSec)||loopSec<=0)return {conclusion:'indeterminate',facts:{...base,conclusion:'indeterminate',reason:'timing-or-fixture-unavailable',tapAvailable:false}};
  const rec=timing.states?.find(s=>s[1]==='r'&&s[2]==='RECORDING');const recMs=rec?rec[0]:null;
  const lag=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?Math.round(a-b):null;
  const common={...base,tapAvailable:Number.isFinite(timing.tapStartMs),tapState:({running:'tap-running',suspended:'tap-suspended',closed:'tap-closed',interrupted:'tap-interrupted',failed:'tap-failed'})[timing.tapState]||'none',
    acquisitionCount:Array.isArray(timing.acquisitions)?timing.acquisitions.length:null,
    gumResolvedToRecordingMs:lag(recMs,timing.gumResolvedMs),tapStartToRecordingMs:lag(recMs,timing.tapStartMs),gumCallToResolveMs:lag(timing.gumResolvedMs,timing.gumCalledMs),
    recordingObserved:recMs!==null,energySamples:Array.isArray(timing.energy)?timing.energy.length:0};
  if(recMs===null||!Number.isFinite(timing.tapStartMs))return {conclusion:'indeterminate',facts:{...common,conclusion:'indeterminate',reason:recMs===null?'recording-state-not-observed':'tap-not-started'}};
  const a=activity(timing.energy,timing.tapStartMs);
  if(!a)return {conclusion:'indeterminate',facts:{...common,conclusion:'indeterminate',reason:'envelope-too-short'}};
  const active=a.act.reduce((x,y)=>x+y,0);
  if(active<MIN_ACTIVE_BINS)return {conclusion:'indeterminate',facts:{...common,conclusion:'indeterminate',reason:'no-speech-in-envelope',activeBins:active,bins:a.act.length}};
  const est=typeof reference==='string'&&/^[01]{50,}$/.test(reference)?estimateRef(a.act,reference):estimate(a.act,w,loopSec);
  if(est.ambiguous||est.score<=0)return {conclusion:'indeterminate',facts:{...common,conclusion:'indeterminate',reason:est.score<=0?'envelope-does-not-match-fixture':'alignment-ambiguous',activeBins:active,bins:a.act.length}};
  // The device cannot start before the file does, so an estimate just below the loop length is a tap that began a fraction of a second before the file's start (estimation noise), not the end of an earlier pass.
  const p0=est.p0>loopSec-1?est.p0-loopSec:est.p0;
  const posRec=p0+(recMs-timing.tapStartMs)/1000;                // unwrapped fixture seconds at RECORDING
  if(!w.length)return {conclusion:'position-only',facts:{...common,conclusion:'position-only',activeBins:active,bins:a.act.length,fixtureSecAtTapStart:round(p0),fixtureSecAtRecording:round(posRec)}};
  const status=w.map(x=>x[1]<=posRec?'before-recording':x[0]<posRec?'partly-before-recording':'after-recording');
  const beforeCount=status.filter(s=>s==='before-recording').length;
  const opening=status[0];
  const conclusion=opening==='after-recording'?'opening-reached-recording':'opening-clipped-before-recording';
  return {conclusion,facts:{...common,conclusion,activeBins:active,bins:a.act.length,
    fixtureSecAtTapStart:round(p0),fixtureSecAtRecording:round(posRec),
    firstWindowStartSec:round(w[0][0]),firstWindowEndSec:round(w[0][1]),
    windowStatusByPoint:status,pointsFullyBeforeRecording:beforeCount,openingWindowStatus:opening,
    clippedBeforeRecordingSec:round(Math.max(0,Math.min(posRec,w[0][1])-w[0][0]))}};
}
// Places each point's first non-pending observation on the fixture's own clock, so a late or missing change can be compared with where that point's audio was.
// Returns {} when the alignment is not established; never guesses.
function alignRecognition({recognition,audio,observerStartMs,recordingMs,windows}){
  const startedAfter=Number.isFinite(observerStartMs)&&Number.isFinite(recordingMs)?Math.round(observerStartMs-recordingMs):null;
  const out={observerStartedAfterRecordingMs:startedAfter};
  const firsts=recognition?.firstLeftPendingMsByPoint,base=audio?.fixtureSecAtRecording;
  if(!Array.isArray(firsts)||!Number.isFinite(base)||startedAfter===null||!Array.isArray(windows))return out;
  const sec=firsts.map(ms=>Number.isFinite(ms)?round(base+(startedAfter+ms)/1000):null);
  out.firstLeftPendingFixtureSecByPoint=sec;
  out.firstLeftPendingVsWindowByPoint=sec.map((s,i)=>{const w=windows[i];if(s===null)return 'never';if(!Array.isArray(w))return 'unknown';return s<w[0]?'before-window':s<=w[1]?'within-window':'after-window';});
  return out;
}
module.exports={analyze,activity,estimate,estimateRef,alignRecognition};
