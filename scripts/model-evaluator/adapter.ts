import type { ModelIdentity } from '../../tests/evidence/modelEvaluator';

/** A model-specific adapter. The runner owns clip loading and timing; adapters own only execution. */
export interface ModelAdapter {
  initialize(): Promise<ModelIdentity>;
  decode(pcm16k: Float32Array): Promise<void>;
  finalize(): Promise<{ transcript: string; inputSha256: string }>;
  dispose(): Promise<void>;
}

export interface AdapterContext {
  baseUrl: string;
  expected: ModelIdentity;
  repositoryRoot: string;
  options: Record<string, unknown>;
}

export type AdapterFactory = (context: AdapterContext) => ModelAdapter;
