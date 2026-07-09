/**
 * Filler-source comparison — live wrapper (Private/Cloud ONLY) for the source-comparison gate.
 *
 * Drives ONE finalized take against a KNOWN-audio fixture (via Chrome --use-file-for-fake-audio-capture,
 * set by playwright.live.config through LIVE_AUDIO_FIXTURE), reads the numbers-only `fillerDivergence`
 * artifact the controller caches at finalization, reads the color-coded FillerWordsCard rows, and emits a
 * numbers/enum-only comparison row (live counter vs transcript recount vs declared ground truth). It
 * DECIDES nothing — the Reviewer reads the rows. No source of truth is pre-selected; the flag stays OFF.
 *
 * NATIVE IS BLOCKED: fake-audio does not reach Web Speech, so Native evidence via this path is invalid;
 * Native must use the Reviewer/QA real-mic path. Unknown modes fail closed.
 *
 * Env-gated: skips unless a fixture + ground truth + credentials + fixture provenance are provided, so it
 * never runs (or fails) in the normal unit/e2e CI. The comparison math is unit-tested in
 * helpers/fillerSourceComparison.test.ts.
 *
 * Run (per mode, after Reviewer/QA provides a release-grade WAV fixture):
 *   LIVE_AUDIO_FIXTURE=tests/fixtures/filler_script1_static_16k.wav SCRIPT=1 GROUND_TRUTH=9 MODE=private \
 *   FIXTURE_SOURCE=reviewer_qa_human LIVE_TEST_EMAIL=… LIVE_TEST_PASSWORD=… \
 *   pnpm exec playwright test --config=playwright.live.config.ts filler-source-comparison
 *
 * NOTE: the login + drive path below reuses the proven benchmark-utils helpers and the first-time-tester
 * pattern, but has NOT yet been executed end-to-end (no fixtures/creds available at authoring time). It
 * must be validated on the first real Reviewer/QA run before its rows count as evidence.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { selectBenchmarkMode, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { buildComparisonRow, type FillerDivergenceArtifact } from './helpers/fillerSourceComparison';

const FIXTURE = process.env.LIVE_AUDIO_FIXTURE;
const GROUND_TRUTH = process.env.GROUND_TRUTH != null ? Number(process.env.GROUND_TRUTH) : null;
const SCRIPT = process.env.SCRIPT || 'unknown';
const RAW_MODE = process.env.MODE || 'private';
const EMAIL = process.env.LIVE_TEST_EMAIL;
const PASSWORD = process.env.LIVE_TEST_PASSWORD;

// Fake-audio replay is ONLY valid for the getUserMedia engines. Native (Web Speech) is blocked here.
const ALLOWED_MODES = ['private', 'cloud'] as const;
const IS_NATIVE = RAW_MODE === 'native';
const IS_ALLOWED_MODE = (ALLOWED_MODES as readonly string[]).includes(RAW_MODE);

const FIXTURE_SOURCES = ['reviewer_qa_human', 'dev_preliminary', 'tts_preliminary'] as const;
type FixtureSource = typeof FIXTURE_SOURCES[number];
const FIXTURE_SOURCE = process.env.FIXTURE_SOURCE ?? '';

const hasFixtureContext = Boolean(FIXTURE && GROUND_TRUTH != null && Number.isInteger(GROUND_TRUTH) && GROUND_TRUTH >= 0);
const hasCreds = Boolean(EMAIL && PASSWORD);

async function readFillerDivergence(page: Page): Promise<FillerDivergenceArtifact | { error: string }> {
  return page.evaluate(() => {
    const fn = (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown> }).__SPEECH_RUNTIME_DEBUG__;
    if (typeof fn !== 'function') return { error: 'debug hook absent (not a dev/test build?)' };
    const dbg = fn();
    return dbg && 'fillerDivergence' in dbg && dbg.fillerDivergence
      ? (dbg.fillerDivergence as FillerDivergenceArtifact)
      : { error: 'fillerDivergence not present (no finalized take yet)' };
  });
}

/** Card row-count coherence: do the color-coded rows sum to the headline count the card displays? */
async function readCardRowCount(page: Page): Promise<{ displayedCount: number; rowSum: number; coherent: boolean }> {
  const displayedText = (await page.getByTestId('filler-count-value').textContent().catch(() => '')) ?? '';
  const displayedCount = Number(displayedText.match(/\d+/)?.[0] ?? '0');
  const rowSum = await page.locator('[data-testid="filler-words-list"] [data-filler-count]').evaluateAll(
    (els) => els.reduce((acc, el) => acc + Number((el as HTMLElement).getAttribute('data-filler-count') ?? '0'), 0),
  ).catch(() => 0);
  return { displayedCount, rowSum, coherent: rowSum === displayedCount };
}

