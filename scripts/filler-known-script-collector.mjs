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

    const record = {
      capturedAt: new Date().toISOString(),
      pageKind: 'session', // NO raw page URL — keep the artifact numbers/enum-only (routes/queries can carry metadata)
      mode: MODE,
      script: String(SCRIPT),
      groundTruthFillerCount: GROUND_TRUTH,
      artifact, // sanitized, numbers-only, custom words anonymized (in-app)
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
