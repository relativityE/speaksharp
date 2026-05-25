import { STTEngine, validateEngine } from '../../../contracts/STTEngine';
import type { EngineType, IPrivateSTTEngine } from '../../../contracts/IPrivateSTTEngine';
import { Result, type ITranscriptionEngine, type TranscriptionModeOptions, type Transcript } from './types';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { floatToInt16Async } from '../utils/AudioProcessor';
import { ENV } from '../../../config/TestFlags';
import { FILLER_WORD_KEYS } from '../../../config';
import { TranscriptionError } from '../errors';
import { CLOUD_STT, CLOUD_STT_DERIVED } from '../sttConstants';
import logger from '../../../lib/logger';
import type { MicStream } from '../utils/types';

// Message types for AssemblyAI WebSocket
interface AssemblyAIMessage {
  message_type?: 'SessionBegins' | 'PartialTranscript' | 'FinalTranscript' | 'SessionTerminated';
  type?: 'Begin' | 'Turn' | 'Termination' | string;
  session_id?: string;
  id?: string;
  text?: string;
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
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

// AssemblyAI requires each binary audio WebSocket payload to contain 50-1000ms
// of PCM audio. At 16kHz that is 800-16000 samples; we send 50ms chunks.
// Do not send raw browser callback frames directly: they can be ~2-3ms and
// trigger provider "Input Duration Violation" errors before transcription starts.
const MIN_STREAMING_CHUNK_SAMPLES = CLOUD_STT_DERIVED.MIN_PACKET_SAMPLES;
const MAX_QUEUED_AUDIO_FRAMES = CLOUD_STT.MAX_QUEUED_AUDIO_FRAMES;
const CLOUD_DEFAULT_KEYTERMS = [
  ...Object.values(FILLER_WORD_KEYS),
  'umm',
  'ummm',
  'uhm',
  'uhh',
  'uhhh',
  'er',
  'err',
  'ahm',
  'ahhh',
  "y'know",
  'ya know',
  'kinda',
  'sorta',
];

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

  private mockEngine?: IPrivateSTTEngine;
  private onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
  private onModelLoadProgress?: (progress: number | null) => void;
  public onReady?: () => void;
  private onError?: (error: TranscriptionError) => void;

  private socket: WebSocket | null = null;
  private isListening: boolean = false;
  private audioQueue: Float32Array[] = [];
  private pendingAudioFrames: Float32Array[] = [];
  private pendingAudioSamples: number = 0;
  private connectionState: ConnectionState = 'disconnected';

  // Connection State Machine
  private connectionId: number = 0;
  private flushPromise: Promise<void> | null = null;
  private receivedAudioFrames: number = 0;
  private queuedAudioFrames: number = 0;
  private droppedAudioFrames: number = 0;
  private sentAudioChunks: number = 0;
  private receivedMessageCounts: Record<string, number> = {};
  private isManualStop: boolean = false;

  // Reconnection logic
  private reconnectionAttempts: number = 0;
  private maxReconnectionAttempts: number = CLOUD_STT.MAX_RECONNECT_ATTEMPTS;
  private baseReconnectDelay: number = CLOUD_STT.BASE_RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnect: boolean = false;
  private session: Session | null = null;

  constructor(options?: TranscriptionModeOptions, mockEngine?: IPrivateSTTEngine) {
    super(options);
    this.mockEngine = mockEngine;
    this.syncCallbacks();
  }

  public override updateOptions(options: Partial<TranscriptionModeOptions>): void {
    super.updateOptions(options);
    this.syncCallbacks();
  }

  private syncCallbacks(): void {
    const opts = this.modeOptions;
    if (opts) {
      this.session = opts.session ?? null;
      this.onTranscriptUpdate = opts.onTranscriptUpdate;
      this.onModelLoadProgress = opts.onModelLoadProgress;
      this.onReady = opts.onReady;
      this.onError = opts.onError;
    }
  }

  private get modeOptions(): TranscriptionModeOptions | null {
    return this.options as TranscriptionModeOptions;
  }