test.describe('Filler-source comparison — live vs recount vs ground truth @live', () => {
  test(`${RAW_MODE} / script ${SCRIPT}: emit numbers-only comparison row`, async ({ page }, testInfo) => {
    // Mode gating FIRST. Native fake-audio evidence is invalid; unknown modes fail closed.
    test.skip(IS_NATIVE, 'Native requires Reviewer/QA real-mic path; fake-audio evidence is invalid for Web Speech.');
    if (!IS_ALLOWED_MODE) {
      throw new Error(`Invalid MODE '${RAW_MODE}' — only ${ALLOWED_MODES.join('|')} produce valid fake-audio evidence.`);
    }
    test.skip(!hasFixtureContext, 'Set LIVE_AUDIO_FIXTURE + GROUND_TRUTH (non-negative int) + SCRIPT.');
    test.skip(!hasCreds, 'Set LIVE_TEST_EMAIL + LIVE_TEST_PASSWORD for the comparison account.');
    if (!(FIXTURE_SOURCES as readonly string[]).includes(FIXTURE_SOURCE)) {
      throw new Error(`FIXTURE_SOURCE must be one of ${FIXTURE_SOURCES.join('|')} (got '${FIXTURE_SOURCE}') — provenance is required.`);
    }
    test.setTimeout(360_000);

    const mode = RAW_MODE as 'private' | 'cloud';
    const source = FIXTURE_SOURCE as FixtureSource;
    const fixtureSha256 = createHash('sha256').update(fs.readFileSync(FIXTURE!)).digest('hex');

    await page.addInitScript(() => {
      const win = window as unknown as {
        __E2E_CONTEXT__?: boolean; __FORCE_TRANSFORMERS_JS__?: boolean; __STT_LOAD_TIMEOUT__?: number;
        __SS_E2E__?: { isActive: boolean };
      };
      win.__E2E_CONTEXT__ = true;
      win.__FORCE_TRANSFORMERS_JS__ = true; // Private → real transformers-js engine on the fixture audio
      win.__STT_LOAD_TIMEOUT__ = 180000;
      win.__SS_E2E__ = { ...(win.__SS_E2E__ ?? {}), isActive: true };
    });

    await test.step('Sign in with the comparison account', async () => {
      await page.goto('/signin');
      await page.getByTestId('email-input').fill(EMAIL!);
      await page.getByTestId('password-input').fill(PASSWORD!);
      await page.getByTestId('sign-in-submit').click();
      await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    });

    await test.step(`Select ${mode} mode and wait for readiness`, async () => {
      await selectBenchmarkMode(page, mode);
    });

    await test.step('Record the fixture, stop, and finalize', async () => {
      const startStop = page.getByTestId('session-start-stop-button');
      await expect(startStop).toBeEnabled({ timeout: 120_000 });
      await startStop.click();
      await expect(startStop).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });
      // The fake-audio fixture plays into getUserMedia; give it time to stream, then stop.
      await page.waitForTimeout(Number(process.env.RECORD_MS ?? 30_000));
      await startStop.click();
      await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 60_000 });
      await waitForBenchmarkSaveCandidate(page, `filler-comparison-${mode}-script${SCRIPT}`);
    });

    const artifact = await readFillerDivergence(page);
    expect('error' in artifact ? artifact.error : null, `fillerDivergence must be present: ${JSON.stringify(artifact)}`).toBeNull();
    const card = await readCardRowCount(page);

    const row = buildComparisonRow({
      artifact: artifact as FillerDivergenceArtifact,
      groundTruth: GROUND_TRUTH!,
      script: SCRIPT,
      cardRowCountCoherent: card.coherent,
    });

    // Numbers/enum-only artifact — fixture provenance (name + SHA256 + source), NO transcript/raw-custom text.
    const record = {
      capturedAt: new Date().toISOString(),
      mode,
      fixture: {
        name: FIXTURE!.split('/').pop(),
        sha256: fixtureSha256,
        source,                                   // reviewer_qa_human | dev_preliminary | tts_preliminary
        releaseGrade: source === 'reviewer_qa_human',
      },
      card,
      row,
    };
    const blob = JSON.stringify(record, null, 2);
    for (const forbidden of ['transcript', 'partial', 'preview', 'modelOutput']) {
      expect(blob.toLowerCase().includes(`"${forbidden}"`), `no ${forbidden} field`).toBe(false);
    }
    const out = testInfo.outputPath(`filler-comparison-${mode}-script${SCRIPT}.json`);
    fs.writeFileSync(out, blob);
    await testInfo.attach(`filler-comparison-${mode}-script${SCRIPT}`, { body: blob, contentType: 'application/json' });
    console.log(`[filler-comparison] ${mode} script ${SCRIPT} (${source}): ${JSON.stringify(row)}`);
  });
});
