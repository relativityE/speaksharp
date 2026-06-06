import { TransformersJSEngine } from '@/services/transcription/engines/TransformersJSEngine';
import logger from '@/lib/logger';

type DropInEvent = {
  t: number;
  event: string;
  detail?: Record<string, unknown>;
};

type DropInState = {
  events: DropInEvent[];
  status: string;
  transcript: string;
  sampleRate: number | null;
  capturedSamples: number;
  capturedSeconds: number;
  modelReady: boolean;
  recording: boolean;
};

declare global {
  interface Window {
    __PRIVATE_DROPIN__?: DropInState & {
      initModel: () => Promise<void>;
      startCapture: () => Promise<void>;
      stopAndTranscribe: () => Promise<string>;
    };
  }
}

const state: DropInState = {
  events: [],
  status: 'idle',
  transcript: '',
  sampleRate: null,
  capturedSamples: 0,
  capturedSeconds: 0,
  modelReady: false,
  recording: false,
};

const engine = new TransformersJSEngine();
const chunks: Float32Array[] = [];
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function render(): void {
  document.querySelector<HTMLElement>('#status')!.textContent = state.status;
  document.querySelector<HTMLElement>('#transcript')!.textContent = state.transcript;
  document.querySelector<HTMLElement>('#events')!.textContent = JSON.stringify(state.events, null, 2);
}

function log(event: string, detail: Record<string, unknown> = {}): void {
  const entry = {
    t: Number(performance.now().toFixed(1)),
    event,
    detail,
  };
  state.events.push(entry);
  logger.info({ entry }, '[PRIVATE_DROPIN]');
  render();
}

function mergeChunks(): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * toRate / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = (input.length - 1) / Math.max(1, outputLength - 1);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const weight = sourceIndex - leftIndex;
    output[index] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight;
  }
  return output;
}

async function initModel(): Promise<void> {
  if (state.modelReady) return;
  state.status = 'loading model';
  log('model:init:start');
  const result = await engine.init();
  if (!result.isOk) {
    state.status = `model error: ${result.error.message}`;
    log('model:init:error', { error: result.error.message });
    throw result.error;
  }
  state.modelReady = true;
  state.status = 'model ready';
  log('model:init:ready');
}

async function startCapture(): Promise<void> {
  await initModel();
  if (state.recording) return;

  chunks.length = 0;
  state.transcript = '';
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  audioContext = new AudioContext();
  state.sampleRate = audioContext.sampleRate;
  sourceNode = audioContext.createMediaStreamSource(stream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  processorNode.onaudioprocess = (event) => {
    if (!state.recording) return;
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);
  state.recording = true;
  state.status = 'recording';
  log('capture:start', {
    sampleRate: state.sampleRate,
    userAgent: navigator.userAgent,
  });
}

async function stopAndTranscribe(): Promise<string> {
  if (!state.recording) return state.transcript;
  state.recording = false;
  state.status = 'stopping';
  log('capture:stop:start', { chunks: chunks.length });

  processorNode?.disconnect();
  sourceNode?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close();

  const input = mergeChunks();
  const sourceRate = state.sampleRate ?? 48_000;
  const audio16k = resampleLinear(input, sourceRate, 16_000);
  state.capturedSamples = audio16k.length;
  state.capturedSeconds = audio16k.length / 16_000;
  state.status = 'transcribing';
  log('transcribe:start', {
    sourceSamples: input.length,
    sourceRate,
    samples16k: audio16k.length,
    seconds: Number(state.capturedSeconds.toFixed(3)),
  });

  const result = await engine.transcribe(audio16k);
  if (!result.isOk) {
    state.status = `transcribe error: ${result.error.message}`;
    log('transcribe:error', { error: result.error.message });
    throw result.error;
  }

  state.transcript = compact(result.data);
  state.status = 'done';
  log('transcribe:done', {
    transcriptLength: state.transcript.length,
    transcript: state.transcript,
  });
  return state.transcript;
}

window.__PRIVATE_DROPIN__ = Object.assign(state, {
  initModel,
  startCapture,
  stopAndTranscribe,
});

document.querySelector<HTMLButtonElement>('#init')!.addEventListener('click', () => {
  void initModel();
});
document.querySelector<HTMLButtonElement>('#start')!.addEventListener('click', () => {
  void startCapture();
});
document.querySelector<HTMLButtonElement>('#stop')!.addEventListener('click', () => {
  void stopAndTranscribe();
});

render();
