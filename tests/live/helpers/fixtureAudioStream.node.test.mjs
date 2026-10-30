import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import {
  injectAlignedFixtureAudio, playFixtureAudioOnce, readFixturePlaybackState,
  resetFixtureAudioToStart, disposeFixtureAudio, waitForFixtureAudioEnd,
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
