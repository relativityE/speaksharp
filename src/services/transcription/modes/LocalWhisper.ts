import logger from '../../../lib/logger';
import { SessionManager, AvailableModels, InferenceSession } from 'whisper-turbo';
import { ITranscriptionMode, TranscriptionModeOptions } from './types';
import { MicStream } from '../utils/types';
import { TranscriptUpdate } from '../TranscriptionService';

// Helper to convert Float32Array to WAV Uint8Array
function floatToWav(samples: Float32Array, sampleRate: number = 16000): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true); // NumChannels (1 for mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write samples (convert Float32 to Int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

type Status = 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

export default class LocalWhisper implements ITranscriptionMode {
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number) => void;
  private onReady?: () => void;
  private status: Status;
  private transcript: string;
  private session: InferenceSession | null;
  private mic: MicStream | null = null;
  private manager: SessionManager;

  constructor({ onTranscriptUpdate, onModelLoadProgress, onReady }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate) {
      throw new Error("onTranscriptUpdate callback is required for LocalWhisper.");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.status = 'idle';
    this.transcript = '';
    this.session = null;
    this.manager = new SessionManager();
    logger.info('[LocalWhisper] Initialized (whisper-turbo backend).');
  }

  public async init(): Promise<void> {
    logger.info('[LocalWhisper] Initializing model...');
    this.status = 'loading';

    try {
      logger.info(`[LocalWhisper] Loading model: ${AvailableModels.WHISPER_TINY}`);

      // Trigger initial progress to ensure UI shows "Downloading..." immediately
      if (this.onModelLoadProgress) {
        this.onModelLoadProgress(0);
      }

      const result = await this.manager.loadModel(
        AvailableModels.WHISPER_TINY,
        () => {
          logger.info('[LocalWhisper] Model loaded callback triggered.');
        },
        (progress: number) => {
          if (this.onModelLoadProgress) {
            this.onModelLoadProgress(progress);
          }
        }
      );

      if (result.isErr) {
        throw result.error;
      }

      this.session = result.value;
      this.status = 'idle';
      logger.info('[LocalWhisper] Model loaded successfully.');

      // Notify that the service is ready
      if (this.onReady) {
        this.onReady();
      }
    } catch (error) {
      logger.error({ err: error }, '[LocalWhisper] Failed to load model.');
      this.status = 'error';
      throw error;
    }
  }

  public async startTranscription(mic: MicStream): Promise<void> {
    this.mic = mic;
    logger.info('[LocalWhisper] startTranscription() called.');
    if (this.status !== 'idle' || !this.session) {
      logger.error('[LocalWhisper] Not ready for transcription.');
      return;
    }
    this.status = 'transcribing';

    // Record for 5 seconds (matching original LocalWhisper behavior)
    const audioData = await this.getAudioData(mic);
    const wavData = floatToWav(audioData);

    logger.info(`[LocalWhisper] Transcribing ${audioData.length} samples...`);

    try {
      // Perform transcription without callback to ensure we get the full result object
      const result = await this.session.transcribe(wavData, false, {});

      if (result.isErr) {
        throw result.error;
      }

      // The result value contains the full text
      const text = result.value.text || '';
      this.transcript = text;

      this.onTranscriptUpdate({ transcript: { final: this.transcript } });
      logger.info({ textLength: this.transcript.length }, '[LocalWhisper] Transcription complete.');

    } catch (err) {
      logger.error({ err }, '[LocalWhisper] Transcription failed.');
    } finally {
      this.status = 'stopped';
    }
  }

  private async getAudioData(mic: MicStream, duration: number = 5000): Promise<Float32Array> {
    return new Promise(resolve => {
      const frames: Float32Array[] = [];
      const frameHandler = (frame: Float32Array) => {
        frames.push(frame.slice(0));
      };
      mic.onFrame(frameHandler);

      setTimeout(() => {
        mic.offFrame(frameHandler);
        const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
        const concatenated = new Float32Array(totalLength);
        let offset = 0;
        for (const frame of frames) {
          concatenated.set(frame, offset);
          offset += frame.length;
        }
        resolve(concatenated);
      }, duration);
    });
  }

  public async stopTranscription(): Promise<string> {
    logger.info('[LocalWhisper] stopTranscription() called.');
    this.status = 'stopped';
    this.mic = null;
    return this.transcript;
  }

  public async getTranscript(): Promise<string> {
    return this.transcript;
  }
}
