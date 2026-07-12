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
// RUN #2: ?testMode=true + __SS_E2E__ (set via addInitScript) raises the pino logger to 'info' on the
// deployed build (TestFlags.ts:108-114), surfacing the info-level Cloud start trace. ENV.isE2E stays
// FALSE on production-MODE builds, so the REAL engine + REAL token path are preserved (no mock).
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/signin?testMode=true');
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
  const sentryExceptions: Array<{ type: string; value: string; topFrames: string[]; tags?: unknown; ctx?: unknown; tMs: number }> = [];
  const allRequestFailures: Array<{ url: string; failure: string; tMs: number }> = [];
  let clickAt = 0;
  const now = () => (clickAt ? Date.now() - clickAt : 0); // ms relative to the Start click (negative = before)

  // Parse a Sentry envelope POST body (newline-delimited JSON) for exception details. The leaf error is
  // NOT captured to Sentry (only the controller wrapper is), but the recording_start context/tags are.
  const parseSentryEnvelope = (raw: string, tMs: number) => {
    for (const line of raw.split('\n')) {
      const s = line.trim(); if (!s || s[0] !== '{') continue;
      let obj: Record<string, unknown>; try { obj = JSON.parse(s); } catch { continue; }
      const exc = (obj as { exception?: { values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: Array<{ function?: string; filename?: string; lineno?: number }> } }> } }).exception;
      if (exc?.values) {
        for (const v of exc.values) {
          sentryExceptions.push({
            type: v.type ?? '(none)',
            value: (v.value ?? '').slice(0, 300),
            topFrames: (v.stacktrace?.frames ?? []).slice(-6).reverse().map((f) => `${f.function ?? '?'}@${(f.filename ?? '?').split('/').pop()}:${f.lineno ?? '?'}`),
            tags: (obj as { tags?: unknown }).tags,
            ctx: (obj as { contexts?: { recording_start?: unknown } }).contexts?.recording_start,
            tMs,
          });
        }
      }
    }
  };

  const tag = (u: string) => (isTokenUrl(u) ? 'TOKEN' : isUsageUrl(u) ? 'USAGE' : isSentryUrl(u) ? 'SENTRY' : null);
  page.on('request', (r) => {
    const k = tag(r.url()); if (k) net.push({ kind: `${k}:req`, url: r.url().slice(0, 140), method: r.method(), tMs: now() });
    if (k === 'SENTRY') { try { const pd = r.postData(); if (pd) parseSentryEnvelope(pd, now()); } catch { /* body unavailable */ } }
  });
  page.on('response', (r) => { const k = tag(r.url()); if (k) net.push({ kind: `${k}:res`, url: r.url().slice(0, 140), status: r.status(), tMs: now() }); });
  page.on('requestfailed', (r) => {
    const k = tag(r.url()); if (k) net.push({ kind: `${k}:FAIL`, url: r.url().slice(0, 140), failure: r.failure()?.errorText ?? 'unknown', tMs: now() });
    // ANY failed request (worklet asset, websocket, cross-origin) — catches blocked sub-resources.
    allRequestFailures.push({ url: r.url().slice(0, 160), failure: r.failure()?.errorText ?? 'unknown', tMs: now() });
  });
  // Capture the FULL console untruncated (prod-MODE logger level is 'warn', so engine logger.warn/error
  // DO reach console). The prior run truncated the leaf error via slice(-40); capture everything now.
  page.on('console', (m) => { consoleLog.push({ type: m.type(), text: m.text().slice(0, 600), tMs: now() }); });
  page.on('pageerror', (e) => consoleLog.push({ type: 'pageerror', text: `${e.name}: ${e.message}`.slice(0, 600), tMs: now() }));

  // App-logger-independent global error capture (installed before navigation).
  // RUN #2: also set __SS_E2E__ so the deployed build's TestFlags promotes the pino logger to 'info'
  // (with ?testMode=true in the first navigation). ENV.isE2E stays false (production MODE), so this only
  // raises log verbosity — it does NOT flip the engine/token path to any mock. bridge.pushEvent is left
  // undefined, so pushE2EEvent is a safe no-op.
  await page.addInitScript(() => {
    (window as unknown as { __SS_E2E__?: { isActive: boolean } }).__SS_E2E__ = { isActive: true };
    const w = window as unknown as { __DIAG_ERRORS__?: Array<Record<string, unknown>> };
    w.__DIAG_ERRORS__ = [];
    window.addEventListener('error', (e) => {
      w.__DIAG_ERRORS__!.push({ kind: 'window.onerror', message: String(e.message), filename: (e as ErrorEvent).filename, lineno: (e as ErrorEvent).lineno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = (e as PromiseRejectionEvent).reason;
      w.__DIAG_ERRORS__!.push({ kind: 'unhandledrejection', message: String((r && (r as Error).message) || r), name: r && (r as Error).name });
    });
  });

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

  // App-logger-independent global errors captured in-page.
  const diagErrors = await page.evaluate(() => {
    const w = window as unknown as { __DIAG_ERRORS__?: Array<Record<string, unknown>> };
    return w.__DIAG_ERRORS__ ?? [];
  }).catch(() => [] as Array<Record<string, unknown>>);

  // Emit the FULL console + errors + sentry exceptions as individual prefixed lines so they can be
  // extracted from the CI job log without JSON truncation.
  for (const c of consoleLog) console.log(`DIAG285_CON|${c.type}|${c.tMs}|${c.text.replace(/\n/g, ' ⏎ ')}`);
  for (const e of diagErrors) console.log(`DIAG285_ERR|${JSON.stringify(e)}`);
  for (const s of sentryExceptions) console.log(`DIAG285_SENTRY|${s.type}: ${s.value}|frames=${s.topFrames.join(' <- ')}|ctx=${JSON.stringify(s.ctx ?? null)}`);
  for (const f of allRequestFailures) console.log(`DIAG285_REQFAIL|${f.tMs}|${f.failure}|${f.url}`);

  const report = {
    scenario: ':285 Pro Cloud-start (diagnostic reproduction)',
    baseUrl: process.env.BASE_URL ?? null,
    before,
    afterImmediate,
    trajectory,
    tokenRequestMade: net.some((n) => n.kind.startsWith('TOKEN')),
    network: net,
    diagErrors,
    sentryExceptions,
    allRequestFailures,
    consoleFull: consoleLog,
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
