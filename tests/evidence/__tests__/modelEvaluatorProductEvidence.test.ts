// Synthetic receipt/DOM controls only. No browser, model, account or provider is executed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { webcrypto } from 'node:crypto';
import type { Page, Response } from 'playwright';
import { attachProductEvidence, evaluateProductEvidence, type ProductEvidence, type ProductEvidenceBinding } from '../../../scripts/model-evaluator/product-evidence';
import { sha256 } from '../../../scripts/model-evaluator/source-binding';

const session = '11111111-1111-4111-8111-111111111111';
const text = 'synthetic final content';
const source = { head: 'a'.repeat(40), tree: 'b'.repeat(40), lockSha256: 'c'.repeat(64), worktreeSha256: 'd'.repeat(64), files: [] };
const binding: ProductEvidenceBinding = { source, candidateId: 'v2:base.en', backend: 'wasm', journey: 'open_mic', fixtureWavSha256: 'e'.repeat(64) };
const receipt = () => ({ sessionSha256: sha256(session), transcriptSha256: sha256(text) });
const attribution = { attributionStatus: 'verified', engine: 'private', engineVersion: 'private_v2:whisper-base.en', modelName: 'whisper-base.en', deviceType: 'browser' };
const authority = () => ({ sessionSha256: sha256(session), authorityVersion: 'attrib_v1', engineClass: 'private', provider: 'transformers-js',
  engine: attribution.engine, engineVersion: attribution.engineVersion, modelName: attribution.modelName, deviceType: attribution.deviceType });
