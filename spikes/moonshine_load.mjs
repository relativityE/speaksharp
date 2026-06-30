// Load SELF-HOSTED Moonshine base (same approach as whisper-base.en: local ONNX, allowRemoteModels=false)
// and transcribe the baseline fixture. Measures decode RTF + quality vs the whisper baseline.
import { pipeline, env } from '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
import { readFileSync } from 'node:fs';
env.allowLocalModels = true; env.allowRemoteModels = false;
env.localModelPath = '/private/tmp/moonshine-models/';

function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
 let off=12,dataOff=-1,dataLen=0,bps=16,ch=1;
 while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));
 const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dataOff=off+8;dataLen=sz;}off+=8+sz+(sz%2);}
 const step=(bps/8)*ch,n=Math.floor(dataLen/step),out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=dv.getInt16(dataOff+i*step,true)/32768;return out;}

const audio=readWav('/private/tmp/ss_utterance_0.wav');
const durS=audio.length/16000;
console.log(`loading self-hosted moonshine-base (audio ${durS.toFixed(1)}s)…`);
const tL=Date.now();
const asr=await pipeline('automatic-speech-recognition','moonshine-base',{ dtype:{ encoder_model:'q8', decoder_model_merged:'q8' } });
console.log(`LOADED in ${Date.now()-tL}ms`);
const t0=Date.now();
const r=await asr(audio);                 // Moonshine = variable-length; no 30s chunking
const ms=Date.now()-t0;
const text=(typeof r==='string'?r:r.text||'').trim();
console.log(`DECODE ${ms}ms  RTF ${(ms/1000/durS).toFixed(3)}x  | 5-min implied: ${Math.round(ms/durS*300/1000)}s`);
console.log(`opening "my main point"? ${/my main point/i.test(text)}`);
console.log('HEAD:', text.slice(0,200));
