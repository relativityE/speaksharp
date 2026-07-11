// DIAGNOSTIC ONLY (#963 / :285) — not a Gate 3 gate test. Reproduces the ":285 Pro cannot switch STT
// mode while a Cloud recording is active" Cloud-start path and CAPTURES the full start-sequence state
// before/after clicking Start, instead of hanging on `waitForResponse(assemblyai-token)`.
//
// Why this exists: on the #963 Preview build, clicking Start in the Cloud path never emits an
// `assemblyai-token` request and `data-recording` stays false — but the SAME test PASSES on prod.
// Two earlier fixes were REFUTED by identical failures (injected getUserMedia stream; forcing
// __E2E_CONTEXT__ to skip MSW). So the token is never requested because the Cloud START SEQUENCE
// stalls/aborts upstream of the token fetch. This spec localizes exactly where.
//
// Production-build reality: Vercel builds are import.meta.env.MODE === 'production', so ENV.isE2E is
// FALSE on both preview and prod → e2eProbe.probe() early-returns → window.__E2E_PROBE__ (the SR_*
// event trail) is NEVER populated on the deployed app. So we observe the start sequence through
// production-active signals instead: the forensic anchors on <html> (data-runtime-state etc., written
// unconditionally by forensicAnchors.ts), __SPEECH_RUNTIME_DEBUG__() (controllerState/serviceMode/
// serviceState/policy), the status-message-text (set to "⚠️ …" on Cloud-start failure), and console.
// The data-runtime-state / controllerState trajectory (READY/IDLE → INITIATING → ENGINE_INITIALIZING
// → …, or → FAILED, or unchanged) is the production-observable proxy for "did startRecording enter".

import { type Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';
import { HARVARD_BENCHMARK_AUDIO } from './helpers/audio-fixtures';
import { injectAlignedFixtureAudio, resetFixtureAudioToStart } from './helpers/fixtureAudioStream';
import { selectBenchmarkMode, assertPreStartMode } from './helpers/benchmark-utils';

const E2E_PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

// Reproduced from stt-switching-contract.live.spec.ts (signIn is local to that spec).
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
}

// The owner's exact before/after field list, read from production-active signals.
async function captureStartState(page: Page, label: string) {
  return page.evaluate((snapLabel) => {
    const root = document.documentElement;
    const modeSelect = document.querySelector('[data-testid="stt-mode-select"]') as HTMLElement | null;
    const startBtn = document.querySelector('[data-testid="session-start-stop-button"]') as HTMLElement | null;
    const status = document.querySelector('[data-testid="status-message-text"]') as HTMLElement | null;
    const w = window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown> };
    const dbg = typeof w.__SPEECH_RUNTIME_DEBUG__ === 'function' ? w.__SPEECH_RUNTIME_DEBUG__() : null;
    const policy = (dbg?.policy ?? null) as Record<string, unknown> | null;
    return {
      label: snapLabel,
      // <html> forensic anchors (owner list)
      dataSttMode: root.getAttribute('data-stt-mode'),
      dataSttResolvedMode: root.getAttribute('data-stt-resolved-mode'),
      dataRuntimeState: root.getAttribute('data-runtime-state'),
      dataEngineReady: root.getAttribute('data-engine-ready'),
      dataSttReady: root.getAttribute('data-stt-ready'),
      dataModelStatus: root.getAttribute('data-model-status'),
      // activeEngine + resolution (from the controller debug accessor)
      controllerState: dbg?.controllerState ?? null,
      controllerPreferredMode: dbg?.controllerPreferredMode ?? null,
      serviceMode: dbg?.serviceMode ?? null,   // the active engine's negotiated mode (null = no engine yet)
      serviceState: dbg?.serviceState ?? null, // the active engine's own FSM state
      policyPreferredMode: policy?.preferredMode ?? null,
      policyAllowCloud: policy?.allowCloud ?? null,
      // selected UI mode + Start button
      uiModeSelectState: modeSelect?.getAttribute('data-state') ?? null,
      startButtonDisabled: startBtn?.hasAttribute('disabled') ?? null,
      startButtonRecording: startBtn?.getAttribute('data-recording') ?? null,
      startButtonText: startBtn?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? null,
      // status text (the Cloud-start failure path writes "⚠️ …" here)
      statusText: status?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200) ?? null,
    };
  }, label);
}

test.describe.configure({ mode: 'serial', retries: 0 });

