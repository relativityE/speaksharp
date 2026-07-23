#!/usr/bin/env node
/**
 * Build TWO separate dist directories for the genuine two-build rollover test:
 *   test-results/rollover/a  — Build A (the tab boots on this)
 *   test-results/rollover/b  — Build B (the "deployment"): ONLY the lazy SessionPage chunk is changed,
 *                              so its content hash — and therefore its /assets URL — differs from A.
 *
 * The change is a top-level side effect (not tree-shaken) that sets window.__ROLLOVER_VARIANT__ = 'B',
 * which the test asserts after recovery to prove the reloaded document + assets are Build B. Both builds
 * are TEST mode (so the E2E mock-auth bridge is present) and carry distinct BUILD_IDs (window.__APP_RELEASE__).
 *
 * Deterministic + self-cleaning: the SessionPage edit is reverted via git even on failure.
 */
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'test-results/rollover');
const DIST = resolve(ROOT, 'frontend/dist');
const SESSION_PAGE = resolve(ROOT, 'frontend/src/pages/SessionPage.tsx');
const MARKER = `\n// --- rollover fixture marker (Build B only; top-level side effect, not tree-shaken) ---\n(globalThis).__ROLLOVER_VARIANT__ = 'B';\n`;

const run = (cmd, env) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
const sessionPageAsset = (dir) => {
  const f = readdirSync(resolve(dir, 'assets')).find((n) => /^SessionPage-.*\.js$/.test(n));
  if (!f) throw new Error(`no SessionPage chunk in ${dir}`);
  return `/assets/${f}`;
};

const revert = () => { try { execSync(`git checkout -- ${SESSION_PAGE}`, { cwd: ROOT }); } catch { /* ignore */ } };

try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // Build A
  run('pnpm build:test', { BUILD_ID: 'rolloverBuildA' });
  cpSync(DIST, resolve(OUT, 'a'), { recursive: true });

  // Change ONLY SessionPage → Build B
  appendFileSync(SESSION_PAGE, MARKER);
  run('pnpm build:test', { BUILD_ID: 'rolloverBuildB' });
  cpSync(DIST, resolve(OUT, 'b'), { recursive: true });

  revert();

  const aUrl = sessionPageAsset(resolve(OUT, 'a'));
  const bUrl = sessionPageAsset(resolve(OUT, 'b'));
  if (aUrl === bUrl) throw new Error(`SessionPage chunk did NOT change between builds (${aUrl}) — fixture invalid`);
  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify({ sessionPageA: aUrl, sessionPageB: bUrl, releaseA: 'rolloverBuildA', releaseB: 'rolloverBuildB' }, null, 2));
  console.log(`[rollover] Build A SessionPage: ${aUrl}`);
  console.log(`[rollover] Build B SessionPage: ${bUrl}`);
  console.log(`[rollover] fixtures ready in ${OUT}`);
} catch (err) {
  revert();
  console.error('[rollover] fixture build failed:', err?.message ?? err);
  process.exit(1);
}
