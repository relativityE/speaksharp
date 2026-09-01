/**
 * #1390 — the observer's DECISIONS, tested without a browser.
 *
 * The wrapper's job is to stop the operator from recording a take that cannot be attributed afterwards.
 * That judgement is pure logic and belongs under test here; only the CDP plumbing needs a browser.
 */
import { describe, it, expect } from 'vitest';
import { readiness, classifyTake, auditEgress, TERMINAL_PRE_RECORDING_STATE, DEFAULT_APP_PATHS } from '../../scripts/human-test/observer.mjs';

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';
const ready = (over = {}) => ({
  release: RELEASE,
  requestedCandidate: 'v4:distil:q4',
  observedCandidate: 'v4:distil:q4',
  identityMatches: true,
  modelStatus: 'ready',
  runtimeState: 'READY',
  ...over,
});

describe('READY means the engine published a MATCHING identity', () => {
  it('POSITIVE CONTROL: a matching, loaded engine is ready', () => {
    expect(readiness(ready(), 'v4:distil:q4', RELEASE)).toEqual({ ready: true, problems: [] });
  });

  it('CASUALTY: a visually loaded page with NO published identity is not ready', () => {
    // This is the case the operator cannot see: the UI looks fine and the recording would be
    // unattributable afterwards.
    const r = readiness(ready({ observedCandidate: null, identityMatches: false }), 'v4:distil:q4', RELEASE);
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toMatch(/no engine has published an identity/);
  });

  it('CASUALTY: a MISMATCH between requested and observed blocks the take', () => {
    // A switch that silently ran v2 would otherwise be recorded as distil.
    const r = readiness(ready({ observedCandidate: 'v2:base.en', identityMatches: false }), 'v4:distil:q4', RELEASE);
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toMatch(/observed v2:base\.en != requested v4:distil:q4/);
  });

  it('CASUALTY: a stale deployment is refused', () => {
    const r = readiness(ready({ release: 'deadbeef' }), 'v4:distil:q4', RELEASE);
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toMatch(/release deadbeef/);
  });
});

describe('an unattributable take is HOLD, never PASS or FAIL', () => {
  it('CASUALTY: no observed identity yields HOLD', () => {
    const v = classifyTake({ probe: ready({ observedCandidate: null, identityMatches: false }), saved: true, errors: [] });
    expect(v.verdict).toBe('HOLD');
  });

  it('CASUALTY: an identity mismatch yields HOLD, not a model FAIL', () => {
    // Recording it as FAIL would blame the model for a harness problem and corrupt the comparison.
    const v = classifyTake({ probe: ready({ identityMatches: false }), saved: true, errors: [] });
    expect(v.verdict).toBe('HOLD');
  });

  it('a take that never saved is a FAIL', () => {
    expect(classifyTake({ probe: ready(), saved: false, errors: [] }).verdict).toBe('FAIL');
  });

  it('POSITIVE CONTROL: attributable, saved, error-free is a PASS', () => {
    expect(classifyTake({ probe: ready(), saved: true, errors: [] }).verdict).toBe('PASS');
  });
});

