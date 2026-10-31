import { readFile } from 'fs/promises';
import type { Page } from '@playwright/test';

const FIXTURE_ROUTE_GLOB = '**/__e2e_fixture_audio__.wav';
const FIXTURE_URL_PATH = '/__e2e_fixture_audio__.wav';

export interface FixturePlaybackState {
  phase: 'waiting-for-capture' | 'ready' | 'playing' | 'ended' | 'disposed';
  generation: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  durationSeconds: number | null;
  activeStreams: number;
}

export interface FixtureAudioOptions {
  /** Default preserves legacy looping behavior. Controlled playback stays silent until explicitly played. */
  playback?: 'legacy-loop' | 'controlled-once';
}

/**
 * Deterministic, position-0-aligned fake-audio injection for live STT specs (#960).
 *
 * WHY: `playwright.deployed-live.config.ts` feeds the fixture via Chrome
 * `--use-file-for-fake-audio-capture=<wav>`, a BROWSER-PROCESS-GLOBAL free-running device. When two
 * engines record in one run (Cloud first, Private later), the second samples the fixture mid-stream.
 *
 * P1 (review): the app does NOT necessarily reacquire the mic per recording — `stopTranscription()`
 * leaves `this.mic` set and `ensureMicReadyForStart()` reuses it — so overriding `getUserMedia` alone
 * does NOT guarantee Private restarts at fixture position 0 (it may reuse Cloud's already-advanced
 * stream). To make the harness DETERMINISTIC regardless of mic reuse we expose an explicit reset that
 * restarts the fixture at position 0 on the live MediaStreamDestination(s); the spec calls it right
 * before each recording. We also count getUserMedia calls so the run self-reports reuse vs reacquire.
 */
export async function injectAlignedFixtureAudio(
  page: Page, fixturePath: string, options: FixtureAudioOptions = {},
): Promise<void> {
  const wav = await readFile(fixturePath);
  await page.route(FIXTURE_ROUTE_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );

  await page.addInitScript(({ fixtureUrlPath, controlled }) => {
    const md = navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return;

    const realGetUserMedia = md.getUserMedia.bind(md);
    const AudioCtx: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    interface FixtureEntry {
      dest: MediaStreamAudioDestinationNode;
      source: AudioBufferSourceNode | null;
    }
    const w = window as unknown as {
      __ss_fixtureEntries__?: FixtureEntry[];
      __ss_fixtureGumCalls__?: number;
      __ss_resetFixtureAudio__?: () => void;
      __ss_playFixtureOnce__?: () => Promise<FixturePlaybackState>;
      __ss_fixturePlaybackState__?: () => FixturePlaybackState;
      __ss_disposeFixtureAudio__?: () => Promise<void>;
    };
    w.__ss_fixtureEntries__ = w.__ss_fixtureEntries__ ?? [];
    w.__ss_fixtureGumCalls__ = w.__ss_fixtureGumCalls__ ?? 0;

    let ctx: AudioContext | null = null;
    let decoded: AudioBuffer | null = null;
    let phase: FixturePlaybackState['phase'] = 'waiting-for-capture';
    let generation = 0;
    let startedAtMs: number | null = null;
    let endedAtMs: number | null = null;
    const activeEntries = () => (w.__ss_fixtureEntries__ ?? [])
      .filter((entry) => entry.dest.stream.getAudioTracks().some((track) => track.readyState === 'live'));
    const snapshot = (): FixturePlaybackState => ({
      phase, generation, startedAtMs, endedAtMs,
      durationSeconds: decoded?.duration ?? null,
      activeStreams: activeEntries().length,
    });
    const stopSources = () => {
      for (const entry of w.__ss_fixtureEntries__ ?? []) {
        if (entry.source) {
          entry.source.onended = null;
          try { entry.source.stop(); } catch { /* already stopped */ }
          entry.source.disconnect();
          entry.source = null;
        }
      }
    };

    const startAtZero = (entry: FixtureEntry) => {
      if (!ctx || !decoded) return;
      try { entry.source?.stop(); } catch { /* already stopped */ }
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.loop = !controlled;
      src.connect(entry.dest);
      src.start(0); // fixture position 0
      entry.source = src;
    };

    // Restart every live fixture stream at position 0. The spec calls this immediately before each
    // recording, so the engine that records (even one reusing a warm mic) samples from the opening.
    w.__ss_resetFixtureAudio__ = () => {
      if (controlled) {
        if (phase === 'disposed') throw new Error('Fixture audio was disposed');
        stopSources();
        generation += 1;
        startedAtMs = endedAtMs = null;
        phase = activeEntries().length ? 'ready' : 'waiting-for-capture';
        return;
      }
      for (const entry of w.__ss_fixtureEntries__ ?? []) startAtZero(entry);
    };

    w.__ss_fixturePlaybackState__ = snapshot;
    w.__ss_playFixtureOnce__ = async () => {
      if (!controlled) throw new Error('Fixture was not installed in controlled-once mode');
      if (!ctx || !decoded || activeEntries().length !== 1 || phase !== 'ready') {
        throw new Error('Fixture playback requires one live capture stream and an armed ready take');
      }
      const armedGeneration = generation;
      await ctx.resume();
      if (ctx.state !== 'running') throw new Error('Fixture AudioContext did not resume');
      // Recheck after the await: reset/disposal must not start an obsolete take.
      if (generation !== armedGeneration || phase !== 'ready' || activeEntries().length !== 1) {
        throw new Error('Fixture capture changed before playback');
      }
      const entry = activeEntries()[0];
      const take = generation;
      phase = 'playing';
      startedAtMs = performance.now();
      startAtZero(entry);
      entry.source!.onended = () => {
        if (generation !== take || phase !== 'playing') return;
        phase = 'ended';
        endedAtMs = performance.now();
        entry.source?.disconnect();
        entry.source = null;
      };
      return snapshot();
    };
    w.__ss_disposeFixtureAudio__ = async () => {
      generation += 1;
      phase = 'disposed';
      stopSources();
      for (const entry of w.__ss_fixtureEntries__ ?? []) {
        for (const track of entry.dest.stream.getTracks()) track.stop();
      }
      w.__ss_fixtureEntries__ = [];
      await ctx?.close();
      decoded = null;
    };

    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (!constraints || !constraints.audio) return realGetUserMedia(constraints);
      if (phase === 'disposed') throw new Error('Fixture audio was disposed');
      const acquisitionGeneration = generation;
      const assertCurrentAcquisition = () => {
        if (phase === 'disposed' || generation !== acquisitionGeneration) {
          throw new Error('Fixture capture changed during microphone acquisition');
        }
      };
      w.__ss_fixtureGumCalls__ = (w.__ss_fixtureGumCalls__ ?? 0) + 1;
      console.log(`LIVE_FIXTURE_GETUSERMEDIA_CALL ${JSON.stringify({ call: w.__ss_fixtureGumCalls__ })}`);

      ctx = ctx ?? new AudioCtx();
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* automated browser usually allows it */ }
      }
      assertCurrentAcquisition();
      if (!decoded) {
        const bytes = await (await fetch(fixtureUrlPath, { cache: 'no-store' })).arrayBuffer();
        assertCurrentAcquisition();
        const buffer = await ctx.decodeAudioData(bytes);
        assertCurrentAcquisition();
        decoded = buffer;
      }

      assertCurrentAcquisition();
      const entry: FixtureEntry = { dest: ctx.createMediaStreamDestination(), source: null };
      try {
        if (!controlled) startAtZero(entry);
        (w.__ss_fixtureEntries__ ?? []).push(entry);
        if (controlled && phase !== 'playing' && phase !== 'ended') phase = 'ready';
        return entry.dest.stream;
      } catch (error) {
        try { entry.source?.stop(); } catch { /* already stopped */ }
        entry.source?.disconnect();
        for (const track of entry.dest.stream.getTracks()) track.stop();
        throw error;
      }
    };
  }, { fixtureUrlPath: FIXTURE_URL_PATH, controlled: options.playback === 'controlled-once' });
}

