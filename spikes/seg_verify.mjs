// Phase 1.5/2 segmentation VERIFICATION + seam coverage (Branch B, #891). Reproducible.
//   Run from repo root:  node spikes/seg_verify.mjs   (or SS_ROOT=/path node spikes/seg_verify.mjs)
//
// COVERAGE INVARIANT (the load-bearing safety property): every token dropped by a seam reconciliation, on
// EITHER side, must have its audio timespan fall entirely within the temporal overlap region both adjacent
// segments decoded. Overlap = wall-clock [t_lo, t_hi] = [curr.audioStart, prev.audioEnd]. A dropped span
// outside it = deleting audio the other segment never saw => ABORT the splice to keep-both+FLAG. Token-count
// is blast-radius; time-range is coverage. Word timestamps come from return_timestamps:'word'.
import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
const ROOT = process.env.SS_ROOT || resolve(import.meta.dirname, '..');
env.allowLocalModels=true; env.allowRemoteModels=false; env.localModelPath=resolve(ROOT,'frontend/public/models/');
const FIX = resolve(ROOT,'tests/fixtures');

const SR=16000, TARGET=20, HARDCAP=30, OVERLAP=1.5;
const MAX_SEAM_TRIM=6, FUZZY_W=10, MIN_ANCHOR=2, DROP_CAP=8, COV_EPS=0.20;   // COV_EPS = timestamp-jitter tolerance (s)

function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);let off=12,dO=-1,dL=0,bps=16,ch=1;while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dO=off+8;dL=sz;}off+=8+sz+(sz%2);}const st=(bps/8)*ch,n=Math.floor(dL/st),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=dv.getInt16(dO+i*st,true)/32768;return o;}
const tok=s=>s.trim().split(/\s+/).filter(Boolean), nm=t=>t.toLowerCase().replace(/[^a-z0-9']/g,'');
function pc(a){const H=Math.round(0.02*SR),r=[];for(let i=0;i+H<=a.length;i+=H){let s=0;for(let j=0;j<H;j++)s+=a[i+j]*a[i+j];r.push(Math.sqrt(s/H));}const md=[...r].sort((x,y)=>x-y)[Math.floor(r.length/2)]||0,th=Math.max(0.006,0.3*md),nd=Math.round(0.25/0.02);const ps=[];let rn=0;for(let i=0;i<r.length;i++){if(r[i]<th)rn++;else{if(rn>=nd)ps.push(((i-rn/2)*H)/SR);rn=0;}}return ps;}
function bd(a){const d=a.length/SR,ps=pc(a),bs=[];let c=0;while(d-c>HARDCAP){const lo=c+TARGET-5,hi=c+HARDCAP,cd=ps.filter(p=>p>=lo&&p<=hi);let ct=cd.length?cd.reduce((b,p)=>Math.abs(p-(c+TARGET))<Math.abs(b-(c+TARGET))?p:b):c+HARDCAP;bs.push(ct);c=ct;}bs.push(d);return bs;}
function wer(ref,hyp){const r=ref.map(nm),h=hyp.map(nm),m=r.length,n=h.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(r[i-1]===h[j-1]?0:1));return m?d[m][n]/m:0;}
function werOps(refW,hypW){const ref=refW.map(nm),hyp=hypW.map(nm),m=ref.length,n=hyp.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(ref[i-1]===hyp[j-1]?0:1));
  let i=m,j=n,ops=[];while(i>0||j>0){if(i>0&&j>0&&ref[i-1]===hyp[j-1]&&d[i][j]===d[i-1][j-1]){i--;j--;continue;}if(i>0&&j>0&&d[i][j]===d[i-1][j-1]+1){ops.push({type:'S',ref:refW[i-1],hyp:hypW[j-1],pos:j-1});i--;j--;}else if(j>0&&d[i][j]===d[i][j-1]+1){ops.push({type:'I',ref:null,hyp:hypW[j-1],pos:j-1});j--;}else if(i>0&&d[i][j]===d[i-1][j]+1){ops.push({type:'D',ref:refW[i-1],hyp:null,pos:j});i--;}else break;}return ops.reverse();}
