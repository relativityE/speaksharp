// #891 Phase 5.8 Step 1 — filler known-script collector (READ-ONLY).
//
// After the OWNER records a known script and presses Stop, this connects read-only over CDP and reads the
// sanitized, numbers-only filler artifact the controller cached at finalization
// (window.__SPEECH_RUNTIME_DEBUG__().fillerDivergence), then writes it to /private/tmp.
//
// It NEVER drives the mic, clicks, types, or reads transcript text. The artifact is numbers-only by
// construction (custom words already anonymized to custom_N in-app). The owner declares GROUND_TRUTH.
//
// Usage (per take, after Stop):
//   CDP_URL=http://127.0.0.1:9222 MODE=private SCRIPT=1 GROUND_TRUTH=9 \
//     node scripts/filler-known-script-collector.mjs

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const MODE = process.env.MODE || 'unknown';          // private | cloud | native (annotation only)
const SCRIPT = process.env.SCRIPT || 'unknown';       // 1 | 2 | 3 (annotation only)
const GROUND_TRUTH = process.env.GROUND_TRUTH != null ? Number(process.env.GROUND_TRUTH) : null;
const OUT = process.env.OUT
  || `/private/tmp/STT_RUNS/filler-knownscript-${MODE}-script${SCRIPT}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

// Allowlisted static filler labels (mirror of FILLER_WORD_KEYS) + anonymized custom labels.
const STATIC_FILLER_LABELS = new Set([
  'um', 'uh', 'ah', 'like', 'You Know', 'so', 'actually', 'oh', 'I Mean', 'basically', 'literally', 'Kind Of', 'Sort Of',
]);
const CUSTOM_LABEL = /^custom_(\d+|other)$/;
const FORBIDDEN_FIELDS = ['transcript', 'text', 'partial', 'preview', 'modelOutput', 'url'];
const REQUIRED_NUMERIC = [
  'liveFillerCount', 'recountFillerCount', 'delta',
  'clarityLive', 'clarityRecount', 'clarityDelta',
  'scoreLive', 'scoreRecount', 'scoreDelta',
];

/** Fail-closed validation: returns a list of problems ([] = a valid sanitized artifact). */
function validateArtifact(a) {
  if (a == null || typeof a !== 'object' || Array.isArray(a)) return ['artifact absent / null / not an object'];
  if ('error' in a) return [`artifact carries error: ${String(a.error)}`];
  const errs = [];
  for (const k of FORBIDDEN_FIELDS) if (k in a) errs.push(`forbidden transcript-like/url field present: ${k}`);
  if (typeof a.engine !== 'string') errs.push('engine must be a string');
  if (a.selectedSource !== undefined && typeof a.selectedSource !== 'string') errs.push('selectedSource must be a string');
  if (typeof a.usedCustomWords !== 'boolean') errs.push('usedCustomWords must be a boolean');
  for (const k of REQUIRED_NUMERIC) if (!Number.isFinite(a[k])) errs.push(`missing / non-finite numeric field: ${k}`);
  for (const detailKey of ['liveDetail', 'recountDetail']) {
    const d = a[detailKey];
    if (d == null || typeof d !== 'object' || Array.isArray(d)) { errs.push(`${detailKey} missing or not an object`); continue; }
    for (const [key, val] of Object.entries(d)) {
      if (!STATIC_FILLER_LABELS.has(key) && !CUSTOM_LABEL.test(key)) errs.push(`${detailKey}: unexpected key '${key}' (possible text leak)`);
      if (!Number.isFinite(val)) errs.push(`${detailKey}.${key} is not a finite number`);
    }
  }
  return errs;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const contexts = browser.contexts();
    const pages = contexts.flatMap((c) => c.pages());
    const page = pages.find((p) => /\/session/.test(p.url())) || pages[0];
    if (!page) throw new Error('No page found over CDP. Is the dev session open?');

    // READ-ONLY: single evaluate of the dev/test debug hook. No clicks, no input, no mic, no transcript.
    const artifact = await page.evaluate(() => {
      const fn = window.__SPEECH_RUNTIME_DEBUG__;
      if (typeof fn !== 'function') return { error: 'debug hook absent (not a dev/test build?)' };
      const dbg = fn();
      return dbg && 'fillerDivergence' in dbg
        ? dbg.fillerDivergence
        : { error: 'fillerDivergence not present (flag off / no finalized take yet)' };
    });

    // FAIL CLOSED: never write a misleading success record for a missing/null/error/malformed artifact.
    const problems = validateArtifact(artifact);
    if (problems.length) {
      throw new Error(
        `INVALID sanitized artifact — NO file written (hook absent / flag off / no finalized take / leak?):\n  - ${problems.join('\n  - ')}`,
      );
    }

    const record = {
      capturedAt: new Date().toISOString(),
      pageKind: 'session', // NO raw page URL — keep the artifact numbers/enum-only (routes/queries can carry metadata)
      mode: MODE,
      script: String(SCRIPT),
      groundTruthFillerCount: GROUND_TRUTH,
      artifact, // validated: sanitized, numbers-only, custom words anonymized (in-app)
    };

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(record, null, 2));
    console.log(`[filler-known-script] wrote ${OUT}`);
    console.log(JSON.stringify(record, null, 2));
  } finally {
    await browser.close(); // detaches CDP; does not close the owner's browser
  }
}

main().catch((err) => {
  console.error('[filler-known-script] failed:', err.message);
  process.exit(1);
});
