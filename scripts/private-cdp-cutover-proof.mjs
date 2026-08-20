// #1309 Private-STT + metrics-only cutover CDP proof (attaches to the EXISTING logged-in Chrome on 9222).
//
// Content boundary:
//   - BENCHMARK ARTIFACT (<out>.artifact.json): MAY retain reference + recognized transcript (WER/accuracy only).
//   - APP-DIAGNOSTIC TIMELINE (<out>.jsonl): CONTENT-FREE — lengths/codes/states/counts only. Never transcript
//     text, never document.body.innerText, never previews, never raw trace text, never a PG error `details`/`hint`.
//
// It proves: the page runs the DEPLOYED cutover build; Private runtime + zero Cloud requests; live transcript
// grows while recording; at terminal the store transcript length goes 0 and the save-candidate buffers clear;
// the saved detail carries metrics + exactly one VALID next action (an integrity error is counted separately);
// and a recursive scan of the diagnostic surface finds no transcript-bearing strings.
//
// v2 corrections (2026-08-19), each verified against the deployed tree at 30746293:
//   - EXPECTED_RELEASE gate. The prior run silently exercised a STALE CACHED BUNDLE: it recorded
//     `debug.selectedTranscriptForSave` / `debug.saveCandidate.selectedForSave` as raw 209-char STRINGS, but the
//     cutover (30746293) renamed both to `…Length` numbers. Every conclusion from that run is about the old build.
//     This harness now FAILS CLOSED unless window.__APP_RELEASE__ matches, so that can never recur silently.
//   - `transcript-container` is a DEAD testid (only TranscriptPanel.tsx renders it, and nothing imports
//     TranscriptPanel). The session page renders TranscriptCard/LiveTranscript → `transcript-content`,
//     `transcript-card`, `live-transcript`.
//   - There is no `data-recording` attribute; recording derives from controllerState === 'RECORDING'.
//   - Metric testids are `filler-count-value` / `clarity-score-value` / `wpm-value` (the `-value` suffix was
//     missing before, so `metricsPresent` was false in all 1769 rows of the prior run — void, not evidence).
//   - `[data-testid^="session-next-action"]` matches the integrity-error and none-state too. Split them, or a
//     rendered "missing its next action" error counts as a passing next action.
//   - Private does not populate __NATIVE_PARALLEL_CAPTURE__ (Native harness only); timing comes from
//     __PRIVATE_TIMING__.
//   - Captures the persistence boundary: the /rest/v1/sessions PATCH and the create/complete RPC responses
//     (HTTP status + PG code + SANITIZED message), which is the one diagnostic the metrics-failure needs.
import { chromium } from 'playwright';
import { appendFile, writeFile } from 'node:fs/promises';
// The verdict lives in its own module so it can be FIXTURE-TESTED without a browser or a human
// (tests/deps/private-proof-verdict.fixture.test.ts). The previous harness's verdict was structurally
// unreachable and nobody noticed, because it could only ever be exercised during a real-device run.
import { evaluateProof, evaluateRelease } from './lib/private-proof-verdict.mjs';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = process.env.OUT || '/private/tmp/1309-private-cdp-proof';
const JSONL = `${OUT}.jsonl`;
const ART = `${OUT}.artifact.json`;
const REFERENCE = (process.env.REFERENCE || '').trim();
const MAX_MS = Number(process.env.MAX_MIN || 10) * 60_000;
// Fail closed unless the page is the deployed cutover build. Override only to test a different head on purpose.
const EXPECTED_RELEASE = (process.env.EXPECTED_RELEASE || '307462931905ddcaac1eac303821c4291b7e0257').trim();

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
function wer(ref, hyp) {
  const r = norm(ref).split(' ').filter(Boolean), h = norm(hyp).split(' ').filter(Boolean);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 0; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = r[i - 1] === h[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1]);
  return { refWords: r.length, hypWords: h.length, edits: d[r.length][h.length], wer: r.length ? d[r.length][h.length] / r.length : null };
}

// A PG/PostgREST error may carry prose in `details`/`hint` (and, on a check-constraint violation, the offending
// row). Keep ONLY the fixed code + the message's leading clause, and never the body of a request.
const sanitizeErr = (o) => {
  if (!o || typeof o !== 'object') return null;
  const msg = typeof o.message === 'string' ? o.message.slice(0, 200) : null;
  return { code: o.code ?? null, message: msg, hasDetails: o.details != null, hasHint: o.hint != null };
};

const b = await chromium.connectOverCDP(CDP);
const cloudHits = [];
const persistenceCalls = [];   // the §4(2) diagnostic: what the metrics writers actually returned

