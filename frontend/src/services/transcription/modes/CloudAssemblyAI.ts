import { ITranscriptionMode, TranscriptionModeOptions, Transcript, TranscriptionError } from './types';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import { floatToInt16Async } from '../utils/AudioProcessor';
import logger from '../../../lib/logger';

// Message types for AssemblyAI WebSocket
interface AssemblyAIMessage {
  message_type: 'SessionBegins' | 'PartialTranscript' | 'FinalTranscript' | 'SessionTerminated';
  session_id?: string;
  text?: string;
  words?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  confidence?: number;
  error?: string;
}

// Internal connection state tracking
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export default class CloudAssemblyAI implements ITranscriptionMode {
  private onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  private onReady: () => void;
  private onError?: (error: TranscriptionError) => void;
  private customVocabulary: string[] = [];
  private socket: WebSocket | null = null;
  private isListening: boolean = false;
  private audioQueue: Float32Array[] = [];
  private connectionState: ConnectionState = 'disconnected';

  // Connection State Machine
  private connectionId: number = 0;

  // Reconnection logic
  private reconnectionAttempts: number = 0;
  private maxReconnectionAttempts: number = 5;
  private baseReconnectDelay: number = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnect: boolean = false;

  constructor({ onTranscriptUpdate, onReady, onError, customVocabulary = [] }: TranscriptionModeOptions) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this.onError = onError;
    this.customVocabulary = customVocabulary;
  }

  public async init(): Promise<void> {
    // No-op for init, connection happens on startTranscription
    logger.info('[CloudAssemblyAI] Init complete (lazy connection strategy).');
  }

  private async fetchToken(): Promise<string> {
    try {
      // Use our backend functionality to get a temporary token
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assemblyai-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch token: ${response.statusText}`);
      }

      const data = await response.json();
      return data.token;
    } catch (error) {
      logger.error({ error }, '[CloudAssemblyAI] Failed to fetch auth token');
      throw error;
    }
  }

  public async startTranscription(): Promise<void> {
    if (this.isListening) return;

    this.isListening = true;
    this.reconnectionAttempts = 0;
    this.isReconnect = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    // Increment generation ID for this new connection attempt
    const currentConnectionId = ++this.connectionId;

    try {
      this.updateConnectionState('connecting');
      logger.info(`[CloudAssemblyAI] Connecting... (Attempt ${this.reconnectionAttempts + 1}/${this.maxReconnectionAttempts}, ID: ${currentConnectionId})`);

      const token = await this.fetchToken();

      // Guard: If connection ID changed while awaiting token, abort
      if (currentConnectionId !== this.connectionId) {
        logger.warn(`[CloudAssemblyAI] Connection ID mismatch after token fetch. Aborting connect for ID ${currentConnectionId}`);
        return;
      }

      let wsUrl = `wss://streaming.assemblyai.com/v3/realtime/ws?sample_rate=16000&token=${token}`;

      // Support for custom vocabulary (filler words / boost words) via v3 keyterms_prompt
      if (this.customVocabulary.length > 0) {
        const encodedVocab = encodeURIComponent(this.customVocabulary.join(','));
        wsUrl += `&keyterms_prompt=${encodedVocab}`;
      }

      const redactedUrl = wsUrl.replace(/token=[^&]+/, 'token=REDACTED');
      logger.info(`[CloudAssemblyAI] Connecting to WebSocket: ${redactedUrl} (ID: ${currentConnectionId})`);

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = async () => {
        // Guard: zombie socket check
        if (currentConnectionId !== this.connectionId) {
          logger.warn(`[CloudAssemblyAI] closing zombie socket for ID ${currentConnectionId}`);
          this.socket?.close();
          return;
        }

        logger.info(`[CloudAssemblyAI] WebSocket connected (ID: ${currentConnectionId}).`);
        this.updateConnectionState('connected');
        this.reconnectionAttempts = 0; // Reset counters on successful connection

        if (!this.isReconnect && this.onReady) {
          this.onReady();
        }

        this.flushAudioQueue();
      };

      this.socket.onmessage = (event) => {
        if (currentConnectionId !== this.connectionId) return;

        try {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data) as AssemblyAIMessage;
            this.handleMessage(data);
          }
        } catch (err) {
          logger.error({ err, data: event.data }, '[CloudAssemblyAI] Failed to parse message');
        }
      };

      this.socket.onclose = (event) => {
        if (currentConnectionId !== this.connectionId) return;

        logger.info({ code: event.code, reason: event.reason }, `[CloudAssemblyAI] WebSocket closed (ID: ${currentConnectionId}).`);
        this.socket = null;

        if (this.isListening) {
          this.handleConnectionLoss();
        } else {
          this.updateConnectionState('disconnected');
        }
      };

      this.socket.onerror = (event) => {
        if (currentConnectionId !== this.connectionId) return;
        logger.error({ event }, `[CloudAssemblyAI] WebSocket error (ID: ${currentConnectionId}).`);
      };

    } catch (error) {
      if (currentConnectionId !== this.connectionId) return;
      logger.error({ error }, '[CloudAssemblyAI] Connection failed.');
      this.handleConnectionLoss();
    }
  }

  private handleMessage(data: AssemblyAIMessage) {
    switch (data.message_type) {
      case 'SessionBegins':
        logger.info(`[CloudAssemblyAI] Session started. ID: ${data.session_id}`);
        break;

      case 'PartialTranscript':
        if (data.text) {
          this.onTranscriptUpdate({ transcript: { partial: data.text } });
        }
        break;

      case 'FinalTranscript':
        if (data.text) {
          // Strict Turn Assembly: Final overwrites partial
          this.onTranscriptUpdate({ transcript: { final: data.text } });
        }
        break;

      case 'SessionTerminated':
        logger.info('[CloudAssemblyAI] Session terminated by server.');
        this.stopTranscription();
        break;
    }

    if (data.error) {
      logger.error({ error: data.error }, '[CloudAssemblyAI] API Error received');
    }
  }

  private handleConnectionLoss() {
    if (!this.isListening) return;

    this.updateConnectionState('reconnecting');

    if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
      this.reconnectionAttempts++;
      this.isReconnect = true;

      // Exponential Backoff with Jitter
      const exp = Math.min(Math.pow(2, this.reconnectionAttempts), 16);
      const jitter = Math.random() * 200;
      const delay = (this.baseReconnectDelay * exp) + jitter;

      logger.warn(`[CloudAssemblyAI] Connection lost. Reconnecting in ${Math.round(delay)}ms...`);

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      logger.error('[CloudAssemblyAI] Max reconnection attempts reached.');
      this.stopTranscription();
      if (this.onError) {
        this.onError(TranscriptionError.network('Connection lost. Unable to reconnect to transcription service.'));
      }
    }
  }

  public async stopTranscription(): Promise<string> {
    this.isListening = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      // Send termination message if open
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ terminate_session: true }));
      }
      this.socket.close();
      this.socket = null;
    }

    this.audioQueue = []; // Clear queue
    this.updateConnectionState('disconnected');
    return ''; // Recent transcript is already handled via callbacks
  }

  public async getTranscript(): Promise<string> {
    return "";
  }

  public processAudio(audioData: Float32Array): void {
    if (!this.isListening) return;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendAudioChunk(audioData);
    } else {
      // Buffer audio if connecting
      if (this.audioQueue.length < 500) { // Limit queue size (~50s @ 100ms chunks)
        this.audioQueue.push(audioData);
      }
    }
  }

  private async sendAudioChunk(audioData: Float32Array) {
    try {
      // PERFORMANCE OPTIMIZATION: Moving heavy audio processing off the main thread.
      // The worker now handles both Float32 -> Int16 conversion and Base64 encoding.
      const { base64 } = await floatToInt16Async(audioData);

      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ audio_data: base64 }));
      }
    } catch (err) {
      logger.error({ err }, '[CloudAssemblyAI] Error processing audio chunk');
    }
  }

  private async flushAudioQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    logger.info(`[CloudAssemblyAI] Flushing ${this.audioQueue.length} queued audio chunks.`);

    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        await this.sendAudioChunk(chunk);
      }
    }
  }

  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    logger.debug(`[CloudAssemblyAI] Connection state: ${state}`);
  }
}
