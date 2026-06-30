// Phase-1 segmented-finalization SPIKE (Branch B). Proves the two things that decide it:
//   (1) TIMING — at Stop you decode only the unconfirmed TAIL (bounded by MAX_SEGMENT), not the
//       whole recording. Tail decode is ~constant regardless of total length.
//   (2) BOUNDARY CORRECTNESS — splitting at forced boundaries WITH overlap + conservative seam
//       reconciliation reproduces the whole-utterance transcript with no lost/duplicated words.
// Real whisper-base.en (local), real audio. No network. No app. Pure timing+correctness proof.
import { pipeline, env } from '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@xenova/transformers/src/transformers.js';
import { readFileSync } from 'node:fs';
env.allowLocalModels = true; env.allowRemoteModels = false;
env.localModelPath = '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/frontend/public/models/';

function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
 let off=12,dataOff=-1,dataLen=0,bps=16,ch=1;
 while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));
 const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dataOff=off+8;dataLen=sz;}off+=8+sz+(sz%2);}
 const step=(bps/8)*ch,n=Math.floor(dataLen/step),out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=dv.getInt16(dataOff+i*step,true)/32768;return out;}

const SR=16000, MAX_SEG=20, OVERLAP=1.5;            // forced 20s segments, 1.5s overlap
const tok=s=>s.trim().split(/\s+/).filter(Boolean);
const nm=t=>t.toLowerCase().replace(/[^a-z0-9']/g,'');
function reconcile(prev, cur){                       // drop cur's leading overlap that dups prev's tail
  const maxK=Math.min(25,prev.length,cur.length);
  for(let k=maxK;k>=2;k--){let ok=true;for(let i=0;i<k;i++){if(nm(prev[prev.length-k+i])!==nm(cur[i])){ok=false;break;}}if(ok)return cur.slice(k);}
  return cur;                                         // no clean seam match -> keep all (under-trim, never lose words)
}

console.log('loading whisper-base.en (quantized)…');
const asr=await pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
const decode=async(a)=>{const t=Date.now();const r=await asr(a,{chunk_length_s:30,stride_length_s:5});return {text:(r.text||'').trim(),ms:Date.now()-t};};

const audio=readWav('/private/tmp/ss_utterance_0.wav');
const durS=audio.length/SR;
console.log(`audio ${durS.toFixed(1)}s\n`);

// --- baseline: current architecture (whole-utterance decode at Stop) ---
const whole=await decode(audio);
console.log(`BASELINE whole-utterance decode: ${whole.ms}ms (${(whole.ms/1000/durS).toFixed(3)}x)`);

// --- segmented: forced boundaries + overlap; decode each (during-recording), Stop = tail only ---
const bounds=[]; for(let s=0;s<durS;s+=MAX_SEG) bounds.push(s); bounds.push(durS);
const segs=[];
for(let i=0;i+1<bounds.length;i++){
  const start=Math.max(0,(bounds[i]-(i>0?OVERLAP:0)))*SR, end=Math.min(audio.length,bounds[i+1]*SR);
  const d=await decode(audio.slice(Math.floor(start),Math.floor(end)));
  segs.push({i,startS:start/SR,endS:end/SR,...d});
  console.log(`  seg${i} [${(start/SR).toFixed(1)}-${(end/SR).toFixed(1)}s] decode ${d.ms}ms`);
}
// assemble with seam reconciliation
let acc=tok(segs[0].text);
for(let i=1;i<segs.length;i++) acc=acc.concat(reconcile(acc, tok(segs[i].text)));
const assembled=acc.join(' ');
const tailMs=segs[segs.length-1].ms;   // the ONLY decode that happens after Stop

// --- correctness: assembled vs whole (word recall + duplication) ---
const W=tok(whole.text).map(nm), A=acc.map(nm);
const setW=new Set(W);
const recall=W.filter(w=>A.includes(w)).length/W.length;
const lenRatio=A.length/W.length;
console.log(`\nSEGMENTED stop-to-final (TAIL only): ${tailMs}ms  vs baseline ${whole.ms}ms`);
console.log(`5-min implied: segmented ≈ ${Math.round(tailMs/1000)}s (tail bounded by ${MAX_SEG}s) vs whole ≈ ${Math.round(whole.ms/durS*300/1000)}s`);
console.log(`opening preserved? ${/my main point/i.test(assembled)}`);
console.log(`word recall assembled-vs-whole: ${(recall*100).toFixed(1)}%  | length ratio: ${lenRatio.toFixed(3)} (≈1.0 = no lost/dup)`);
console.log(`\nWHOLE  : ${whole.text.slice(0,160)}`);
console.log(`ASSEMB : ${assembled.slice(0,160)}`);
