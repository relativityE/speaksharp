/** Dev-server-only PCM seam. This HTML is not a Vite production build input. */
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';
import { CANDIDATES, type CandidateId } from '@/services/transcription/candidateRegistry';

type ArmId = CandidateId;

type HarnessState = {
  candidateId: ArmId | null;
  decodedCount: number;
  lastInputSha256: string | null;
  lastTranscript: string | null;
  runtime: unknown;
  workerAcquisition: unknown;
};

declare global {
  interface Window {
    __MODEL_EVALUATOR__?: {
      initialize: (candidateId: ArmId, backend: 'wasm' | 'webgpu') => Promise<HarnessState>;
      decodePcmBase64: (value: string) => Promise<{ transcript: string; inputSha256: string }>;
      dispose: () => Promise<void>;
      state: HarnessState;
    };
  }
}

if (import.meta.env.VITE_INTERNAL_BUILD !== 'true') {
  throw new Error('model evaluator page requires VITE_INTERNAL_BUILD=true');
}

const state: HarnessState = {
  candidateId: null, decodedCount: 0, lastInputSha256: null, lastTranscript: null, runtime: null,
  workerAcquisition: null,
};
let engine: PrivateSTT | null = null;
let generation = 0;
// A newer initialization must await release, including a failed/uncertain release.
let retirement: Promise<void> = Promise.resolve();

function retireCurrentEngine(): Promise<void> {
  const retiring = engine;
  engine = null;
  state.candidateId = null;
  state.decodedCount = 0;
  state.lastInputSha256 = null;
  state.lastTranscript = null;
  state.runtime = null;
  state.workerAcquisition = null;
  if (retiring) {
    retirement = Promise.all([retirement, retiring.terminate()]).then(() => undefined);
  }
  return retirement;
}

function assertCurrentEngine(selected: PrivateSTT, selectedGeneration: number): void {
  if (generation !== selectedGeneration || engine !== selected) {
    throw new Error('evaluator operation superseded');
  }
}

async function dispose(): Promise<void> {
  generation++;
  await retireCurrentEngine();
}

async function initialize(candidateId: ArmId, backend: 'wasm' | 'webgpu'): Promise<HarnessState> {
  if (!Object.prototype.hasOwnProperty.call(CANDIDATES, candidateId)) {
    throw new Error(`unsupported model evaluator candidate: ${candidateId}`);
  }
  const candidate = CANDIDATES[candidateId];
  if ((backend !== 'wasm' && backend !== 'webgpu') ||
      (candidate.model.device === 'wasm' && backend !== 'wasm')) {
    throw new Error('unsupported model evaluator backend');
  }
  const selectedGeneration = ++generation;
  await retireCurrentEngine();
  if (generation !== selectedGeneration) throw new Error('evaluator initialization superseded');
  const selected = new PrivateSTT({
    evaluatorCandidateId: candidateId, evaluatorBackend: backend,
    onTranscriptUpdate: () => {}, onReady: () => {},
  });
  engine = selected;
  try {
    const result = await selected.init();
    assertCurrentEngine(selected, selectedGeneration);
    if (!result.isOk) throw result.error;
    if (selected.getMetadata().candidateId !== candidateId) throw new Error('Facade initialized a different candidate');
    const evidence = selected.getExecutionEvidence();
    state.candidateId = candidateId;
    state.decodedCount = 0;
    state.runtime = evidence.runtime;
    state.workerAcquisition = evidence.workerAcquisition;
    return { ...state };
  } catch (error) {
    // A later initialize/dispose already owns a superseded instance's release.
    if (generation === selectedGeneration && engine === selected) await retireCurrentEngine();
    throw error;
  }
}

async function decodePcmBase64(value: string): Promise<{ transcript: string; inputSha256: string }> {
  const selected = engine;
  const candidateId = state.candidateId;
  const selectedGeneration = generation;
  if (!selected || !candidateId) throw new Error('evaluator engine is not initialized');
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.byteLength % 4 !== 0) throw new Error('invalid Float32 PCM payload');
  const pcm = new Float32Array(bytes.buffer);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  assertCurrentEngine(selected, selectedGeneration);
  if (state.candidateId !== candidateId) throw new Error('evaluator candidate changed before decode');
  const inputSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const result = await selected.transcribe(pcm, { final: true });
  assertCurrentEngine(selected, selectedGeneration);
  if (state.candidateId !== candidateId) throw new Error('evaluator candidate changed during decode');
  if (!result.isOk) throw result.error;
  state.decodedCount += 1;
  state.lastInputSha256 = inputSha256;
  state.lastTranscript = result.data;
  return { transcript: result.data, inputSha256 };
}

window.__MODEL_EVALUATOR__ = { initialize, decodePcmBase64, dispose, state };