const isSupabaseWrite = (u, m) =>
  /\/rest\/v1\/sessions/.test(u) && ['PATCH', 'POST'].includes(m)
  || /\/rest\/v1\/rpc\/(complete_session|create_session_and_update_usage|heartbeat_session)/.test(u);

for (const ctx of b.contexts()) {
  ctx.on('request', (req) => {
    const u = req.url();
    if (/assemblyai|deepgram|gemini|cloud[-_/]?token|transcription\/token|openai/i.test(u)) {
      cloudHits.push({ t: Date.now(), host: new URL(u).host });
    }
  });
  ctx.on('response', async (res) => {
    const req = res.request(); const u = res.url(); const m = req.method();
    if (!isSupabaseWrite(u, m)) return;
    const rec = {
      t: Date.now(),
      // path only — never the query string (it can carry row filters) and never the request body.
      endpoint: new URL(u).pathname, method: m, status: res.status(), ok: res.ok(),
    };
    if (!res.ok()) {
      try { rec.error = sanitizeErr(JSON.parse(await res.text())); }
      catch { rec.error = { code: null, message: null, hasDetails: false, hasHint: false, unparseable: true }; }
    }
    persistenceCalls.push(rec);
    await appendFile(JSONL, JSON.stringify({ kind: 'persistence', ...rec }) + '\n').catch(() => {});
  });
}

const sessionPage = () => { const p = b.contexts().flatMap((c) => c.pages()); return p.filter((x) => /speaksharp-public\.vercel\.app/.test(x.url())).at(-1) || p.at(-1) || null; };

const p0 = sessionPage();
if (!p0) { console.error('NO_SPEAKSHARP_PAGE'); process.exit(2); }

// ---- Release gate: refuse to produce evidence about a bundle that is not the deployed one. ----
const release = await p0.evaluate(() => window.__APP_RELEASE__ ?? null);
const gate = evaluateRelease(release, EXPECTED_RELEASE);
if (!gate.ok) {
  console.error(`${gate.code} page=${gate.running ?? 'null'} expected=${gate.expected ?? 'null'}`);
  console.error('Hard-reload the tab (Cmd-Shift-R) so it picks up the deployed build, then re-arm. Refusing to run.');
  process.exit(3);
}
console.log(`RELEASE_OK ${release}`);

await p0.evaluate(() => { window.__SS_TRANSCRIPT_TRACE__ = []; });
await writeFile(JSONL, '');
console.log(`PRIVATE_CDP_PROOF_ARMED jsonl=${JSONL} artifact=${ART} release=${release}`);

const timeline = [];                        // in-memory samples, fed to the fixture-tested verdict
let peak = { len: 0, text: '' };
let sawRecording = false, terminalObserved = false, terminalMetrics = null, savedDetail = null;
let stopEnteredAt = null; const finalizations = [];

