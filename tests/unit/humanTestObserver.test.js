/**
 * #1390 — the observer's DECISIONS, tested without a browser.
 *
 * The wrapper's job is to stop the operator from recording a take that cannot be attributed afterwards.
 * That judgement is pure logic and belongs under test here; only the CDP plumbing needs a browser.
 */
import { describe, it, expect } from 'vitest';
import { readiness, classifyTake, auditEgress, TERMINAL_PRE_RECORDING_STATE } from '../../scripts/human-test/observer.mjs';

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
  const PINNED = ['https://download.moonshine.ai', 'https://huggingface.co'];
  const audit = (reqs) => auditEgress(reqs, APP, PINNED);

  it('CASUALTY: audio posted to an UNKNOWN host is caught', () => {
    // The defect this replaces. The old audit matched four known cloud-STT domains, so a POST carrying
    // recorded audio to any host nobody had thought of passed clean -- and the run would have been
    // recorded as PROVING zero egress. Being unable to name the vendor is the case to catch, not a
    // reason to allow it.
    const hits = audit([
      { url: 'https://telemetry.unknown-vendor.example/v1/ingest', method: 'POST', hasPostData: true },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('off_origin_body');
    expect(hits[0].origin).toBe('https://telemetry.unknown-vendor.example');
  });

  it('CASUALTY: a known cloud STT endpoint is suspect even with NO observed body', () => {
    // Transport metadata is not always complete -- a body streamed over a socket or sent in a redirected
    // follow-up may not surface as hasPostData. For these hosts there is no innocent reason to be
    // talking at all, so absence of an observed body is not evidence of innocence.
    const hits = audit([{ url: 'https://api.deepgram.com/v1/listen', method: 'GET' }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('known_cloud_stt');
  });

  it('CASUALTY: a POST to a pinned asset host is NOT treated as an asset fetch', () => {
    // The allowance is for READ-ONLY fetches of declared assets. An upload to the same origin borrows
    // the asset host's reputation to move bytes off the device.
    const hits = audit([
      { url: 'https://download.moonshine.ai/upload', method: 'POST', hasPostData: true },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('off_origin_body');
  });

  it('CASUALTY: query strings and bodies never reach the evidence', () => {
    const hits = audit([{
      url: 'https://unknown.example/ingest?token=SECRET_TOKEN&sid=abc#frag=SECRET_FRAGMENT',
      method: 'POST',
      hasPostData: true,
    }]);
    const serialized = JSON.stringify(hits);
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('SECRET_FRAGMENT');
    expect(serialized).not.toContain('sid=abc');
    expect(hits[0].pathname).toBe('/ingest');
  });

  it('CASUALTY: an unparseable target cannot be shown to be safe, so it is reported', () => {
    const hits = audit([{ url: 'not-a-url', method: 'POST', hasPostData: true }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('unparseable_target');
  });

  it('POSITIVE CONTROL: pinned asset GETs and same-origin traffic are not egress', () => {
    // Without these the audit flags a normal session and would be switched off, which is how a
    // fail-closed check becomes no check at all.
    expect(audit([
      { url: 'https://download.moonshine.ai/model/medium-streaming-en/quantized_26_07_30/encoder.ort', method: 'GET' },
      { url: 'https://huggingface.co/onnx-community/distil-small.en/resolve/main/model.onnx', method: 'GET' },
      { url: `${APP}/api/sessions`, method: 'POST', hasPostData: true },
      { url: `${APP}/assets/index.js`, method: 'GET' },
    ])).toEqual([]);
  });

  it('POSITIVE CONTROL: an off-origin GET with no body is not flagged', () => {
    // Fail-closed applies to bytes LEAVING. A bodyless third-party GET is not audio egress, and
    // flagging it would drown the real signal.
    expect(audit([{ url: 'https://fonts.gstatic.com/s/inter.woff2', method: 'GET' }])).toEqual([]);
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
