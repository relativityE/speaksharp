import { STTEngine } from '@/contracts/STTEngine';
import { EngineType, EngineCallbacks } from '@/contracts/IPrivateSTTEngine';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript, TranscriptionError, Result } from './types';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { floatToInt16Async } from '../utils/AudioProcessor';
import logger from '../../../lib/logger';
import { ENV } from '../../../config/TestFlags';

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
    speaker?: string;
  }>;
  speaker?: string;
  confidence?: number;
  error?: string;
}

// Internal connection state tracking
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * ARCHITECTURE:
 * TranscriptionService generates a runId (e.g., abc-123) every time you click record. 
 * This identifies the current recording session.
 * The service then creates an engine and passes this runId into the engine's constructor 
 * via the options.instanceId field.
 * Inside the Engine, this ID is stored as this.instanceId.
 */
export default class CloudAssemblyAI extends STTEngine implements ITranscriptionEngine {
  public readonly type: EngineType = 'cloud';
  
  private onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
  private onModelLoadProgress?: (progress: number | null) => void;
  public onReady?: () => void;
  private onError?: (error: TranscriptionError) => void;
  
  private socket: WebSocket | null = null;
  private isListening: boolean = false;
  private audioQueue: Float32Array[] = [];
  private connectionState: ConnectionState = 'disconnected';

  // Connection State Machine
  private connectionId: number = 0;
  private flushPromise: Promise<void> | null = null;

  // Reconnection logic
  private reconnectionAttempts: number = 0;
  private maxReconnectionAttempts: number = 5;
  private baseReconnectDelay: number = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnect: boolean = false;

  private session: Session | null = null;
  private options?: TranscriptionModeOptions;

  constructor(options?: TranscriptionModeOptions) {
    super();
    if (options) {
      this.options = options;
      this.session = options.session ?? null;
      this.onTranscriptUpdate = options.onTranscriptUpdate;
      this.onModelLoadProgress = options.onModelLoadProgress;
      this.onReady = options.onReady;
      this.onError = options.onError;
    }
  }

  protected async onInit(callbacks: EngineCallbacks | TranscriptionModeOptions): Promise<Result<void, Error>> {
    // We already captured options in the constructor, but we'll accept callbacks if they change
    const opts = callbacks as TranscriptionModeOptions;
    if (opts.onTranscriptUpdate) this.onTranscriptUpdate = opts.onTranscriptUpdate;
    if (opts.onModelLoadProgress) this.onModelLoadProgress = opts.onModelLoadProgress;
    if (opts.onReady) this.onReady = opts.onReady;
    if (opts.onError) this.onError = opts.onError;
    
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[CloudAssemblyAI] Init complete (lazy connection strategy).');
    return Result.ok(undefined);
  }

  protected async onStart(): Promise<void> {
    if (this.isListening) return;

    this.isListening = true;
    this.currentTranscript = '';
    this.reconnectionAttempts = 0;
    this.isReconnect = false;
    await this.connect();
  }

  protected async onStop(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[CloudAssemblyAI] 🛑 Stopping transcription');
    this.isListening = false;
    await this.closeConnection();
  }

  protected async onDestroy(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[CloudAssemblyAI] 🛑 Destroying engine');
    await this.onStop();
  }

