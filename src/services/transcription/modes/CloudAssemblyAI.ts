import type { ITranscriptionMode, TranscriptionModeOptions, Transcript } from './types';
import type { MicStream } from '../utils/types';
import logger from '../../../lib/logger';

// Type definitions for AssemblyAI WebSocket messages
interface AssemblyAIWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

interface AssemblyAIMessage {
  transcript: string;
  turn_is_formatted?: boolean;
  end_of_turn?: boolean;
  words?: AssemblyAIWord[];
}

export default class CloudAssemblyAI implements ITranscriptionMode {
  private onTranscriptUpdate: (update: { transcript: Transcript; words?: AssemblyAIWord[] }) => void;
  private onReady: () => void;
  private _getAssemblyAIToken: () => Promise<string | null>;
  private customVocabulary: string[];
  private socket: WebSocket | null = null;
  private mic: MicStream | null = null;
  private frameHandler: (frame: Float32Array) => void;
  private firstPacketSent: boolean = false;

  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken, customVocabulary = [] }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate || !onReady || !getAssemblyAIToken) {
      throw new Error("Missing required options for CloudAssemblyAI");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.frameHandler = this._handleAudioFrame.bind(this);
  }

  public async init(): Promise<void> {
    // Initialization logic is handled in startTranscription where the token is fetched.
  }

  public async startTranscription(mic: MicStream): Promise<void> {
    if (!mic || typeof mic.onFrame !== 'function') {
      throw new Error("A valid MicStream object with an onFrame method is required.");
    }
    this.mic = mic;

    try {
      const token = await this._getAssemblyAIToken();
      if (!token) {
        throw new Error("Failed to retrieve AssemblyAI token.");
      }

      // Build WebSocket URL with optional boost_param for custom vocabulary
      let url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${mic.sampleRate}&token=${token}&format_turns=true&speaker_labels=true`;
      if (this.customVocabulary.length > 0) {
        const boostParam = this.customVocabulary.join(',');
        url += `&boost_param=${encodeURIComponent(boostParam)}`;
      }
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        logger.info('[CloudAssemblyAI] WebSocket connected - calling onReady() and starting audio frame handler');
        this.onReady();
        this.mic?.onFrame(this.frameHandler);
      };

      this.socket.onmessage = (event: MessageEvent<string>) => {
        const data: AssemblyAIMessage = JSON.parse(event.data);
        logger.info({ data }, '[CloudAssemblyAI] WebSocket message received');

        if (data.transcript) {
          if (data.turn_is_formatted && data.end_of_turn) {
            logger.info({ transcript: data.transcript }, '[CloudAssemblyAI] Final transcript');
            this.onTranscriptUpdate({ transcript: { final: data.transcript }, words: data.words || [] });
          } else {
            logger.info({ transcript: data.transcript }, '[CloudAssemblyAI] Partial transcript');
            this.onTranscriptUpdate({ transcript: { partial: data.transcript } });
          }
        }
      };

      this.socket.onerror = (error) => {
        console.error('❌ [CloudAssemblyAI] WebSocket error:', error);
        this.stopTranscription();
      };

      this.socket.onclose = () => {
        this.socket = null;
        this.mic?.offFrame(this.frameHandler);
      };

    } catch (error) {
      console.error('❌ [CloudAssemblyAI] Error starting cloud transcription:', error);
      throw error;
    }
  }

  private _handleAudioFrame(float32Array: Float32Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
    }

    this.socket.send(int16Array.buffer);

    if (!this.firstPacketSent) {
      this.firstPacketSent = true;
      logger.info({ audioFrameLength: float32Array.length }, '[CloudAssemblyAI] First audio packet sent to WebSocket');
    }
  }

  public async stopTranscription(): Promise<string> {
    if (this.mic) {
      this.mic.offFrame(this.frameHandler);
      this.mic = null;
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // AssemblyAI v3 doesn't use a 'Terminate' message like v2.
      // Simply closing the socket is sufficient.
      this.socket.close(1000);
    }
    this.socket = null;
    this.firstPacketSent = false;
    return ""; // This mode does not maintain a full transcript itself
  }

  public async getTranscript(): Promise<string> {
    // This mode is event-driven and does not store the full transcript.
    // The parent service is responsible for aggregating the final transcript parts.
    return "";
  }
}
