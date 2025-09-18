import { ITranscriptionMode, TranscriptionModeOptions, Transcript } from './types';
import { MicStream } from '../utils/types';

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
  private socket: WebSocket | null = null;
  private mic: MicStream | null = null;
  private frameHandler: (frame: Float32Array) => void;
  private firstPacketSent: boolean = false;

  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate || !onReady || !getAssemblyAIToken) {
      throw new Error("Missing required options for CloudAssemblyAI");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken;
    this.frameHandler = this._handleAudioFrame.bind(this);
  }

  public async init(): Promise<void> {
    // Initialization logic is handled in startTranscription where the token is fetched.
    console.log('[CloudAssemblyAI] Initialized.');
  }

  public async startTranscription(mic: MicStream): Promise<void> {
    if (!mic || typeof mic.onFrame !== 'function') {
      throw new Error("A valid MicStream object with an onFrame method is required.");
    }
    this.mic = mic;
    console.log('[CloudAssemblyAI] Starting transcription...');

    try {
      console.log('[CloudAssemblyAI] Requesting AssemblyAI token...');
      const token = await this._getAssemblyAIToken();
      if (!token) {
        throw new Error("Failed to retrieve AssemblyAI token.");
      }
      console.log('[CloudAssemblyAI] Token received.');

      const url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${mic.sampleRate}&token=${token}&format_turns=true`;
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        console.log('✅ [CloudAssemblyAI] WebSocket connected to AssemblyAI.');
        this.onReady();
        this.mic?.onFrame(this.frameHandler);
      };

      this.socket.onmessage = (event: MessageEvent<string>) => {
        const data: AssemblyAIMessage = JSON.parse(event.data);
        console.log('[CloudAssemblyAI] Received message:', data);

        if (data.transcript) {
          if (data.turn_is_formatted && data.end_of_turn) {
            this.onTranscriptUpdate({ transcript: { final: data.transcript }, words: data.words || [] });
          } else {
            this.onTranscriptUpdate({ transcript: { partial: data.transcript } });
          }
        }
      };

      this.socket.onerror = (error) => {
        console.error('❌ [CloudAssemblyAI] WebSocket error:', error);
        this.stopTranscription();
      };

      this.socket.onclose = (event) => {
        console.log(`🔌 [CloudAssemblyAI] WebSocket closed: ${event.code} ${event.reason}`);
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
      console.log('[CloudAssemblyAI] Sent first audio packet.');
      this.firstPacketSent = true;
    }
  }

  public async stopTranscription(): Promise<string> {
    console.log('[CloudAssemblyAI] Stopping transcription...');
    if (this.mic) {
      this.mic.offFrame(this.frameHandler);
      console.log('[CloudAssemblyAI] Mic frame handler removed.');
      this.mic = null;
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      console.log('[CloudAssemblyAI] Sending termination message.');
      // AssemblyAI v3 doesn't use a 'Terminate' message like v2.
      // Simply closing the socket is sufficient.
      this.socket.close(1000);
    } else {
      console.log('[CloudAssemblyAI] No active socket to stop.');
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
