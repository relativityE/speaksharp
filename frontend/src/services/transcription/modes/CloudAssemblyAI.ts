import { STTEngine, validateEngine } from '../../../contracts/STTEngine';
import type { EngineType, IPrivateSTTEngine } from '../../../contracts/IPrivateSTTEngine';
import { Result, type ITranscriptionEngine, type TranscriptionModeOptions, type Transcript } from './types';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { ENV } from '../../../config/TestFlags';
import { TranscriptionError } from '../errors';
import { CLOUD_STT } from '../sttConstants';
import logger from '../../../lib/logger';
import type { MicStream } from '../utils/types';
import {
  AssemblyAICloudProvider,
} from '../providers/cloud/AssemblyAICloudProvider';
import type {
  CloudProviderEvent,
  CloudProviderMetadata,
  CloudSttProvider,
} from '../providers/cloud/types';

// Internal connection state tracking
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const traceTextSample = (text: string | undefined): string | undefined =>
  text?.replace(/\s+/g, ' ').trim().slice(0, 120);

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

  private readonly provider: CloudSttProvider;
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
  private terminateResolve: (() => void) | null = null;
  private providerReady: boolean = false;
  private readyEmitted: boolean = false;
  private providerSessionId: string | null = null;
  private connectionStartedAt: string | null = null;
  private connectionClosedAt: string | null = null;
  private terminationReason: string | null = null;
  private metadata: CloudProviderMetadata;

  // Reconnection logic
  private reconnectionAttempts: number = 0;
  private maxReconnectionAttempts: number = CLOUD_STT.MAX_RECONNECT_ATTEMPTS;
  private baseReconnectDelay: number = CLOUD_STT.BASE_RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnect: boolean = false;
  private session: Session | null = null;

  constructor(options?: TranscriptionModeOptions, mockEngine?: IPrivateSTTEngine, provider: CloudSttProvider = new AssemblyAICloudProvider()) {
    super(options);
    this.provider = provider;
    this.metadata = this.buildProviderMetadata();
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

  public getMetadata(): CloudProviderMetadata {
    return this.metadata;
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
        reason: 'NO_API_KEY',
        message: 'Cloud STT is available only for signed-in Pro accounts with Cloud entitlement.'
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
    this.providerReady = false;
    this.readyEmitted = false;
    this.providerSessionId = null;
    this.connectionStartedAt = null;
    this.connectionClosedAt = null;
    this.terminationReason = null;
    this.metadata = this.buildProviderMetadata();
    
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

  private async fetchToken() {
    return this.provider.getToken({
      modeOptions: this.modeOptions,
      session: this.session,
      isE2E: this.isE2EEnvironment(),
      isDevelopment: this.isDevelopmentEnvironment(),
      getMockToken: () => this.getMockToken(),
      logContext: { sId: this.serviceId, rId: this.instanceId, eId: this.instanceId },
    });
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

  private buildProviderMetadata(): CloudProviderMetadata {
    const connectionDurationSeconds = this.connectionStartedAt && this.connectionClosedAt
      ? Math.max(0, Math.round((Date.parse(this.connectionClosedAt) - Date.parse(this.connectionStartedAt)) / 1_000))
      : undefined;

    return {
      engineVersion: this.provider.id,
      modelName: this.provider.modelName,
      deviceType: 'cloud',
      provider: this.provider.id,
      providerModel: this.provider.modelName,
      providerSessionId: this.providerSessionId,
      connectionStartedAt: this.connectionStartedAt ?? undefined,
      connectionClosedAt: this.connectionClosedAt ?? undefined,
      connectionDurationSeconds,
      terminationReason: this.terminationReason ?? undefined,
    };
  }

  private async connect(): Promise<void> {
    // Increment generation ID for this new connection attempt
    const currentConnectionId = ++this.connectionId;

    try {
      this.updateConnectionState('connecting');
      this.providerReady = false;
      logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connecting... (Attempt ${this.reconnectionAttempts + 1}/${this.maxReconnectionAttempts}, ID: ${currentConnectionId})`);

      const token = await this.fetchToken();

      // Guard: If connection ID changed while awaiting token, abort
      if (currentConnectionId !== this.connectionId) {
        logger.warn({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, `[CloudAssemblyAI] Connection ID mismatch after token fetch. Aborting connect for ID ${currentConnectionId}`);
        return;
      }

      const wsUrl = this.provider.buildWebSocketUrl({
        token,
        customTerms: this.modeOptions?.userWords ?? [],
      });

      const ws = new WebSocket(wsUrl);
      this.socket = ws;
      this.connectionStartedAt = new Date().toISOString();
      this.metadata = this.buildProviderMetadata();

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

        const openMessage = this.provider.buildOpenMessage?.({
          token,
          customTerms: this.modeOptions?.userWords ?? [],
        });
        if (openMessage) {
          ws.send(openMessage);
        }
      };


      ws.onmessage = (event) => {
        if (currentConnectionId !== this.connectionId) return;
        this.updateHeartbeat();

        try {
          const events = this.provider.parseMessage(event.data);
          this.handleProviderEvents(events);
        } catch (err) {
          logger.error({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId, err, data: event.data }, '[CloudAssemblyAI] Failed to parse message');
        }
      };

      ws.onclose = (event) => {
        if (currentConnectionId !== this.connectionId) return;

        const closeClassification = this.provider.classifyClose?.(event);
        this.connectionClosedAt = new Date().toISOString();
        this.terminationReason = closeClassification?.reason ?? event.reason ?? null;
        this.metadata = this.buildProviderMetadata();

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
          providerClose: closeClassification,
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

  private handleProviderEvents(events: CloudProviderEvent[]) {
    for (const event of events) {
      this.receivedMessageCounts[event.type] = (this.receivedMessageCounts[event.type] ?? 0) + 1;
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        eId: this.instanceId,
        provider: this.provider.id,
        eventType: event.type,
        textLength: 'text' in event ? event.text.length : 0,
        textSample: 'text' in event ? traceTextSample(event.text) : undefined,
        counts: this.receivedMessageCounts,
        error: event.type === 'error' ? event.message : undefined,
      }, '[CloudAssemblyAI] provider event received');

      switch (event.type) {
        case 'provider-ready':
          this.providerReady = true;
          this.providerSessionId = event.sessionId ?? null;
          this.metadata = this.buildProviderMetadata();
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            provider: this.provider.id,
            providerSessionId: this.providerSessionId,
          }, '[CloudAssemblyAI] Provider session ready');
          if (!this.readyEmitted && this.onReady) {
            this.readyEmitted = true;
            this.onReady();
          }
          void this.flushAudioQueue();
          break;

        case 'partial':
          this.updateHeartbeat();
          this.onTranscriptUpdate?.({
            transcript: { partial: event.text },
          });
          break;

        case 'final':
          this.updateHeartbeat();
          this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${event.text}` : event.text;
          this.onTranscriptUpdate?.({
            transcript: {
              final: event.text,
              speaker: event.speaker,
            },
          });
          break;

        case 'terminated':
          this.terminationReason = 'provider-terminated';
          this.metadata = this.buildProviderMetadata();
          logger.info({ sId: this.serviceId, rId: this.instanceId, eId: this.instanceId }, '[CloudAssemblyAI] Session terminated by provider.');
          if (this.terminateResolve) {
            this.terminateResolve();
          } else {
            void this.onStop();
          }
          break;

        case 'error':
          logger.error({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            provider: this.provider.id,
            error: event.message,
            code: event.code,
            recoverable: event.recoverable,
          }, '[CloudAssemblyAI] Provider error received');
          if (!event.recoverable && this.onError) {
            this.onError(TranscriptionError.engineFailure(this.provider.id, event.message, false));
          }
          break;
      }
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

    const ws = this.socket;
    if (ws) {
      // Send termination message if open
      if (ws.readyState === WebSocket.OPEN) {
        try {
          await this.flushAudioQueue({ forceTail: true });
          const terminateMessage = this.provider.buildTerminateMessage();
          if (terminateMessage) {
            ws.send(terminateMessage);
          }
        } catch (err) {
          logger.warn({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            err,
            socketReadyState: ws.readyState,
            pendingAudioSamples: this.pendingAudioSamples,
            queuedAudioFrames: this.audioQueue.length,
          }, '[CloudAssemblyAI] Failed to flush tail audio or send terminate message during shutdown');
        }
      }

      // DETERMINISTIC SHUTDOWN: Await the actual 'close' event or termination ack
      if (ws.readyState !== WebSocket.CLOSED) {
        if (this.isTerminated) {
          // Nuclear/immediate shutdown: close immediately and do not wait for provider termination
          ws.close();
        } else {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resolve();
            };
            const timeout = setTimeout(() => {
              logger.warn('[CloudAssemblyAI] Socket close/termination timed out. Forcing closure.');
              finish();
            }, CLOUD_STT.SOCKET_CLOSE_TIMEOUT_MS);
            this.terminateResolve = finish;

            const originalOnClose = ws.onclose;
            ws.onclose = (event) => {
              if (originalOnClose) {
                originalOnClose.call(ws, event);
              }
              finish();
            };
          });

          this.terminateResolve = null;
        }

        ws.onmessage = null;
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
        if (this.socket === ws) {
          this.socket = null;
        }
      }
      
      if (this.socket === ws) {
          ws.onclose = null;
          this.socket = null;
      }
    }

    this.audioQueue = []; // Clear queue
    this.pendingAudioFrames = [];
    this.pendingAudioSamples = 0;
    this.providerReady = false;
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

    const audioPolicy = this.provider.getAudioPolicy();
    const canSendAudio = this.socket
      && this.socket.readyState === WebSocket.OPEN
      && (this.providerReady || audioPolicy.canStreamBeforeProviderReady);

    if (canSendAudio) {
      this.bufferAudioFrame(audioData);
      this.scheduleAudioFlush();
    } else {
      // Buffer audio if connecting
      if (this.audioQueue.length < audioPolicy.maxQueuedAudioFrames) {
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
        (this.audioQueue.length > 0 || this.pendingAudioSamples >= this.provider.getAudioPolicy().minPacketSamples)
      ) {
        this.scheduleAudioFlush();
      }
    });
  }

  private async sendAudioChunk(audioData: Float32Array) {
    try {
      // Cloud streams tiny 50ms chunks; synchronous conversion avoids worker
      // startup/contention failures that can otherwise leave live Cloud stuck
      // receiving mic frames without sending provider audio.
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(this.provider.encodeAudio(audioData));
        this.sentAudioChunks++;
        if (this.sentAudioChunks === 1 || this.sentAudioChunks % 25 === 0) {
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            eId: this.instanceId,
            sentAudioChunks: this.sentAudioChunks,
            samples: audioData.length,
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

    const audioPolicy = this.provider.getAudioPolicy();
    const canSendAudio = this.providerReady || audioPolicy.canStreamBeforeProviderReady;
    if (!canSendAudio) return;

    while (
      this.pendingAudioSamples >= audioPolicy.minPacketSamples &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      await this.sendAudioChunk(this.takeBufferedAudioChunk(audioPolicy.minPacketSamples));
    }

    if (
      forceTail &&
      this.pendingAudioSamples > 0 &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      const tail = this.takeBufferedAudioChunk(this.pendingAudioSamples);
      const paddedTail = new Float32Array(audioPolicy.minPacketSamples);
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
