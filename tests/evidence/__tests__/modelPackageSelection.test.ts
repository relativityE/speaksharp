import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { candidateFromPackage, sealModelPackage } from '../../../frontend/src/services/transcription/modelPackage';
import {
  clearRuntimeCandidateOverride, registerSwitchExecutor, runtimeCandidateOverride, switchCandidate,
} from '../../../frontend/src/services/transcription/runtimeCandidateSwitch';

beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => {
  registerSwitchExecutor(null);
  clearRuntimeCandidateOverride();
  vi.unstubAllEnvs();
});

/** A fourth package that reuses the installed v2 Whisper adapter; only data is new. */
async function fourthCandidate() {
  const base = CANDIDATES['v2:base.en'];
  const pkg = await sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'selection:fourth-whisper',
    engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
    execution: { ...base.execution, localModelId: 'selection-fourth-whisper' },
    assets: { servedFrom: '/models/selection-fourth-whisper',
      files: base.assets.files!.map(f => ({ ...f, url: '/models/selection-fourth-whisper/' + f.path })) },
    license: 'MIT (fixture declaration; no new model copied)' });
  return candidateFromPackage(pkg, 'fourth.json');
}

function executor() {
  const calls: string[] = [];
  registerSwitchExecutor({
    currentState: () => 'READY',
    teardown: async () => { calls.push('teardown'); },
    initialize: async () => { calls.push(`initialize:${runtimeCandidateOverride()}`); },
    observedCandidate: () => runtimeCandidateOverride(),
  });
  return calls;
}

describe('a fourth compatible package reaches selection through data alone', () => {
  it('is selected on an internal build through the existing adapter, with no catalogue or engine edit', async () => {
    vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
    const fourth = await fourthCandidate();
    expect(CANDIDATES[fourth.id]).toBeUndefined();
    expect(fourth.engine).toBe(CANDIDATES['v2:base.en'].engine);
    const calls = executor();
    const outcome = await switchCandidate(fourth.id, { ...CANDIDATES, [fourth.id]: fourth });
    expect(outcome).toEqual({ ok: true, candidate: fourth.id });
    expect(runtimeCandidateOverride()).toBe(fourth.id);
    expect(calls).toEqual(['teardown', `initialize:${fourth.id}`]);
  });

  it('cannot be selected in a production build: it is unqualified and outside the signed comparison', async () => {
    vi.stubEnv('VITE_INTERNAL_BUILD', '');
    const fourth = await fourthCandidate();
    const calls = executor();
    const outcome = await switchCandidate(fourth.id, { ...CANDIDATES, [fourth.id]: fourth });
    expect(outcome).toMatchObject({ ok: false, code: 'not_armed' });
    expect(fourth.comparisonReady).toBe(false);
    expect(fourth.activationReady).toBe(false);
    expect(runtimeCandidateOverride()).toBeNull();
    expect(calls).toEqual([]);
  });
});
