/** Dev-server-only PCM seam. This HTML is not a Vite production build input. */
import { TransformersJSV4Engine } from '@/services/transcription/engines/TransformersJSV4Engine';
import { MoonshineStreamingEngine } from '@/services/transcription/engines/MoonshineStreamingEngine';
import { CANDIDATES, type CandidateId } from '@/services/transcription/candidateRegistry';
import type { TranscriptionModeOptions } from '@/services/transcription/modes/types';

type ArmId = 'v4:base:q4' | 'v4:distil:q4' | 'moonshine:streaming-medium';
type Engine = TransformersJSV4Engine | MoonshineStreamingEngine;

type HarnessState = {
  candidateId: ArmId | null;
  decodedCount: number;
  lastInputSha256: string | null;
  lastTranscript: string | null;
  runtime: unknown;
};

declare global {
  interface Window {
    __MODEL_EVALUATOR__?: {
      initialize: (candidateId: ArmId) => Promise<HarnessState>;
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
};
let engine: Engine | null = null;

async function dispose(): Promise<void> {
  await engine?.terminate();
  engine = null;
  state.candidateId = null;
  state.lastInputSha256 = null;
  state.lastTranscript = null;
  state.runtime = null;
}

async function initialize(candidateId: ArmId): Promise<HarnessState> {
  if (!(['v4:base:q4', 'v4:distil:q4', 'moonshine:streaming-medium'] as string[]).includes(candidateId)) {
    throw new Error(`unsupported model evaluator candidate: ${candidateId}`);
  }
  if (engine) await dispose();
  const candidate = CANDIDATES[candidateId as CandidateId];
  if (candidate.engine === 'transformers-js-v4') {
    const v4Variant = candidateId === 'v4:distil:q4' ? 'distil_q4' : 'base_q4';
    const options: TranscriptionModeOptions & { v4Variant: typeof v4Variant } = {
      v4Variant, onTranscriptUpdate: () => {}, onReady: () => {},
    };
    engine = new TransformersJSV4Engine(options);
  } else {
    engine = new MoonshineStreamingEngine({
      candidateId: 'moonshine:streaming-medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    });
  }
  const result = await engine.init();
  if (!result.isOk) throw result.error;
  state.candidateId = candidateId;
  state.decodedCount = 0;
  state.runtime = candidate.engine === 'transformers-js-v4'
    ? (window as unknown as { __PRIVATE_V4_RUNTIME__?: unknown }).__PRIVATE_V4_RUNTIME__ ?? null
    : (engine as MoonshineStreamingEngine).getMetadata();
  return { ...state };
}

async function decodePcmBase64(value: string): Promise<{ transcript: string; inputSha256: string }> {
  if (!engine || !state.candidateId) throw new Error('evaluator engine is not initialized');
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.byteLength % 4 !== 0) throw new Error('invalid Float32 PCM payload');
  const pcm = new Float32Array(bytes.buffer);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  const inputSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const result = engine instanceof MoonshineStreamingEngine
    ? await engine.transcribe(pcm, { final: true })
    : await engine.transcribe(pcm);
  if (!result.isOk) throw result.error;
  state.decodedCount += 1;
  state.lastInputSha256 = inputSha256;
  state.lastTranscript = result.data;
  return { transcript: result.data, inputSha256 };
}

window.__MODEL_EVALUATOR__ = { initialize, decodePcmBase64, dispose, state };
