import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const AUDIO_SOURCE = process.env.NATIVE_HARNESS_AUDIO_SOURCE || 'fixture';
const AUDIO_FILE = path.resolve(process.env.NATIVE_HARNESS_AUDIO_FILE || 'tests/fixtures/stt-isomorphic/audio/h1_1.wav');
const USE_FAKE_AUDIO_CAPTURE = process.env.NATIVE_HARNESS_FAKE_AUDIO_CAPTURE === 'true';
const SAY_TEXT = process.env.NATIVE_HARNESS_SAY_TEXT || 'Native browser standalone proof. The quick brown fox reads clear speech for SpeakSharp validation.';
const OUT = process.env.NATIVE_HARNESS_OUT || `/private/tmp/speaksharp-native-standalone-${AUDIO_SOURCE}-${Date.now()}.json`;
const HEADLESS = process.env.HEADLESS === 'true';
const LISTEN_MS = Number(process.env.NATIVE_HARNESS_LISTEN_MS || 18_000);
const POST_AUDIO_WAIT_MS = Number(process.env.NATIVE_HARNESS_POST_AUDIO_WAIT_MS || 5_000);

function compact(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function html() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Standalone Native Web Speech Harness</title>
    <style>
      body { font: 16px system-ui, -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #111827; }
      button { font: inherit; padding: 10px 14px; margin-right: 8px; }
      pre { white-space: pre-wrap; border: 1px solid #cbd5e1; padding: 12px; background: #f8fafc; }
    </style>
  </head>
  <body>
    <button id="start">Start</button>
    <button id="stop">Stop</button>
    <h1>Standalone Native Web Speech Harness</h1>
    <p id="status">idle</p>
    <h2>Visible Transcript</h2>
    <pre id="visible"></pre>
    <h2>Events</h2>
    <pre id="events"></pre>
    <script>
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const eventsEl = document.getElementById('events');
      const visibleEl = document.getElementById('visible');
      const statusEl = document.getElementById('status');
      const state = window.__STANDALONE_WEB_SPEECH__ = {
        supported: Boolean(SpeechRecognition),
        events: [],
        finalTranscript: '',
        interimTranscript: '',
        visibleTranscript: '',
        startedAt: 0,
        endedAt: 0,
        config: null,
      };

      function compact(value) {
        return (value || '').replace(/\\s+/g, ' ').trim();
      }

      function log(event, data = {}) {
        const entry = { t: Number(performance.now().toFixed(1)), event, ...data };
        state.events.push(entry);
        console.info('[StandaloneWebSpeech]', JSON.stringify(entry));
        eventsEl.textContent = JSON.stringify(state.events, null, 2);
      }

      function render() {
        state.visibleTranscript = [state.finalTranscript, state.interimTranscript].filter(Boolean).join(' ').trim();
        visibleEl.textContent = state.visibleTranscript;
      }

      let recognition = null;
      let shouldListen = false;
      let restartPending = false;

      function createRecognition() {
        recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        state.config = {
          lang: recognition.lang,
          continuous: recognition.continuous,
          interimResults: recognition.interimResults,
          maxAlternatives: recognition.maxAlternatives,
          userAgent: navigator.userAgent,
        };
        log('configured', state.config);

        recognition.onstart = () => {
          state.startedAt = performance.now();
          statusEl.textContent = 'started';
          log('onstart');
        };
        recognition.onaudiostart = () => log('onaudiostart');
        recognition.onsoundstart = () => log('onsoundstart');
        recognition.onspeechstart = () => log('onspeechstart');
        recognition.onspeechend = () => log('onspeechend');
        recognition.onsoundend = () => log('onsoundend');
        recognition.onaudioend = () => log('onaudioend');
        recognition.onnomatch = () => log('onnomatch');
        recognition.onerror = (event) => log('onerror', { error: event.error, message: event.message || '' });
        recognition.onresult = (event) => {
          let interim = '';
          const rawResults = [];
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const transcript = (result?.[0]?.transcript || '').trim();
            rawResults.push({ index: i, isFinal: Boolean(result?.isFinal), transcript });
            if (!transcript) continue;
            if (result.isFinal) {
              state.finalTranscript = compact(state.finalTranscript + ' ' + transcript);
            } else {
              interim = compact(interim + ' ' + transcript);
            }
          }
          state.interimTranscript = interim;
          render();
          log('onresult', {
            resultIndex: event.resultIndex,
            resultsLength: event.results.length,
            rawResults,
            finalTranscript: state.finalTranscript,
            interimTranscript: state.interimTranscript,
            visibleTranscript: state.visibleTranscript,
          });
        };
        recognition.onend = () => {
          state.endedAt = performance.now();
          log('onend', { shouldListen, finalTranscript: state.finalTranscript, interimTranscript: state.interimTranscript });
          if (!shouldListen || restartPending) return;
          restartPending = true;
          setTimeout(() => {
            restartPending = false;
            if (!shouldListen) return;
            try {
              log('restart_attempt');
              recognition.start();
            } catch (error) {
              log('restart_error', { error: error instanceof Error ? error.message : String(error) });
            }
          }, 300);
        };
      }

      document.getElementById('start').addEventListener('click', () => {
        if (!SpeechRecognition) {
          log('unsupported');
          return;
        }
        shouldListen = true;
        state.finalTranscript = '';
        state.interimTranscript = '';
        state.visibleTranscript = '';
        state.events = [];
        render();
        createRecognition();
        recognition.start();
        log('start_invoked');
      });

      document.getElementById('stop').addEventListener('click', () => {
        shouldListen = false;
        log('stop_requested');
        try {
          recognition?.stop();
          log('stop_invoked');
        } catch (error) {
          log('stop_error', { error: error instanceof Error ? error.message : String(error) });
        }
      });
    </script>
  </body>
</html>`;
}

async function withServer(run) {
  const server = createServer((_, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(html());
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    return await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function playAudio() {
  if (USE_FAKE_AUDIO_CAPTURE) {
    return { attempted: false, source: 'chrome-fake-audio-capture', audioFile: AUDIO_FILE };
  }

  if (process.platform !== 'darwin') {
    return { attempted: false, reason: 'non-darwin' };
  }

  if (AUDIO_SOURCE === 'say') {
    await execFileAsync('/usr/bin/say', ['-v', 'Samantha', '-r', '165', SAY_TEXT], { timeout: 45_000 });
    return { attempted: true, source: 'say', text: SAY_TEXT };
  }

  await execFileAsync('/usr/bin/afplay', [AUDIO_FILE], { timeout: 45_000 });
  return { attempted: true, source: 'fixture', audioFile: AUDIO_FILE };
}

const evidence = {
  startedAt: new Date().toISOString(),
  audioSource: AUDIO_SOURCE,
  audioFile: AUDIO_FILE,
  fakeAudioCapture: USE_FAKE_AUDIO_CAPTURE,
  sayText: SAY_TEXT,
  browser: 'Google Chrome via Playwright channel=chrome',
  consoleEvents: [],
  pageErrors: [],
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: HEADLESS,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-blink-features=AutomationControlled',
    ...(USE_FAKE_AUDIO_CAPTURE ? [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO_FILE}`,
    ] : []),
  ],
});

