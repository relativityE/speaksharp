/**
 * Phase 2 SANDBOX screenshot generator for CI (headless Playwright).
 *
 * Assumes a Vite DEV server is already serving the sandbox at http://127.0.0.1:5174/sandbox.html
 * (the standalone entry exists only in dev mode, never in a production build). Launches its own
 * headless Chromium (no CDP needed here), walks the 8 fixture states + 3 representative mobile views,
 * and writes PNGs to OUT_DIR for upload as a short-retention CI artifact.
 *
 * It also records any NON-localhost request as a defense-in-depth isolation check: the sandbox must
 * make zero external requests. Screenshots are always written; the process exits non-zero only if an
 * external request is observed (the workflow still uploads the artifact via `if: always()`).
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.SANDBOX_URL || 'http://127.0.0.1:5174/sandbox.html';
const OUT_DIR = process.env.OUT_DIR || 'sandbox-screenshots';

const isLocal = (u) => {
  try { if (/^(data|blob):/i.test(u)) return true; const x = new URL(u); return (x.hostname === '127.0.0.1' || x.hostname === 'localhost') && x.port === '5174'; }
  catch { return false; }
};

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
const MOBILE = ['improved', 'partial-agenda', 'recovered-agenda'];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const external = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('request', (r) => { if (!isLocal(r.url())) { try { external.push(new URL(r.url()).origin); } catch { external.push('[external]'); } } });

  const shots = [];
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /All states/i }).click().catch(() => {});

  for (const f of FIXTURES) {
    await page.getByRole('button', { name: f.name }).first().click();
    await page.waitForTimeout(150);
    if (f.key === 'recovered-agenda') {
      const b = page.getByRole('button', { name: /request help with this point/i });
      if (await b.count()) { await b.first().click(); await page.waitForTimeout(150); }
    }
    const p = `${OUT_DIR}/desktop-${f.key}.png`;
    await page.screenshot({ path: p, fullPage: true });
    shots.push(p);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  for (const key of MOBILE) {
    const f = FIXTURES.find((x) => x.key === key);
    await page.getByRole('button', { name: f.name }).first().click();
    await page.waitForTimeout(120);
    if (key === 'recovered-agenda') {
      const b = page.getByRole('button', { name: /request help with this point/i });
      if (await b.count()) { await b.first().click(); await page.waitForTimeout(120); }
    }
    const p = `${OUT_DIR}/mobile-${key}.png`;
    await page.screenshot({ path: p, fullPage: true });
    shots.push(p);
  }

  const uniqueExternal = [...new Set(external)];
  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({ screenshots: shots, externalOrigins: uniqueExternal }, null, 2));
  await browser.close();

  console.log(`Captured ${shots.length} screenshots to ${OUT_DIR}`);
  if (uniqueExternal.length) { console.error(`ISOLATION FAIL — external origins: ${uniqueExternal.join(', ')}`); process.exit(1); }
  console.log('Isolation OK — zero external requests.');
}

main().catch((e) => { console.error(e); process.exit(1); });
