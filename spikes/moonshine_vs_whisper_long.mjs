// Honest long-audio comparison on ~3.3min of VARIED real speech (4 different clips, no repetition).
import { readFileSync } from 'node:fs';
function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);let off=12,dataOff=-1,dataLen=0,bps=16,ch=1;
 while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dataOff=off+8;dataLen=sz;}off+=8+sz+(sz%2);}
 const step=(bps/8)*ch,n=Math.floor(dataLen/step),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=dv.getInt16(dataOff+i*step,true)/32768;return o;}
const R='/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/tests/fixtures';
const parts=[readWav('/private/tmp/ss_utterance_0.wav'),readWav('/private/tmp/ss_utterance_1.wav'),readWav(R+'/stt-isomorphic/audio/washington_01.wav'),readWav(R+'/harvard_benchmark_16k.wav')];
const N=parts.reduce((s,p)=>s+p.length,0); const big=new Float32Array(N); let o=0; for(const p of parts){big.set(p,o);o+=p.length;}
const durS=big.length/16000;
console.log(`VARIED long clip: ${durS.toFixed(0)}s of real speech (4 distinct clips)\n`);

const wsp=(await import('/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@xenova/transformers/src/transformers.js'));
wsp.env.allowLocalModels=true; wsp.env.allowRemoteModels=false; wsp.env.localModelPath='/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/frontend/public/models/';
const wpipe=await wsp.pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
let t=Date.now(); const wr=await wpipe(big,{chunk_length_s:30,stride_length_s:5}); const wms=Date.now()-t;
console.log(`WHISPER base.en : ${wms}ms  RTF ${(wms/1000/durS).toFixed(3)}x  -> 5-min ≈ ${Math.round(wms/durS*300/1000)}s  words=${(wr.text||'').trim().split(/\s+/).length}`);

const ms=(await import('/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@huggingface/transformers/dist/transformers.node.mjs'));
ms.env.allowLocalModels=true; ms.env.allowRemoteModels=false; ms.env.localModelPath='/private/tmp/moonshine-models/';
const mpipe=await ms.pipeline('automatic-speech-recognition','moonshine-base',{dtype:{encoder_model:'q8',decoder_model_merged:'q8'}});
t=Date.now(); const mr=await mpipe(big); const mms=Date.now()-t;
console.log(`MOONSHINE base  : ${mms}ms  RTF ${(mms/1000/durS).toFixed(3)}x  -> 5-min ≈ ${Math.round(mms/durS*300/1000)}s  words=${(mr.text||'').trim().split(/\s+/).length}`);
console.log(`\nMoonshine HEAD: ${(mr.text||'').trim().slice(0,140)}`);
console.log(`Moonshine TAIL: …${(mr.text||'').trim().slice(-100)}`);
