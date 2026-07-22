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

const FIXTURES = [
  { key: 'baseline-established', name: /Baseline established/i },
  { key: 'improved', name: /Improved vs previous comparable/i },
  { key: 'regression', name: /Regression/i },
  { key: 'target-maintained', name: /Target maintained/i },
  { key: 'incompatible', name: /Incompatible session/i },
  { key: 'partial-agenda', name: /partly covered agenda/i },
  { key: 'recovered-agenda', name: /recovered after guidance/i },
  { key: 'insufficient-confidence', name: /Insufficient transcript confidence/i },
];

const MOBILE_STATES = ['improved', 'partial-agenda', 'recovered-agenda'];

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

  // Reload to capture boot under instrumentation.
  await page.reload({ waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 1280, height: 900 });

  // Ensure all 8 states are visible.
  await page.getByRole('tab', { name: /All states/i }).click().catch(() => {});

  // Walk all 8 fixture states (desktop).
  for (const f of FIXTURES) {
    await page.getByRole('button', { name: f.name }).first().click();
    await page.waitForTimeout(150);
    // Rehearsal recovery: exercise the user-requested remedy so the recovered state is captured.
    if (f.key === 'recovered-agenda') {
      const btn = page.getByRole('button', { name: /request help with this point/i });
      if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(150); }
    }
    const shot = `${OUT_DIR}/desktop-${f.key}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    report.fixturesInspected.push(f.key);
    report.screenshots.push(shot);
  }

  // Mobile screenshots for representative states.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const key of MOBILE_STATES) {
    const f = FIXTURES.find((x) => x.key === key);
    await page.getByRole('button', { name: f.name }).first().click();
    await page.waitForTimeout(120);
    if (key === 'recovered-agenda') {
      const btn = page.getByRole('button', { name: /request help with this point/i });
      if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(120); }
    }
    const shot = `${OUT_DIR}/mobile-${key}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshots.push(shot);
  }

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

  // Do NOT close the browser — it is the operator's dedicated CDP instance.
  await client.detach().catch(() => {});
}

main().catch((e) => fail(e.message));