test('DIAG :285 Cloud start sequence — capture, do not hang on token', async ({ page }, testInfo) => {
  test.skip(!E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'Pro test credentials are required.');
  test.setTimeout(180_000);

  // ---- network + console capture (installed before any navigation) ----
  const isTokenUrl = (u: string) => /\/functions\/v1\/assemblyai-token/i.test(u);
  const isUsageUrl = (u: string) => /check-?usage-?limit|usage[-_]?limit|entitlement/i.test(u);
  const isSentryUrl = (u: string) => /sentry|ingest\./i.test(u);
  const net: Array<{ kind: string; url: string; method?: string; status?: number; failure?: string; tMs: number }> = [];
  const consoleLog: Array<{ type: string; text: string; tMs: number }> = [];
  let clickAt = 0;
  const now = () => (clickAt ? Date.now() - clickAt : 0); // ms relative to the Start click (negative = before)

  const tag = (u: string) => (isTokenUrl(u) ? 'TOKEN' : isUsageUrl(u) ? 'USAGE' : isSentryUrl(u) ? 'SENTRY' : null);
  page.on('request', (r) => { const k = tag(r.url()); if (k) net.push({ kind: `${k}:req`, url: r.url().slice(0, 140), method: r.method(), tMs: now() }); });
  page.on('response', (r) => { const k = tag(r.url()); if (k) net.push({ kind: `${k}:res`, url: r.url().slice(0, 140), status: r.status(), tMs: now() }); });
  page.on('requestfailed', (r) => { const k = tag(r.url()); if (k) net.push({ kind: `${k}:FAIL`, url: r.url().slice(0, 140), failure: r.failure()?.errorText ?? 'unknown', tMs: now() }); });
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error' || type === 'warning' || /recording|start|cloud|assemblyai|token|Failed|Sentry|mic|engine/i.test(m.text())) {
      consoleLog.push({ type, text: m.text().slice(0, 300), tMs: now() });
    }
  });
  page.on('pageerror', (e) => consoleLog.push({ type: 'pageerror', text: e.message.slice(0, 300), tMs: now() }));

  // ---- reproduce :285 setup up to the Start click ----
  await injectAlignedFixtureAudio(page, HARVARD_BENCHMARK_AUDIO);
  await signIn(page, E2E_PRO_EMAIL!, E2E_PRO_PASSWORD!);
  await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
  await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });

  await selectBenchmarkMode(page, 'cloud');
  await assertPreStartMode(page, 'cloud'); // proves mode=cloud, policy.preferredMode=cloud, runtimeState READY/IDLE

  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });
  await resetFixtureAudioToStart(page);

  // ---- BEFORE click ----
  const before = await captureStartState(page, 'BEFORE_CLICK');

  // ---- click Start (do NOT await a token response; we want to observe the sequence) ----
  clickAt = Date.now();
  await startStopButton.click();

  // ---- IMMEDIATELY after click ----
  const afterImmediate = await captureStartState(page, 'AFTER_CLICK_IMMEDIATE');

  // ---- trajectory: poll the FSM/state for ~20s (the production proxy for the SR_* start-sequence trail) ----
  const trajectory: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 20; i++) {
    const s = await captureStartState(page, `t+${i + 1}s`);
    trajectory.push({
      t: `+${i + 1}s`,
      runtimeState: s.dataRuntimeState,
      controllerState: s.controllerState,
      serviceMode: s.serviceMode,
      serviceState: s.serviceState,
      engineReady: s.dataEngineReady,
      recording: s.startButtonRecording,
      status: s.statusText,
    });
    const tokenSeen = net.some((n) => n.kind.startsWith('TOKEN'));
    const recording = s.startButtonRecording === 'true';
    const failed = s.dataRuntimeState === 'FAILED' || (s.statusText ?? '').includes('⚠️');
    if ((tokenSeen && recording) || failed) break;
    await page.waitForTimeout(1_000);
  }

  const report = {
    scenario: ':285 Pro Cloud-start (diagnostic reproduction)',
    baseUrl: process.env.BASE_URL ?? null,
    before,
    afterImmediate,
    trajectory,
    tokenRequestMade: net.some((n) => n.kind.startsWith('TOKEN')),
    network: net,
    consoleTail: consoleLog.slice(-40),
    // Classification hint (owner's decision tree)
    classification:
      net.some((n) => n.kind.startsWith('TOKEN:FAIL')) ? 'TOKEN_REQUEST_FAILED (CORS/network — check headers/CORS)' :
      net.some((n) => n.kind.startsWith('TOKEN:res')) ? 'TOKEN_RETURNED (test wait/assert issue)' :
      net.some((n) => n.kind.startsWith('TOKEN:req')) ? 'TOKEN_REQUESTED_NO_RESPONSE (edge fn/timeout)' :
      (afterImmediate.dataRuntimeState === 'FAILED' || (afterImmediate.statusText ?? '').includes('⚠️')) ? 'START_FAILED_FAST (recording_start_failed path — see status/console)' :
      trajectory.some((t) => ['INITIATING', 'ENGINE_INITIALIZING'].includes(String(t.runtimeState))) ? 'START_ENTERED_BUT_STALLED_BEFORE_TOKEN (warmup/engine init)' :
      'NO_REQUEST_MADE — start sequence never advanced past READY/IDLE (client/start sequencing)',
  };

  await testInfo.attach('diag-285-cloud-start.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  console.log(`DIAG_285_CLOUD_START ${JSON.stringify(report)}`);

  // Diagnostic pass: we assert only that we captured the sequence, so the run completes and surfaces
  // the report rather than timing out. This spec does NOT gate anything.
  expect(before.uiModeSelectState).toBe('cloud');
});
