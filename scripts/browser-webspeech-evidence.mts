/**
 * #1037 Browser/Web Speech manual-assisted release proof.
 *
 * Uses installed system Chrome with the real Web Speech backend. Application
 * auth/database calls are replaced by the repository's in-memory E2E client,
 * so the journey creates no Supabase or production write. Chrome still manages
 * speech recognition; that vendor-managed boundary is disclosed, not described
 * as on-device or provider-free.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setupE2EManifest } from '../tests/e2e/helpers/setupE2EManifest';
import { classifyBrowserJourney } from '../tests/evidence/browserJourney';
import { finalizeRow } from '../tests/evidence/sttEvidenceSchema';
import { createMockSession } from '../frontend/src/mocks/test-user-utils';

const execFileAsync = promisify(execFile);
const SPOKEN_TEXT = 'SpeakSharp browser practice starts quickly. Clear ideas, steady pacing, and concise delivery help every audience follow the message.';
const MODEL_REVISION = 'browser-managed-unreported-v1';
// The Cloud + Private engine registry keys (see providers/sttProviderConfig.ts). A Browser/Web-Speech
// journey must construct ONLY the real native-browser engine; if the app ever resolves any of these, the
// tripwire below records it and throws, so a silent mid-journey engine switch cannot pass the zero-Cloud
// claim vacuously through a permissive stub.
const FORBIDDEN_ENGINE_KEYS = ['assemblyai', 'transformers-js', 'transformers-js-v4', 'whisper-turbo'] as const;

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

async function selectMode(page: import('playwright').Page, mode: 'native'): Promise<void> {
  const select = page.getByTestId('stt-mode-select');
  await select.waitFor({ state: 'visible', timeout: 30_000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Normal accessible interaction only — NO force clicks. A forced click could bypass a disabled or
    // obscured control and "prove" a path a real user could not take; fail closed instead.
    await select.click();
    const option = page.getByTestId(`stt-mode-${mode}`);
    if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const disabled = await option.getAttribute('aria-disabled');
      if (disabled === 'true') throw new Error(`Browser mode option is disabled — a user could not select it (state=${await select.getAttribute('data-state')})`);
      await option.click(); // Playwright waits for actionable (visible+enabled+stable); no force
      await page.waitForTimeout(500);
      if ((await select.getAttribute('data-state')) === mode) return;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  throw new Error(`could not select production Browser mode by normal interaction; final state=${await select.getAttribute('data-state')}`);
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('manual-assisted Browser proof currently requires macOS system Chrome and /usr/bin/say');
  }
  const baseUrl = arg('base-url', 'http://127.0.0.1:5173');
  const releaseSha = arg('release-sha', process.env.GITHUB_SHA ?? '');
  const outPath = resolve(arg('out', 'test-results/stt-evidence/1037-browser-webspeech.json'));
  const applicationServerWrites: string[] = [];
  const cloudProviderCalls: string[] = [];
  const allRequests: string[] = [];

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
  });
  try {
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const consoleEvents: string[] = [];
    page.on('console', message => consoleEvents.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', error => consoleEvents.push(`pageerror: ${error.message}`));
    page.on('request', request => {
      const method = request.method();
      const url = request.url();
      allRequests.push(`${method} ${url}`);
      if (/assemblyai|gemini|cloud-stt|assemblyai-token|process-transcript/i.test(url)) {
        cloudProviderCalls.push(`${method} ${url}`);
      }
      const hostname = new URL(url).hostname;
      if (!['127.0.0.1', 'localhost'].includes(hostname) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        applicationServerWrites.push(`${method} ${url}`);
      }
    });
    const syntheticSession = createMockSession({}, 'pro');
    await setupE2EManifest(page, {
      engineType: 'real', enableRealEngine: true, userType: 'pro', emptySessions: true,
      debug: true, realEngineRegistryKeys: ['native-browser'],
      storage: { 'speaksharp-runtime-evidence-auth': JSON.stringify(syntheticSession) },
    });
    // Forbidden-engine TRIPWIRES. setupE2EManifest registers a permissive minimal stub for every
    // non-real engine key, so an accidental switch to Cloud/Private would `start()` silently and the
    // zero-Cloud network assertion would hold vacuously. Replace those keys' factories with tripwires that
    // record any construction and THROW on init/start/transcribe. Runs AFTER setupE2EManifest's init script
    // (later-registered addInitScripts execute later), so `__SS_E2E__.registry` already exists; STTRegistry
    // resolves `window.__SS_E2E__.registry[key]` live on every getEngine, so these overrides are authoritative.
    await page.addInitScript((forbiddenKeys: string[]) => {
      const win = window as unknown as {
        __SS_E2E__?: { registry?: Record<string, unknown> };
        __SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__?: Array<{ key: string; phase: string; at: number }>;
        setInterval: (h: () => void, t: number) => number;
        clearInterval: (id: number) => void;
      };
      win.__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__ = win.__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__ || [];
      const record = (key: string, phase: string) =>
        win.__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__!.push({ key, phase, at: Date.now() });
      const install = (): boolean => {
        const registry = win.__SS_E2E__?.registry;
        if (!registry) return false;
        for (const key of forbiddenKeys) {
          registry[key] = () => {
            record(key, 'construct');
            const boom = (phase: string) => async () => {
              record(key, phase);
              throw new Error(`[1037-tripwire] forbidden engine '${key}' ${phase}() invoked during a Browser/Web-Speech journey`);
            };
            return {
              instanceId: `tripwire-${key}`,
              checkAvailability: async () => { record(key, 'checkAvailability'); return { isAvailable: false }; },
              init: boom('init'), start: boom('start'), transcribe: boom('transcribe'), getTranscript: boom('getTranscript'),
              stop: async () => {}, pause: async () => {}, resume: async () => {}, destroy: async () => {}, terminate: async () => {},
              getEngineType: () => key, getLastHeartbeatTimestamp: () => Date.now(),
            };
          };
        }
        return true;
      };
      if (!install()) {
        const iv = win.setInterval(() => { if (install()) win.clearInterval(iv); }, 10);
      }
    }, [...FORBIDDEN_ENGINE_KEYS]);
    console.log('[browser-webspeech] phase=auth-seeded');
    await page.goto(`${baseUrl}/session?nativeDiag=1`, { waitUntil: 'domcontentloaded' });
    try {
      await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });
    } catch (error) {
      const snapshot = await page.evaluate(() => ({
        url: location.href,
        html: document.documentElement.outerHTML.slice(0, 2_000),
        body: document.body?.innerText?.slice(0, 2_000) ?? '',
      })).catch(() => null);
      console.error(`readiness snapshot: ${JSON.stringify(snapshot, null, 2)}`);
      console.error(consoleEvents.join('\n'));
      throw error;
    }
    await page.getByTestId('session-page').waitFor({ state: 'visible', timeout: 60_000 });
    console.log('[browser-webspeech] phase=app-ready');
    const engineRegistry = await page.evaluate(() => {
      const registry = window.__SS_E2E__?.registry;
      return {
        nativeMockPresent: Boolean(registry?.['native-browser']),
        engineType: window.__SS_E2E__?.engineType ?? null,
      };
    });
    if (engineRegistry.nativeMockPresent || engineRegistry.engineType !== 'real') {
      throw new Error(`failed to isolate the production Browser engine: ${JSON.stringify(engineRegistry)}`);
    }
    await selectMode(page, 'native');
    await page.evaluate(() => {
      window.__NATIVE_BROWSER_TRACE__ = [];
      window.__NATIVE_PARALLEL_CAPTURE_TRACE__ = true;
    });

    const speechApiAvailable = await page.evaluate(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    const startButton = page.getByTestId('session-start-stop-button');
    await startButton.click();
    try {
      await page.waitForFunction(() => (window.__NATIVE_BROWSER_TRACE__ ?? []).some(entry =>
        entry.event === 'recognition_start_attempt'), null, { timeout: 5_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        trace: window.__NATIVE_BROWSER_TRACE__ ?? [],
        runtime: window.__SPEECH_RUNTIME_DEBUG__?.() ?? null,
        mode: document.querySelector('[data-testid="stt-mode-select"]')?.getAttribute('data-state'),
        startButton: {
          recording: document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording'),
          disabled: document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('disabled'),
        },
        body: document.body?.innerText?.slice(0, 1_500) ?? '',
      }));
      throw new Error(`production Browser engine did not attempt recognition: ${JSON.stringify(diagnostic)}; ${error instanceof Error ? error.message : String(error)}; console=${JSON.stringify(consoleEvents.slice(-30))}`);
    }
    try {
      await page.waitForFunction(() => (window.__NATIVE_BROWSER_TRACE__ ?? []).some(entry =>
        entry.event === 'recognition_start_onstart' || entry.event === 'recognition_start_onerror'
          || entry.event === 'recognition_start_throw' || entry.event === 'recognition_start_timeout'),
      null, { timeout: 20_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        trace: window.__NATIVE_BROWSER_TRACE__ ?? [],
        runtime: window.__SPEECH_RUNTIME_DEBUG__?.() ?? null,
        body: document.body?.innerText?.slice(0, 1_500) ?? '',
      }));
      throw new Error(`Browser recognition start remained unclassified: ${JSON.stringify(diagnostic)}; ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('[browser-webspeech] phase=recognition-start-classified');
    await page.getByTestId('session-timer').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-testid="session-timer"]')?.textContent?.trim() !== '00:00', null, { timeout: 10_000 });
    console.log('[browser-webspeech] phase=timer-advanced');

    // Manual-assisted rather than fake-audio automation: system Chrome owns Web
    // Speech and receives physical microphone input. macOS TTS supplies a fixed,
    // reproducible utterance through the machine's speaker/mic path.
    await execFileAsync('/usr/bin/say', ['-v', 'Samantha', '-r', '155', SPOKEN_TEXT], { timeout: 30_000 });
    await page.waitForFunction(() => (window.__NATIVE_BROWSER_TRACE__ ?? []).some(entry =>
      entry.event === 'interim_candidate' || entry.event === 'final_candidate'),
    null, { timeout: 30_000 });
    console.log('[browser-webspeech] phase=transcript-produced');

    const timerText = (await page.getByTestId('session-timer').textContent() ?? '').trim();
    const stopStarted = await page.evaluate(() => performance.now());
    await startButton.click();
    await page.locator('html[data-session-persisted="true"]').waitFor({ timeout: 60_000 });
    console.log('[browser-webspeech] phase=session-produced');
    const finalizationLatencyMs = await page.evaluate(start => Number((performance.now() - start).toFixed(1)), stopStarted);
    const snapshot = await page.evaluate(async () => {
      const trace = window.__NATIVE_BROWSER_TRACE__ ?? [];
      const transcript = window.__SPEECH_RUNTIME_DEBUG__?.().saveCandidate?.selectedForSave ?? '';
      const capture = (window.__NATIVE_PARALLEL_CAPTURE__ ?? []).at(-1) ?? null;
      let captureHash = '';
      if (capture?.wavDataUrl) {
        const payload = capture.wavDataUrl.split(',')[1] ?? '';
        const bytes = Uint8Array.from(atob(payload), character => character.charCodeAt(0));
        const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
        captureHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      return {
        trace,
        transcript: String(transcript).trim(),
        captureHash,
        captureBytes: capture?.wavDataUrl ? Math.floor((capture.wavDataUrl.split(',')[1]?.length ?? 0) * 0.75) : 0,
        captureSamples: capture?.samples ?? 0,
        captureDuration: capture?.durationSec ?? 0,
        userAgent: navigator.userAgent,
        connection: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? 'unreported',
        sessionId: document.documentElement.getAttribute('data-session-persisted-id'),
        appRelease: (window as unknown as { __APP_RELEASE__?: string; __APP_RUNTIME_CONFIG__?: { release?: string } }).__APP_RELEASE__
          ?? (window as unknown as { __APP_RUNTIME_CONFIG__?: { release?: string } }).__APP_RUNTIME_CONFIG__?.release ?? '',
      };
    });
    const events = snapshot.trace.map(entry => String(entry.event ?? ''));
    const journey = classifyBrowserJourney({
      speechApiAvailable,
      traceEvents: events,
      timerText,
      transcript: snapshot.transcript,
      sessionProduced: Boolean(snapshot.sessionId),
      executionMode: 'manual-assisted',
      applicationServerWrites: applicationServerWrites.length,
      cloudProviderCalls: cloudProviderCalls.length,
    });
    const startEvent = snapshot.trace.find(entry => entry.event === 'recognition_start_onstart' || entry.event === 'onstart');
    const partialEvent = snapshot.trace.find(entry => entry.event === 'interim_candidate');
    const firstPartialLatencyMs = typeof startEvent?.t === 'number' && typeof partialEvent?.t === 'number'
      ? Number((partialEvent.t - startEvent.t).toFixed(1))
      : null;
    const promptSha256 = hash(SPOKEN_TEXT);
    const browserVersion = /Chrome\/(\S+)/.exec(snapshot.userAgent)?.[1] ?? 'unknown';
    const osVersion = (await execFileAsync('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim();

    // Bind evidence to the LOADED build: require the app-reported release to be a full SHA and to equal
    // --release-sha (when supplied). Record the app-reported SHA on the row so a stale preview cannot pass
    // while claiming the current exact head.
    const appRelease = String(snapshot.appRelease ?? '');
    if (!/^[0-9a-f]{40}$/i.test(appRelease)) throw new Error(`loaded build did not report a 40-char __APP_RELEASE__ (got '${appRelease}')`);
    if (releaseSha && releaseSha !== appRelease) throw new Error(`--release-sha ${releaseSha} != loaded build __APP_RELEASE__ ${appRelease}`);

    // Fail closed if ANY forbidden (Cloud/Private) engine was constructed or started during the journey —
    // defense in depth beyond the network assertion, and the artifact records the (empty) result as proof
    // the guard ran.
    const forbiddenEngineTripwire = await page.evaluate(() =>
      (window as unknown as { __SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__?: Array<{ key: string; phase: string; at: number }> })
        .__SS_E2E_FORBIDDEN_ENGINE_TRIPWIRE__ ?? []);
    if (forbiddenEngineTripwire.length > 0) {
      throw new Error(`forbidden engine constructed/started during the Browser journey: ${JSON.stringify(forbiddenEngineTripwire)}`);
    }

    const row = finalizeRow({
      comparability_class: 'browser_journey',
      engine: 'browser-webspeech',
      engine_version: 'web-speech-api/system-chrome',
      model_name: 'browser-managed-unreported',
      // Browser stays honestly UNVERIFIED — Web Speech exposes no trustworthy provider/model identity.
      attribution_status: 'unverified',
      browser: 'Google Chrome',
      browser_version: browserVersion,
      os: `macOS ${osVersion}`,
      device: `${process.arch} desktop`,
      network_condition: snapshot.connection,
      fixture_id: 'browser-system-tts-v1',
      wer: null,
      first_partial_latency_ms: firstPartialLatencyMs,
      finalization_latency_ms: finalizationLatencyMs,
      failure_class: 'none',
      release_sha: appRelease,
      // Web Speech's recognizer capture is opaque — there is NO proven audio route, and this row claims
      // none. The passive same-mic capture is diagnostic only (artifact.passiveMicCaptureSha256), never
      // the recognizer input.
      audio_route_evidence: {
        fixtureSha256: '',
        adapterInputPayloadSha256: '',
        adapterInputBytes: 0,
        decodedSampleCount: 0,
        decodedDurationSeconds: 0,
      },
      runtime_capability: {
        requestedThreads: null, configuredThreads: null, workerReportedThreads: null,
        runtimePath: 'browser-webspeech', crossOriginIsolated: false,
        sharedArrayBufferAvailable: false, fallbackReason: null,
      },
      comparability_inputs: {
        fixtureHash: '',
        groundTruthVersion: 'not-scored',
        normalizationVersion: 'not-scored',
        decodeConfiguration: 'system-chrome/web-speech/browser-managed/live-mic',
        modelRevision: MODEL_REVISION,
        runtimeVersions: { chrome: browserVersion, 'web-speech-api': 'browser-managed' },
      },
      // The spoken-prompt hash is informational provenance ONLY — not an audio-fixture/route hash.
      browser_journey_evidence: { ...journey, promptSha256 },
    });
    const artifact = {
      generatedFor: '#1037 Browser/Web Speech manual-assisted journey',
      releaseSha,
      disclosure: 'Chrome manages Browser transcription and may use browser-vendor services. This run proves zero SpeakSharp Cloud/Gemini/Supabase/application-server writes, not on-device transcription.',
      routeLimitation: 'Web Speech does not expose its recognizer audio payload, so this row claims NO audio route (audio_route_proven=false, attribution unverified, wer=null). Admissibility is journey-based: recognition actually started, timer advanced, transcript + session produced, zero app-server/Cloud writes.',
      passiveMicCaptureSha256: snapshot.captureHash || null,
      passiveMicCaptureNote: 'Diagnostic ONLY: SHA-256 of a passive same-microphone capture via the NativeBrowser observer. This is NOT the audio Web Speech received and is never used as route proof.',
      forbiddenEngineGuard: {
        keys: [...FORBIDDEN_ENGINE_KEYS],
        invocations: forbiddenEngineTripwire,
        note: 'Tripwires replaced every Cloud/Private engine factory; any construct/init/start was recorded and thrown. An empty invocations list proves only the real native-browser engine was used.',
      },
      spokenText: SPOKEN_TEXT,
      transcript: snapshot.transcript,
      timerText,
      sessionId: snapshot.sessionId,
      applicationServerWrites,
      cloudProviderCalls,
      requestCount: allRequests.length,
      rows: [row],
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    execFileSync('node', ['scripts/validate-stt-evidence.mjs', outPath], { stdio: 'inherit' });
    console.log(`[browser-webspeech] accepted artifact: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`[browser-webspeech] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
