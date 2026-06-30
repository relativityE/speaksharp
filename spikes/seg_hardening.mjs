// Phase-1 segmentation HARDENING (Branch B). Per owner's 8-item spec:
//  1) 20s target / 30s hard cap   2) pause-aligned boundaries   3) decode confirmed segments during recording
//  4) Stop decodes only the unconfirmed tail   8) 5+ varied clips + 5-min proxy, WER (assembled-vs-whole),
//  raw loop check, opening preservation. (5/6/7 = production wiring, asserted via the single assembled transcript.)
import { pipeline, env } from '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@xenova/transformers/src/transformers.js';
import { readFileSync } from 'node:fs';
env.allowLocalModels = true; env.allowRemoteModels = false;
env.localModelPath = '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/frontend/public/models/';
const SR=16000, TARGET=20, HARDCAP=30, OVERLAP=1.5, MINPAUSE=0.25;

function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);let off=12,dataOff=-1,dataLen=0,bps=16,ch=1;
 while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dataOff=off+8;dataLen=sz;}off+=8+sz+(sz%2);}
 const step=(bps/8)*ch,n=Math.floor(dataLen/step),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=dv.getInt16(dataOff+i*step,true)/32768;return o;}
const tok=s=>s.trim().split(/\s+/).filter(Boolean), nm=t=>t.toLowerCase().replace(/[^a-z0-9']/g,'');

// pause detection: 20ms-frame RMS; silent if < max(floor, 0.3*median); pause = >=MINPAUSE of silence
function pauseCenters(a){const H=Math.round(0.02*SR),rms=[];for(let i=0;i+H<=a.length;i+=H){let s=0;for(let j=0;j<H;j++)s+=a[i+j]*a[i+j];rms.push(Math.sqrt(s/H));}
 const med=[...rms].sort((x,y)=>x-y)[Math.floor(rms.length/2)]||0, thr=Math.max(0.006,0.3*med), need=Math.round(MINPAUSE/0.02);
 const ps=[];let run=0;for(let i=0;i<rms.length;i++){if(rms[i]<thr)run++;else{if(run>=need)ps.push(((i-run/2)*H)/SR);run=0;}}if(run>=need)ps.push(((rms.length-run/2)*H)/SR);return ps;}
// boundaries: target 20s, snap to nearest pause in [TARGET-5, HARDCAP]; else hard-cap at 30s
function boundaries(a){const dur=a.length/SR, ps=pauseCenters(a), bs=[]; let cur=0;
 while(dur-cur>HARDCAP){const lo=cur+TARGET-5, hi=cur+HARDCAP, cand=ps.filter(p=>p>=lo&&p<=hi);
  let cut=cand.length?cand.reduce((b,p)=>Math.abs(p-(cur+TARGET))<Math.abs(b-(cur+TARGET))?p:b):cur+HARDCAP;
  bs.push(cut); cur=cut;} bs.push(dur); return {bs, nPauseSnaps: ps.length};}

function reconcile(prev,curr){const maxK=Math.min(25,prev.length,curr.length);for(let k=maxK;k>=2;k--){let ok=1;for(let i=0;i<k;i++)if(nm(prev[prev.length-k+i])!==nm(curr[i])){ok=0;break;}if(ok)return curr.slice(k);}return curr;}
function loop(words){const n=words.length,nw=words.map(nm);for(let i=0;i<n;i++){const maxK=Math.min(30,Math.floor((n-i)/3));for(let k=2;k<=maxK;k++){let r=1;while(i+(r+1)*k<=n){let m=1;for(let x=0;x<k;x++)if(nw[i+r*k+x]!==nw[i+x]){m=0;break;}if(!m)break;r++;}if(r>=3)return `"${words.slice(i,i+k).join(' ')}" x${r}`;}}return null;}
// word-level WER (assembled vs whole) via Levenshtein
function wer(ref,hyp){const r=ref.map(nm),h=hyp.map(nm),m=r.length,n=h.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;
 for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(r[i-1]===h[j-1]?0:1));return m?d[m][n]/m:0;}

const asr=await pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
const dec=async a=>{const r=await asr(a,{chunk_length_s:30,stride_length_s:5});return (r.text||'').trim();};

const F='/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/tests/fixtures';
const clips=[
 ['ss_utt_0 (53s)', readWav('/private/tmp/ss_utterance_0.wav'), /my main point/i],
 ['ss_utt_1 (47s)', readWav('/private/tmp/ss_utterance_1.wav'), null],
 ['washington (66s)', readWav(F+'/stt-isomorphic/audio/washington_01.wav'), null],
 ['harvard (35s)', readWav(F+'/harvard_benchmark_16k.wav'), null],
 ['jfk (11s, single-seg)', readWav(F+'/jfk_16k.wav'), null],
];
// 5-min proxy: varied concat
const vc=[clips[0][1],clips[1][1],clips[2][1],clips[3][1]]; let L=vc.reduce((s,p)=>s+p.length,0); const big=new Float32Array(L); let o=0; for(const p of vc){big.set(p,o);o+=p.length;}
clips.push(['VARIED ~3.3min (5-min proxy)', big, /my main point/i]);

console.log('clip | dur | segs | pause-snaps/hardcaps | stop-to-final(tail) | WER(assm-vs-whole) | recall | loop | opening');
for(const [name,a,openRe] of clips){
  const dur=a.length/SR;
  const whole=await dec(a);
  const {bs}=boundaries(a); let cur=0, segTexts=[], tailMs=0, hard=0, snap=0;
  for(let i=0;i<bs.length;i++){const start=Math.max(0,(cur-(i>0?OVERLAP:0)))*SR, end=bs[i]*SR;
    const t0=Date.now(); const txt=await dec(a.slice(Math.floor(start),Math.floor(end))); const ms=Date.now()-t0;
    segTexts.push(txt); if(i===bs.length-1)tailMs=ms;
    if(i<bs.length-1){ if(Math.abs(bs[i]-(cur+HARDCAP))<0.05) hard++; else snap++; } cur=bs[i];}
  let acc=tok(segTexts[0]); for(let i=1;i<segTexts.length;i++)acc=acc.concat(reconcile(acc,tok(segTexts[i])));
  const w=tok(whole); const recall=w.length?w.map(nm).filter(x=>acc.map(nm).includes(x)).length/w.length:1;
  const WER=wer(w,acc); const lp=loop(acc); const open=openRe?openRe.test(acc.join(' ')):'n/a';
  console.log(`${name} | ${dur.toFixed(0)}s | ${bs.length} | ${snap}snap/${hard}cap | ${(tailMs/1000).toFixed(1)}s | ${(WER*100).toFixed(1)}% | ${(recall*100).toFixed(0)}% | ${lp||'none'} | ${open}`);
}
console.log('\n(5/6/7 = production wiring: the assembled transcript above is the SINGLE artifact that must drive visible-final == saved History AND analytics/WPM/filler/PDF. Immediate-start re-gate tracked separately.)');
