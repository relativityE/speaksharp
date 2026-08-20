#!/usr/bin/env node
/**
 * Deployment-to-deployment chunk-stability audit (PR #1027).
 *
 * Runs TWO production builds that differ ONLY in the simulated deployment SHA (BUILD_ID +
 * VITE_VERCEL_GIT_COMMIT_SHA — the two vars Vercel varies per deploy) and proves:
 *   - index.html changes (it carries the inline window.__APP_RELEASE__ = <SHA>), and
 *   - NO JS/CSS chunk contains the deployment SHA, and
 *   - every chunk keeps an identical filename AND identical bytes across the two builds
 *     (i.e. nothing rotates its content hash merely because the deployment SHA changed).
 *
 * Sentry's release injection only runs on real Vercel (needs the Sentry build token), so locally the
 * entry chunk is SHA-free too — which is exactly what isolates the env-inlining fix. On the real preview
 * the entry (main-*) may additionally carry the Sentry release SHA; the live spec audits that lazy chunks
 * stay SHA-free there.
 *
 * Builds go to their own outDirs; frontend/dist is never touched.
 */
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'test-results/chunk-stability');
const SHA_A = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const SHA_B = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';

const build = (outDir, sha) =>
  execSync(`pnpm --dir frontend exec vite build --mode production --outDir "${outDir}"`, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, BUILD_ID: sha, VITE_VERCEL_GIT_COMMIT_SHA: sha, VITE_VERCEL_GIT_COMMIT_REF: 'chunk-stability-audit' },
  });

const assetMap = (dir) => {
  const assets = resolve(dir, 'assets');
  const map = new Map();
  for (const f of readdirSync(assets)) {
    if (!/\.(js|css)$/.test(f)) continue;
    const bytes = readFileSync(resolve(assets, f));
    map.set(f, { hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16), text: bytes.toString('utf8') });
  }
  return map;
};

const isEntry = (name) => /^main-/.test(name);

try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  console.log('[stability] building A (SHA a1…)'); build(resolve(OUT, 'a'), SHA_A);
  console.log('[stability] building B (SHA b2…)'); build(resolve(OUT, 'b'), SHA_B);

  const a = assetMap(resolve(OUT, 'a'));
  const b = assetMap(resolve(OUT, 'b'));

  const failures = [];

  // 1. index.html carries the SHA (expected — the inline release script).
  const idxA = readFileSync(resolve(OUT, 'a/index.html'), 'utf8');
  const idxB = readFileSync(resolve(OUT, 'b/index.html'), 'utf8');
  if (!idxA.includes(SHA_A)) failures.push('index.html (A) is missing the release SHA');
  if (!idxB.includes(SHA_B)) failures.push('index.html (B) is missing the release SHA');
  console.log(`\n[stability] index.html carries the release SHA: A=${idxA.includes(SHA_A)} B=${idxB.includes(SHA_B)} (expected true/true)`);

  // 2. No chunk embeds the deployment SHA.
  const shaChunks = [];
  for (const [name, { text }] of a) if (text.includes(SHA_A)) shaChunks.push(`A:${name}`);
  for (const [name, { text }] of b) if (text.includes(SHA_B)) shaChunks.push(`B:${name}`);
  console.log(`[stability] chunks embedding the deployment SHA: ${shaChunks.length ? shaChunks.join(', ') : 'NONE'} (expected NONE)`);
  for (const c of shaChunks) failures.push(`chunk embeds deployment SHA: ${c}${isEntry(c.split(':')[1]) ? ' (entry — allowed only for Sentry on real Vercel, not for the inlined env var locally)' : ' (LAZY/vendor — MUST be SHA-free)'}`);

  // 3. Filename + byte stability across the two builds.
  const names = new Set([...a.keys(), ...b.keys()]);
  const changed = [], identical = [];
  for (const name of [...names].sort()) {
    const ia = a.get(name), ib = b.get(name);
    if (!ia || !ib) { changed.push(`${name} (present in only one build)`); continue; }
    if (ia.hash !== ib.hash) changed.push(`${name} (same name, different bytes)`);
    else identical.push(name);
  }
  console.log(`\n[stability] identical chunks (name+bytes) across A/B: ${identical.length}`);
  console.log(`[stability] changed chunks across A/B: ${changed.length ? changed.join(', ') : 'NONE'} (expected NONE — only index.html should differ)`);
  for (const c of changed) failures.push(`chunk changed solely due to deployment SHA: ${c}`);

  console.log('\n=== SUMMARY ===');
  console.log(`index.html differs between deployments: ${idxA !== idxB} (expected true)`);
  console.log(`total chunks: ${identical.length + changed.length}; identical: ${identical.length}; changed: ${changed.length}; SHA-bearing: ${shaChunks.length}`);

  if (failures.length) {
    console.error('\n[stability] FAIL:'); for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('\n[stability] PASS — no chunk embeds the deployment SHA and no chunk rotated across the SHA change.');
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
} catch (err) {
  console.error('[stability] audit error:', err?.message ?? err);
  process.exit(1);
}
