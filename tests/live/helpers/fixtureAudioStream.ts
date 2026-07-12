import { readFile } from 'fs/promises';
import type { Page } from '@playwright/test';

const FIXTURE_ROUTE_GLOB = '**/__e2e_fixture_audio__.wav';
const FIXTURE_URL_PATH = '/__e2e_fixture_audio__.wav';

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
export async function injectAlignedFixtureAudio(page: Page, fixturePath: string): Promise<void> {
  const wav = await readFile(fixturePath);
  await page.route(FIXTURE_ROUTE_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );

  await page.addInitScript((fixtureUrlPath: string) => {
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
    };
    w.__ss_fixtureEntries__ = w.__ss_fixtureEntries__ ?? [];
    w.__ss_fixtureGumCalls__ = w.__ss_fixtureGumCalls__ ?? 0;

    let ctx: AudioContext | null = null;
    let decoded: AudioBuffer | null = null;

    const startAtZero = (entry: FixtureEntry) => {
      if (!ctx || !decoded) return;
      try { entry.source?.stop(); } catch { /* already stopped */ }
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.loop = true;
      src.connect(entry.dest);
      src.start(0); // fixture position 0
      entry.source = src;
    };

    // Restart every live fixture stream at position 0. The spec calls this immediately before each
    // recording, so the engine that records (even one reusing a warm mic) samples from the opening.
    w.__ss_resetFixtureAudio__ = () => {
      for (const entry of w.__ss_fixtureEntries__ ?? []) startAtZero(entry);
    };

    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (!constraints || !constraints.audio) return realGetUserMedia(constraints);
      w.__ss_fixtureGumCalls__ = (w.__ss_fixtureGumCalls__ ?? 0) + 1;
      console.log(`LIVE_FIXTURE_GETUSERMEDIA_CALL ${JSON.stringify({ call: w.__ss_fixtureGumCalls__ })}`);

      ctx = ctx ?? new AudioCtx();
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* automated browser usually allows it */ }
      }
      if (!decoded) {
        const bytes = await (await fetch(fixtureUrlPath, { cache: 'no-store' })).arrayBuffer();
        decoded = await ctx.decodeAudioData(bytes);
      }

      const entry: FixtureEntry = { dest: ctx.createMediaStreamDestination(), source: null };
      startAtZero(entry);
      (w.__ss_fixtureEntries__ ?? []).push(entry);
      return entry.dest.stream;
    };
  }, FIXTURE_URL_PATH);
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
