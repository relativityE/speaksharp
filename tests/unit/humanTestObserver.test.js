/**
 * #1390 — the observer's DECISIONS, tested without a browser.
 *
 * The wrapper's job is to stop the operator from recording a take that cannot be attributed afterwards.
 * That judgement is pure logic and belongs under test here; only the CDP plumbing needs a browser.
 */
import { describe, it, expect } from 'vitest';
import { readiness, classifyTake, auditEgress } from '../../scripts/human-test/observer.mjs';

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';
const ready = (over = {}) => ({
  release: RELEASE,
  requestedCandidate: 'v4:distil:q4',
  observedCandidate: 'v4:distil:q4',
  identityMatches: true,
  modelStatus: 'ready',
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
  it('CASUALTY: a cloud STT upload is reported', () => {
    const hits = auditEgress([
      { url: 'https://api.assemblyai.com/v2/transcript', method: 'POST', hasPostData: true },
      { url: 'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/config.json', method: 'GET' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toMatch(/assemblyai/);
  });

  it('POSITIVE CONTROL: model asset fetches are NOT egress', () => {
    // Pinned weights must download; flagging them would make the check unusable and it would be turned off.
    expect(auditEgress([
      { url: 'https://huggingface.co/onnx-community/distil-small.en/resolve/main/model.onnx', method: 'GET' },
    ])).toEqual([]);
  });
});
