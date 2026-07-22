/**
 * Phase 2 SANDBOX screenshot generator for CI (headless Playwright).
 *
 * Assumes a Vite DEV server is serving http://127.0.0.1:5174/sandbox.html (dev-only entry). Walks the
 * product JOURNEY — Prepare → Rehearse → Help → Recover → Summary, plus general-practice improved and
 * baseline — capturing product-frame desktop + mobile screenshots. Then, for the landing
 * THEME-COMPARISON gate, captures each candidate theme (a|b|c) per state and both side-by-side
 * comparison boards (?compare=1). Also records any NON-localhost request as a defense-in-depth
 * isolation check (screenshots always written; exits non-zero only if an external request is seen, and
 * the workflow still uploads via `if: always()`).
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

/** Walk the three-level journey (landing → overview → working; product frame, no QA). */
async function walk(page, tag, shots, external) {
  await reset(page);
  const m = page.locator('#main-content');
  const shot = async (name) => { const p = `${OUT_DIR}/${tag}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
  const t = (ms) => page.waitForTimeout(ms);

  // ---- Level 1: overall SpeakSharp landing (tagline + two mode choices) ----
  await shot('01-landing');

  // ---- Level 2: Quick Practice overview (specialized hero + numbered journey) ----
  await m.getByRole('button', { name: /quick practice/i }).click(); await t(200);
  await shot('02-quick-overview');
  await m.getByRole('button', { name: /choose your transcription mode/i }).click(); await t(150); // disclose a journey step
  await shot('03-quick-overview-step-open');

  // ---- Level 3: Quick Practice handoff (represents the existing /session route) ----
  await m.getByRole('button', { name: /start speaking/i }).first().click(); await t(150);
  await shot('04-quick-handoff');
  await m.getByRole('button', { name: /back to practice choices/i }).first().click(); await t(150);

  // ---- Level 2: Guided Rehearsal overview (7-step journey + correction loop) ----
  await m.getByRole('button', { name: /guided rehearsal/i }).click(); await t(200);
  await shot('05-guided-overview');

  // ---- Level 3: Guided Rehearsal sample journey ----
  await m.getByRole('button', { name: /try a sample/i }).click(); await t(150);
  await shot('06-sample-ready');
  await m.getByRole('button', { name: /begin speaking/i }).click(); await t(5400);
  await shot('07-listening-passive-agenda');
  await m.getByRole('button', { name: /^pause$/i }).click(); await t(150);
  await shot('08-paused');
  await m.getByRole('button', { name: /resume/i }).click(); await t(150);
  await page.locator('li', { hasText: /request approval for two additional/i }).getByRole('button', { name: /help me with this point/i }).click(); await t(150);
  await shot('09-help-requested-remedy');
  await m.getByRole('button', { name: /i addressed it just now/i }).click(); await t(150);
  await shot('10-recovered-after-guidance');
  await m.getByRole('button', { name: /finish rehearsal/i }).click(); await t(250);
  await shot('11-processing');
  await t(1800);
  await shot('12-complete-summary');
  await m.getByRole('button', { name: /rehearse again/i }).click(); await t(150);
  await shot('13-returning-landing-start-now');
  await m.getByRole('button', { name: /view past progress/i }).click(); await t(150);
  await shot('14-view-past-progress');
}

/**
 * Landing THEME retained-evidence walk — capture each candidate theme (a|b|c) on the frozen landing:
 * default, a card focus state, and the Quick Practice overview. `view` is 'desktop' | 'mobile'.
 * Theme A is the selected direction; B/C are retained only as the A/B/C decision record.
 */
async function themeWalk(page, theme, view, shots) {
  await page.goto(`${BASE}?theme=${theme}`, { waitUntil: 'networkidle' });
  const m = page.locator('#main-content');
  const shot = async (name) => { const p = `${OUT_DIR}/theme-${theme}-${view}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
  const t = (ms) => page.waitForTimeout(ms);

  await shot('01-landing');
  await m.getByRole('button', { name: /quick practice/i }).focus(); await t(120); // visible focus ring
  await shot('02-focus-state');
  await m.getByRole('button', { name: /quick practice/i }).click(); await t(200); // → Quick Practice overview
  await shot('03-quick-overview');
}

/** Side-by-side comparison board of all three themes (?compare=1), desktop or mobile render. */
async function captureCompare(page, mode, shots) {
  const url = mode === 'mobile' ? `${BASE}?compare=1&mode=mobile` : `${BASE}?compare=1`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400); // let the three same-origin theme iframes render
  const p = `${OUT_DIR}/compare-${mode}-board.png`;
  await page.screenshot({ path: p, fullPage: true });
  shots.push(p);
}

/** QA/design reference — only via ?qa=1 (kept out of the product frame). */
async function qaWalk(page, tag, shots) {
  await page.goto(`${BASE}?qa=1`, { waitUntil: 'networkidle' });
  const shot = async (name) => { const p = `${OUT_DIR}/${tag}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
  await page.getByText(/review all states \(qa\)/i).click(); await page.waitForTimeout(150);
  await page.getByRole('button', { name: /3 · Regression/i }).click(); await page.waitForTimeout(200);
  await shot('15-qa-setback-postsession');
  await page.getByText(/design tokens & palette/i).click(); await page.waitForTimeout(200);
  await shot('16-qa-palette-sheet');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const external = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('request', (r) => { if (!isLocal(r.url())) { try { external.push(new URL(r.url()).origin); } catch { external.push('[external]'); } } });

  const shots = [];
  // Desktop — full journey (downstream regression + isolation), QA sheet, then the three themes.
  await page.setViewportSize({ width: 1280, height: 900 });
  await walk(page, 'desktop', shots, external);
  await qaWalk(page, 'desktop', shots);
  for (const th of ['a', 'b', 'c']) await themeWalk(page, th, 'desktop', shots);
  await page.setViewportSize({ width: 1640, height: 1120 });
  await captureCompare(page, 'desktop', shots);

  // Mobile — same journey + themes at 375, plus a stacked-render comparison board.
  await page.setViewportSize({ width: 375, height: 812 });
  await walk(page, 'mobile', shots, external);
  await qaWalk(page, 'mobile', shots);
  for (const th of ['a', 'b', 'c']) await themeWalk(page, th, 'mobile', shots);
  await page.setViewportSize({ width: 1180, height: 1600 });
  await captureCompare(page, 'mobile', shots);

  // Reduced-motion: the warm landing + a working screen must render calmly with animations disabled.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  { const p = `${OUT_DIR}/desktop-reduced-motion-landing.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); }
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const uniqueExternal = [...new Set(external)];
  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({ screenshots: shots, externalOrigins: uniqueExternal }, null, 2));
  await browser.close();

  console.log(`Captured ${shots.length} screenshots to ${OUT_DIR}`);
  if (uniqueExternal.length) { console.error(`ISOLATION FAIL — external origins: ${uniqueExternal.join(', ')}`); process.exit(1); }
  console.log('Isolation OK — zero external requests.');
}

main().catch((e) => { console.error(e); process.exit(1); });
