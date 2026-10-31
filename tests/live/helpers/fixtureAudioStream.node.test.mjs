// Actual helper consumption with fake browser objects only; browser/audio/model NOT RUN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {injectAlignedFixtureAudio,resetFixtureAudioToStart,getFixtureGetUserMediaCalls} from './fixtureAudioStream.ts';

function fakePage({media=true,audio=true,webkit=false}={}) {
  const sources=[],destinations=[],fulfilled=[],routes=[],fetches=[],passthrough=[];
  const decoded={fixture:true};
  let decodes=0,resumes=0;
  class AudioContext {
    state='suspended';
    async resume(){resumes++;this.state='running';}
    async decodeAudioData(){decodes++;return decoded;}
    createMediaStreamDestination(){const dest={stream:{id:destinations.length}};destinations.push(dest);return dest;}
    createBufferSource(){
      const source={starts:[],stopped:false,connect(dest){this.dest=dest;},start(at){this.starts.push(at);},stop(){this.stopped=true;}};
      sources.push(source);return source;
    }
  }
  const original=async constraints=>{passthrough.push(constraints);return 'real-mic-sentinel';};
  const window=audio?{[webkit?'webkitAudioContext':'AudioContext']:AudioContext}:{};
  const navigator=media?{mediaDevices:{getUserMedia:original}}:{};
  const context=vm.createContext({window,navigator,console:{log(){}},fetch:async(url,options)=>{
    fetches.push({url,options});return {arrayBuffer:async()=>new ArrayBuffer(4)};
  }});
  const evaluate=(fn,arg)=>vm.runInContext(`(${fn.toString()})`,context)(arg);
  const page={route:async(glob,handler)=>{
    routes.push(glob);await handler({fulfill:async value=>fulfilled.push(value)});
  },addInitScript:async(fn,arg)=>evaluate(fn,arg),evaluate:async fn=>evaluate(fn)};
  return {page,window,navigator,sources,destinations,fulfilled,routes,fetches,passthrough,original,
    counts:()=>({decodes,resumes})};
}

test('real helper injects exact fixture bytes and resets reused and reacquired streams to zero',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fixture-audio-consumer-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const fixture=path.join(dir,'fixture.wav'),bytes=Buffer.from('offline fixture bytes');
  await fs.writeFile(fixture,bytes);
  const f=fakePage();
  await injectAlignedFixtureAudio(f.page,fixture);
  assert.deepEqual(f.routes,['**/__e2e_fixture_audio__.wav']);
  assert.equal(f.fulfilled[0].status,200);
  assert.equal(f.fulfilled[0].contentType,'audio/wav');
  assert.deepEqual(f.fulfilled[0].body,bytes);
  assert.equal(await getFixtureGetUserMediaCalls(f.page),0);
  const gum=f.navigator.mediaDevices.getUserMedia;
  assert.equal(await gum({video:true}),'real-mic-sentinel');
  assert.equal(f.passthrough.length,1);
  const stream=await gum({audio:true});
  assert.equal(stream,f.destinations[0].stream);
  assert.equal(await getFixtureGetUserMediaCalls(f.page),1);
  assert.deepEqual(f.sources[0].starts,[0]);
  assert.equal(f.sources[0].loop,true);
  assert.equal(f.sources[0].dest,f.destinations[0]);
  await resetFixtureAudioToStart(f.page);
  assert.equal(f.sources[0].stopped,true);
  assert.equal(f.sources[1].dest.stream,stream);
  assert.deepEqual(f.sources[1].starts,[0]);
  const second=await gum({audio:true});
  assert.notEqual(second,stream);
  assert.equal(await getFixtureGetUserMediaCalls(f.page),2);
  await resetFixtureAudioToStart(f.page);
  assert.equal(f.sources.length,5);
  assert.equal(f.sources[1].stopped,true);
  assert.equal(f.sources[2].stopped,true);
  assert.equal(f.sources[3].dest.stream,stream);
  assert.equal(f.sources[4].dest.stream,second);
  assert.ok(f.sources.every(source=>source.starts.length===1&&source.starts[0]===0));
  assert.deepEqual(f.counts(),{decodes:1,resumes:1});
  assert.equal(f.fetches.length,1);
  assert.equal(f.fetches[0].url,'/__e2e_fixture_audio__.wav');
  assert.equal(f.fetches[0].options.cache,'no-store');
});

test('reset/count are safe before injection and unsupported environments preserve the real mic',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fixture-audio-unsupported-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const fixture=path.join(dir,'fixture.wav');await fs.writeFile(fixture,'offline');
  for(const options of [{media:false},{audio:false}]) {
    const f=fakePage(options);
    await resetFixtureAudioToStart(f.page);
    assert.equal(await getFixtureGetUserMediaCalls(f.page),0);
    await injectAlignedFixtureAudio(f.page,fixture);
    assert.equal(f.navigator.mediaDevices?.getUserMedia,options.media===false?undefined:f.original);
    assert.equal(f.sources.length,0);
  }
  const fallback=fakePage({webkit:true});
  await injectAlignedFixtureAudio(fallback.page,fixture);
  await fallback.navigator.mediaDevices.getUserMedia({audio:true});
  assert.equal(await getFixtureGetUserMediaCalls(fallback.page),1);
  assert.deepEqual(fallback.sources[0].starts,[0]);
  const missing=fakePage();
  await assert.rejects(injectAlignedFixtureAudio(missing.page,path.join(dir,'absent.wav')),/ENOENT/);
  assert.equal(missing.routes.length,0);
});
