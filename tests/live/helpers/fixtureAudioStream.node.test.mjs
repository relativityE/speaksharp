import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {
  injectAlignedFixtureAudio, playFixtureAudioOnce, readFixturePlaybackState,
  resetFixtureAudioToStart, disposeFixtureAudio, waitForFixtureAudioEnd, getFixtureGetUserMediaCalls,
} from './fixtureAudioStream.ts';

// Tests the harness state machine only, without claiming browser/audio/model qualification.
async function harness(t, playback = 'controlled-once') {
  const dir = await mkdtemp(join(tmpdir(), 'ss-fixture-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'fixture.wav');
  await writeFile(path, new Uint8Array([0]));
  const sources = [];
  let resumeBarrier = null;
  let fetchBarrier = null;
  let decodeBarrier = null;
  const tracks = [];
  class AudioContext {
    state = 'running';
    async resume() { if (resumeBarrier) await resumeBarrier; this.state = 'running'; }
    async close() { this.state = 'closed'; }
    async decodeAudioData() { if (decodeBarrier) await decodeBarrier; return { duration: 2 }; }
    createMediaStreamDestination() {
      const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
      tracks.push(track);
      return { stream: { getAudioTracks: () => [track], getTracks: () => [track] } };
    }
    createBufferSource() {
      const source = { loop: false, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} };
      sources.push(source);
      return source;
    }
  }
  const browser = {
    AudioContext, navigator: { mediaDevices: { getUserMedia: async () => null } },
    fetch: async () => ({ arrayBuffer: async () => {
      if (fetchBarrier) await fetchBarrier;
      return new ArrayBuffer(0);
    } }),
    performance: { now: () => 100 }, console: { log() {} },
  };
  browser.window = browser;
  const context = createContext(browser);
  const page = {
    route: async () => {},
    addInitScript: async (fn, arg) => runInContext(`(${fn.toString()})(${JSON.stringify(arg)})`, context),
    evaluate: async (fn) => runInContext(`(${fn.toString()})()`, context),
  };
  await injectAlignedFixtureAudio(page, path, { playback });
  return { page, sources, tracks, capture: () => browser.navigator.mediaDevices.getUserMedia({ audio: true }),
    setFetchBarrier: (value) => { fetchBarrier = value; },
    setDecodeBarrier: (value) => { decodeBarrier = value; },
    setResumeBarrier: (value) => { resumeBarrier = value; } };
}

test('controlled fixture stays silent until capture, plays once, requires rearm, and disposes', async (t) => {
  const h = await harness(t);
  await assert.rejects(playFixtureAudioOnce(h.page), /requires one live capture/);
  await h.capture();
  assert.equal(h.sources.length, 0);
  assert.equal((await readFixturePlaybackState(h.page)).phase, 'ready');
  await playFixtureAudioOnce(h.page);
  assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].loop, false);
  await assert.rejects(playFixtureAudioOnce(h.page), /armed ready take/);
  h.sources[0].onended();
  assert.equal((await readFixturePlaybackState(h.page)).phase, 'ended');
  assert.equal((await waitForFixtureAudioEnd(h.page)).phase, 'ended');
  await assert.rejects(playFixtureAudioOnce(h.page), /armed ready take/);
  await resetFixtureAudioToStart(h.page);
  await playFixtureAudioOnce(h.page);
  assert.equal(h.sources.length, 2);
  await disposeFixtureAudio(h.page);
  assert.equal((await readFixturePlaybackState(h.page)).activeStreams, 0);
  assert.equal((await readFixturePlaybackState(h.page)).phase, 'disposed');
});

for (const stage of ['Fetch', 'Decode']) {
  for (const action of ['dispose', 'reset']) {
    test(`${action} during pending ${stage} refuses obsolete microphone acquisition`, async (t) => {
      const h = await harness(t);
      let release;
      h[`set${stage}Barrier`](new Promise((resolve) => { release = resolve; }));
      const pending = h.capture();
      // Allow fetch/arrayBuffer/decode to reach the selected asynchronous boundary.
      await new Promise((resolve) => setImmediate(resolve));
      if (action === 'dispose') await disposeFixtureAudio(h.page);
      else await resetFixtureAudioToStart(h.page);
      release();
      await assert.rejects(pending, /capture changed during microphone acquisition/);
      const state = await readFixturePlaybackState(h.page);
      assert.equal(state.phase, action === 'dispose' ? 'disposed' : 'waiting-for-capture');
      assert.equal(state.activeStreams, 0);
      assert.equal(h.tracks.length, 0);
      assert.equal(h.sources.length, 0);
      if (action === 'reset') {
        await h.capture();
        assert.equal((await readFixturePlaybackState(h.page)).phase, 'ready');
      }
    });
  }
}

test('reset during AudioContext resume cancels pending playback', async (t) => {
  const h = await harness(t);
  await h.capture();
  let release;
  h.setResumeBarrier(new Promise((resolve) => { release = resolve; }));
  const pending = playFixtureAudioOnce(h.page);
  await resetFixtureAudioToStart(h.page);
  release();
  await assert.rejects(pending, /capture changed/);
  assert.equal(h.sources.length, 0);
});

test('legacy default behavior still begins a looping source at microphone acquisition', async (t) => {
  const h = await harness(t, 'legacy-loop');
  await h.capture();
  assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].loop, true);
  await resetFixtureAudioToStart(h.page);
  assert.equal(h.sources.length, 2);
});

// PR1762 legacy real-consumer controls retained verbatim alongside model controls.
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