try {
  await withServer(async (url) => {
    evidence.url = url;
    const context = await browser.newContext({
      permissions: ['microphone'],
      viewport: { width: 1200, height: 900 },
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (/StandaloneWebSpeech|Speech/i.test(text)) {
        evidence.consoleEvents.push({ type: message.type(), text });
      }
    });
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.click('#start');
    await page.waitForFunction(() => {
      const events = window.__STANDALONE_WEB_SPEECH__?.events || [];
      return events.some((entry) => entry.event === 'onstart');
    }, null, { timeout: 15_000 });

    await page.waitForTimeout(700);
    evidence.audioPlayback = await playAudio();
    await page.waitForTimeout(POST_AUDIO_WAIT_MS);
    await page.click('#stop');
    await page.waitForTimeout(1_500);
    evidence.harness = await page.evaluate(() => window.__STANDALONE_WEB_SPEECH__);
    evidence.bodyText = compact(await page.locator('body').innerText().catch(() => ''));
    await page.waitForTimeout(Math.max(0, LISTEN_MS - POST_AUDIO_WAIT_MS)).catch(() => undefined);
  });
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  evidence.completedAt = new Date().toISOString();
  evidence.pass = Boolean(compact(evidence.harness?.visibleTranscript || evidence.harness?.finalTranscript).length >= 12);
  await writeFile(OUT, JSON.stringify(evidence, null, 2));
  console.log(`STANDALONE_NATIVE_WEB_SPEECH_EVIDENCE ${JSON.stringify(evidence)}`);
  await browser.close().catch(() => undefined);
}

if (!evidence.pass) {
  process.exitCode = 1;
}
