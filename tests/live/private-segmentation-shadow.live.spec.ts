/**
 * Private segmentation shadow-comparison validation (#891) @live
 * ============================================================================
 * Drives the REAL Private path (REAL_WHISPER_TEST=true → real whisper-base.en from local /models/) with
 * segmentation ENABLED via the internal window flag (works even with Item 5's prod URL-param gate),
 * feeding the washington_01 65.8s speech fixture through the fake mic. After Stop it reads
 * window.__PRIVATE_SEGMENTATION_TELEMETRY__ and reports BOTH signals the 5-min gate needs:
 *   - keep-pace: maxQueueDepth (want flat/low), per-segment rtf (want < 1), tailDecodeMs, stopToFinalMs
 *   - fidelity: shadow.similarity (want near 1.0 vs the canonical whole-utterance), flaggedSeams, tokenDelta
 * Nothing is saved as the segmented transcript; the whole-utterance decode stays canonical. This is the
 * automated stand-in for the owner's manual 5-min take — no mic, no devtools.
 */
import { test, expect, type Page } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { preparePrivateModelIfPrompted, selectBenchmarkMode, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { WASHINGTON_01 } from '../fixtures/stt-isomorphic/washington-speeches';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';

// CORPUS (avoid overfitting to one adversarial clip). Select via CORPUS_ID; feed the matching audio via
// LIVE_AUDIO_FIXTURE (playwright.live.config.ts). Each entry: reference text + duration + adversarial flag.
const CORPUS: Record<string, { label: string; reference: string; durationSec: number; adversarial: boolean }> = {
  washington_01: { label: 'washington_01 (adversarial regression guard)', reference: WASHINGTON_01.transcript, durationSec: WASHINGTON_01.metadata.durationSec, adversarial: true },
  harvard_full: { label: 'harvard_full (non-adversarial clean read, 10 sentences)', reference: HARVARD_FULL, durationSec: 29.6, adversarial: false },
};
const CORPUS_ID = process.env.CORPUS_ID || 'washington_01';
const FIXTURE = CORPUS[CORPUS_ID] ?? CORPUS.washington_01;

const AUDIO_COMPLETION_MARGIN_MS = 3_000;

test.describe('Private segmentation corpus WER validation @live', () => {
  test(`${CORPUS_ID}: private whole vs segmented WER + keep-pace`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);

    await enableSegmentationHooks(page);
    const account = makeTesterAccount();
    await signIn(page, account.email, account.password);

    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfPrompted(page, 180_000);

    const startStopButton = page.getByTestId('session-start-stop-button');
    await expect(startStopButton).toBeEnabled({ timeout: 60_000 });
    await startStopButton.click();
    const recordingStartedAt = Date.now();
    await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });

    await waitForNonPlaceholderTranscript(page);
    const elapsed = Date.now() - recordingStartedAt;
    await page.waitForTimeout(Math.max(0, FIXTURE.durationSec * 1000 + AUDIO_COMPLETION_MARGIN_MS - elapsed));

    await startStopButton.click();
    await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 90_000 });
    const saveCandidate = await waitForBenchmarkSaveCandidate(page, 'private-segmentation-shadow', 120_000);
    const wholeUtterance = (saveCandidate.selectedForSave ?? '').trim();

    const { telemetry, assembled } = await page.evaluate(() => {
      const win = window as unknown as { __PRIVATE_SEGMENTATION_TELEMETRY__?: unknown; __PRIVATE_SEGMENTATION_ASSEMBLED__?: string };
      return { telemetry: win.__PRIVATE_SEGMENTATION_TELEMETRY__ ?? null, assembled: (win.__PRIVATE_SEGMENTATION_ASSEMBLED__ ?? '').trim() };
    });

    // ACCURACY vs KNOWN reference (public-domain fixtures, so logging text is fine here). Also surface
    // the whole-utterance repetition-risk flag — the loop detector — to answer "does the CURRENT shipping
    // path loop on THIS clip?" (the production-bug generality check), not just on washington_01.
    const groundTruth = FIXTURE.reference;
    const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;
    const acc = (wer: number) => Number(((1 - wer) * 100).toFixed(1));
    const wholeWer = calculateWordErrorRate(groundTruth, wholeUtterance);
    const segWer = assembled ? calculateWordErrorRate(groundTruth, assembled) : NaN;
    const sc = saveCandidate as { repetitionRisk?: boolean; repeatedSpanSummary?: string };
    const wholeRepetition = sc.repetitionRisk ?? false;
    const wholeRepeatSpan = sc.repeatedSpanSummary ?? '';
    // eslint-disable-next-line no-console
    console.log(
      `\n===== CORPUS WER: ${FIXTURE.label} (reference ${wc(groundTruth)} words) =====\n` +
      `whole-utterance (current saved): WER ${wholeWer.toFixed(3)} (${acc(wholeWer)}%), ${wc(wholeUtterance)} words, repetitionRisk=${wholeRepetition}${wholeRepeatSpan ? ' [' + wholeRepeatSpan + ']' : ''}\n` +
      `assembled (segmented):           WER ${assembled ? segWer.toFixed(3) : 'n/a'} (${assembled ? acc(segWer) + '%' : 'N/A'}), ${wc(assembled)} words\n` +
      `================================================================\n`,
    );

    // Human-readable report attached to the test run.
    const report = JSON.stringify(telemetry, null, 2);
    await testInfo.attach('private-segmentation-telemetry.json', { body: report, contentType: 'application/json' });
    // eslint-disable-next-line no-console
    console.log('\n===== PRIVATE SEGMENTATION TELEMETRY =====\n' + report + '\n=========================================\n');

    const t = telemetry as {
      segmentationEnabled?: boolean;
      maxQueueDepth?: number;
      tailDecodeMs?: number | null;
      stopToFinalMs?: number | null;
      usedWholeUtteranceFallback?: boolean;
      segments?: Array<{ rtf: number | null }>;
      shadow?: { segmentCount: number; seamCount: number; flaggedSeams: number; tokenCountDelta: number; similarity: number } | null;
    } | null;

    expect(t, 'window.__PRIVATE_SEGMENTATION_TELEMETRY__ must be present after Stop').toBeTruthy();
    expect(t?.segmentationEnabled).toBe(true);
    expect(t?.usedWholeUtteranceFallback).toBe(true); // instrumentation only — never a cutover
    expect(t?.shadow, 'shadow comparison must be published').toBeTruthy();
    // Keep-pace: real decodes should run faster than real time (RTF < 1) so the queue stays flat.
    const rtfs = (t?.segments ?? []).map((s) => s.rtf).filter((r): r is number => typeof r === 'number');
    // Fidelity: the assembled segmented transcript should closely match the canonical whole-utterance.
    // Not a hard gate here (real WER varies) — logged for the go/no-go read; assert only that it computed.
    expect(typeof t?.shadow?.similarity).toBe('number');
    testInfo.annotations.push(
      { type: 'maxQueueDepth', description: String(t?.maxQueueDepth) },
      { type: 'tailDecodeMs', description: String(t?.tailDecodeMs) },
      { type: 'stopToFinalMs', description: String(t?.stopToFinalMs) },
      { type: 'segment-rtfs', description: rtfs.join(', ') },
      { type: 'similarity', description: String(t?.shadow?.similarity) },
      { type: 'flaggedSeams', description: String(t?.shadow?.flaggedSeams) },
      { type: 'tokenCountDelta', description: String(t?.shadow?.tokenCountDelta) },
    );
  });
});

