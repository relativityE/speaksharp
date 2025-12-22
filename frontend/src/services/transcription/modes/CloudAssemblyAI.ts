import type { ITranscriptionMode, TranscriptionModeOptions, Transcript } from './types';
import { TranscriptionError } from './types';
import type { MicStream } from '../utils/types';
import { floatToInt16 } from '../utils/AudioProcessor';
import logger from '../../../lib/logger';

// Type definitions for AssemblyAI WebSocket messages
interface AssemblyAIWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

interface AssemblyAIMessage {
  type: 'Begin' | 'Turn' | 'Termination';
  transcript?: string;
  turn_is_formatted?: boolean;
  words?: AssemblyAIWord[];
  session_id?: string;
  id?: string;
  expires_at?: number;
  audio_start?: number;
  audio_end?: number;
  confidence?: number;
  created?: string;
}

// Connection state for WebSocket
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'error';

export default class CloudAssemblyAI implements ITranscriptionMode {
  private onTranscriptUpdate: (update: { transcript: Transcript; words?: AssemblyAIWord[] }) => void;
  private onReady: () => void;
  private _getAssemblyAIToken: () => Promise<string | null>;
  private customVocabulary: string[];
  private socket: WebSocket | null = null;
  private mic: MicStream | null = null;
  private frameHandler: (frame: Float32Array) => void;
  private firstPacketSent: boolean = false;
  private audioBuffer: Int16Array = new Int16Array(0);
  private readonly MIN_SAMPLES = 800; // 50ms at 16kHz (AssemblyAI minimum)

