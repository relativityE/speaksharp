import { pipeline, env } from '/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/node_modules/@xenova/transformers/src/transformers.js';
import { readFileSync } from 'node:fs';
env.allowLocalModels=true; env.allowRemoteModels=false; env.localModelPath='/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/frontend/public/models/';
const SR=16000,TARGET=20,HARDCAP=30,OVERLAP=1.5,MINPAUSE=0.25;
function readWav(p){const b=readFileSync(p);const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);let off=12,dO=-1,dL=0,bps=16,ch=1;while(off+8<=dv.byteLength){const id=String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3));const sz=dv.getUint32(off+4,true);if(id==='fmt '){ch=dv.getUint16(off+10,true);bps=dv.getUint16(off+22,true);}else if(id==='data'){dO=off+8;dL=sz;}off+=8+sz+(sz%2);}const st=(bps/8)*ch,n=Math.floor(dL/st),o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=dv.getInt16(dO+i*st,true)/32768;return o;}
const nm=t=>t.toLowerCase().replace(/[^a-z0-9']/g,''), tok=s=>s.trim().split(/\s+/).filter(Boolean);
function pc(a){const H=Math.round(0.02*SR),r=[];for(let i=0;i+H<=a.length;i+=H){let s=0;for(let j=0;j<H;j++)s+=a[i+j]*a[i+j];r.push(Math.sqrt(s/H));}const md=[...r].sort((x,y)=>x-y)[Math.floor(r.length/2)]||0,th=Math.max(0.006,0.3*md),nd=Math.round(MINPAUSE/0.02);const ps=[];let rn=0;for(let i=0;i<r.length;i++){if(r[i]<th)rn++;else{if(rn>=nd)ps.push(((i-rn/2)*H)/SR);rn=0;}}return ps;}
function bd(a){const d=a.length/SR,ps=pc(a),bs=[];let c=0;while(d-c>HARDCAP){const lo=c+TARGET-5,hi=c+HARDCAP,cd=ps.filter(p=>p>=lo&&p<=hi);let ct=cd.length?cd.reduce((b,p)=>Math.abs(p-(c+TARGET))<Math.abs(b-(c+TARGET))?p:b):c+HARDCAP;bs.push(ct);c=ct;}bs.push(d);return bs;}
function rec(p,c){const mk=Math.min(25,p.length,c.length);for(let k=mk;k>=2;k--){let ok=1;for(let i=0;i<k;i++)if(nm(p[p.length-k+i])!==nm(c[i])){ok=0;break;}if(ok)return c.slice(k);}return c;}
function wer(ref,hyp){const r=ref.map(nm),h=hyp.map(nm),m=r.length,n=h.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(r[i-1]===h[j-1]?0:1));return m?d[m][n]/m:0;}
const asr=await pipeline('automatic-speech-recognition','whisper-base.en',{quantized:true});
const dec=async a=>((await asr(a,{chunk_length_s:30,stride_length_s:5})).text||'').trim();
// washington reference (ground truth) from the .ts
const tsf=readFileSync('/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/tests/fixtures/stt-isomorphic/washington-speeches.ts','utf8');
const strs=[...tsf.matchAll(/'([^']+)'/g)].map(m=>m[1]);
const s0=strs.findIndex(s=>/^On the one hand/.test(s)), s1=strs.findIndex(s=>/originated/.test(s));
const ref=tok(strs.slice(s0,s1+1).join(' '));
const a=readWav('/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/tests/fixtures/stt-isomorphic/audio/washington_01.wav');
const whole=tok(await dec(a));
const bs=bd(a); let cur=0,segT=[];for(let i=0;i<bs.length;i++){const st=Math.max(0,(cur-(i>0?OVERLAP:0)))*SR,en=bs[i]*SR;segT.push(await dec(a.slice(Math.floor(st),Math.floor(en))));cur=bs[i];}
let acc=tok(segT[0]);for(let i=1;i<segT.length;i++)acc=acc.concat(rec(acc,tok(segT[i])));
console.log(`washington reference words: ${ref.length}`);
console.log(`WHOLE-utterance decode:  ${whole.length} words | WER vs ground truth: ${(wer(ref,whole)*100).toFixed(1)}%`);
console.log(`SEGMENTED decode:        ${acc.length} words | WER vs ground truth: ${(wer(ref,acc)*100).toFixed(1)}%`);
