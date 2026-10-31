// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateId } from '@/services/transcription/candidateRegistry';

type InitResult = { isOk: true; data: undefined } | { isOk: false; error: Error };
type DecodeResult = { isOk: true; data: string } | { isOk: false; error: Error };
type FacadeDouble = {
  checkAvailability: () => Promise<import('@/services/transcription/STTStrategy').AvailabilityResult>;
  grantModelConsent: () => void;
  init: () => Promise<InitResult>;
  terminate: () => Promise<void>;
  transcribe: (audio: Float32Array, options: { final: boolean }) => Promise<DecodeResult>;
  getMetadata: () => { candidateId: CandidateId };
  getExecutionEvidence: () => { runtime: unknown; workerAcquisition: null };
};

const construct = vi.hoisted(() => vi.fn<
  (options: { evaluatorCandidateId: CandidateId }) => FacadeDouble
>());

vi.mock('@/services/transcription/engines/PrivateSTT', () => ({
  PrivateSTT: vi.fn(function (options: { evaluatorCandidateId: CandidateId }) {
    return construct(options);
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function prepare(candidateId: CandidateId) {
  const entered = deferred<void>();
  const decoding = deferred<void>();
  const load = vi.fn<() => Promise<InitResult>>().mockResolvedValue({ isOk: true, data: undefined });
  const decode = vi.fn<FacadeDouble['transcribe']>().mockResolvedValue({ isOk: true, data: candidateId });
  const engine = {
    checkAvailability: vi.fn<FacadeDouble['checkAvailability']>().mockResolvedValue({ isAvailable: true }),
    grantModelConsent: vi.fn(),
    init: vi.fn(() => { entered.resolve(undefined); return load(); }),
    terminate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    transcribe: vi.fn<FacadeDouble['transcribe']>((audio, options) => {
      decoding.resolve(undefined);
      return decode(audio, options);
    }),
    getMetadata: vi.fn(() => ({ candidateId })),
    getExecutionEvidence: vi.fn(() => ({ runtime: { candidateId }, workerAcquisition: null })),
  };
  construct.mockReturnValueOnce(engine);
  return { engine, load, decode, entered: entered.promise, decoding: decoding.promise };
}

async function openHarness() {
  await import('./model-evaluator-local');
  const harness = window.__MODEL_EVALUATOR__;
  if (!harness) throw new Error('Evaluator API missing');
  return harness;
}

const PCM = 'AACAPg=='; // One Float32 sample, 0.25.
const FIRST: CandidateId = 'v2:base.en';
const NEXT: CandidateId = 'v4:base:q4';
let digest: ReturnType<typeof vi.fn<() => Promise<ArrayBuffer>>>;

beforeEach(() => {
  vi.resetModules();
  construct.mockReset();
  vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
  digest = vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(32));
  vi.stubGlobal('crypto', { subtle: { digest } });
});

afterEach(() => {
  delete window.__MODEL_EVALUATOR__;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('model evaluator operation ownership', () => {
  it.each(['CONSENT_REQUIRED', 'CACHE_MISS'] as const)('requires explicit download consent through the shared facade for %s', async (reason) => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    first.engine.checkAvailability.mockResolvedValue({ isAvailable: false, reason });
    await expect(harness.initialize(FIRST, 'wasm')).rejects.toThrow('CONSENT_REQUIRED');
    expect(first.engine.init).not.toHaveBeenCalled();
    expect(first.engine.grantModelConsent).not.toHaveBeenCalled();
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
  });

  it('refuses the checked-in explicit false consent on an uncached Whisper arm', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    first.engine.checkAvailability.mockResolvedValue({ isAvailable: false, reason: 'CACHE_MISS' });
    await expect(harness.initialize(FIRST, 'wasm', false)).rejects.toThrow('CONSENT_REQUIRED');
    expect(first.engine.init).not.toHaveBeenCalled();
    expect(first.engine.grantModelConsent).not.toHaveBeenCalled();
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['CONSENT_REQUIRED', 'CACHE_MISS'] as const)('records explicit download consent before init for %s using the shared facade', async (reason) => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    first.engine.checkAvailability.mockResolvedValue({ isAvailable: false, reason });
    expect(await harness.initialize(FIRST, 'wasm', true)).toMatchObject({ candidateId: FIRST });
    expect(first.engine.grantModelConsent).toHaveBeenCalledTimes(1);
    expect(first.engine.init).toHaveBeenCalledTimes(1);
    expect(first.engine.grantModelConsent.mock.invocationCallOrder[0])
      .toBeLessThan(first.engine.init.mock.invocationCallOrder[0]);
  });
  it('initializes, decodes and retires the selected facade normally', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    expect(await harness.initialize(FIRST, 'wasm')).toMatchObject({ candidateId: FIRST, decodedCount: 0 });
    expect(first.engine.grantModelConsent).not.toHaveBeenCalled();
    expect(await harness.decodePcmBase64(PCM)).toEqual({ transcript: FIRST, inputSha256: '0'.repeat(64) });
    expect(first.engine.transcribe).toHaveBeenCalledWith(new Float32Array([0.25]), { final: true });
    expect(harness.state).toMatchObject({ candidateId: FIRST, decodedCount: 1, lastTranscript: FIRST });
    await harness.dispose();
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
    expect(harness.state).toMatchObject({ candidateId: null, lastTranscript: null, runtime: null });
  });

  it.each(['success', 'failure', 'rejection'] as const)(
    'an older initialization settling with %s cannot retire the newer facade', async (outcome) => {
      const harness = await openHarness();
      const first = prepare(FIRST);
      const load = deferred<InitResult>();
      first.load.mockReturnValueOnce(load.promise);
      // Observe the rejection immediately; its late settlement must not be unhandled.
      const oldResult = harness.initialize(FIRST, 'wasm').then(() => null, (error: unknown) => error);
      await first.entered;
      const next = prepare(NEXT);
      await harness.initialize(NEXT, 'wasm');
      if (outcome === 'success') load.resolve({ isOk: true, data: undefined });
      else if (outcome === 'failure') load.resolve({ isOk: false, error: new Error('old load failed') });
      else load.reject(new Error('old load rejected'));
      expect(await oldResult).toBeInstanceOf(Error);
      expect(first.engine.terminate).toHaveBeenCalledTimes(1);
      expect(next.engine.terminate).not.toHaveBeenCalled();
      expect(harness.state).toMatchObject({ candidateId: NEXT, runtime: { candidateId: NEXT } });
      expect(await harness.decodePcmBase64(PCM)).toMatchObject({ transcript: NEXT });
      await harness.dispose();
    },
  );

  it('dispose rejects late initialization success without publishing ready state', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    const load = deferred<InitResult>();
    first.load.mockReturnValueOnce(load.promise);
    const oldResult = harness.initialize(FIRST, 'wasm').then(() => null, (error: unknown) => error);
    await first.entered;
    await harness.dispose();
    load.resolve({ isOk: true, data: undefined });
    expect(await oldResult).toEqual(expect.objectContaining({ message: expect.stringContaining('superseded') }));
    expect(first.engine.getMetadata).not.toHaveBeenCalled();
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
    expect(harness.state).toMatchObject({ candidateId: null, decodedCount: 0, runtime: null });
  });

  it('detaches immediately and awaits the same release before a newer initialization', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    await harness.initialize(FIRST, 'wasm');
    const release = deferred<void>();
    first.engine.terminate.mockReturnValueOnce(release.promise);
    const disposal = harness.dispose();
    expect(harness.state.candidateId).toBeNull();
    const next = prepare(NEXT);
    const initialization = harness.initialize(NEXT, 'wasm');
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
    expect(next.engine.init).not.toHaveBeenCalled();
    release.resolve(undefined);
    await disposal;
    expect(await initialization).toMatchObject({ candidateId: NEXT });
    expect(next.engine.terminate).not.toHaveBeenCalled();
    await harness.dispose();
  });

  it('only the latest request may initialize after an outstanding release', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    await harness.initialize(FIRST, 'wasm');
    const release = deferred<void>();
    first.engine.terminate.mockReturnValueOnce(release.promise);
    const disposal = harness.dispose();
    const superseded = harness.initialize(FIRST, 'wasm').then(() => null, (error: unknown) => error);
    prepare(NEXT);
    const latest = harness.initialize(NEXT, 'wasm').then(
      (value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }),
    );
    release.resolve(undefined);
    await disposal;
    expect(await superseded).toEqual(expect.objectContaining({ message: expect.stringContaining('superseded') }));
    expect(await latest).toMatchObject({ value: { candidateId: NEXT }, error: null });
    expect(construct).toHaveBeenCalledTimes(2);
    expect(harness.state.candidateId).toBe(NEXT);
    await harness.dispose();
  });

  it('never sends old PCM to a new model when selection changes during hashing', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    await harness.initialize(FIRST, 'wasm');
    const hash = deferred<ArrayBuffer>();
    digest.mockReturnValueOnce(hash.promise);
    const stale = harness.decodePcmBase64(PCM).then(() => null, (error: unknown) => error);
    const next = prepare(NEXT);
    await harness.initialize(NEXT, 'wasm');
    hash.resolve(new ArrayBuffer(32));
    expect(await stale).toEqual(expect.objectContaining({ message: expect.stringContaining('superseded') }));
    expect(first.engine.transcribe).not.toHaveBeenCalled();
    expect(next.engine.transcribe).not.toHaveBeenCalled();
    expect(harness.state).toMatchObject({ candidateId: NEXT, decodedCount: 0, lastTranscript: null });
    await harness.dispose();
  });

  it('rejects hashing completion after disposal without decoding or publishing state', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    await harness.initialize(FIRST, 'wasm');
    const hash = deferred<ArrayBuffer>();
    digest.mockReturnValueOnce(hash.promise);
    const stale = harness.decodePcmBase64(PCM).then(() => null, (error: unknown) => error);
    await harness.dispose();
    hash.resolve(new ArrayBuffer(32));
    expect(await stale).toEqual(expect.objectContaining({ message: expect.stringContaining('superseded') }));
    expect(first.engine.transcribe).not.toHaveBeenCalled();
    expect(harness.state).toMatchObject({ candidateId: null, decodedCount: 0, lastTranscript: null });
  });

  it.each(['success', 'failure'] as const)(
    'rejects stale decode %s after a newer model is ready', async (outcome) => {
      const harness = await openHarness();
      const first = prepare(FIRST);
      await harness.initialize(FIRST, 'wasm');
      const decoded = deferred<DecodeResult>();
      first.decode.mockReturnValueOnce(decoded.promise);
      const stale = harness.decodePcmBase64(PCM).then(() => null, (error: unknown) => error);
      await first.decoding;
      const next = prepare(NEXT);
      await harness.initialize(NEXT, 'wasm');
      decoded.resolve(outcome === 'success'
        ? { isOk: true, data: 'old model transcript' }
        : { isOk: false, error: new Error('old decode failed') });
      expect(await stale).toEqual(expect.objectContaining({ message: expect.stringContaining('superseded') }));
      expect(harness.state).toMatchObject({ candidateId: NEXT, decodedCount: 0,
        lastInputSha256: null, lastTranscript: null, runtime: { candidateId: NEXT } });
      expect(next.engine.transcribe).not.toHaveBeenCalled();
      expect(next.engine.terminate).not.toHaveBeenCalled();
      await harness.dispose();
    },
  );

  it('cleans up a current failed load once and permits a later successful selection', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    first.load.mockResolvedValueOnce({ isOk: false, error: new Error('current load failed') });
    await expect(harness.initialize(FIRST, 'wasm')).rejects.toThrow('current load failed');
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
    expect(harness.state.candidateId).toBeNull();
    prepare(NEXT);
    expect(await harness.initialize(NEXT, 'wasm')).toMatchObject({ candidateId: NEXT });
    await harness.dispose();
  });

  it('blocks further acquisition after release fails instead of retrying an uncertain instance', async () => {
    const harness = await openHarness();
    const first = prepare(FIRST);
    await harness.initialize(FIRST, 'wasm');
    first.engine.terminate.mockRejectedValueOnce(new Error('release uncertain'));
    await expect(harness.dispose()).rejects.toThrow('release uncertain');
    expect(harness.state.candidateId).toBeNull();
    const next = prepare(NEXT);
    await expect(harness.initialize(NEXT, 'wasm')).rejects.toThrow('release uncertain');
    expect(first.engine.terminate).toHaveBeenCalledTimes(1);
    expect(next.engine.init).not.toHaveBeenCalled();
    expect(construct).toHaveBeenCalledTimes(1);
  });
});