  private getCloudKeyterms(): string[] {
    const userWords = this.modeOptions?.userWords ?? [];
    const seen = new Set<string>();

    return [...CLOUD_DEFAULT_KEYTERMS, ...userWords]
      .map((word) => word.trim())
      .filter((word) => {
        if (!word) return false;
        const normalized = word.toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .map((word) => word.toLowerCase());
  }

  /**
   * STTStrategy Requirement: Probe availability and prerequisites.
   */
  public async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
    // Mock engine injected = availability is authoritatively declared by test harness
    if (this.mockEngine) {
      return { isAvailable: true };
    }

    // 1. Check for network connectivity
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        isAvailable: false,
        reason: 'OFFLINE',
        message: 'AssemblyAI requires an active internet connection. Please check your network and retry.'
      };
    }

    // 2. Check for existence of Supabase session (primary auth source)
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !this.isE2EEnvironment()) {
      return {
        isAvailable: false,
        reason: 'NO_API_KEY', // Semantic mapping to "Not Authenticated"
        message: 'Cloud transcription requires authentication. Please sign in.'
      };
    }

    return { isAvailable: true };
  }


  protected override async onInit(): Promise<Result<void, Error>> {
    if (this.mockEngine) {
        logger.info('[CloudAssemblyAI] 🧪 Using injected MockEngine, initializing...');
        if (this.mockEngine.init) {
            await this.mockEngine.init();
        }
        return Result.ok(undefined);
    }

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[CloudAssemblyAI] Init complete.');
    return Result.ok(undefined);
  }

  protected override async onStart(_mic: MicStream | undefined, userWords: string[] = []): Promise<void> {
    if (this.isListening) return;
    this.updateOptions({ userWords });

    // Use injected mock if available
    if (this.mockEngine) {
        logger.info('[CloudAssemblyAI] 🧪 Using injected MockEngine');
        validateEngine(this.mockEngine);
    }

    this.isListening = true;
    this.isManualStop = false;
    this.currentTranscript = '';
    this.reconnectionAttempts = 0;
    this.isReconnect = false;
    this.sentAudioChunks = 0;
    this.receivedMessageCounts = {};
    this.audioQueue = [];
    this.pendingAudioFrames = [];
    this.pendingAudioSamples = 0;
    
    // Only connect if not mocked
    if (!this.mockEngine) {
        await this.connect();
    } else {
        await this.mockEngine.start(_mic, userWords);
    }
  }

  protected async onStop(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[CloudAssemblyAI] Stopping connection...');
    this.isManualStop = true;
    this.isListening = false;
    await this.closeConnection();
  }

  public async pause(): Promise<void> {
    await super.pause();
  }

  protected async onPause(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[CloudAssemblyAI] Pausing connection (no-op)...');
  }

  public async resume(): Promise<void> {
    await super.resume();
  }

  protected async onResume(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[CloudAssemblyAI] Resuming connection (no-op)...');
  }

  protected async onDestroy(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[CloudAssemblyAI] 🛑 Destroying engine');
    
    // Nuclear Cleanup: Kill timers and socket immediately
    this.isManualStop = true;
    this.isListening = false;

    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    if (this.socket) {
        this.socket.onmessage = null;
        this.socket.onclose = null;
        this.socket.onopen = null;
        this.socket.onerror = null;
        this.socket.close();
        this.socket = null;
    }
  }

  public async terminate(): Promise<void> {
    if (this.isTerminated) return;
    
    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[CloudAssemblyAI] 🛑 Nuclear termination requested');
    this.isManualStop = true;
    this.isListening = false;

    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    if (this.mockEngine) {
      if (typeof this.mockEngine.terminate === 'function') await this.mockEngine.terminate();
      else await this.mockEngine.destroy();
    }

    await this.closeConnection();
    await super.terminate();
  }

  public getLastHeartbeatTimestamp(): number {
    return this.mockEngine ? this.mockEngine.getLastHeartbeatTimestamp() : super.getLastHeartbeatTimestamp();
  }

  public override async getTranscript(): Promise<string> {
    const engineWithGet = this.mockEngine as unknown as { getTranscript?: () => Promise<string> };
    if (engineWithGet && engineWithGet.getTranscript) {
        return engineWithGet.getTranscript();
    }
    return super.getTranscript();
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
      logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] 🧪 Test/E2E mode - bypassing auth');
      return this.getMockToken();
    }

    try {
      const callbackToken = await this.modeOptions?.getAssemblyAIToken?.();
      if (callbackToken) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          eId: this.instanceId,
          source: 'modeOptions.getAssemblyAIToken',
        }, '[CloudAssemblyAI] token fetched');
        return callbackToken;
      }

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
        let body = '';
        try {
          body = await response.text();
        } catch (bodyError) {
          logger.warn({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            status: response.status,
            err: bodyError,
          }, '[CloudAssemblyAI] Token endpoint returned non-2xx, but response body could not be read');
        }
        throw new Error(`Auth failed: ${response.status} ${body.slice(0, 300)}`);
      }

      const data = await response.json();
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        eId: this.instanceId,
        status: response.status,
        hasToken: typeof data.token === 'string' && data.token.length > 0,
      }, '[CloudAssemblyAI] token fetched');
      return data.token;

    } catch (error) {
      logger.error({
        sId: this.serviceId,
        rId: this.instanceId,
        eId: this.instanceId,
        err: error,
        message: error instanceof Error ? error.message : String(error),
      }, '[CloudAssemblyAI] ❌ Auth token fetch failed');
      logger.error(`[CloudAssemblyAI] Auth token fetch failed: ${error instanceof Error ? error.message : String(error)}`);

      // Fallback to mock in development
      if (this.isDevelopmentEnvironment()) {
        logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] Falling back to mock token');
        return this.getMockToken();
      }

      throw error;
    }
  }

  /** @internal */
  public isE2EEnvironment(): boolean {
    return ENV.isE2E || ENV.isTest;
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

      const vocabulary = this.getCloudKeyterms();
      const connectionParams = new URLSearchParams({
        sample_rate: String(CLOUD_STT.SAMPLE_RATE_HZ),
        encoding: CLOUD_STT.ENCODING,
        speech_model: CLOUD_STT.SPEECH_MODEL,
        format_turns: 'true',
        token,
      });

      if (vocabulary.length > 0) {
        connectionParams.set('keyterms_prompt', JSON.stringify(vocabulary));
      }

      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${connectionParams.toString()}`;

      const ws = new WebSocket(wsUrl);
      this.socket = ws;

      ws.onopen = () => {
        // Guard: zombie socket check
        if (currentConnectionId !== this.connectionId) {
          logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] closing zombie socket for ID ${currentConnectionId}`);
          ws.onmessage = null;
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
          return;
        }

        this.updateConnectionState('connected');
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          eId: this.instanceId,
          queuedAudioChunks: this.audioQueue.length,
        }, '[CloudAssemblyAI] WebSocket open');
        this.reconnectionAttempts = 0; // Reset counters on successful connection
        this.updateHeartbeat();

        if (!this.isReconnect && this.onReady) {
          this.onReady();
        }

        void this.flushAudioQueue();
      };


      ws.onmessage = (event) => {
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

      ws.onclose = (event) => {
        if (currentConnectionId !== this.connectionId) return;

        logger.warn({
          sId: this.serviceId,
          rId: this.instanceId,
          eId: this.instanceId,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          isManualStop: this.isManualStop,
          isListening: this.isListening,
          connectionState: this.connectionState,
          reconnectAttempts: this.reconnectionAttempts,
          sentAudioChunks: this.sentAudioChunks,
          receivedMessageCounts: this.receivedMessageCounts,
          currentTranscriptLength: this.currentTranscript.length,
        }, '[CLOUD_WS_CLOSE]');
        
        if (this.socket === ws) {
          this.socket = null;
        }

        if (this.isListening) {
          this.handleConnectionLoss();
        } else {
          this.updateConnectionState('disconnected');
        }
      };

      ws.onerror = (event) => {
        if (currentConnectionId !== this.connectionId) return;
        logger.error({
          sId: this.serviceId,
          rId: this.instanceId,
          eId: this.instanceId,
          event,
          isManualStop: this.isManualStop,
          isListening: this.isListening,
          connectionState: this.connectionState,
          reconnectAttempts: this.reconnectionAttempts,
          sentAudioChunks: this.sentAudioChunks,
          receivedMessageCounts: this.receivedMessageCounts,
          currentTranscriptLength: this.currentTranscript.length,
        }, '[CLOUD_WS_ERROR]');

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
    const messageType = data.message_type ?? data.type ?? 'unknown';
    const transcriptText = data.text ?? data.transcript ?? data.utterance ?? '';
    this.receivedMessageCounts[messageType] = (this.receivedMessageCounts[messageType] ?? 0) + 1;
    logger.info({
      sId: this.serviceId,
      rId: this.instanceId,
      eId: this.instanceId,
      messageType,
      textLength: transcriptText.length,
      counts: this.receivedMessageCounts,
      error: data.error,
    }, '[CloudAssemblyAI] message received');

    switch (messageType) {
      case 'SessionBegins':
      case 'Begin':
        logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Session started. ID: ${data.session_id ?? data.id}`);
        break;

      case 'PartialTranscript':
        if (transcriptText) {
          this.updateHeartbeat();
          if (this.onTranscriptUpdate) {
            this.onTranscriptUpdate({ 
                transcript: { partial: transcriptText }
            });
          }
        }
        break;

      case 'FinalTranscript':
        if (transcriptText) {
          this.updateHeartbeat();
          this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${transcriptText}` : transcriptText;
          if (this.onTranscriptUpdate) {
            this.onTranscriptUpdate({
              transcript: {
                final: transcriptText,
                speaker: data.speaker
              }
            });
          }
        }
        break;

      case 'Turn':
        if (transcriptText) {
          this.updateHeartbeat();
          if (data.end_of_turn) {
            this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${transcriptText}` : transcriptText;
            this.onTranscriptUpdate?.({
              transcript: {
                final: transcriptText,
                speaker: data.speaker,
              },
            });
          } else {
            this.onTranscriptUpdate?.({
              transcript: { partial: transcriptText },
            });
          }
        }
        break;

      case 'SessionTerminated':
      case 'Termination':
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
      const exp = Math.min(Math.pow(2, this.reconnectionAttempts), CLOUD_STT.RECONNECT_EXPONENT_CAP);
      const jitter = Math.random() * CLOUD_STT.RECONNECT_JITTER_MS;
      const delay = (this.baseReconnectDelay * exp) + jitter;

      logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connection lost. Reconnecting in ${Math.round(delay)}ms...`);

      const currentId = this.connectionId;
      this.reconnectTimer = setTimeout(() => {
        // Generation Guard: Abort if engine was destroyed or restarted while waiting
        if (this.connectionId === currentId && this.isListening) {
          void this.connect();
        }
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
        try {
          await this.flushAudioQueue({ forceTail: true });
          this.socket.send(JSON.stringify({ type: 'Terminate' }));
        } catch (err) {
          logger.warn({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            err,
            socketReadyState: this.socket.readyState,
            pendingAudioSamples: this.pendingAudioSamples,
            queuedAudioFrames: this.audioQueue.length,
          }, '[CloudAssemblyAI] Failed to flush tail audio or send terminate message during shutdown');
        }
      }

      // DETERMINISTIC SHUTDOWN: Await the actual 'close' event
      if (this.socket.readyState !== WebSocket.CLOSED) {
        // Silencing listeners EXCEPT for onclose (the resolve trigger)
        this.socket.onmessage = null;
        this.socket.onopen = null;
        this.socket.onerror = null;

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            logger.warn('[CloudAssemblyAI] Socket close timed out. Forcing closure.');
            resolve();
          }, CLOUD_STT.SOCKET_CLOSE_TIMEOUT_MS);

          if (this.socket) {
            this.socket.onclose = () => {
              clearTimeout(timeout);
              resolve();
            };
            this.socket.close();
          } else {
            resolve();
          }
        });
      }
      
      if (this.socket) {
          this.socket.onclose = null;
          this.socket = null;
      }
    }

    this.audioQueue = []; // Clear queue
    this.pendingAudioFrames = [];
    this.pendingAudioSamples = 0;
    this.updateConnectionState('disconnected');
  }



  public processAudio(audioData: Float32Array): void {
    if (!this.isListening) return;

    // Audio frames are Cloud engine liveness, even when the provider is quiet
    // between transcript messages. Without this, the runtime watchdog can
    // terminate an active streaming session before stop/save completes.
    this.updateHeartbeat();

    this.receivedAudioFrames++;
    if (this.receivedAudioFrames === 1 || this.receivedAudioFrames % 25 === 0) {
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        eId: this.instanceId,
        receivedAudioFrames: this.receivedAudioFrames,
        sentAudioChunks: this.sentAudioChunks,
        queuedAudioFrames: this.queuedAudioFrames,
        droppedAudioFrames: this.droppedAudioFrames,
        samples: audioData.length,
        socketReadyState: this.socket?.readyState ?? null,
        connectionState: this.connectionState,
      }, '[CloudAssemblyAI] processAudio frame received');
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.bufferAudioFrame(audioData);
      this.scheduleAudioFlush();
    } else {
      // Buffer audio if connecting
      if (this.audioQueue.length < MAX_QUEUED_AUDIO_FRAMES) {
        this.audioQueue.push(audioData);
        this.queuedAudioFrames++;
      } else {
        this.droppedAudioFrames++;
      }
    }
  }

  private bufferAudioFrame(audioData: Float32Array): void {
    if (audioData.length === 0) return;
    // Buffer tiny mic callbacks until they meet AssemblyAI's minimum duration.
    this.pendingAudioFrames.push(audioData);
    this.pendingAudioSamples += audioData.length;
  }

  private takeBufferedAudioChunk(sampleCount: number): Float32Array {
    const chunk = new Float32Array(sampleCount);
    let offset = 0;

    while (offset < sampleCount && this.pendingAudioFrames.length > 0) {
      const frame = this.pendingAudioFrames[0];
      const remaining = sampleCount - offset;

      if (frame.length <= remaining) {
        chunk.set(frame, offset);
        offset += frame.length;
        this.pendingAudioFrames.shift();
      } else {
        chunk.set(frame.subarray(0, remaining), offset);
        this.pendingAudioFrames[0] = frame.subarray(remaining);
        offset += remaining;
      }
    }

    this.pendingAudioSamples = Math.max(0, this.pendingAudioSamples - offset);
    return offset === sampleCount ? chunk : chunk.subarray(0, offset);
  }

  private scheduleAudioFlush(): void {
    if (this.flushPromise) return;

    this.flushPromise = this._doFlush().finally(() => {
      this.flushPromise = null;
      if (
        this.isListening &&
        this.socket?.readyState === WebSocket.OPEN &&
        (this.audioQueue.length > 0 || this.pendingAudioSamples >= MIN_STREAMING_CHUNK_SAMPLES)
      ) {
        this.scheduleAudioFlush();
      }
    });
  }

  private async sendAudioChunk(audioData: Float32Array) {
    try {
      // PERFORMANCE OPTIMIZATION: Moving heavy audio processing off the main thread.
      // The worker now handles both Float32 -> Int16 conversion and Base64 encoding.
      const { result, base64 } = await floatToInt16Async(audioData);

      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength));
        this.sentAudioChunks++;
        if (this.sentAudioChunks === 1 || this.sentAudioChunks % 25 === 0) {
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            sentAudioChunks: this.sentAudioChunks,
            samples: audioData.length,
            base64Length: base64.length,
          }, '[CloudAssemblyAI] audio chunk sent');
        }
      }
    } catch (err) {
      logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, err }, '[CloudAssemblyAI] Error processing audio chunk');
    }
  }

  private async flushAudioQueue(options: { forceTail?: boolean } = {}) {
    if (options.forceTail) {
      if (this.flushPromise) {
        await this.flushPromise;
      }
      this.flushPromise = this._doFlush(options).finally(() => {
        this.flushPromise = null;
      });
    } else {
      this.scheduleAudioFlush();
    }

    if (this.flushPromise) {
      await this.flushPromise;
    }
  }

  private async _doFlush({ forceTail = false }: { forceTail?: boolean } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const queuedAudioChunks = this.audioQueue.length;
    const sentAudioChunksBeforeFlush = this.sentAudioChunks;

    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        this.bufferAudioFrame(chunk);
      }
    }

    while (
      this.pendingAudioSamples >= MIN_STREAMING_CHUNK_SAMPLES &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      await this.sendAudioChunk(this.takeBufferedAudioChunk(MIN_STREAMING_CHUNK_SAMPLES));
    }

    if (
      forceTail &&
      this.pendingAudioSamples > 0 &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      const tail = this.takeBufferedAudioChunk(this.pendingAudioSamples);
      const paddedTail = new Float32Array(MIN_STREAMING_CHUNK_SAMPLES);
      paddedTail.set(tail);
      await this.sendAudioChunk(paddedTail);
    }

    if (queuedAudioChunks > 0 || forceTail || this.sentAudioChunks > sentAudioChunksBeforeFlush) {
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        eId: this.instanceId,
        queuedAudioChunks,
        pendingAudioFrames: this.pendingAudioFrames.length,
        pendingAudioSamples: this.pendingAudioSamples,
        sentAudioChunks: this.sentAudioChunks,
        forceTail,
      }, '[CloudAssemblyAI] audio flush');
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
