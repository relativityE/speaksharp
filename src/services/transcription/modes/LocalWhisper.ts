import logger from '../../../lib/logger';
import { pipeline, AutomaticSpeechRecognitionPipeline } from '@xenova/transformers';
import { ITranscriptionMode, TranscriptionModeOptions } from './types';
import { MicStream } from '../utils/types';
import { TranscriptUpdate } from '../TranscriptionService';

const HUB_MODEL = 'Xenova/whisper-tiny.en';
const LOCAL_MODEL_PATH = '/models/whisper-tiny.en/';

type Status = 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

interface TranscriptionChunk {
  timestamp: [number, number];
  text: string;
}

export default class LocalWhisper implements ITranscriptionMode {
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number) => void;
  private status: Status;
  private transcript: string;
  private pipe: AutomaticSpeechRecognitionPipeline | null;
  private mic: MicStream | null = null;

  constructor({ onTranscriptUpdate, onModelLoadProgress }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate) {
      throw new Error("onTranscriptUpdate callback is required for LocalWhisper.");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.status = 'idle';
    this.transcript = '';
    this.pipe = null;
    logger.info('[LocalWhisper] Initialized.');
  }

  public async init(): Promise<void> {
    logger.info('[LocalWhisper] Initializing model...');
    this.status = 'loading';

    try {
      logger.info(`[LocalWhisper] Attempting to load model from Hub: ${HUB_MODEL}`);
      this.pipe = await pipeline('automatic-speech-recognition', HUB_MODEL, {
        progress_callback: this.onModelLoadProgress,
      });
      this.status = 'idle';
      logger.info(`[LocalWhisper] Model loaded successfully from Hub: ${HUB_MODEL}.`);
    } catch (hubError: unknown) {
      const errorMessage = hubError instanceof Error ? hubError.message : String(hubError);
      logger.warn(`[LocalWhisper] Failed to load model from Hub. Falling back to local model. Error: ${errorMessage}`);
      try {
        logger.info(`[LocalWhisper] Attempting to load model from local path: ${LOCAL_MODEL_PATH}`);
        this.pipe = await pipeline('automatic-speech-recognition', LOCAL_MODEL_PATH, {
          progress_callback: this.onModelLoadProgress,
        });
        this.status = 'idle';
        logger.info(`[LocalWhisper] Model loaded successfully from local path: ${LOCAL_MODEL_PATH}.`);
      } catch (localError) {
        logger.error({ err: localError }, '[LocalWhisper] CRITICAL: Failed to load model from both Hub and local path.');
        this.status = 'error';
        throw localError;
      }
    }
  }

  public async startTranscription(mic: MicStream): Promise<void> {
    this.mic = mic;
    logger.info('[LocalWhisper] startTranscription() called.');
    if (this.status !== 'idle' || !this.pipe) {
      logger.error('[LocalWhisper] Not ready for transcription.');
      return;
    }
    this.status = 'transcribing';

    const audioData = await this.getAudioData(mic);
    const result = await this.pipe(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
    }) as { text: string; chunks: TranscriptionChunk[] };

    this.transcript = result.text;
    this.onTranscriptUpdate({ transcript: { final: this.transcript }, chunks: result.chunks || [] });
    this.status = 'stopped';
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
