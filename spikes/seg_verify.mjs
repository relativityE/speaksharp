// Phase 1.5 VERIFICATION + seam-hardening (Branch B, #891). Reproducible; repo-relative paths + repo
// fixtures + authoritative references. Run from repo root:  node spikes/seg_verify.mjs
// (override root with SS_ROOT=/path node spikes/seg_verify.mjs)
//
// Two jobs:
//  A) Reproducible WER vs GROUND TRUTH (washington_01, authoritative 191-word fixture), bounded to the clip.
//  B) SEAM AUDIT with a CONSERVATIVE, overlap-bounded, INSTRUMENTED reconciliation policy:
//       - trim only an EXACT overlap match inside the known window (<= maxTrim, DERIVED from overlap duration)
//       - otherwise KEEP BOTH and FLAG (under-trim, never silent-delete; no global de-dup; no out-of-window trim)
//       - log every seam: segIds, overlap window, removed text + token count, reason
//       - run repetition-risk on the assembled transcript AND on every removed seam span
import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = process.env.SS_ROOT || resolve(import.meta.dirname, '..');
env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = resolve(ROOT, 'frontend/public/models/');
const FIX = resolve(ROOT, 'tests/fixtures');

const SR=16000, TARGET=20, HARDCAP=30, OVERLAP=1.5;
const ASSUMED_MAX_WPS=4;                                    // generous upper bound for fast speech
const MAX_SEAM_TRIM = Math.min(10, Math.ceil(OVERLAP*ASSUMED_MAX_WPS));   // overlap-derived token cap (=6 for 1.5s)