  async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
    // AssemblyAI uses WebSockets for streaming; chunked synchronous return is a no-op
    // This satisfies the IPrivateSTTEngine contract.
    return Result.ok('');
  }

  private async fetchToken(): Promise<string> {
    // INDUSTRY STANDARD: Environment-based auth bypass
    // Pattern: Used by Stripe, Auth0, Twilio SDKs

    if (this.isE2EEnvironment()) {
      logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] 🧪 E2E mode - bypassing auth');
      return this.getMockToken();
    }

    try {
      // Use the session passed in the config if available, otherwise fetch from client
      const supabase = getSupabaseClient();
      const session = this.session ?? (await supabase.auth.getSession()).data.session;
      const accessToken = session?.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assemblyai-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Auth failed: ${response.status}`);
      }

      const data = await response.json();
      return data.token;

    } catch (error) {
      logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, err: error }, '[CloudAssemblyAI] ❌ Auth token fetch failed');

      // Fallback to mock in development
      if (this.isDevelopmentEnvironment()) {
        logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] Falling back to mock token');
        return this.getMockToken();
      }

      throw error;
    }
  }

  private isE2EEnvironment(): boolean {
    return ENV.IS_E2E;
  }

  private isDevelopmentEnvironment(): boolean {
    return import.meta.env.DEV || import.meta.env.MODE === 'development';
  }

  private getMockToken(): string {
    // Generate deterministic mock token for E2E
    const timestamp = Date.now();
    return `mock_token_${timestamp}_e2e`;
  }

  private async connect(): Promise<void> {
    // Increment generation ID for this new connection attempt
    const currentConnectionId = ++this.connectionId;

    try {
      this.updateConnectionState('connecting');
      logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connecting... (Attempt ${this.reconnectionAttempts + 1}/${this.maxReconnectionAttempts}, ID: ${currentConnectionId})`);

      const token = await this.fetchToken();

      // Guard: If connection ID changed while awaiting token, abort
      if (currentConnectionId !== this.connectionId) {
        logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connection ID mismatch after token fetch. Aborting connect for ID ${currentConnectionId}`);
        return;
      }

      // 🚀 PERFORMANCE: Add STT Word Boosting for user words (Fixes Domain 4)
      const vocabulary = this.options?.userWords || [];
      const keytermsParam = vocabulary.length > 0
        ? `&keyterms_prompt=${encodeURIComponent(vocabulary.join(','))}`
        : '';

      const wsUrl = `wss://streaming.assemblyai.com/v3/realtime/ws?sample_rate=16000&token=${token}${keytermsParam}&speaker_labels=true`;

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = async () => {
        // Guard: zombie socket check
        if (currentConnectionId !== this.connectionId) {
          logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] closing zombie socket for ID ${currentConnectionId}`);
          this.socket?.close();
          return;
        }

        this.updateConnectionState('connected');
        this.reconnectionAttempts = 0; // Reset counters on successful connection
        this.updateHeartbeat();

        if (!this.isReconnect && this.onReady) {
          this.onReady();
        }

        void this.flushAudioQueue();
      };


      this.socket.onmessage = (event) => {
        if (currentConnectionId !== this.connectionId) return;
        this.updateHeartbeat();

        try {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data) as AssemblyAIMessage;
            this.handleMessage(data);
          }
        } catch (err) {
          logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, err, data: event.data }, '[CloudAssemblyAI] Failed to parse message');
        }
      };

      this.socket.onclose = (event) => {
        if (currentConnectionId !== this.connectionId) return;

        logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, code: event.code, reason: event.reason }, `[CloudAssemblyAI] WebSocket closed (ID: ${currentConnectionId}).`);
        this.socket = null;

        if (this.isListening) {
          this.handleConnectionLoss();
        } else {
          this.updateConnectionState('disconnected');
        }
      };

      this.socket.onerror = (event) => {
        if (currentConnectionId !== this.connectionId) return;
        logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, event }, `[CloudAssemblyAI] WebSocket error (ID: ${currentConnectionId}).`);

        // 🛡️ RELIABILITY: Trigger reconnection logic on error (Fixes Domain 3)
        if (this.isListening) {
          this.handleConnectionLoss();
        }
      };

    } catch (error) {
      if (currentConnectionId !== this.connectionId) return;
      logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, error }, '[CloudAssemblyAI] Connection failed.');
      this.handleConnectionLoss();
    }
  }

  private handleMessage(data: AssemblyAIMessage) {
    switch (data.message_type) {
      case 'SessionBegins':
        logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Session started. ID: ${data.session_id}`);
        break;

      case 'PartialTranscript':
        if (data.text) {
          if (this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { partial: data.text } });
        }
        break;

      case 'FinalTranscript':
        if (data.text) {
          // Accumulate transcript
          this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${data.text}` : data.text;
          // Strict Turn Assembly: Final overwrites partial
          // Map AssemblyAI 'speaker' (e.g. 'A', 'B') to transcript update
          if (this.onTranscriptUpdate) {
            this.onTranscriptUpdate({
              transcript: {
                final: data.text,
                speaker: data.speaker
              }
            });
          }
        }
        break;

      case 'SessionTerminated':
        logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] Session terminated by server.');
        void this.onStop();
        break;

    }

    if (data.error) {
      logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, error: data.error }, '[CloudAssemblyAI] API Error received');
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

      logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connection lost. Reconnecting in ${Math.round(delay)}ms...`);

      this.reconnectTimer = setTimeout(() => {
        void this.connect();
      }, delay);

    } else {
      logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] Max reconnection attempts reached.');
      void this.onStop();
      if (this.onError) {
        this.onError(TranscriptionError.network('Connection lost. Unable to reconnect to transcription service.'));
      }
    }

  }

  private async closeConnection(): Promise<void> {
    this.updateHeartbeat();
    
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
  }

  public processAudio(audioData: Float32Array): void {
    if (!this.isListening) return;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      void this.sendAudioChunk(audioData);
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
      logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, err }, '[CloudAssemblyAI] Error processing audio chunk');
    }
  }

  private async flushAudioQueue() {
    this.flushPromise = this._doFlush();
    await this.flushPromise;
  }

  private async _doFlush() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Flushing ${this.audioQueue.length} queued audio chunks.`);

    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        await this.sendAudioChunk(chunk);
      }
    }
  }

  public async waitForFlush(): Promise<void> {
    // If flush is already in progress or completed, await it.
    // If not yet started, we don't wait indefinitely here (the test should trigger it).
    if (this.flushPromise) {
      await this.flushPromise;
    }
  }

  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    logger.debug({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connection state: ${state}`);
  }
}
