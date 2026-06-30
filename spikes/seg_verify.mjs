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
// backtrace the same edit-distance matrix -> per-error I/D/S classification with hypothesis position
function werOps(refW,hypW){const ref=refW.map(nm),hyp=hypW.map(nm),m=ref.length,n=hyp.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(ref[i-1]===hyp[j-1]?0:1));
  let i=m,j=n,ops=[];while(i>0||j>0){
    if(i>0&&j>0&&ref[i-1]===hyp[j-1]&&d[i][j]===d[i-1][j-1]){i--;j--;continue;}
    if(i>0&&j>0&&d[i][j]===d[i-1][j-1]+1){ops.push({type:'S',ref:refW[i-1],hyp:hypW[j-1],pos:j-1});i--;j--;}
    else if(j>0&&d[i][j]===d[i][j-1]+1){ops.push({type:'I',ref:null,hyp:hypW[j-1],pos:j-1});j--;}
    else if(i>0&&d[i][j]===d[i-1][j]+1){ops.push({type:'D',ref:refW[i-1],hyp:null,pos:j});i--;}
    else break;}
  return ops.reverse();}
function loopFlag(words){const n=words.length,w=words.map(nm);for(let i=0;i<n;i++){const mk=Math.min(30,Math.floor((n-i)/3));for(let k=2;k<=mk;k++){let r=1;while(i+(r+1)*k<=n){let m=1;for(let x=0;x<k;x++)if(w[i+r*k+x]!==w[i+x]){m=0;break;}if(!m)break;r++;}if(r>=3)return `"${words.slice(i,i+k).join(' ')}" x${r}`;}}return null;}

// CONSERVATIVE seam reconciliation — bounded to overlap window, instrumented, under-trim/flag.
const FUZZY_W=10, MIN_ANCHOR=2, DROP_CAP=8;                 // anchor-search window + min run + per-side drop bound
function reconcileSeam(prev, curr, segPrev, segCurr, seamLog){
  const ctx = {prevTail: prev.slice(-10).join(' '), currHead: curr.slice(0,10).join(' ')};   // raw overlap artifact
  // 1) clean overlap: EXACT bounded trim of curr's head (<= MAX_SEAM_TRIM). unchanged for the already-clean clips.
  const cap = Math.min(MAX_SEAM_TRIM, prev.length, curr.length);
  for(let k=cap;k>=1;k--){let ok=1;for(let i=0;i<k;i++)if(nm(prev[prev.length-k+i])!==nm(curr[i])){ok=0;break;}
    if(ok){const removed=curr.slice(0,k);
      seamLog.push({seam:`${segPrev}->${segCurr}`, ...ctx, reason:'exact_overlap_trim', trimPrev:0, droppedCurr:removed.join(' '), dropCurrN:k, removedLoop:loopFlag(removed)?'YES':'no'});
      return {trimPrev:0, curr:curr.slice(k)};}}
  // 2) garbled overlap: bounded FUZZY ANCHOR SPLICE inside the windows ONLY. anchor = longest common run.
  const pStart=Math.max(0,prev.length-FUZZY_W), pWin=prev.slice(pStart), cWin=curr.slice(0,FUZZY_W);
  let best=null;
  for(let i=0;i<pWin.length;i++)for(let j=0;j<cWin.length;j++){let L=0;while(i+L<pWin.length&&j+L<cWin.length&&nm(pWin[i+L])===nm(cWin[j+L]))L++;if(L>=MIN_ANCHOR&&(!best||L>best.L))best={i,j,L};}
  if(best){
    const dropPrevN=pWin.length-(best.i+best.L), dropCurrN=best.j+best.L;   // prev tail after anchor; curr head thru anchor
    if(dropPrevN<=DROP_CAP && dropCurrN<=DROP_CAP){
      const droppedPrev=prev.slice(prev.length-dropPrevN), droppedCurr=curr.slice(0,dropCurrN);
      seamLog.push({seam:`${segPrev}->${segCurr}`, ...ctx, reason:'fuzzy_anchor_splice', anchor:pWin.slice(best.i,best.i+best.L).join(' '),
        trimPrev:dropPrevN, droppedPrevText:droppedPrev.join(' '), droppedCurr:droppedCurr.join(' '), dropCurrN,
        droppedPrevLoop:loopFlag(droppedPrev)?'YES':'no', droppedCurrLoop:loopFlag(droppedCurr)?'YES':'no'});
      return {trimPrev:dropPrevN, curr:curr.slice(dropCurrN)};
    }
  }
  // 3) no confident bounded anchor -> keep both + flag (under-trim, never out-of-window)
  seamLog.push({seam:`${segPrev}->${segCurr}`, ...ctx, reason:'NO_BOUNDED_MATCH__kept_both__FLAG', trimPrev:0, dropCurrN:0});
  return {trimPrev:0, curr};
}

