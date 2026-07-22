/**
 * Phase 2 SANDBOX screenshot generator for CI (headless Playwright).
 *
 * Assumes a Vite DEV server is serving http://127.0.0.1:5174/sandbox.html (dev-only entry). Walks the
 * product JOURNEY — Prepare → Rehearse → Help → Recover → Summary, plus general-practice improved and
 * baseline — capturing product-frame desktop + mobile screenshots. Also records any NON-localhost
 * request as a defense-in-depth isolation check (screenshots always written; exits non-zero only if an
 * external request is seen, and the workflow still uploads via `if: always()`).
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.SANDBOX_URL || 'http://127.0.0.1:5174/sandbox.html';
const OUT_DIR = process.env.OUT_DIR || 'sandbox-screenshots';

const isLocal = (u) => {
  try { if (/^(data|blob):/i.test(u)) return true; const x = new URL(u); return (x.hostname === '127.0.0.1' || x.hostname === 'localhost') && x.port === '5174'; }
  catch { return false; }
};

async function reset(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
}

/** Walk the full journey, taking a screenshot at each product state. `tag` prefixes filenames. */
async function walk(page, tag, shots, external) {
  await reset(page);
  const shot = async (name) => { const p = `${OUT_DIR}/${tag}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };

  // 1. Prepare
  await shot('01-prepare');

  // 2. Ready state (after Start, before speaking)
  await page.getByRole('button', { name: /start rehearsal/i }).click();
  await page.waitForTimeout(150);
  await shot('02-ready');

  // 3. Listening — passive agenda (item 1 covered, item 2 partly) — also the "partly addressed" state
  await page.getByRole('button', { name: /begin speaking/i }).click();
  await page.waitForTimeout(5400);
  await shot('03-listening-passive-agenda');

  // 4. Paused
  await page.getByRole('button', { name: /^pause$/i }).click();
  await page.waitForTimeout(150);
  await shot('04-paused');
  await page.getByRole('button', { name: /resume/i }).click();
  await page.waitForTimeout(150);

  // 5. Help requested → one remedy shown (approval-request item specifically)
  await page.locator('li', { hasText: /request approval for two additional/i }).getByRole('button', { name: /help me with this point/i }).click();
  await page.waitForTimeout(150);
  await shot('05-help-requested-remedy');

  // 6. Recovered after guidance (in-session)
  await page.getByRole('button', { name: /i addressed it just now/i }).click();
  await page.waitForTimeout(150);
  await shot('06-recovered-after-guidance');

  // 7. Processing (Finalizing…) — captured before it auto-advances (~1.6s)
  await page.getByRole('button', { name: /finish rehearsal/i }).click();
  await page.waitForTimeout(250);
  await shot('07-processing');

  // 8. Complete — outcome summary
  await page.waitForTimeout(1800);
  await shot('08-complete-summary');

  // 9. General practice — improved (raw movement leads)
  await page.getByRole('button', { name: /rehearse again/i }).click();
  await page.getByRole('button', { name: /skip agenda — general practice/i }).click();
  await page.waitForTimeout(150);
  await shot('09-general-improved');

  // 10. General practice — first-session baseline (not a grade)
  await page.getByRole('button', { name: /first-session \(baseline\) example/i }).click();
  await page.waitForTimeout(150);
  await shot('10-general-baseline');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const external = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('request', (r) => { if (!isLocal(r.url())) { try { external.push(new URL(r.url()).origin); } catch { external.push('[external]'); } } });

  const shots = [];
  await walk(page, 'desktop', shots, external);

  await page.setViewportSize({ width: 375, height: 812 });
  await walk(page, 'mobile', shots, external);

  const uniqueExternal = [...new Set(external)];
  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({ screenshots: shots, externalOrigins: uniqueExternal }, null, 2));
  await browser.close();

  console.log(`Captured ${shots.length} screenshots to ${OUT_DIR}`);
  if (uniqueExternal.length) { console.error(`ISOLATION FAIL — external origins: ${uniqueExternal.join(', ')}`); process.exit(1); }
  console.log('Isolation OK — zero external requests.');
}

main().catch((e) => { console.error(e); process.exit(1); });