  // Reconnection logic
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs = 30000; // 30 seconds
  private connectionState: ConnectionState = 'disconnected';
  private onConnectionStateChange?: (state: ConnectionState) => void;
  private onError?: (error: TranscriptionError) => void;
  private isManualStop = false; // Track if stop was intentional

  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken, customVocabulary = [], onConnectionStateChange, onError }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate || !onReady || !getAssemblyAIToken) {
      throw new Error("Missing required options for CloudAssemblyAI");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onError = onError;
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
      console.log('[AssemblyAI] 🔄 Starting Cloud STT connection...');
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
      logger.info({ url: url.replace(/token=[^&]+/, 'token=REDACTED') }, '[CloudAssemblyAI] Creating WebSocket connection');
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        logger.info({ readyState: this.socket?.readyState }, '[CloudAssemblyAI] WebSocket OPEN event');
        this.reconnectAttempts = 0; // Reset reconnect counter on successful connection
        this.startHeartbeat(); // Start heartbeat
        this.updateConnectionState('connected'); // Update state
        this.onReady();
        this.mic?.onFrame(this.frameHandler);
      };

      this.socket.onmessage = (event: MessageEvent<string>) => {
        const data: AssemblyAIMessage = JSON.parse(event.data);
        logger.info({ data }, '[CloudAssemblyAI] WebSocket message received');

        if (data.type === 'Begin') {
          logger.info({ session_id: data.session_id || data.id }, '[CloudAssemblyAI] Session started');
          return;
        }

        if (data.type === 'Turn' && data.transcript) {
          if (data.turn_is_formatted) {
            logger.info({ transcript: data.transcript }, '[CloudAssemblyAI] Final transcript');
            this.onTranscriptUpdate({ transcript: { final: data.transcript }, words: data.words || [] });
          } else {
            logger.info({ transcript: data.transcript }, '[CloudAssemblyAI] Partial transcript');
            this.onTranscriptUpdate({ transcript: { partial: data.transcript } });
          }
        }
      };

      this.socket.onerror = (error) => {
        logger.error({ error, readyState: this.socket?.readyState }, '❌ [CloudAssemblyAI] WebSocket ERROR event');
        this.onError?.(TranscriptionError.websocket('WebSocket connection error', true));
        this.stopTranscription();
      };

      this.socket.onclose = (event) => {
        logger.info({ code: event.code, reason: event.reason, wasClean: event.wasClean }, '[CloudAssemblyAI] WebSocket CLOSE event');
        this.socket = null;
        this.mic?.offFrame(this.frameHandler);
        this.stopHeartbeat(); // Stop heartbeat

        // Only attempt reconnect if not a normal closure (code 1000)
        if (event.code !== 1000) {
          this.attemptReconnect();
        } else {
          this.updateConnectionState('disconnected');
        }
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

    // Convert Float32 to Int16 using shared utility
    const int16Array = floatToInt16(float32Array);

    // Buffer audio until we have at least MIN_SAMPLES (50ms)
    // AssemblyAI requires 50-1000ms per packet
    const newBuffer = new Int16Array(this.audioBuffer.length + int16Array.length);
    newBuffer.set(this.audioBuffer);
    newBuffer.set(int16Array, this.audioBuffer.length);
    this.audioBuffer = newBuffer;

    // Send when we have enough samples
    if (this.audioBuffer.length >= this.MIN_SAMPLES) {
      this.socket.send(this.audioBuffer.buffer);

      if (!this.firstPacketSent) {
        this.firstPacketSent = true;
        const durationMs = (this.audioBuffer.length / 16000) * 1000;
        logger.info({
          samples: this.audioBuffer.length,
          durationMs: durationMs.toFixed(2)
        }, '[CloudAssemblyAI] First audio packet sent to WebSocket');
      }

      // Clear buffer after sending
      this.audioBuffer = new Int16Array(0);
    }
  }

  public async stopTranscription(): Promise<string> {
    // Set manual stop flag to prevent reconnection
    this.isManualStop = true;

    // Cleanup reconnection timers
    this.cleanupReconnection();

    if (this.mic) {
      this.mic.offFrame(this.frameHandler);
      this.mic = null;
    }

    // Send any remaining buffered audio before closing
    if (this.audioBuffer.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(this.audioBuffer.buffer);
      this.audioBuffer = new Int16Array(0);
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // AssemblyAI v3 doesn't use a 'Terminate' message like v2.
      // Simply closing the socket is sufficient.
      this.socket.close(1000); // Normal closure
    }
    this.socket = null;
    this.firstPacketSent = false;
    this.updateConnectionState('disconnected');

    // Reset manual stop flag for next session
    this.isManualStop = false;

    return ""; // This mode does not maintain a full transcript itself
  }

  public async getTranscript(): Promise<string> {
    // This mode is event-driven and does not store the full transcript.
    // The parent service is responsible for aggregating the final transcript parts.
    return "";
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    // Don't reconnect if stop was manual
    if (this.isManualStop) {
      logger.info('[CloudAssemblyAI] Manual stop detected, skipping reconnect');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('[CloudAssemblyAI] Max reconnect attempts reached');
      this.onError?.(TranscriptionError.websocket('Max reconnection attempts reached. Please check your network connection.', false));
      this.updateConnectionState('disconnected');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    logger.info({ delay, attempt: this.reconnectAttempts }, `[CloudAssemblyAI] Reconnecting in ${delay}ms`);
    this.updateConnectionState('reconnecting');

    this.reconnectTimeout = setTimeout(async () => {
      logger.info('[CloudAssemblyAI] Attempting reconnect...');
      if (this.mic) {
        try {
          await this.startTranscription(this.mic);
        } catch (error) {
          logger.error({ error }, '❌ [CloudAssemblyAI] Reconnect transition failed');
          // If startTranscription fails (e.g. token fetch error), it won't trigger onclose on a socket.
          // We must manually trigger the next reconnect attempt here to ensure resilience.
          this.attemptReconnect();
        }
      }
    }, delay);
  }

  /**
   * Start heartbeat to detect dead connections
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        logger.debug('[CloudAssemblyAI] Heartbeat check - connection alive');
        // AssemblyAI doesn't require explicit ping, just check readyState
        // If connection is dead, onclose will fire
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Update connection state and notify callback
   */
  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    logger.info({ state }, '[CloudAssemblyAI] Connection state changed');
    this.onConnectionStateChange?.(state);
  }

  /**
   * Cleanup reconnection timers
   */
  private cleanupReconnection(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