function loopFlag(words){const n=words.length,w=words.map(nm);for(let i=0;i<n;i++){const mk=Math.min(30,Math.floor((n-i)/3));for(let k=2;k<=mk;k++){let r=1;while(i+(r+1)*k<=n){let m=1;for(let x=0;x<k;x++)if(w[i+r*k+x]!==w[i+x]){m=0;break;}if(!m)break;r++;}if(r>=3)return `"${words.slice(i,i+k).join(' ')}" x${r}`;}}return null;}

const asr=await pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
const dec=async a=>((await asr(a,{chunk_length_s:30,stride_length_s:5})).text||'').trim();           // whole-path baseline
const decTimed=async a=>((await asr(a,{chunk_length_s:30,stride_length_s:5,return_timestamps:'word'})).chunks||[]).map(c=>({w:(c.text||'').trim(), ts:c.timestamp[0], te:c.timestamp[1]??c.timestamp[0]})).filter(x=>x.w);

// span coverage: a dropped span (timed tokens) is COVERED iff every token lies inside [tLo,tHi] (+/- jitter)
function spanCov(span, tLo, tHi){ if(!span.length) return {ts:null,te:null,covered:true};
  const ts=Math.min(...span.map(t=>t.ts)), te=Math.max(...span.map(t=>t.te));
  return {ts, te, covered: span.every(t=>t.ts>=tLo-COV_EPS && t.te<=tHi+COV_EPS)}; }

// reconcile a seam between prev (timed acc tail) and curr (timed next seg). tLo/tHi = wall-clock overlap interval.
function reconcileSeam(prev, curr, tLo, tHi, segPrev, segCurr, seamLog){
  const base={seam:`${segPrev}->${segCurr}`, tLo, tHi, prevTail:prev.slice(-10).map(t=>t.w).join(' '), currHead:curr.slice(0,10).map(t=>t.w).join(' ')};
  // 1) clean overlap: EXACT bounded trim of curr's head — but still coverage-checked
  const cap=Math.min(MAX_SEAM_TRIM, prev.length, curr.length);
  for(let k=cap;k>=1;k--){let ok=1;for(let i=0;i<k;i++)if(nm(prev[prev.length-k+i].w)!==nm(curr[i].w)){ok=0;break;}
    if(ok){const dropped=curr.slice(0,k), c=spanCov(dropped,tLo,tHi);
      if(c.covered){ seamLog.push({...base, reason:'exact_overlap_trim', drops:[{side:'curr',text:dropped.map(t=>t.w).join(' '),...c,action:'DROPPED'}]}); return {trimPrev:0,curr:curr.slice(k)}; }
      break; } }
  // 2) garbled overlap: bounded FUZZY ANCHOR SPLICE — anchor=longest common run, then COVERAGE-GATED
  const pStart=Math.max(0,prev.length-FUZZY_W), pWin=prev.slice(pStart), cWin=curr.slice(0,FUZZY_W);
  let best=null;
  for(let i=0;i<pWin.length;i++)for(let j=0;j<cWin.length;j++){let L=0;while(i+L<pWin.length&&j+L<cWin.length&&nm(pWin[i+L].w)===nm(cWin[j+L].w))L++;if(L>=MIN_ANCHOR&&(!best||L>best.L))best={i,j,L};}
  if(best){
    const dropPrevN=pWin.length-(best.i+best.L), dropCurrN=best.j+best.L;
    if(dropPrevN<=DROP_CAP && dropCurrN<=DROP_CAP){
      const dp=prev.slice(prev.length-dropPrevN), dc=curr.slice(0,dropCurrN), cp=spanCov(dp,tLo,tHi), cc=spanCov(dc,tLo,tHi);
      const anchor=pWin.slice(best.i,best.i+best.L).map(t=>t.w).join(' ');
      // ASYMMETRIC: drop each side's span IFF it is coverage-certified (jitter incl). keep+FLAG any out-of-window
      // span. NEVER drop out-of-window. Boundary-hallucination removal is NOT attempted (out of scope).
      const doPrev = dp.length>0 && cp.covered, doCurr = dc.length>0 && cc.covered;
      const drops=[...(dp.length?[{side:'prev',text:dp.map(t=>t.w).join(' '),...cp,action:doPrev?'DROPPED':'KEPT'}]:[]), ...(dc.length?[{side:'curr',text:dc.map(t=>t.w).join(' '),...cc,action:doCurr?'DROPPED':'KEPT'}]:[])];
      const reason=(doPrev&&doCurr)?'fuzzy_anchor_splice_FULL':(doPrev||doCurr)?'asym_splice_partial__residual_FLAG':'NO_COVERED_SPAN__kept_both__FLAG';
      seamLog.push({...base, reason, anchor, drops});
      return {trimPrev: doPrev?dropPrevN:0, curr: doCurr?curr.slice(dropCurrN):curr};
    }
  }
  seamLog.push({...base, reason:'NO_BOUNDED_MATCH__kept_both__FLAG', drops:[]});
  return {trimPrev:0, curr};
}

