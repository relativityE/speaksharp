/**
 * Phase 2 SANDBOX CDP monitor — READ-ONLY, sanitized, localhost-only diagnostic collector.
 *
 * Connects (over CDP) to a dedicated Chrome already showing http://127.0.0.1:5174/sandbox.html,
 * attaches instrumentation BEFORE reloading so boot is captured, drives the 8 fixture states + both
 * flows, captures desktop/mobile screenshots, and proves the sandbox makes ZERO external requests.
 *
 * This is LOCAL DIAGNOSTIC TELEMETRY, not product analytics. It sends nothing to PostHog or any
 * network service. It records ONLY: console/pageerror counts, failed/4xx-5xx requests, external
 * origins, render timings, which fixtures were inspected, and the sandbox's own content-free trace.
 * It deliberately does NOT collect request/response bodies, headers, cookies, storage, transcript or
 * agenda text, emails, ids, secrets, or env. URLs are sanitized to origin + pathname only.
 *
 * Usage:  node scripts/phase2-sandbox-cdp-monitor.mjs   (CDP_URL overrides the default endpoint)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SANDBOX_ORIGIN = 'http://127.0.0.1:5174';
const SANDBOX_URL = `${SANDBOX_ORIGIN}/sandbox.html`;
const OUT_DIR = process.env.OUT_DIR || '/tmp/speaksharp-phase2-cdp';

// Origins that are ALLOWED (local dev + inert schemes). Everything else is a forbidden external hop.
const isAllowedUrl = (u) => {
  try {
    if (/^(data|blob):/i.test(u)) return true;
    const url = new URL(u);
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '5174') return true;
    return false;
  } catch {
    return false;
  }
};

// Known production/third-party destinations we explicitly prove are NEVER contacted.
const FORBIDDEN_MATCHERS = [
  ['supabase', /supabase/i],
  ['posthog', /posthog|i\.posthog|app\.posthog/i],
  ['sentry', /sentry\.io|ingest\.sentry/i],
  ['stripe', /stripe\.com|js\.stripe/i],
  ['google-ai', /generativelanguage|gemini|googleapis/i],
  ['assemblyai', /assemblyai/i],
  ['vercel-prod', /vercel\.app|speaksharp/i],
];

const sanitize = (u) => {
  try {
    if (/^(data|blob):/i.test(u)) return u.slice(0, 12) + '…';
    const url = new URL(u);
    return `${url.origin}${url.pathname}`; // strip query + fragment
  } catch {
    return '[unpar?able]';
  }
};

function fail(msg) {
  console.error(`\n[phase2-cdp] FAIL-CLOSED: ${msg}\n`);
  process.exit(1);
}

const report = {
  startedAtMonotonicMs: Math.round(performance.now()),
  sandboxUrl: SANDBOX_URL,
  cdpUrl: CDP_URL,
  consoleWarnings: 0,
  consoleErrors: 0,
  pageErrors: 0,
  failedRequests: 0,
  httpErrors: 0,
  externalOrigins: {}, // origin -> count (should stay empty)
  forbiddenHits: [], // { category, url }
  allowedOriginSample: {}, // origin -> count
  fixturesInspected: [],
  screenshots: [],
  renderMetrics: {},
  sandboxTrace: [],
};

function classifyRequest(u) {
  if (isAllowedUrl(u)) {
    const key = /^(data|blob):/i.test(u) ? u.slice(0, 5) : new URL(u).origin;
    report.allowedOriginSample[key] = (report.allowedOriginSample[key] || 0) + 1;
    return;
  }
  const origin = (() => { try { return new URL(u).origin; } catch { return '[external]'; } })();
  report.externalOrigins[origin] = (report.externalOrigins[origin] || 0) + 1;
  for (const [cat, re] of FORBIDDEN_MATCHERS) {
    if (re.test(u)) report.forbiddenHits.push({ category: cat, url: sanitize(u) });
  }
}

// Walk the product journey (Prepare → Rehearse → Help → Recover → Summary → general practice),
// capturing a screenshot at each state and proving zero external traffic throughout.
async function walkJourney(page, tag, report) {
  // Viewport-only screenshots (not fullPage) — a headed Chrome resizes the viewport for fullPage
  // captures, which breaks click actionability mid-walk. The uploaded artifact screenshots come from
  // the headless workflow; here the screenshots are a secondary record and the network/error proof is
  // the point.
  const m = page.locator('#main-content'); // scope accordion lookups (QA panel is outside <main>)
  const shot = async (name) => { const p = `${OUT_DIR}/${tag}-${name}.png`; await page.screenshot({ path: p }); report.screenshots.push(p); report.fixturesInspected.push(`${tag}-${name}`); };
  const click = async (loc) => { await loc.scrollIntoViewIfNeeded(); await loc.click({ timeout: 15000 }); };
  // Launcher
  await shot('01-landing');
  await click(m.getByRole('button', { name: /quick practice:/i }));
  await shot('02-quick-expanded');
  await click(m.getByRole('button', { name: /review my progress:/i }));
  await shot('03-review-expanded');
  await click(m.getByRole('button', { name: /executive rehearsal:/i }));
  await shot('04-exec-expanded');
  // Sample journey
  await click(m.getByRole('button', { name: /^start rehearsal$/i }));
  await shot('05-ready');
  await click(m.getByRole('button', { name: /begin speaking/i }));
  await page.waitForTimeout(5400);
  await shot('06-listening-passive-agenda');
  await click(m.getByRole('button', { name: /^pause$/i }));
  await shot('07-paused');
  await click(m.getByRole('button', { name: /resume/i }));
  await click(page.locator('li', { hasText: /request approval for two additional/i }).getByRole('button', { name: /help me with this point/i }));
  await shot('08-help-requested-remedy');
  await click(m.getByRole('button', { name: /i addressed it just now/i }));
  await shot('09-recovered-after-guidance');
  await click(m.getByRole('button', { name: /finish rehearsal/i }));
  await page.waitForTimeout(250);
  await shot('10-processing');
  await page.waitForTimeout(1800);
  await shot('11-complete-summary');
  await click(m.getByRole('button', { name: /rehearse again/i }));
  await shot('12-returning-user');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP(CDP_URL).catch((e) => fail(`cannot connect to CDP at ${CDP_URL}: ${e.message}`));
  const contexts = browser.contexts();
  if (!contexts.length) fail('no browser contexts over CDP');

  // Find the sandbox page; fail closed if it is not present or not on the sandbox origin/path.
  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      try {
        const url = new URL(p.url());
        if (url.origin === SANDBOX_ORIGIN && url.pathname === '/sandbox.html') { page = p; break; }
      } catch { /* skip */ }
    }
    if (page) break;
  }
  if (!page) fail(`no page found at ${SANDBOX_URL} (open it in the dedicated CDP Chrome first)`);

  // Attach monitoring BEFORE reload so initial boot is captured.
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'warning') report.consoleWarnings += 1;
    if (t === 'error') report.consoleErrors += 1;
  });
  page.on('pageerror', () => { report.pageErrors += 1; });
  page.on('requestfailed', (r) => { report.failedRequests += 1; classifyRequest(r.url()); });
  page.on('request', (r) => classifyRequest(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) report.httpErrors += 1; });

  // Raw CDP domains (belt-and-suspenders network capture independent of Playwright routing).
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Performance.enable');
  client.on('Network.requestWillBeSent', (e) => classifyRequest(e.request.url));

  // Reload to capture boot under instrumentation, then walk the product journey. Use domcontentloaded
  // (not networkidle — the Vite HMR socket keeps the network non-idle) and DO NOT call setViewportSize
  // (it corrupts interaction on a headed CDP Chrome). The uploaded artifact screenshots (desktop +
  // mobile) come from the headless workflow; this monitor's job is the network/console/error proof.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /start rehearsal/i }).waitFor({ timeout: 15000 });
  await walkJourney(page, 'cdp', report);

  // Render metrics (content-free).
  try {
    const metrics = await client.send('Performance.getMetrics');
    for (const m of metrics.metrics) {
      if (['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'].includes(m.name)) {
        report.renderMetrics[m.name] = Math.round(m.value * 1000) / 1000;
      }
    }
  } catch { /* best-effort */ }

  // The sandbox's own content-free interaction trace (allowlisted enums/ids/counts only).
  try {
    report.sandboxTrace = await page.evaluate(() => window.__SS_SANDBOX_TRACE__ || []);
  } catch { /* best-effort */ }

  report.finishedAtMonotonicMs = Math.round(performance.now());
  report.externalOriginCount = Object.keys(report.externalOrigins).length;
  report.result =
    report.externalOriginCount === 0 && report.forbiddenHits.length === 0 && report.pageErrors === 0
      ? 'PASS — zero external origins, zero forbidden hits, zero page errors'
      : 'ATTENTION — see externalOrigins / forbiddenHits / pageErrors';

  const summaryPath = `${OUT_DIR}/summary.json`;
  writeFileSync(summaryPath, JSON.stringify(report, null, 2));

  // Console output is itself sanitized (counts + origins only).
  console.log(JSON.stringify({
    result: report.result,
    externalOriginCount: report.externalOriginCount,
    externalOrigins: report.externalOrigins,
    forbiddenHits: report.forbiddenHits,
    consoleWarnings: report.consoleWarnings,
    consoleErrors: report.consoleErrors,
    pageErrors: report.pageErrors,
    failedRequests: report.failedRequests,
    httpErrors: report.httpErrors,
    allowedOriginSample: report.allowedOriginSample,
    fixturesInspected: report.fixturesInspected,
    sandboxTraceEventCount: report.sandboxTrace.length,
    screenshots: report.screenshots.length,
    summaryPath,
  }, null, 2));

  // Do NOT close the browser — it is the operator's dedicated CDP instance. Detach and exit cleanly
  // (the open CDP connection would otherwise keep the process alive).
  await client.detach().catch(() => {});
  process.exit(report.result.startsWith('PASS') ? 0 : 2);
}

main().catch((e) => fail(e.message));