describe('recorded audio must not leave the device', () => {
  const APP = 'https://speaksharp-public.vercel.app';
  const CANDIDATE = 'moonshine:streaming-medium';
  const audit = (reqs, over = {}) => auditEgress(reqs, { appOrigin: APP, observedCandidate: CANDIDATE, ...over });
  const PINNED = 'https://download.moonshine.ai/model/medium-streaming-en/quantized_26_07_30/encoder.ort';

  it('CASUALTY: audio posted to an UNKNOWN host is caught', () => {
    const hits = audit([{ url: 'https://telemetry.unknown-vendor.example/v1/ingest', method: 'POST', hasPostData: true }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('off_origin_body');
  });

  it('CASUALTY: an unknown off-origin BODYLESS GET is no longer waved through', () => {
    // A GET carries a query string perfectly well, so "no body" is not evidence that nothing left.
    const hits = audit([{ url: 'https://unknown.example/collect?d=stuff', method: 'GET' }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('off_origin_unrecognised');
    expect(JSON.stringify(hits)).not.toContain('stuff');
  });

  it('CASUALTY: same-origin traffic is NOT trusted merely for being same-origin', () => {
    // The app's own domain is where exfiltration is cheapest to hide. An unrecognised path is reported
    // for a human to judge rather than assumed benign.
    const hits = audit([{ url: `${APP}/collect-audio`, method: 'POST', hasPostData: true }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('unknown_same_origin');
  });

  it('CASUALTY: a body on an EXPECTED same-origin path is still surfaced', () => {
    const hits = audit([{ url: `${APP}/api/sessions`, method: 'POST', hasPostData: true }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('same_origin_body');
  });

  it('CASUALTY: the allowance is EXACT-URL, not per-origin', () => {
    // An origin allowance permits every path the host serves, including an upload endpoint sitting
    // beside the weight files.
    const hits = audit([{ url: 'https://download.moonshine.ai/upload', method: 'POST', hasPostData: true }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('off_origin_body');
  });

  it('CASUALTY: a pinned URL with data appended is a DIFFERENT request', () => {
    const hits = audit([{ url: `${PINNED}?exfil=SECRET`, method: 'GET' }]);
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits)).not.toContain('SECRET');
  });

  it('CASUALTY: an UNATTRIBUTABLE run allows nothing', () => {
    // With no observed candidate we cannot say which downloads were legitimate, so guessing would let an
    // unknown model's fetches pass as expected.
    const hits = audit([{ url: PINNED, method: 'GET' }], { observedCandidate: null });
    expect(hits).toHaveLength(1);
  });

  it('CASUALTY: a known cloud STT endpoint is suspect even with no observed body', () => {
    const hits = audit([{ url: 'https://api.deepgram.com/v1/listen', method: 'GET' }]);
    expect(hits[0].category).toBe('known_cloud_stt');
  });

  it('CASUALTY: query strings and fragments never reach the evidence', () => {
    const hits = audit([{ url: 'https://unknown.example/ingest?token=SECRET_Q#f=SECRET_F', method: 'POST', hasPostData: true }]);
    const s = JSON.stringify(hits);
    expect(s).not.toContain('SECRET_Q');
    expect(s).not.toContain('SECRET_F');
    expect(hits[0].pathname).toBe('/ingest');
  });

  it('POSITIVE CONTROL: the exact pinned assets and expected app paths are not egress', () => {
    // Without these the audit flags an ordinary session and gets switched off, which is how a
    // fail-closed check becomes no check at all.
    expect(audit([
      { url: PINNED, method: 'GET' },
      { url: `${APP}/assets/index.js`, method: 'GET' },
      { url: `${APP}/index.html`, method: 'GET' },
    ])).toEqual([]);
  });

  it('CASUALTY: the app-path allowlist cannot contain a prefix that matches everything', () => {
    // A '/' entry would make the same-origin rule vacuous while still reading as an allowlist.
    expect(DEFAULT_APP_PATHS).not.toContain('/');
    expect(DEFAULT_APP_PATHS.every((p) => p.length > 1)).toBe(true);
  });
});

describe('READY requires the controller to have settled, not just the model', () => {
  it('CASUALTY: a ready MODEL mid-initialisation is not ready to record', () => {
    // The harness artefact this prevents: a take started here loses its opening audio, which reads
    // afterwards as the MODEL clipping the first words -- and gets scored against the arm.
    for (const state of ['INITIATING', 'ENGINE_INITIALIZING', 'DOWNLOAD_REQUIRED', 'IDLE']) {
      const r = readiness(ready({ runtimeState: state }), 'v4:distil:q4', RELEASE);
      expect(r.ready, `${state} must not be ready`).toBe(false);
      expect(r.problems.join(' ')).toMatch(/runtime state is/);
    }
  });

  it('CASUALTY: a session already RECORDING or STOPPING is not a fresh take', () => {
    for (const state of ['RECORDING', 'STOPPING']) {
      expect(readiness(ready({ runtimeState: state }), 'v4:distil:q4', RELEASE).ready).toBe(false);
    }
  });

  it('POSITIVE CONTROL: the terminal pre-recording state is READY', () => {
    expect(TERMINAL_PRE_RECORDING_STATE).toBe('READY');
    expect(readiness(ready(), 'v4:distil:q4', RELEASE)).toEqual({ ready: true, problems: [] });
  });
});