/** Call only after the product has acknowledged capture readiness. This never presses Start or injects a transcript. */
export async function playFixtureAudioOnce(page: Page): Promise<FixturePlaybackState> {
  return page.evaluate(async () => {
    const play = (window as unknown as { __ss_playFixtureOnce__?: () => Promise<FixturePlaybackState> }).__ss_playFixtureOnce__;
    if (!play) throw new Error('Controlled fixture audio is not installed');
    return play();
  });
}

export async function readFixturePlaybackState(page: Page): Promise<FixturePlaybackState> {
  return page.evaluate(() => {
    const read = (window as unknown as { __ss_fixturePlaybackState__?: () => FixturePlaybackState }).__ss_fixturePlaybackState__;
    if (!read) throw new Error('Fixture audio is not installed');
    return read();
  });
}

export async function disposeFixtureAudio(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (window as unknown as { __ss_disposeFixtureAudio__?: () => Promise<void> }).__ss_disposeFixtureAudio__?.();
  });
}

/** Source completion only. Product-side received-frame coverage must be asserted separately. */
export async function waitForFixtureAudioEnd(page: Page, timeoutMs = 120_000): Promise<FixturePlaybackState> {
  const initial = await readFixturePlaybackState(page);
  if (initial.phase === 'ended') return initial;
  if (initial.phase !== 'playing') throw new Error('Fixture source is not playing');
  await page.waitForFunction((generation) => {
    const read = (window as unknown as { __ss_fixturePlaybackState__?: () => FixturePlaybackState }).__ss_fixturePlaybackState__;
    const state = read?.();
    return state && (state.phase === 'ended' || state.phase === 'disposed' || state.generation !== generation);
  }, initial.generation, { timeout: timeoutMs });
  const result = await readFixturePlaybackState(page);
  if (result.phase !== 'ended' || result.generation !== initial.generation) {
    throw new Error('Fixture take was reset or disposed before source completion');
  }
  return result;
}

/** Restart the injected fixture at position 0 (call right before a recording starts). No-op if unset. */
export async function resetFixtureAudioToStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __ss_resetFixtureAudio__?: () => void }).__ss_resetFixtureAudio__?.();
  });
}

/** How many times the app called getUserMedia — 1 = mic reused across engines, 2+ = reacquired. */
export async function getFixtureGetUserMediaCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __ss_fixtureGumCalls__?: number }).__ss_fixtureGumCalls__ ?? 0,
  );
}