function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);let off=12,dO=-1,dL=0,bps=16,ch=1;while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dO=off+8;dL=sz;}off+=8+sz+(sz%2);}const st=(bps/8)*ch,n=Math.floor(dL/st),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=dv.getInt16(dO+i*st,true)/32768;return o;}
const tok=s=>s.trim().split(/\s+/).filter(Boolean), nm=t=>t.toLowerCase().replace(/[^a-z0-9']/g,'');
function pc(a){const H=Math.round(0.02*SR),r=[];for(let i=0;i+H<=a.length;i+=H){let s=0;for(let j=0;j<H;j++)s+=a[i+j]*a[i+j];r.push(Math.sqrt(s/H));}const md=[...r].sort((x,y)=>x-y)[Math.floor(r.length/2)]||0,th=Math.max(0.006,0.3*md),nd=Math.round(0.25/0.02);const ps=[];let rn=0;for(let i=0;i<r.length;i++){if(r[i]<th)rn++;else{if(rn>=nd)ps.push(((i-rn/2)*H)/SR);rn=0;}}return ps;}
function bd(a){const d=a.length/SR,ps=pc(a),bs=[];let c=0;while(d-c>HARDCAP){const lo=c+TARGET-5,hi=c+HARDCAP,cd=ps.filter(p=>p>=lo&&p<=hi);let ct=cd.length?cd.reduce((b,p)=>Math.abs(p-(c+TARGET))<Math.abs(b-(c+TARGET))?p:b):c+HARDCAP;bs.push(ct);c=ct;}bs.push(d);return bs;}
function wer(ref,hyp){const r=ref.map(nm),h=hyp.map(nm),m=r.length,n=h.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(r[i-1]===h[j-1]?0:1));return m?d[m][n]/m:0;}
function loopFlag(words){const n=words.length,w=words.map(nm);for(let i=0;i<n;i++){const mk=Math.min(30,Math.floor((n-i)/3));for(let k=2;k<=mk;k++){let r=1;while(i+(r+1)*k<=n){let m=1;for(let x=0;x<k;x++)if(w[i+r*k+x]!==w[i+x]){m=0;break;}if(!m)break;r++;}if(r>=3)return `"${words.slice(i,i+k).join(' ')}" x${r}`;}}return null;}

// CONSERVATIVE seam reconciliation — bounded to overlap window, instrumented, under-trim/flag.
function reconcileSeam(prev, curr, segPrev, segCurr, seamLog){
  const cap = Math.min(MAX_SEAM_TRIM, prev.length, curr.length);
  for(let k=cap;k>=1;k--){let ok=1;for(let i=0;i<k;i++)if(nm(prev[prev.length-k+i])!==nm(curr[i])){ok=0;break;}
    if(ok){ const removed=curr.slice(0,k);
      seamLog.push({seam:`${segPrev}->${segCurr}`, overlapSec:OVERLAP, cap, removedTokens:k, removedText:removed.join(' '), reason:'exact_overlap_trim', removedLoop:loopFlag(removed)?'YES':'no'});
      return curr.slice(k); } }
  seamLog.push({seam:`${segPrev}->${segCurr}`, overlapSec:OVERLAP, cap, removedTokens:0, removedText:'', reason:'NO_BOUNDED_MATCH__kept_both__FLAG'});
  return curr;                                              // keep both, never delete out-of-window
}

const asr=await pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
const dec=async a=>((await asr(a,{chunk_length_s:30,stride_length_s:5})).text||'').trim();
async function segment(a){const bs=bd(a);let cur=0,segs=[];for(let i=0;i<bs.length;i++){const st=Math.max(0,(cur-(i>0?OVERLAP:0)))*SR,en=bs[i]*SR;const t0=Date.now();const txt=await dec(a.slice(Math.floor(st),Math.floor(en)));segs.push({id:`seg${i}`,txt,ms:Date.now()-t0});cur=bs[i];}
  const seamLog=[]; let acc=tok(segs[0].txt); for(let i=1;i<segs.length;i++)acc=acc.concat(reconcileSeam(acc,tok(segs[i].txt),segs[i-1].id,segs[i].id,seamLog));
  return {segs,acc,seamLog,tailMs:segs[segs.length-1].ms,nSeg:segs.length};}

// ---- A) REPRODUCIBLE WER (washington, authoritative reference) ----
const wts=readFileSync(resolve(FIX,'stt-isomorphic/washington-speeches.ts'),'utf8');
const blk=wts.slice(wts.indexOf('transcript: ['), wts.indexOf("].join"));
const ref=tok([...blk.matchAll(/'([^']+)'/g)].map(m=>m[1]).join(' '));
const wa=readWav(resolve(FIX,'stt-isomorphic/audio/washington_01.wav'));
const wWhole=tok(await dec(wa)); const wSeg=await segment(wa);
console.log(`MAX_SEAM_TRIM = ${MAX_SEAM_TRIM} tokens (overlap ${OVERLAP}s x ${ASSUMED_MAX_WPS} wps, cap 10)\n`);
console.log(`== A) WASHINGTON WER vs authoritative ground truth (${ref.length} words) ==`);
console.log(`whole-utterance: ${wWhole.length}w  WER ${(wer(ref,wWhole)*100).toFixed(1)}%`);
console.log(`segmented      : ${wSeg.acc.length}w  WER ${(wer(ref,wSeg.acc)*100).toFixed(1)}%   (tail ${(wSeg.tailMs/1000).toFixed(1)}s, ${wSeg.nSeg} segs)`);

// ---- B) SEAM AUDIT across repo-fixture multi-segment clips ----
const harv=readWav(resolve(FIX,'harvard_benchmark_16k.wav'));
const jfk=readWav(resolve(FIX,'jfk_16k.wav'));
const cat=(...xs)=>{let L=xs.reduce((s,x)=>s+x.length,0),o=new Float32Array(L),k=0;for(const x of xs){o.set(x,k);k+=x.length;}return o;};
const clips=[['washington_01',wa,wSeg],['harvard_benchmark',harv,await segment(harv)],['concat(jfk+harvard+washington)',cat(jfk,harv,wa),null]];
clips[2][2]=await segment(clips[2][1]);
console.log(`\n== B) SEAM AUDIT (conservative overlap-bounded reconciliation) ==`);
for(const [name,,s] of clips){
  console.log(`\n[${name}] ${s.nSeg} segs, assembled ${s.acc.length}w, assembled-loop: ${loopFlag(s.acc)||'none'}`);
  for(const e of s.seamLog) console.log(`  seam ${e.seam} | window ${e.overlapSec}s/cap ${e.cap}tok | removed ${e.removedTokens}tok ${e.removedText?`"${e.removedText}"`:''} | ${e.reason}${e.removedLoop==='YES'?' | REMOVED-SPAN-WAS-A-LOOP!':''}`);
  const flagged=s.seamLog.filter(e=>e.reason.includes('FLAG')).length, trims=s.seamLog.filter(e=>e.removedTokens>0);
  console.log(`  -> seams:${s.seamLog.length} trimmed:${trims.length} kept-both/flagged:${flagged} max-trim-this-clip:${Math.max(0,...s.seamLog.map(e=>e.removedTokens))}tok`);
}
console.log(`\nPolicy: trim only EXACT overlap match <= ${MAX_SEAM_TRIM} tok inside the window; else keep-both+flag. No global de-dup. No out-of-window trim. Under-trim shows as a FLAG (visible duplication), never silent deletion.`);
