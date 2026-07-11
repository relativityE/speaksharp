import { readFile } from 'fs/promises';
import type { Page } from '@playwright/test';

const FIXTURE_ROUTE_GLOB = '**/__e2e_fixture_audio__.wav';
const FIXTURE_URL_PATH = '/__e2e_fixture_audio__.wav';

/**
 * Deterministic, position-0-aligned fake-audio injection for live STT specs (#960).
 *
 * WHY: `playwright.deployed-live.config.ts` feeds the fixture via Chrome
 * `--use-file-for-fake-audio-capture=<wav>`. That device is BROWSER-PROCESS-GLOBAL and free-runs the
 * file; it is NOT restarted/aligned to each engine's recording start. So when two engines record in
 * one run (Cloud first, Private later after model prep), the SECOND engine samples the fixture
 * mid-stream. That made the #892 opening-fidelity gate fail on fake-mic LOOP PHASE, not on a product
 * defect: Cloud captured "The stale smell…" at position 0 and passed; Private started at "Well, the
 * swan dive…" and failed — its LIVE DOM and saved DB row both began mid-fixture (drop is at capture,
 * not save/trim/decode). See issue #960.
 *
 * WHAT: override `navigator.mediaDevices.getUserMedia` so every audio capture returns a FRESH
 * MediaStream that plays the fixture from position 0. Both engines then start at the true opening, so
 * the #892 gate tests the app's real capture-from-start behavior instead of loop phase. If Private
 * STILL drops the opening under this aligned injection, that is a genuine product defect (not a
 * harness artifact) and should be fixed in the app.
 *
 * Call this ONCE per page, before the first navigation/getUserMedia in the spec that needs it.
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

    let ctx: AudioContext | null = null;
    let decoded: AudioBuffer | null = null;

    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      // Only intercept audio captures; defer everything else to the real implementation.
      if (!constraints || !constraints.audio) return realGetUserMedia(constraints);

      ctx = ctx ?? new AudioCtx();
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* best effort — automated browser usually allows it */ }
      }
      if (!decoded) {
        const bytes = await (await fetch(fixtureUrlPath, { cache: 'no-store' })).arrayBuffer();
        decoded = await ctx.decodeAudioData(bytes);
      }

      const destination = ctx.createMediaStreamDestination();
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.loop = true;
      source.connect(destination);
      source.start(0); // fixture position 0 at THIS capture — aligned per recording

      return destination.stream;
    };
  }, FIXTURE_URL_PATH);
}
