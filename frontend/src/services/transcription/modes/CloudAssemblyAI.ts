import type { ITranscriptionMode, TranscriptionModeOptions, Transcript } from './types';
import { TranscriptionError } from './types';
import type { MicStream } from '../utils/types';
import { floatToInt16 } from '../utils/AudioProcessor';
import logger from '../../../lib/logger';
import { STT_CONFIG, AUDIO_CONFIG } from '../../../config';

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
  end_of_turn?: boolean;
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
  // AssemblyAI requires audio packets between 50-1000ms (see STT_CONFIG)
  private readonly MIN_SAMPLES = STT_CONFIG.ASSEMBLYAI_MIN_SAMPLES;
  private readonly MAX_SAMPLES = STT_CONFIG.ASSEMBLYAI_MAX_SAMPLES;

  // Track last partial to preserve on unexpected disconnect
  // AssemblyAI sample code shows partials overwrite until final is received
  private lastPartialTranscript: string = '';

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

      // Build WebSocket URL with AssemblyAI Universal Streaming parameters
      // Settings from AssemblyAI Playground for optimal end-of-turn detection:
      // - format_turns=true: Get formatted final transcripts
      // - end_of_turn_confidence_threshold=0.7: Confidence for end-of-turn detection
      // - min_end_of_turn_silence=160: Min silence (ms) when confident
      // - max_turn_silence=2400: Max silence (ms) before forcing end-of-turn
      let url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${mic.sampleRate}&token=${token}&format_turns=true&end_of_turn_confidence_threshold=0.7&min_end_of_turn_silence=160&max_turn_silence=2400`;
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
          // AssemblyAI v3 sends:
          // - Partial transcripts: no end_of_turn, no turn_is_formatted
          // - Unformatted final: end_of_turn=true, turn_is_formatted=false
          // - Formatted final: turn_is_formatted=true (if format_turns=true)
          // We treat BOTH end_of_turn and turn_is_formatted as finals to ensure accumulation
          if (data.turn_is_formatted || data.end_of_turn) {
            logger.info({ transcript: data.transcript, formatted: data.turn_is_formatted }, '[CloudAssemblyAI] Final transcript');
            this.onTranscriptUpdate({ transcript: { final: data.transcript }, words: data.words || [] });
            this.lastPartialTranscript = ''; // Clear after final
          } else {
            logger.info({ transcript: data.transcript }, '[CloudAssemblyAI] Partial transcript');
            this.lastPartialTranscript = data.transcript; // Track for disconnect recovery
            this.onTranscriptUpdate({ transcript: { partial: data.transcript } });
          }
        }

        // Handle Termination message per canonical sample
        if (data.type === 'Termination') {
          const audioDuration = (data as { audio_duration_seconds?: number }).audio_duration_seconds;
          const sessionDuration = (data as { session_duration_seconds?: number }).session_duration_seconds;
          logger.info({ audioDuration, sessionDuration }, '[CloudAssemblyAI] Session Terminated');
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

        // On unexpected close, save the last partial as a final to prevent transcript loss
        // This matches AssemblyAI sample behavior where partials overwrite until commit
        if (event.code !== 1000 && this.lastPartialTranscript) {
          logger.info({ transcript: this.lastPartialTranscript }, '[CloudAssemblyAI] Saving partial before reconnect');
          this.onTranscriptUpdate({ transcript: { final: this.lastPartialTranscript } });
          this.lastPartialTranscript = '';
        }

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

    // Buffer audio until we have at least MIN_SAMPLES (50ms at 16kHz)
    // Web Audio provides ~2.6ms frames, but AssemblyAI requires 50-1000ms per packet
    const newBuffer = new Int16Array(this.audioBuffer.length + int16Array.length);
    newBuffer.set(this.audioBuffer);
    newBuffer.set(int16Array, this.audioBuffer.length);
    this.audioBuffer = newBuffer;

    // Send when we have enough samples (50ms minimum)
    if (this.audioBuffer.length >= this.MIN_SAMPLES) {
      // Validate packet duration is within AssemblyAI's 50-1000ms range
      const durationMs = (this.audioBuffer.length / AUDIO_CONFIG.SAMPLE_RATE) * 1000;

      if (durationMs < STT_CONFIG.ASSEMBLYAI_MIN_PACKET_MS || durationMs > STT_CONFIG.ASSEMBLYAI_MAX_PACKET_MS) {
        logger.error({
          samples: this.audioBuffer.length,
          durationMs: durationMs.toFixed(2),
          expectedMin: STT_CONFIG.ASSEMBLYAI_MIN_PACKET_MS,
          expectedMax: STT_CONFIG.ASSEMBLYAI_MAX_PACKET_MS
        }, '[CloudAssemblyAI] Audio packet duration INVALID - expected between 50 and 1000 ms');
      }

      this.socket.send(this.audioBuffer.buffer);

      if (!this.firstPacketSent) {
        this.firstPacketSent = true;
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
      // Send Terminate message before closing per canonical AssemblyAI sample
      const terminateMessage = { type: 'Terminate' };
      logger.info({ terminateMessage }, '[CloudAssemblyAI] Sending termination message');
      this.socket.send(JSON.stringify(terminateMessage));
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

    // Exponential backoff: 3s, 6s, 12s, max 30s
    // 3005 errors are fixed, so we can use shorter delays now
    const delay = Math.min(3000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    logger.info({ delay, attempt: this.reconnectAttempts }, `[CloudAssemblyAI] Reconnecting in ${delay}ms`);
    this.updateConnectionState('reconnecting');

    this.reconnectTimeout = setTimeout(async () => {
      logger.info('[CloudAssemblyAI] Attempting reconnect...');
      // Clear audio buffer to prevent sending stale audio faster than real-time (error 3005)
      this.audioBuffer = new Int16Array(0);
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

