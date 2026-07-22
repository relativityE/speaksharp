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

/** Walk the launcher + journey, taking a screenshot at each product state. `tag` prefixes filenames. */
async function walk(page, tag, shots, external) {
  await reset(page);
  const m = page.locator('#main-content'); // scope accordion lookups (the QA panel is outside <main>)
  const shot = async (name) => { const p = `${OUT_DIR}/${tag}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
  const t = (ms) => page.waitForTimeout(ms);

  // ---- Activity launcher (accordions) ----
  await shot('01-landing-arrival'); // Executive Rehearsal open, Prepare step open
  await m.getByRole('button', { name: /executive rehearsal:/i }).click(); await t(120); // collapse
  await shot('02-all-collapsed');
  await m.getByRole('button', { name: /quick practice:/i }).click(); await t(120);
  await shot('03-quick-expanded');
  await m.getByRole('button', { name: /review my progress:/i }).click(); await t(120);
  await shot('04-review-expanded');
  await m.getByRole('button', { name: /executive rehearsal:/i }).click(); await t(120);
  await shot('05-exec-prepare-step');
  await m.getByRole('button', { name: /^rehearse naturally$/i }).click(); await t(120);
  await shot('06-exec-rehearse-step');
  await m.getByRole('button', { name: /^review and recover$/i }).click(); await t(120);
  await shot('07-exec-review-step-rollups'); // Prepare/Rehearse shown as completed rollups
  await m.getByRole('button', { name: /^prepare$/i }).click(); await t(120); // reopen Prepare

  // ---- Sample journey ----
  await m.getByRole('button', { name: /^start rehearsal$/i }).click(); await t(150);
  await shot('08-sample-ready');
  await m.getByRole('button', { name: /begin speaking/i }).click(); await t(5400);
  await shot('09-listening-passive-agenda');
  await m.getByRole('button', { name: /^pause$/i }).click(); await t(150);
  await shot('10-paused');
  await m.getByRole('button', { name: /resume/i }).click(); await t(150);
  await page.locator('li', { hasText: /request approval for two additional/i }).getByRole('button', { name: /help me with this point/i }).click(); await t(150);
  await shot('11-help-requested-remedy');
  await m.getByRole('button', { name: /i addressed it just now/i }).click(); await t(150);
  await shot('12-recovered-after-guidance');
  await m.getByRole('button', { name: /finish rehearsal/i }).click(); await t(250);
  await shot('13-processing');
  await t(1800);
  await shot('14-complete-summary');
  await m.getByRole('button', { name: /rehearse again/i }).click(); await t(150);
  await shot('15-returning-user');

  // ---- Design reference (QA panels, outside <main>) ----
  await page.getByText(/review all states \(qa\)/i).click(); await t(150);
  await page.getByRole('button', { name: /3 · Regression/i }).click(); await t(200);
  await shot('16-setback-postsession');
  await page.getByText(/design tokens & palette/i).click(); await t(200);
  await shot('17-palette-sheet');
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
