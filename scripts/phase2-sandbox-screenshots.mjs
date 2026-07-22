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

/** Walk the two-column chooser + journey (product frame, no QA). `tag` prefixes filenames. */
async function walk(page, tag, shots, external) {
  await reset(page);
  const m = page.locator('#main-content');
  const shot = async (name) => { const p = `${OUT_DIR}/${tag}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
  const t = (ms) => page.waitForTimeout(ms);

  // ---- Two-column practice chooser (SpeakSharp Session | Executive Rehearsal) ----
  await shot('01-landing-two-column'); // both choices, no row open
  await m.getByRole('button', { name: /^choose your session mode$/i }).click(); await t(150); // a SpeakSharp Session row
  await shot('02-session-selected');
  await m.getByRole('button', { name: /^prepare$/i }).click(); await t(150); // Exec row — Session collapses (cross-column single-open)
  await shot('03-exec-selected');
  await m.getByRole('button', { name: /^review and recover$/i }).click(); await t(150); // Prepare/Rehearse become checkmark rollups
  await shot('04-completed-rollups');

  // ---- SpeakSharp Session handoff (represents the existing /session route) ----
  await m.getByRole('button', { name: /start a session/i }).click(); await t(150);
  await shot('05-session-handoff');
  await m.getByRole('button', { name: /back to practice choices/i }).click(); await t(150);

  // ---- Executive Rehearsal sample journey ----
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
  await shot('13-returning-user-two-column');
  await m.getByRole('button', { name: /view past progress/i }).click(); await t(150);
  await shot('14-view-past-progress');
}

/**
 * Landing THEME-COMPARISON gate — capture each candidate theme (a|b|c) on the frozen two-column
 * layout: default, Session-selected, Rehearsal-selected, a deeper expanded row, and a focus state.
 * `view` is 'desktop' | 'mobile' (the caller sets the viewport). No theme is selected — this is review.
 */
async function themeWalk(page, theme, view, shots) {
  await page.goto(`${BASE}?theme=${theme}`, { waitUntil: 'networkidle' });
  const m = page.locator('#main-content');
  const shot = async (name) => { const p = `${OUT_DIR}/theme-${theme}-${view}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); shots.push(p); };
  const t = (ms) => page.waitForTimeout(ms);

  await shot('01-default');
  await m.getByRole('button', { name: /^choose your session mode$/i }).click(); await t(150); // Session card selected + row open
  await shot('02-session-selected');
  await m.getByRole('button', { name: /^prepare$/i }).click(); await t(150); // Rehearsal selected; Session collapses (mutual exclusion)
  await shot('03-rehearsal-selected');
  await m.getByRole('button', { name: /^review and recover$/i }).click(); await t(150); // deeper row; rows 1–2 become rollups
  await shot('04-expanded-row');
  await m.getByRole('button', { name: /start a session/i }).focus(); await t(120); // visible focus ring
  await shot('05-focus-state');
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

  const uniqueExternal = [...new Set(external)];
  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({ screenshots: shots, externalOrigins: uniqueExternal }, null, 2));
  await browser.close();

  console.log(`Captured ${shots.length} screenshots to ${OUT_DIR}`);
  if (uniqueExternal.length) { console.error(`ISOLATION FAIL — external origins: ${uniqueExternal.join(', ')}`); process.exit(1); }
  console.log('Isolation OK — zero external requests.');
}

main().catch((e) => { console.error(e); process.exit(1); });
