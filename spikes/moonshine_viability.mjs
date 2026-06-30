// Moonshine viability spike (owner sequence step 2): does it actually load + transcribe in our
// transformers.js stack? Loads original Moonshine (the only variant in @huggingface/transformers
// v4.2.0 — v2/streaming is NOT registered) and decodes the same fixture used for the Whisper baseline.
import { pipeline, env } from '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
import { readFileSync } from 'node:fs';

env.allowRemoteModels = true; // Moonshine isn't self-hosted; pull from HF for the spike only

function readWav(p){const dv=new DataView(readFileSync(p).buffer);let off=12,dataOff=-1,dataLen=0,bps=16,ch=1;
 while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));
 const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dataOff=off+8;dataLen=sz;}off+=8+sz+(sz%2);}
 const step=(bps/8)*ch,n=Math.floor(dataLen/step),out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=dv.getInt16(dataOff+i*step,true)/32768;return out;}

const MODEL = process.argv[2] || 'onnx-community/moonshine-base-ONNX';
const audio = readWav('/private/tmp/ss_utterance_0.wav');
console.log(`loading ${MODEL} … (audio ${(audio.length/16000).toFixed(1)}s)`);
const tLoad = Date.now();
const asr = await pipeline('automatic-speech-recognition', MODEL);
console.log(`loaded in ${Date.now()-tLoad}ms`);
const t0 = Date.now();
const r = await asr(audio);
const decodeMs = Date.now()-t0;
const text = (typeof r === 'string' ? r : r.text || '').trim();
console.log(`DECODE ${decodeMs}ms  (RTF ${(decodeMs/1000/(audio.length/16000)).toFixed(3)}x)  5-min implied: ${Math.round(decodeMs/(audio.length/16000)*300/1000)}s`);
console.log(`opening "my main point"? ${/my main point/i.test(text)}`);
console.log('HEAD:', text.slice(0, 120));
