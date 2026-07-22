/**
 * Phase 2 SANDBOX CDP PASSIVE watcher — read-only, does NOT drive the page.
 *
 * Unlike phase2-sandbox-cdp-monitor.mjs (which self-drives the 8 states once), this attaches and then
 * just WATCHES a human interacting: it streams sanitized console/pageerror/network events and polls the
 * sandbox's own content-free interaction trace, appending each to a log. Same privacy rules: URLs are
 * sanitized to origin+path; no bodies/headers/cookies/storage/transcript/agenda text/PII is captured.
 *
 * Usage: node scripts/phase2-sandbox-cdp-watch.mjs   (env: CDP_URL, OUT_DIR, DURATION_MS)
 */

import { chromium } from 'playwright';
import { mkdirSync, appendFileSync } from 'node:fs';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SANDBOX_ORIGIN = 'http://127.0.0.1:5174';
const OUT_DIR = process.env.OUT_DIR || '/tmp/speaksharp-phase2-cdp';
const DURATION_MS = Number(process.env.DURATION_MS || 600000);
const LOG = `${OUT_DIR}/watch.log`;

const isAllowed = (u) => {
  try {
    if (/^(data|blob):/i.test(u)) return true;
    const url = new URL(u);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '5174';
  } catch { return false; }
};
const sanitize = (u) => { try { if (/^(data|blob):/i.test(u)) return u.slice(0, 12) + '…'; const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return '[unpar?able]'; } };
const t0 = performance.now();
const stamp = () => `+${Math.round(performance.now() - t0)}ms`;
const line = (o) => { const s = `${stamp()} ${JSON.stringify(o)}`; console.log(s); appendFileSync(LOG, s + '\n'); };

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP_URL);
  let page = null;
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
    try { const u = new URL(p.url()); if (u.origin === SANDBOX_ORIGIN && u.pathname === '/sandbox.html') page = p; } catch { /* skip */ }
  }
  if (!page) { console.error('FAIL-CLOSED: no /sandbox.html page open in the CDP Chrome'); process.exit(1); }

  line({ event: 'watch_started', durationMs: DURATION_MS });

  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') line({ event: 'console', level: t }); });
  page.on('pageerror', () => line({ event: 'pageerror' }));
  page.on('response', (r) => { if (r.status() >= 400) line({ event: 'http_error', status: r.status(), url: sanitize(r.url()) }); });
  page.on('request', (r) => { const u = r.url(); if (!isAllowed(u)) line({ event: 'EXTERNAL_REQUEST', url: sanitize(u) }); });

  // Poll the sandbox's own content-free trace and emit only NEW events (your clicks).
  let seen = 0;
  const poll = setInterval(async () => {
    try {
      const tr = await page.evaluate(() => window.__SS_SANDBOX_TRACE__ || []);
      for (let i = seen; i < tr.length; i++) line({ event: 'interaction', ...tr[i] });
      seen = tr.length;
    } catch { /* page navigating */ }
  }, 1000);

  setTimeout(() => { clearInterval(poll); line({ event: 'watch_finished', interactionsSeen: seen }); process.exit(0); }, DURATION_MS);
}

main().catch((e) => { console.error('watch error:', e.message); process.exit(1); });