async function capture() {
  const page = sessionPage();
  if (!page) return;
  const s = await page.evaluate(() => {
    const dbg = (typeof window.__SPEECH_RUNTIME_DEBUG__ === 'function') ? (window.__SPEECH_RUNTIME_DEBUG__() || {}) : {};
    // Live transcript text lives in TranscriptCard/LiveTranscript, NOT the dead `transcript-container`.
    const tcEl = document.querySelector('[data-testid="transcript-content"]')
      || document.querySelector('[data-testid="live-transcript"]')
      || document.querySelector('[data-testid="transcript-card"]');
    const tc = tcEl?.textContent ?? '';
    const trace = window.__SS_TRANSCRIPT_TRACE__ || [];
    const stageCounts = trace.reduce((a, e) => { const k = e && e.stage; if (k) a[k] = (a[k] || 0) + 1; return a; }, {});
    const pt = window.__PRIVATE_TIMING__ || null;   // Private timing (Native harness globals do not apply here)
    const longStrings = [];
    (function scan(o, path, depth) { if (depth > 4 || o == null) return; for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string' && v.length > 40) longStrings.push(`${path}.${k}[len=${v.length}]`); else if (v && typeof v === 'object') scan(v, `${path}.${k}`, depth + 1); } })(dbg, 'debug', 0);
    const q = (sel) => document.querySelectorAll(sel).length;
    return {
      release: window.__APP_RELEASE__ ?? null,          // re-asserted every tick: a mid-run reload must be visible
      path: location.pathname,
      controllerState: dbg.controllerState ?? null, serviceMode: dbg.serviceMode ?? null, serviceState: dbg.serviceState ?? null,
      recording: dbg.controllerState === 'RECORDING',   // derived — there is no `data-recording` attribute
      modelStatus: document.documentElement.getAttribute('data-model-status') ?? null,
      sessionPersisted: document.documentElement.getAttribute('data-session-persisted') ?? null,
      transcriptLength: dbg.transcriptLength ?? null,
      dom_transcript_len: tc.length, dom_transcript_present: !!tcEl,
      saveCandidate_present: dbg.saveCandidate != null,
      // Post-cutover these are NUMBERS. A string here means a stale bundle (the release gate should have caught it).
      selectedForSaveLength: dbg.selectedTranscriptForSaveLength ?? null,
      saveCandidate_selectedForSaveLength: dbg.saveCandidate?.selectedForSaveLength ?? null,
      selectedTranscriptSource: dbg.selectedTranscriptSource ?? null,
      // UI finalization state, to separate a slow engine from a banner that never clears.
      finalizingVisible: /Finalizing your transcript/i.test(document.body.textContent || ''),
      stageCounts,
      privateTiming: pt ? { finalizeDecodeMs: pt.finalizeDecodeMs, capturedAudioMs: pt.capturedAudioMs, rtf: pt.rtf } : null,
      diagLongStringFields: longStrings,                // MUST be [] for the metrics-only contract
      // Metric testids carry the `-value` suffix; without it this was false in every row of the prior run.
      metricsPresent: q('[data-testid="filler-count-value"], [data-testid="clarity-score-value"], [data-testid="wpm-value"]') > 0,
      // A VALID next action and a data-integrity error must never be conflated.
      nextActionValid: q('[data-testid="session-next-action-title"]'),
      nextActionIntegrityError: q('[data-testid="session-next-action-integrity-error"]'),
      nextActionNone: q('[data-testid="session-next-action-none"]'),
      _recognized: tc,                                  // benchmark-only (stripped from the JSONL)
    };
  });

  if (s.recording) sawRecording = true;
  if (s.dom_transcript_len > peak.len) peak = { len: s.dom_transcript_len, text: s._recognized };

  // Finalization interval: STOPPING entry → the tick that reaches a terminal state.
  if (s.controllerState === 'STOPPING' && stopEnteredAt == null) stopEnteredAt = Date.now();
  if (stopEnteredAt != null && s.controllerState !== 'STOPPING') {
    finalizations.push({ ms: Date.now() - stopEnteredAt, exitState: s.controllerState, finalizeDecodeMs: s.privateTiming?.finalizeDecodeMs ?? null, finalizingVisibleAtExit: s.finalizingVisible });
    stopEnteredAt = null;
  }
  if (sawRecording && !s.recording && !terminalObserved && s.transcriptLength === 0 && !s.saveCandidate_present) {
    terminalObserved = true;
    terminalMetrics = { transcriptLength: s.transcriptLength, saveCandidate_present: s.saveCandidate_present, diagLongStringFields: s.diagLongStringFields };
  }
  if (/^\/analytics\/[^/]+/.test(s.path)) {
    savedDetail = { path: s.path, metricsPresent: s.metricsPresent, nextActionValid: s.nextActionValid, nextActionIntegrityError: s.nextActionIntegrityError, dom_transcript_len: s.dom_transcript_len };
  }
  const cf = { ...s }; delete cf._recognized;
  timeline.push(cf);
  await appendFile(JSONL, JSON.stringify({ kind: 'tick', t: Date.now(), ...cf }) + '\n');
  return s;
}

const started = Date.now();
while (Date.now() - started < MAX_MS) { try { await capture(); } catch { /* page nav */ } await new Promise((r) => setTimeout(r, 400)); }

const werResult = REFERENCE && peak.text ? wer(REFERENCE, peak.text) : null;
// One verdict authority, shared with the fixtures. PASS is the conjunction of positively demonstrated
// requirements — absent evidence never passes.
const verdict = evaluateProof({
  release, expectedRelease: EXPECTED_RELEASE, samples: timeline,
  persistenceCalls, cloudHits, benchmark: { recognizedLen: peak.len },
});
await writeFile(ART, JSON.stringify({
  release,
  verdict,
  cutoverContract: {
    terminalObserved, terminal: terminalMetrics, savedDetail,
    cloudRequests: cloudHits.length, cloudHosts: [...new Set(cloudHits.map((c) => c.host))],
  },
  finalizations,
  persistenceCalls,                                    // status + PG code + sanitized message per write
  persistenceFailures: persistenceCalls.filter((c) => !c.ok),
  benchmark: { reference: REFERENCE || null, recognizedTranscript: peak.text || null, recognizedLen: peak.len, wer: werResult },
}, null, 2));
console.log(`PROOF_${verdict.pass ? 'PASS' : 'FAIL'} release=${release} cloudRequests=${cloudHits.length} persistenceFailures=${persistenceCalls.filter((c) => !c.ok).length} recognizedLen=${peak.len} artifact=${ART}`);
if (!verdict.pass) for (const r of verdict.reasons) console.error(`  UNMET ${r}`);
await b.close();
