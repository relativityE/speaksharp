'use strict';
// Ported from the harness proof workspace (harness-proof-workspace.zip sha256 9fc02fd68a8d272d61817bcb2fc6fa662b69e11b08c22d3389e78aaf0f9566cd), tests/extra-tests-r15/real-browser-r15.test.cjs; only the path, pin and browser bindings below changed.
// r15 real-media controls. The REAL reviewed fixture WAVs (tests/fixtures/rwt) played through the same Chrome for Testing binary and permission policy as the guarded lane, with the REAL observer
// and analysis code of the r15 packet. Loopback page only: no network beyond 127.0.0.1, no account, no production host.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const rig=require('./helpers/browser-rig.cjs');const P=rig.P;
const man=require(P+'/draft-adapters/oracles/pure/fixture-manifest.json').fixtures,act=require(P+'/draft-adapters/fixture-activity.json');
const timing=require(P+'/draft-adapters/audio-timing.cjs'),maker=require(P+'/draft-adapters/make-fixture-activity.cjs');
const DIR='/home/user/speaksharp/tests/fixtures/rwt';
const NAMES=['focus_points_tts','focus_points_partial_tts','open_mic_tts'];
const loop=n=>man[n].speechSeconds+man[n].trailingSilenceSeconds;
const run=new Map();
test('M1 real fixtures: bytes match the reviewed manifest; every reviewed point-window boundary coincides with a real pause in the audio (within 0.1 s); the activity pattern file is exactly what the WAV bytes derive',()=>{
  for(const n of NAMES){const b=fs.readFileSync(path.join(DIR,man[n].file));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),man[n].sha256,n);assert.equal(act.fixtures[n].wavSha256,man[n].sha256);}
  assert.deepEqual(maker.build(DIR),act,'fixture-activity.json is stale or edited');
  for(const n of ['focus_points_tts','focus_points_partial_tts']){
    const b=fs.readFileSync(path.join(DIR,man[n].file));let o=12,fmt,data;while(o<b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),rate:b.readUInt32LE(o+12)};if(id==='data'){data=b.subarray(o+8,o+8+sz);break;}o+=8+sz+(sz%2);}
    const nn=data.length/2/fmt.ch,bin=0.02,per=Math.round(bin*fmt.rate),thr=Math.pow(10,-45/20),sil=[];let st=null;
    for(let i=0;i<Math.floor(nn/per);i++){let s=0;for(let k=0;k<per;k++){const v=data.readInt16LE((i*per+k)*2*fmt.ch)/32768;s+=v*v;}const v=Math.sqrt(s/per);if(v<thr){if(st===null)st=i;}else if(st!==null){if((i-st)*bin>=0.18)sil.push([st*bin,i*bin]);st=null;}}
    for(const [i,w] of man[n].pointAudioWindows.entries()){if(!w)continue;const a=Math.min(...sil.map(x=>Math.abs(x[1]-w[0]))),e=Math.min(...sil.map(x=>Math.abs(x[0]-w[1])));assert.ok(a<=0.1&&e<=0.1,n+' window '+i+' start '+a.toFixed(2)+' end '+e.toFixed(2));}
  }
});
test('R1 real WAVs through real Chrome: the probe aligns to the fixture\'s own activity pattern, and RECORDING 0.3 s / 4 s / 14 s late is placed on the fixture clock within 0.8 s',{timeout:280000},async()=>{
  await Promise.all(NAMES.map(async n=>{run.set(n,await rig.runMany({wavFile:path.join(DIR,man[n].file),observeMs:man[n].pointAudioWindows?24000:14000,scenarios:[{name:'early',recordAfterMs:300},{name:'late4',recordAfterMs:4000},{name:'late14',recordAfterMs:14000}]}));}));
  for(const n of NAMES){
    const w=man[n].pointAudioWindows||[],ref=act.fixtures[n].bits;
    for(const [k,at] of [['early',0.3],['late4',4],['late14',14]]){
      const a=timing.analyze({timing:run.get(n)[k].timing,windows:w,loopSec:loop(n),reference:ref});
      assert.ok(Math.abs(a.facts.fixtureSecAtTapStart)<=0.5,n+' '+k+' tap start '+a.facts.fixtureSecAtTapStart);assert.ok(Math.abs(a.facts.fixtureSecAtRecording-at)<=0.8,n+' '+k+' recording '+a.facts.fixtureSecAtRecording);
      if(w.length){assert.equal(a.conclusion,k==='early'?'opening-reached-recording':'opening-clipped-before-recording',n+' '+k);assert.equal(a.facts.openingWindowStatus,k==='early'?'after-recording':k==='late4'?'partly-before-recording':'before-recording');}
      else assert.equal(a.conclusion,'position-only');
    }
  }
});
test('R2 negative control: the r14 window-only mask cannot align the REAL focus audio (it also speaks between the windows) and refuses; only the real activity pattern aligns it',()=>{
  for(const n of ['focus_points_tts','focus_points_partial_tts']){const t=run.get(n).early.timing;
    const old=timing.analyze({timing:t,windows:man[n].pointAudioWindows,loopSec:loop(n)});assert.equal(old.conclusion,'indeterminate',n+' window-only must not claim an alignment on real audio');
    assert.equal(timing.analyze({timing:t,windows:man[n].pointAudioWindows,loopSec:loop(n),reference:act.fixtures[n].bits}).conclusion,'opening-reached-recording');}
});
test('R3 refusals stay refusals on real media: a wrong reference pattern (another fixture) is not accepted as an alignment',()=>{
  const t=run.get('focus_points_tts').early.timing;
  const wrong=timing.analyze({timing:t,windows:man.focus_points_tts.pointAudioWindows,loopSec:loop('focus_points_tts'),reference:act.fixtures.open_mic_tts.bits});
  assert.ok(wrong.conclusion==='indeterminate'||Math.abs(wrong.facts.fixtureSecAtTapStart)>0.5||wrong.facts.fixtureSecAtRecording===undefined||Math.abs(wrong.facts.fixtureSecAtRecording-0.3)>0.8,'a different fixture must not look aligned: '+wrong.conclusion+' '+wrong.facts.fixtureSecAtTapStart);
});
