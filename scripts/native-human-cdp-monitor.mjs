import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = process.env.OUT || `/private/tmp/speaksharp-native-human-cdp-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const JSONL = process.env.JSONL || OUT.replace(/\.json$/i, '.jsonl');
const POLL_MS = Number(process.env.POLL_MS || 500);

function summarizePage(pageDump) {
  const trace = pageDump.trace || [];
  const nativeTrace = pageDump.nativeTrace || [];
  const countBy = (items, key) => items.reduce((acc, item) => {
    const value = item?.[key];
    if (value) acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  const stop = trace.find((entry) => entry.stage === 'lifecycle:stop');
  const beforeStop = (stage) => stop
    ? trace.filter((entry) => entry.stage === stage && entry.timestamp < stop.timestamp).length
    : trace.filter((entry) => entry.stage === stage).length;

  return {
    url: pageDump.url,
    capturedAt: pageDump.capturedAt,
    transcript: pageDump.transcriptContainer,
    traceCounts: countBy(trace, 'stage'),
    nativeCounts: countBy(nativeTrace, 'event'),
    beforeStop: {
      engine: beforeStop('engine:emit'),
      service: beforeStop('service:receive'),
      controller: beforeStop('controller:receive'),
      store: beforeStop('store:update'),
      ui: beforeStop('ui:visible'),
    },
    parallelCaptureCount: (pageDump.parallelCapture || []).length,
    parallelCapture: (pageDump.parallelCapture || []).map((capture) => ({
      createdAt: capture.createdAt,
      durationSec: capture.durationSec,
      sampleRate: capture.sampleRate,
      rms: capture.rms,
      peak: capture.peak,
      speechStartMs: capture.speechStartMs,
      speechEndMs: capture.speechEndMs,
      speechDurationMs: capture.speechDurationMs,
      segmentCount: capture.segmentCount,
      speechSegments: capture.speechSegments,
    })),
    duplicateEvents: nativeTrace
      .filter((entry) => /duplicate|append|promotion/.test(String(entry.event || '')))
      .map((entry) => ({
        t: entry.t,
        event: entry.event,
        reason: entry.reason,
        skipReason: entry.skipReason,
        currentTranscript: entry.currentTranscript,
        lastInterim: entry.lastInterim,
      })),
  };
}

async function getSessionPage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const sessionPages = pages.filter((page) => page.url().includes('/session'));
  return sessionPages.at(-1) || pages.at(-1) || null;
}

async function dumpPage(page) {
  return page.evaluate(() => ({
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    recording: document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') ?? null,
    body: document.body?.innerText ?? '',
    transcriptContainer: document.querySelector('[data-testid="transcript-container"]')?.textContent ?? '',
    liveCurrentLine: document.querySelector('[data-testid="live-transcript-current-line"]')?.textContent ?? '',
    trace: window.__SS_TRANSCRIPT_TRACE__ || [],
    nativeTrace: window.__NATIVE_BROWSER_TRACE__ || [],
    parallelCapture: window.__NATIVE_PARALLEL_CAPTURE__ || [],
    errors: window.__SS_ERRORS__ || [],
  }));
}

async function armPage(page) {
  await page.evaluate(() => {
    window.__SS_TRANSCRIPT_TRACE__ = [];
    window.__SS_TRANSCRIPT_TRACE_SEQ__ = 0;
    window.__NATIVE_BROWSER_TRACE__ = [];
    window.__NATIVE_PARALLEL_CAPTURE_TRACE__ = true;
    window.__NATIVE_PARALLEL_CAPTURE__ = [];
  });
}

const browser = await chromium.connectOverCDP(CDP_URL);
const page = await getSessionPage(browser);
if (!page) {
  throw new Error(`No page found on ${CDP_URL}`);
}

await armPage(page);
console.log(`NATIVE_HUMAN_MONITOR_ARMED ${JSON.stringify({ url: page.url(), out: OUT, jsonl: JSONL })}`);

let latest = null;
let stopped = false;
const poll = async () => {
  const activePage = await getSessionPage(browser);
  if (!activePage) return;
  latest = await dumpPage(activePage);
  await writeFile(JSONL, `${JSON.stringify({ type: 'snapshot', summary: summarizePage(latest), page: latest })}\n`, { flag: 'a' });
  const hadStop = (latest.trace || []).some((entry) => entry.stage === 'lifecycle:stop');
  const hadSave = (latest.trace || []).some((entry) => entry.stage === 'save:candidate');
  if (hadStop && hadSave && latest.recording === 'false') {
    stopped = true;
  }
};

while (!stopped) {
  await poll();
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

const artifact = {
  completedAt: new Date().toISOString(),
  summary: summarizePage(latest),
  page: latest,
};
await writeFile(OUT, JSON.stringify(artifact, null, 2));
console.log(`NATIVE_HUMAN_MONITOR_DONE ${JSON.stringify({ out: OUT, jsonl: JSONL, summary: artifact.summary })}`);
await browser.close();