const identityFields = ['engine', 'engineVersion', 'modelName', 'deviceType'] as const;
const missingIdentityCases = [
  { label: 'all identity fields', fields: identityFields },
  ...identityFields.map(field => ({ label: field, fields: [field] })),
];
function observations(): ProductEvidence {
  return { timeline: { release: source.head, startMs: 10, stopMs: 100, playbackStartMs: 20,
    partials: [{ atMs: 40, sha256: sha256('synthetic partial'), chars: 17 }],
    sessions: [sha256(session)], captures: [sha256('capture')], candidates: ['v2:base.en'], backends: ['wasm'],
    focusChanges: [{ index: 0, status: 'covered', atMs: 50 }], finalFocus: ['covered'], failures: [] },
    completion: [receipt()], persisted: [{ ...receipt(), ...attribution, product: 'open_mic' }], authority: [authority()], reopened: receipt(), failures: [] };
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-runtime-state'); window.history.replaceState({}, '', '/'); });

describe('passive product evidence', () => {
  describe.each(['pending', 'unverified', 'legacy_unknown'])('noncanonical %s authority version', status => {
    it.each(missingIdentityCases)('fails with $label absent', ({ fields }) => {
      const evidence = observations();
      evidence.authority![0].authorityVersion = status;
      for (const field of fields) delete evidence.authority![0][field];
      expect(evaluateProductEvidence(binding, evidence)).toMatchObject({
        verdict: 'FAIL', reasons: expect.arrayContaining(['persisted_authority_invalid']),
      });
    });
  });

  describe.each(['absent', 'verified'])('%s attribution evidence', status => {
    it.each(missingIdentityCases)('holds with $label absent', ({ fields }) => {
      const evidence = observations();
      if (status === 'absent') evidence.authority = [];
      for (const field of fields) delete evidence.persisted[0][field];
      expect(evaluateProductEvidence(binding, evidence)).toMatchObject({
        verdict: 'HOLD', reasons: expect.arrayContaining(['persisted_attribution_unavailable']),
      });
    });
  });

  it.each([
    ['granite:turboctc-q4f16', 'webgpu', 'private_granite', 'ibm-granite/granite-speech-5.0-470m-turboctc'],
    ['parakeet:tdt-v3:int8', 'wasm', 'private_parakeet', 'nvidia/parakeet-tdt-0.6b-v3'],
  ] as const)('binds verified persisted identity to %s rather than browser diagnostics alone', (candidateId, backend, variant, modelName) => {
    const selected = { ...binding, candidateId, backend };
    const evidence = observations();
    evidence.timeline!.candidates = [candidateId]; evidence.timeline!.backends = [backend];
    expect(evaluateProductEvidence(selected, evidence)).toMatchObject({ verdict: 'FAIL', reasons: ['persisted_candidate_identity_mismatch'] });
    Object.assign(evidence.persisted[0], { modelName, engineVersion: `${variant}:${modelName}` });
    Object.assign(evidence.authority![0], { modelName, engineVersion: `${variant}:${modelName}` });
    expect(evaluateProductEvidence(selected, evidence).verdict).toBe('PASS');
    evidence.persisted[0].attributionStatus = 'pending';
    expect(evaluateProductEvidence(selected, evidence).verdict).toBe('PASS');
  });

  it('requires canonical authority regardless of forged or stale legacy status', () => {
    for (const status of ['verified', 'pending', 'unverified', 'legacy_unknown']) {
      const missing = observations(); missing.persisted[0].attributionStatus = status; missing.authority = [];
      expect(evaluateProductEvidence(binding, missing)).toMatchObject({ verdict: 'HOLD', reasons: ['persisted_authority_unavailable'] });
      const valid = observations(); valid.persisted[0].attributionStatus = status;
      expect(evaluateProductEvidence(binding, valid).verdict).toBe('PASS');
    }
    for (const field of ['engine', 'engineVersion', 'modelName', 'deviceType'] as const) {
      const mismatch = observations(); mismatch.persisted[0][field] = 'other';
      expect(evaluateProductEvidence(binding, mismatch)).toMatchObject({ verdict: 'FAIL', reasons: ['persisted_candidate_identity_mismatch'] });
    }
  });
  it.each(['engineClass', 'authorityVersion', 'provider', 'sessionSha256', ...identityFields] as const)('rejects wrong canonical %s', field => {
    const evidence = observations(); evidence.authority![0][field] = 'wrong';
    expect(evaluateProductEvidence(binding, evidence).verdict).toBe('FAIL');
  });
  it('requires actual partial-before-Stop and matching completion, persisted product and reopened content', () => {
    expect(evaluateProductEvidence(binding, observations()).verdict).toBe('PASS');
    const missing = observations(); missing.timeline!.partials = [{ atMs: 110, sha256: sha256('late final'), chars: 10 }];
    expect(evaluateProductEvidence(binding, missing)).toMatchObject({ verdict: 'HOLD', reasons: ['partial_before_stop_unproven'] });
    const wrong = observations(); wrong.reopened!.transcriptSha256 = sha256('wrong final');
    expect(evaluateProductEvidence(binding, wrong)).toMatchObject({ verdict: 'FAIL', reasons: ['saved_content_or_session_mismatch'] });
    const absent = observations(); absent.persisted = [];
    expect(evaluateProductEvidence(binding, absent)).toMatchObject({ verdict: 'HOLD', reasons: ['persisted_transcript_unavailable'] });
  });

  it('rejects wrong model/backend, stale release, capture substitution and another session', () => {
    const wrong = observations(); wrong.timeline!.candidates = ['parakeet:tdt-v3:int8']; wrong.timeline!.backends = ['webgpu'];
    wrong.timeline!.release = 'f'.repeat(40); wrong.timeline!.captures.push(sha256('successor capture'));
    wrong.completion[0].sessionSha256 = sha256('another take');
    const result = evaluateProductEvidence(binding, wrong);
    expect(result.verdict).toBe('FAIL');
    expect(result.reasons).toEqual(expect.arrayContaining(['product_release_mismatch', 'take_or_capture_changed',
      'product_model_or_backend_mismatch', 'completion_not_recorded_take']));
  });

  it('Focus needs per-point live timing, final statuses and persisted Focus product; Stop-only detection fails', () => {
    const focus: ProductEvidenceBinding = { ...binding, journey: 'focus_points',
      focus: [{ index: 0, expected: 'covered', audioWindowMs: [0, 50] }] };
    const evidence = observations(); evidence.persisted[0].product = 'focus_points';
    expect(evaluateProductEvidence(focus, evidence).verdict).toBe('PASS');
    evidence.timeline!.focusChanges[0].atMs = 110;
    expect(evaluateProductEvidence(focus, evidence)).toMatchObject({ verdict: 'FAIL', reasons: ['focus_live_outside_window:0'] });
    evidence.timeline!.focusChanges[0].atMs = 50; evidence.persisted[0].product = 'open_mic';
    expect(evaluateProductEvidence(focus, evidence)).toMatchObject({ verdict: 'FAIL', reasons: ['persisted_product_mismatch'] });
  });

  it('collects real jsdom mutations and response objects passively, hashes content and removes its listener', async () => {
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('__APP_RELEASE__', source.head);
    vi.stubGlobal('__SPEECH_RUNTIME_DEBUG__', () => ({ sessionId: session }));
    vi.stubGlobal('__PRIVATE_CAPTURE_RECEIPT__', () => ({ captureId: 'capture', candidateId: 'v2:base.en', active: true }));
    vi.stubGlobal('__PRIVATE_STT_RUNTIME_DEBUG__', { runtime: 'wasm-singlethread' });
    document.body.innerHTML = '<main data-testid="session-shell" data-session-state="before"><span data-testid="live-interim"></span></main>';
    const events = new EventEmitter();
    const page = Object.assign(events, { evaluate: async <A, R>(fn: (arg: A) => R, arg: A) => fn(arg) }) as unknown as Page;
    const collector = await attachProductEvidence(page, binding, 'https://api.example.invalid');
    document.documentElement.setAttribute('data-runtime-state', 'RECORDING');
    document.querySelector('[data-testid="session-shell"]')!.setAttribute('data-session-state', 'during');
    document.querySelector('[data-testid="live-interim"]')!.textContent = 'private synthetic interim';
    await new Promise(resolve => setTimeout(resolve, 0));
    document.documentElement.setAttribute('data-runtime-state', 'STOPPING');
    await new Promise(resolve => setTimeout(resolve, 0));
    events.emit('response', { url: () => 'https://api.example.invalid/rest/v1/rpc/complete_session_v2', ok: () => true,
      request: () => ({ method: () => 'POST', postDataJSON: () => ({ p_status: 'completed', p_session_id: session, p_final_transcript: text }) }) } as unknown as Response);
    await collector.freezeTake();
    const unrelatedHistory = vi.fn(async () => [{ id: 'unrelated', transcript: 'private unrelated history' }]);
    events.emit('response', { url: () => 'https://api.example.invalid/rest/v1/sessions?select=*', ok: () => true,
      request: () => ({ method: () => 'GET' }), json: unrelatedHistory } as unknown as Response);
    events.emit('response', { url: () => 'https://api.example.invalid/rest/v1/sessions?id=eq.' + session, ok: () => true,
      request: () => ({ method: () => 'GET' }), json: async () => [{ id: session, transcript: text, product: 'open_mic',
        attribution_status: 'verified', engine: 'private', engine_version: 'private_v2:whisper-base.en', model_name: 'whisper-base.en', device_type: 'browser' }] } as unknown as Response);
    events.emit('response', { url: () => 'https://api.example.invalid/rest/v1/session_attribution_authority?session_id=eq.' + session, ok: () => true,
      request: () => ({ method: () => 'GET' }), json: async () => [{ session_id: session, authority_version: 'attrib_v1', engine_class: 'private',
        engine: 'private', engine_version: 'private_v2:whisper-base.en', model_id: 'whisper-base.en', provider: 'transformers-js', resolved_device: 'browser' }] } as unknown as Response);
    window.history.replaceState({}, '', '/progress/' + session);
    // Repository setup replaces location with a static navigation double; advance its observed route too.
    vi.stubGlobal('location', { ...window.location, pathname: '/progress/' + session });
    document.body.innerHTML = '<div data-testid="session-detail-transcript"></div>';
    Object.defineProperty(document.querySelector('[data-testid="session-detail-transcript"]'), 'innerText', { value: text });
    await collector.observeReopened();
    const report = await collector.finish();
    expect(report.productProof.reasons).toEqual([]);
    expect(report.productProof.verdict).toBe('PASS');
    expect(report.evidence.persisted[0]).toMatchObject(attribution);
    expect(report.evidence.timeline!.partials[0].sha256).toBe(sha256('private synthetic interim'));
    expect(JSON.stringify(report)).not.toContain('private synthetic interim');
    expect(JSON.stringify(report)).not.toContain(text);
    expect(events.listenerCount('response')).toBe(0);
    expect(unrelatedHistory).not.toHaveBeenCalled();
  });
});