async function segment(a){const bs=bd(a); let cur=0, segs=[];
  for(let i=0;i<bs.length;i++){const startS=Math.max(0,cur-(i>0?OVERLAP:0)), endS=bs[i];
    const t0=Date.now(); const timed=await decTimed(a.slice(Math.floor(startS*SR),Math.floor(endS*SR))); const ms=Date.now()-t0;
    segs.push({id:`seg${i}`, words:timed.map(x=>({w:x.w, ts:x.ts+startS, te:x.te+startS})), audioStart:startS, audioEnd:endS, ms}); cur=bs[i]; }
  const seamLog=[], seamPos=[]; let acc=segs[0].words.slice();
  for(let i=1;i<segs.length;i++){const r=reconcileSeam(acc, segs[i].words, segs[i].audioStart, segs[i-1].audioEnd, segs[i-1].id, segs[i].id, seamLog); if(r.trimPrev)acc=acc.slice(0,acc.length-r.trimPrev); seamPos.push(acc.length); acc=acc.concat(r.curr);}
  return {segs, acc, accW:acc.map(t=>t.w), seamLog, seamPos, tailMs:segs[segs.length-1].ms, nSeg:segs.length};}

// ---- A) REPRODUCIBLE WER vs authoritative ground truth ----
console.log(`coverage invariant: every dropped span ⊆ [t_lo,t_hi]=[curr.audioStart, prev.audioEnd]; jitter tol ±${COV_EPS}s; out-of-window -> abort to flag\n`);
const wts=readFileSync(resolve(FIX,'stt-isomorphic/washington-speeches.ts'),'utf8');
const wref=tok([...wts.slice(wts.indexOf('transcript: ['), wts.indexOf("].join")).matchAll(/'([^']+)'/g)].map(m=>m[1]).join(' '));
const wa=readWav(resolve(FIX,'stt-isomorphic/audio/washington_01.wav'));
const wWhole=tok(await dec(wa)); const wSeg=await segment(wa);
const hts=readFileSync(resolve(FIX,'stt-isomorphic/harvard-sentences.ts'),'utf8');
const href=tok([...hts.matchAll(/transcript:\s*"([^"]+)"/g)].map(m=>m[1]).join(' '));
const harv=readWav(resolve(FIX,'harvard_benchmark_16k.wav'));
const hWhole=tok(await dec(harv)); const hSeg=await segment(harv);
const flags=s=>s.seamLog.filter(e=>e.reason.includes('FLAG')).length;
const werRow=(n,ref,whole,seg)=>{console.log(`[${n}] gt ${ref.length}w | whole ${whole.length}w WER ${(wer(ref,whole)*100).toFixed(1)}%${whole.length<ref.length*0.8?' (DROPPED)':''} | segmented ${seg.accW.length}w WER ${(wer(ref,seg.accW)*100).toFixed(1)}% (tail ${(seg.tailMs/1000).toFixed(1)}s, ${seg.nSeg} segs, flags ${flags(seg)})`);};
console.log(`== A) WER vs authoritative ground truth ==`);
werRow('washington_01 (66s)', wref, wWhole, wSeg);
werRow('harvard_benchmark (34.5s)', href, hWhole, hSeg);

// ---- A2) HARVARD WER DECOMPOSITION ----
const ops=werOps(href,hSeg.accW).filter(o=>o.type!=='=');
const insSorted=ops.filter(o=>o.type==='I').sort((a,b)=>a.pos-b.pos);
const runs=[]; for(const o of insSorted){const last=runs[runs.length-1]; if(last&&o.pos===last.end+1){last.end=o.pos;last.n++;}else runs.push({start:o.pos,end:o.pos,n:1});}
const seamRun=r=>hSeg.seamPos.some(p=>p>=r.start-1&&p<=r.end+1);
console.log(`\n== A2) HARVARD WER DECOMPOSITION (ref 87w; ${ops.length} errors; seam-pos ${JSON.stringify(hSeg.seamPos)}) ==`);
console.log(`  totals I=${ops.filter(o=>o.type==='I').length} D=${ops.filter(o=>o.type==='D').length} S=${ops.filter(o=>o.type==='S').length} | content-floor errors: ${ops.filter(o=>!(o.type==='I'&&runs.filter(seamRun).some(r=>o.pos>=r.start&&o.pos<=r.end))).length}`);
for(const o of ops) console.log(`   [${o.pos}] ${o.type} "${o.ref||'∅'}" -> "${o.hyp||'∅'}"`);

// ---- B) SEAM AUDIT with COVERAGE verdicts ----
const jfk=readWav(resolve(FIX,'jfk_16k.wav'));
const cat=(...xs)=>{let L=xs.reduce((s,x)=>s+x.length,0),o=new Float32Array(L),k=0;for(const x of xs){o.set(x,k);k+=x.length;}return o;};
const clips=[['washington_01',wSeg],['harvard_benchmark',hSeg],['concat(jfk+harvard+washington)',await segment(cat(jfk,harv,wa))]];
console.log(`\n== B) SEAM AUDIT (coverage-gated) ==`);
const fmt=d=>`${d.ts!=null?`@[${d.ts.toFixed(2)}-${d.te.toFixed(2)}s]`:'@[—]'} ${d.covered?'COVERED ✓':'OUT-OF-WINDOW ✗'}`;
for(const [name,s] of clips){
  console.log(`\n[${name}] ${s.nSeg} segs, assembled ${s.accW.length}w, loop: ${loopFlag(s.accW)||'none'}`);
  for(const e of s.seamLog){
    const tag=e.anchor?`${e.reason} anchor="${e.anchor}"`:e.reason;
    console.log(`  seam ${e.seam} | overlap [t_lo=${e.tLo.toFixed(2)}, t_hi=${e.tHi.toFixed(2)}] | ${tag}`);
    for(const d of e.drops) console.log(`      ${d.action==='DROPPED'?'DROP':'KEEP'}-${d.side} "${d.text}" ${fmt(d)}${d.action==='KEPT'?' (flagged residual)':''}`);
    if(e.reason.includes('NO_BOUNDED')) console.log(`      prevTail …${e.prevTail} | currHead ${e.currHead}…`);
  }
  const droppedOOW=s.seamLog.reduce((n,e)=>n+(e.drops||[]).filter(d=>d.action==='DROPPED'&&!d.covered).length,0);
  console.log(`  -> seams:${s.seamLog.length} flagged:${flags(s)} | DROPPED-OUT-OF-WINDOW (forbidden): ${droppedOOW}`);
}
// path-3 liveness: a no-anchor seam must keep-both+flag
{const sl=[]; const T=ws=>ws.map((w,i)=>({w,ts:i,te:i+0.5})); const r=reconcileSeam(T(['alpha','bravo','charlie','delta']),T(['xray','yankee','zulu','whiskey']),0,4,'tA','tB',sl);
 console.log(`\nPATH-3 liveness (no-anchor -> keep-both+flag): ${(r.trimPrev===0&&r.curr.length===4&&sl[0].reason.includes('FLAG'))?'PASS':'FAIL'}`);}
console.log(`\nPASS(b) = zero DROPPED-OUT-OF-WINDOW across all clips (only coverage-certified spans removed; out-of-window kept+flagged). Asymmetric: drop covered curr-head dup, keep+flag out-of-window prev-tail. Boundary-hallucination removal OUT OF SCOPE.`);
