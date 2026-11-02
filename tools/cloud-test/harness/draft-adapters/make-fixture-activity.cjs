#!/usr/bin/env node
'use strict';
// r15: derives the REAL fixtures' speech-activity pattern (100 ms bins, the same RMS-of-last-43-ms snapshot the passive tap takes) from the reviewed WAV bytes and binds it to their sha256.
// audio-timing.cjs aligns the tapped envelope to THIS pattern, not to a mask of the point windows alone: the real fixtures also speak between the windows, so a window-only mask is not a valid
// reference. Usage: node make-fixture-activity.cjs <fixture dir> [--check]   (--check regenerates and compares with draft-adapters/fixture-activity.json)
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const manifest=require('./oracles/pure/fixture-manifest.json').fixtures;
const timing=require('./audio-timing.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function readWav(b){let o=12,fmt=null,data=null;while(o+8<=b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),rate:b.readUInt32LE(o+12),bits:b.readUInt16LE(o+22)};if(id==='data'){data=b.subarray(o+8,o+8+sz);break;}o+=8+sz+(sz%2);}if(!fmt||!data||fmt.bits!==16)throw new Error('unsupported WAV');return {fmt,data};}
function derive(bytes){
  const {fmt,data}=readWav(bytes),n=data.length/2/fmt.ch,snap=Math.round(0.0427*fmt.rate),step=Math.round(0.1*fmt.rate),energy=[];
  for(let t=snap,k=1;t<=n;t+=step,k++){let s=0;for(let i=t-snap;i<t;i++){const v=data.readInt16LE(i*2*fmt.ch)/32768;s+=v*v;}energy.push([k*100,Math.round(Math.sqrt(s/snap)*10000)/10000]);}
  const a=timing.activity(energy,100);return {binMs:100,bins:a.act.length,threshold:Math.round(a.threshold*10000)/10000,bits:a.act.join('')};
}
function build(dir){const out={schema:'speaksharp.fixture-activity.v1',method:'rms of the last 43 ms at every 100 ms, activity = rms >= max(0.003, 0.2*p95); same rule as the browser tap',fixtures:{}};
  for(const [name,e] of Object.entries(manifest)){const f=path.join(dir,e.file);if(!fs.existsSync(f))continue;const bytes=fs.readFileSync(f);if(sha(bytes)!==e.sha256)throw new Error(name+': WAV bytes differ from the reviewed manifest');out.fixtures[name]={wavSha256:e.sha256,...derive(bytes)};}
  return out;}
if(require.main===module){
  const dir=process.argv[2];if(!dir)throw new Error('fixture dir required');const built=build(dir),file=path.join(__dirname,'fixture-activity.json');
  if(process.argv.includes('--check')){const cur=JSON.parse(fs.readFileSync(file,'utf8'));const same=JSON.stringify(cur)===JSON.stringify(built);console.log(same?'MATCH':'DIFF');process.exitCode=same?0:1;}
  else{fs.writeFileSync(file,JSON.stringify(built,null,1)+'\n');console.log('wrote',Object.keys(built.fixtures).join(','));}
}
module.exports={derive,build};