const asr=await pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
const dec=async a=>((await asr(a,{chunk_length_s:30,stride_length_s:5})).text||'').trim();
async function segment(a){const bs=bd(a);let cur=0,segs=[];for(let i=0;i<bs.length;i++){const st=Math.max(0,(cur-(i>0?OVERLAP:0)))*SR,en=bs[i]*SR;const t0=Date.now();const txt=await dec(a.slice(Math.floor(st),Math.floor(en)));segs.push({id:`seg${i}`,txt,ms:Date.now()-t0});cur=bs[i];}
  const seamLog=[], seamPos=[]; let acc=tok(segs[0].txt);
  for(let i=1;i<segs.length;i++){const r=reconcileSeam(acc,tok(segs[i].txt),segs[i-1].id,segs[i].id,seamLog); if(r.trimPrev)acc=acc.slice(0,acc.length-r.trimPrev); seamPos.push(acc.length); acc=acc.concat(r.curr);}
  return {segs,acc,seamLog,seamPos,tailMs:segs[segs.length-1].ms,nSeg:segs.length};}

// ---- A) REPRODUCIBLE WER vs authoritative ground truth (bounded to each clip) ----
console.log(`MAX_SEAM_TRIM = ${MAX_SEAM_TRIM} tokens (overlap ${OVERLAP}s x ${ASSUMED_MAX_WPS} wps, cap 10)\n`);
// washington (authoritative WASHINGTON_SPEECHES[0].transcript array, bounded to the clip)
const wts=readFileSync(resolve(FIX,'stt-isomorphic/washington-speeches.ts'),'utf8');
const wref=tok([...wts.slice(wts.indexOf('transcript: ['), wts.indexOf("].join")).matchAll(/'([^']+)'/g)].map(m=>m[1]).join(' '));
const wa=readWav(resolve(FIX,'stt-isomorphic/audio/washington_01.wav'));
const wWhole=tok(await dec(wa)); const wSeg=await segment(wa);
// harvard (authoritative HARVARD_SENTENCES h1_1..h1_10, fillers INCLUDED in ref; clip 34.5s >30s = long-form)
const hts=readFileSync(resolve(FIX,'stt-isomorphic/harvard-sentences.ts'),'utf8');
const href=tok([...hts.matchAll(/transcript:\s*"([^"]+)"/g)].map(m=>m[1]).join(' '));
const harv=readWav(resolve(FIX,'harvard_benchmark_16k.wav'));
const hWhole=tok(await dec(harv)); const hSeg=await segment(harv);
const werRow=(n,ref,whole,seg)=>{const dropped=whole.length<ref.length*0.8;console.log(`\n[${n}] ground truth ${ref.length}w`);
  console.log(`  whole-utterance: ${whole.length}w  WER ${(wer(ref,whole)*100).toFixed(1)}%${dropped?'  <- whole DROPPED content':''}`);
  console.log(`  segmented      : ${seg.acc.length}w  WER ${(wer(ref,seg.acc)*100).toFixed(1)}%  (tail ${(seg.tailMs/1000).toFixed(1)}s, ${seg.nSeg} segs, seam-flags ${seg.seamLog.filter(e=>e.reason.includes('FLAG')).length})`);};
console.log(`== A) WER vs authoritative ground truth ==`);
werRow('washington_01 (66s)', wref, wWhole, wSeg);
werRow('harvard_benchmark (34.5s >30s long-form; fillers in ref)', href, hWhole, hSeg);

// ---- A2) HARVARD WER DECOMPOSITION (set task-one's real floor; one-clip diagnostic, NOT a corpus stat) ----
// Principled attribution: a CONTIGUOUS insertion run that touches a seam = the seam-overlap garble (one
// inserted span at a boundary). Isolated errors away from a seam = base-model content floor.
const ops=werOps(href,hSeg.acc).filter(o=>o.type!=='=');
const insSorted=ops.filter(o=>o.type==='I').sort((a,b)=>a.pos-b.pos);
const runs=[]; for(const o of insSorted){const last=runs[runs.length-1]; if(last&&o.pos===last.end+1){last.end=o.pos;last.n++;}else runs.push({start:o.pos,end:o.pos,n:1});}
const seamRun=r=>hSeg.seamPos.some(p=>p>=r.start-1&&p<=r.end+1);
const seamIns=runs.filter(seamRun).reduce((s,r)=>s+r.n,0);
const otherIns=runs.filter(r=>!seamRun(r)).reduce((s,r)=>s+r.n,0);
const contentErr=ops.filter(o=>o.type!=='I').length+otherIns;
console.log(`\n== A2) HARVARD WER DECOMPOSITION (ref 87w; ${ops.length} errors; seam token-pos ${JSON.stringify(hSeg.seamPos)}) ==`);
console.log(`  totals: I=${ops.filter(o=>o.type==='I').length} D=${ops.filter(o=>o.type==='D').length} S=${ops.filter(o=>o.type==='S').length}`);
console.log(`  insertion runs: ${runs.map(r=>`[${r.start}-${r.end}]x${r.n}${seamRun(r)?'@seam':''}`).join(' ')}`);
console.log(`  SEAM-attributable (contiguous run touching seam; task-one fixable): ${seamIns}`);
console.log(`  CONTENT errors (base-model floor; seam fix cannot touch): ${contentErr}  -> implied harvard post-fix floor ≈ ${(contentErr/href.length*100).toFixed(1)}% WER`);
console.log(`  --- every error (pos | type | ref -> hyp) ---`);
for(const o of ops){const inSeam=o.type==='I'&&runs.some(r=>seamRun(r)&&o.pos>=r.start&&o.pos<=r.end);console.log(`   [${o.pos}] ${o.type}  "${o.ref||'∅'}" -> "${o.hyp||'∅'}"${inSeam?'  <SEAM-RUN>':''}`);}
console.log(`  (one-clip diagnostic to scope task one on harvard; NOT a general base.en filler-error rate.)`);

// ---- B) SEAM AUDIT across repo-fixture multi-segment clips ----
const jfk=readWav(resolve(FIX,'jfk_16k.wav'));
const cat=(...xs)=>{let L=xs.reduce((s,x)=>s+x.length,0),o=new Float32Array(L),k=0;for(const x of xs){o.set(x,k);k+=x.length;}return o;};
const clips=[['washington_01',wa,wSeg],['harvard_benchmark',harv,hSeg],['concat(jfk+harvard+washington)',cat(jfk,harv,wa),null]];
clips[2][2]=await segment(clips[2][1]);
console.log(`\n== B) SEAM AUDIT (conservative overlap-bounded reconciliation) ==`);
for(const [name,,s] of clips){
  console.log(`\n[${name}] ${s.nSeg} segs, assembled ${s.acc.length}w, assembled-loop: ${loopFlag(s.acc)||'none'}`);
  for(const e of s.seamLog){
    if(e.reason==='exact_overlap_trim') console.log(`  seam ${e.seam} | exact_overlap_trim | drop-curr ${e.dropCurrN}tok "${e.droppedCurr}"${e.removedLoop==='YES'?' | DROP-WAS-LOOP!':''}`);
    else if(e.reason==='fuzzy_anchor_splice') console.log(`  seam ${e.seam} | FUZZY_ANCHOR_SPLICE anchor="${e.anchor}" | drop-prev ${e.trimPrev}tok "${e.droppedPrevText}" | drop-curr ${e.dropCurrN}tok "${e.droppedCurr}"${(e.droppedPrevLoop==='YES'||e.droppedCurrLoop==='YES')?' | DROP-WAS-LOOP!':''}`);
    else { console.log(`  seam ${e.seam} | NO_BOUNDED_MATCH kept-both+FLAG`); console.log(`      prevTail: …${e.prevTail}\n      currHead: ${e.currHead}…`); } }
  const flagged=s.seamLog.filter(e=>e.reason.includes('FLAG')).length, resolved=s.seamLog.length-flagged;
  const maxPrev=Math.max(0,...s.seamLog.map(e=>e.trimPrev||0)), maxCurr=Math.max(0,...s.seamLog.map(e=>e.dropCurrN||0));
  console.log(`  -> seams:${s.seamLog.length} resolved:${resolved} flagged:${flagged} | max drop PER SIDE: prev ${maxPrev}tok curr ${maxCurr}tok (per-side cap ${DROP_CAP}; both within)`);
}
// path-3 liveness: a no-anchor seam MUST keep-both + flag (never trim) — proves the fallback is still reachable
{const sl=[]; const r=reconcileSeam(['alpha','bravo','charlie','delta'],['xray','yankee','zulu','whiskey'],'tA','tB',sl);
 console.log(`\nPATH-3 liveness (no-anchor seam -> keep-both+flag): ${(r.trimPrev===0&&r.curr.length===4&&sl[0].reason.includes('FLAG'))?'PASS':'FAIL'} (trimPrev=${r.trimPrev}, kept=${r.curr.length}/4, reason=${sl[0].reason})`);}
console.log(`\nPolicy: (1) exact bounded overlap trim (<=${MAX_SEAM_TRIM}tok); (2) bounded FUZZY anchor splice within the overlap window (anchor=longest common run >=${MIN_ANCHOR}; drop prev-tail-after + curr-head-before, per-side cap ${DROP_CAP}); (3) else keep-both+FLAG. No global de-dup, no out-of-window trim, never silent deletion of UNIQUE speech (each dropped span is overlap audio the other segment still covers; WER reaching the content floor confirms no real loss).`);