async function enableSegmentationHooks(page: Page) {
  await page.addInitScript(() => {
    const win = window as Window & {
      __E2E_CONTEXT__?: boolean; REAL_WHISPER_TEST?: boolean; __FORCE_TRANSFORMERS_JS__?: boolean;
      __STT_LOAD_TIMEOUT__?: number; __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
      __PRIVATE_SEGMENTATION__?: boolean; __E2E_DEPS__?: Record<string, unknown>;
    };
    win.__E2E_CONTEXT__ = true;
    win.REAL_WHISPER_TEST = true;
    win.__FORCE_TRANSFORMERS_JS__ = true;
    win.__STT_LOAD_TIMEOUT__ = 180000;
    win.__PRIVATE_TRANSCRIPT_TRACE__ = true;
    win.__PRIVATE_SEGMENTATION__ = true; // internal/dev flag — the Item-5-preserved diagnostic path
    win.__E2E_DEPS__ = {
      ...win.__E2E_DEPS__,
      fetchUsageLimit: async () => ({
        can_start: true, daily_remaining: 3600, daily_limit: 3600, monthly_remaining: 3600, monthly_limit: 3600,
        remaining_seconds: 3600, subscription_status: 'pro', is_pro: true, streak_count: 0, trial_active: true,
      }),
    };
  });
}

function makeTesterAccount() {
  // Fresh account per run — the reusable account can trip the account-wide recording mutex across
  // back-to-back runs (record button enabled but sttReady stays false). A unique email sidesteps that.
  return {
    email: `private-seg-${Date.now()}@speaksharp.app`,
    password: process.env.PRIVATE_LONGFORM_REUSE_PASSWORD ?? 'SpeakSharpLongform-Reuse!Aa9',
  };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-up-submit').click();
  if (await page.waitForURL(/\/session/, { timeout: 15_000 }).then(() => true).catch(() => false)) return;
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page).toHaveURL(/\/session|\/analytics/, { timeout: 30_000 });
}

async function waitForNonPlaceholderTranscript(page: Page) {
  await expect(async () => {
    const text = (await page.getByTestId('transcript-container').textContent() ?? '').replace(/\s+/g, ' ').trim();
    expect(text).not.toMatch(/words appear here|listening|no speech|start recording/i);
    expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
}
