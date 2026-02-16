import logger from '../../lib/logger';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { ITranscriptionMode, TranscriptionModeOptions } from './modes/types';
import { MicStream } from './utils/types';
import { calculateTranscriptStats, TranscriptStats } from '../../utils/fillerWordUtils';
import { ImmutableCallbackProxy } from './utils/ImmutableCallbackProxy';
import {
  TranscriptionPolicy,
  TranscriptionMode,
  resolveMode,
  PROD_FREE_POLICY,
} from './TranscriptionPolicy';
import { useSessionStore } from '../../stores/useSessionStore';
import { getE2EConfig } from '../../../../tests/types/e2eConfig';

export interface TranscriptUpdate {
  transcript: {
    partial?: string;
    final?: string;
  };
  chunks?: { timestamp: [number, number]; text: string }[];
}

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'fallback' | 'error';

/**
 * ARCHITECTURE (Senior Architect):
 * Explicit states for TranscriptionService FSM.
 * IDLE -> INITIALIZING -> READY -> STARTING -> RECORDING -> STOPPING -> IDLE
 * Any state -> ERROR
 */
export type ServiceState =
  | 'IDLE'
  | 'INITIALIZING_ENGINE'
  | 'ENGINE_READY'
  | 'ACTIVATING_MIC'
  | 'READY'
  | 'STARTING'
  | 'RECORDING'
  | 'STOPPING'
  | 'ERROR';

export interface SttStatus {
  type: SttStatusType;
  message: string;
  detail?: string;
  progress?: number;
  newMode?: TranscriptionMode;
}

export interface TranscriptionServiceOptions {
  onTranscriptUpdate: (update: TranscriptUpdate) => void;
  onModelLoadProgress: (progress: number | null) => void;
  onReady: () => void;
  session: Session | null;
  navigate: NavigateFunction;
  getAssemblyAIToken: () => Promise<string | null>;
  customVocabulary?: string[];
  /** 
   * The policy that controls which modes are allowed and preferred.
   * Defaults to PROD_FREE_POLICY if not provided.
   */
  policy?: TranscriptionPolicy;
  /**
   * Optional: Inject a mock microphone for E2E testing.
   * If provided, the service will use this instead of creating a real mic.
   */
  mockMic?: MicStream;
  onModeChange?: (mode: TranscriptionMode | null) => void;
  /** Callback for STT status changes (initialization, fallback, errors) */
  onStatusChange?: (status: SttStatus) => void;
  /** Callback for raw audio data (for visualization/analysis) */
  onAudioData?: (data: Float32Array) => void;
}

import { STT_CONFIG } from '../../config';
import { testRegistry } from './TestRegistry'; // Test Registry Pattern
import { IPrivateSTT } from './engines/IPrivateSTT';

// Extend Window interface for E2E mocks
declare global {
  interface Window {
    MockPrivateWhisper?: new (config: TranscriptionModeOptions) => ITranscriptionMode;
    __E2E_MOCK_LOCAL_WHISPER__?: boolean;
    MockNativeBrowser?: new (config: TranscriptionModeOptions) => ITranscriptionMode;
    __E2E_MOCK_NATIVE__?: boolean;
    __FAKE_PRIVATE_STT__?: IPrivateSTT; // Injected Fake
  }
}

/**
 * Track failures with timestamps for time-based decay.
 * Failures expire after FAILURE_DECAY_MS to prevent permanent lockout.
 */
const FAILURE_DECAY_MS = 5 * 60 * 1000; // 5 minutes

interface FailureRecord {
  count: number;
  lastFailureTime: number;
}

const VALID_MODES = ['native', 'private', 'cloud'] as const;

// isValidMode moved inside class or used via export if needed

export default class TranscriptionService {
  private static privateFailures: FailureRecord = { count: 0, lastFailureTime: 0 };
  protected mode: TranscriptionMode | null = null;
  protected state: ServiceState = 'IDLE';
  // ... existing private properties ...
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress: (progress: number | null) => void;
  private onReady: () => void;
  private onModeChange?: (mode: TranscriptionMode | null) => void;

  // ZOMBIE PREVENTION: Guard against concurrent terminate calls
  protected isTerminating = false;
  private onStatusChange?: (status: SttStatus) => void;
  private onAudioData?: (data: Float32Array) => void;
  private session: Session | null;
  private navigate: NavigateFunction;
  private getAssemblyAIToken: () => Promise<string | null>;
  private customVocabulary: string[];
  private policy: TranscriptionPolicy;
  private mockMic: MicStream | null;
  private mic: MicStream | null = null;
  private callbackProxy: ImmutableCallbackProxy<TranscriptionModeOptions>;
  private static hasInitializedBefore = !!localStorage.getItem('ss_stt_initialized');
  private stateStartTime: number = Date.now();
  private lastError: Error | null = null;
  protected instance: ITranscriptionMode | null = null;
  private startTime: number | null = null;
  private startTimestamp: number = 0;
  private readonly MIN_RECORDING_DURATION_MS = 100;
  private statusMessageTimeout: NodeJS.Timeout | null = null;
  private trackedModelProgress: number | null = null;

  constructor({
    onTranscriptUpdate,
    onModelLoadProgress,
    onReady,
    customVocabulary = [],
    session,
    navigate,
    getAssemblyAIToken,
    policy = PROD_FREE_POLICY,
    mockMic,
    onModeChange,
    onStatusChange,
    onAudioData,
  }: TranscriptionServiceOptions) {
    logger.info(
      { policy: policy.executionIntent },
      `[TranscriptionService] Constructor called with policy: ${policy.executionIntent}`
    );
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.onModeChange = onModeChange;
    this.onStatusChange = onStatusChange;
    this.session = session;
    this.navigate = navigate;
    this.getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.policy = policy;
    this.mockMic = mockMic ?? null;
    this.onAudioData = onAudioData;

    // Initialize the callback proxy with the initial options
    this.callbackProxy = new ImmutableCallbackProxy({
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: (progress: number | null) => {
        logger.info({ progress }, '[TranscriptionService] Model load progress');
        this.trackedModelProgress = progress;
        this.onModelLoadProgress?.(progress);
        useSessionStore.getState().setModelLoadingProgress(progress !== null ? Math.round(progress * 100) : null);
        // Push progress to UI status specifically for downloading state
        if (progress !== null && progress < 100) {
          this.onStatusChange?.({
            type: 'downloading',
            message: 'Getting ready...',
            detail: TranscriptionService.hasInitializedBefore
              ? undefined
              : 'Downloading speech model (6 MB)',
            progress
          });
        }
      },
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
      customVocabulary: this.customVocabulary,
      onAudioData: this.onAudioData,
      onError: (err: Error) => {
        logger.error({ err }, '[TranscriptionService] Error from mode provider');
        this.transitionTo('ERROR');
        this.onStatusChange?.({
          type: 'error',
          message: 'Unable to start recording'
        });
      }
    });
  }

  /**
   * Resets the static failure count.
   * STRICTLY FOR TESTING PURPOSES ONLY.
   */
  public static resetFailureCount(): void {
    TranscriptionService.privateFailures = { count: 0, lastFailureTime: 0 };
  }

  /**
   * Update the policy on an existing service instance.
   * 
   * CRITICAL: Fixes the Free/Pro Policy Race Condition where the singleton
   * is constructed before the user profile loads, defaulting to prod-free.
   * Call this before startTranscription() to ensure the correct policy
   * (e.g. prod-pro with allowPrivate: true) is used for mode resolution.
   */
  public updatePolicy(newPolicy: TranscriptionPolicy): void {
    if (this.policy.executionIntent !== newPolicy.executionIntent) {
      logger.info(
        { oldPolicy: this.policy.executionIntent, newPolicy: newPolicy.executionIntent },
        '[TranscriptionService] 🔄 Policy updated on existing singleton'
      );
    }
    this.policy = newPolicy;
  }

  /**
   * Update callbacks on an existing service instance.
   * 
   * CRITICAL: Fixes Stale Callback Closures after React Remounts.
   * When the app remounts (e.g. after ProfileGuard loads), the hook 
   * provides fresh callbacks. We must re-hydrate the singleton with them.
   */
  public updateCallbacks(options: Partial<TranscriptionServiceOptions>): void {
    logger.info('[TranscriptionService] 🔄 Hydrating callbacks on existing singleton');

    if (options.onTranscriptUpdate) this.onTranscriptUpdate = options.onTranscriptUpdate;
    if (options.onModelLoadProgress) this.onModelLoadProgress = options.onModelLoadProgress;
    if (options.onReady) this.onReady = options.onReady;
    if (options.onModeChange) this.onModeChange = options.onModeChange;
    if (options.onStatusChange) this.onStatusChange = options.onStatusChange;
    if (options.onAudioData) this.onAudioData = options.onAudioData;
    if (options.session !== undefined) this.session = options.session;
    if (options.getAssemblyAIToken) this.getAssemblyAIToken = options.getAssemblyAIToken;

    // Update the proxy to ensure child modes use the latest callbacks
    this.callbackProxy.update({
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: (progress: number | null) => {
        this.trackedModelProgress = progress;
        this.onModelLoadProgress?.(progress);
        useSessionStore.getState().setModelLoadingProgress(progress !== null ? Math.round(progress * 100) : null);
        if (progress !== null && progress < 100) {
          this.onStatusChange?.({
            type: 'downloading',
            message: 'Getting ready...',
            detail: TranscriptionService.hasInitializedBefore
              ? undefined
              : 'Downloading speech model (6 MB)',
            progress
          });
        }
      },
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
      customVocabulary: this.customVocabulary,
      onAudioData: this.onAudioData,
      onError: (err: Error) => {
        logger.error({ err }, '[TranscriptionService] Error from mode provider');
        this.transitionTo('ERROR');
        this.onStatusChange?.({
          type: 'error',
          message: 'Unable to start recording'
        });
      }
    });
  }

  /**
   * Get effective failure count with time-based decay.
   * Failures older than FAILURE_DECAY_MS are ignored.
   */
  private static getEffectiveFailureCount(): number {
    const now = Date.now();
    if (now - TranscriptionService.privateFailures.lastFailureTime > FAILURE_DECAY_MS) {
      // Failures have decayed, reset count
      TranscriptionService.privateFailures = { count: 0, lastFailureTime: 0 };
      return 0;
    }
    return TranscriptionService.privateFailures.count;
  }

  /**
   * Record a private mode failure with timestamp.
   */
  private static recordPrivateFailure(): void {
    TranscriptionService.privateFailures = {
      count: TranscriptionService.getEffectiveFailureCount() + 1,
      lastFailureTime: Date.now()
    };
  }

  private micError: Error | null = null;

  private getFriendlyError(error: Error): string {
    const msg = error.message.toLowerCase();
    const name = error.name;

    if (name === 'NotAllowedError' || msg.includes('permission')) {
      return 'Microphone access blocked';
    }
    if (name === 'NotFoundError' || msg.includes('not found')) {
      return 'No microphone detected';
    }
    if (msg.includes('timeout')) {
      return 'Taking longer than expected';
    }
    return 'Unable to start recording';
  }

  private getErrorAction(error: Error): string {
    const msg = error.message.toLowerCase();
    const name = error.name;

    if (name === 'NotAllowedError' || msg.includes('permission')) {
      return 'Check browser settings to allow microphone access';
    }
    if (name === 'NotFoundError' || msg.includes('not found')) {
      return 'Please connect a microphone and try again';
    }
    return 'Try refreshing the page';
  }

  private transitionTo(newState: ServiceState, error?: Error): void {
    const elapsedSinceStart = Date.now() - this.stateStartTime;
    logger.info({ from: this.state, to: newState, elapsedSinceStart }, `[TranscriptionService] State transition: ${this.state} -> ${newState}`);

    const store = useSessionStore.getState();
    this.state = newState; // CRITICAL: Update internal state for lifecycle methods
    this.stateStartTime = Date.now();
    if (error) this.lastError = error;

    // Clear any pending progressive disclosure timers
    if (this.statusMessageTimeout) {
      clearTimeout(this.statusMessageTimeout);
      this.statusMessageTimeout = null;
    }

    const isFirstTime = !TranscriptionService.hasInitializedBefore;

    // Map internal states to 3-tier user messages (Expert Recommendation)
    const updateUI = () => {
      switch (newState) {
        case 'IDLE': {
          const idleStatus: SttStatus = { type: 'idle', message: '' };
          this.onStatusChange?.(idleStatus);
          store.setSTTStatus(idleStatus);
          break;
        }

        case 'INITIALIZING_ENGINE': {
          const initStatus: SttStatus = {
            type: 'initializing',
            message: 'Preparing...',
            detail: isFirstTime ? 'Setting up speech recognition (one-time setup)' : undefined
          };
          this.onStatusChange?.(initStatus);
          store.setSTTStatus(initStatus);

          // Strategy 1: Time-Based Progressive Disclosure (> 8s)
          this.statusMessageTimeout = setTimeout(() => {
            if (this.state === 'INITIALIZING_ENGINE' && !this.trackedModelProgress) {
              const loadingStatus: SttStatus = {
                type: 'initializing',
                message: 'Loading speech engine...',
                detail: 'Taking longer than expected. Please wait.'
              };
              this.onStatusChange?.(loadingStatus);
              store.setSTTStatus(loadingStatus);
            }
          }, 8000);
          break;
        }

        case 'ACTIVATING_MIC':
        case 'READY': {
          TranscriptionService.hasInitializedBefore = true;
          localStorage.setItem('ss_stt_initialized', 'true');
          const readyStatus: SttStatus = {
            type: 'ready',
            message: 'Ready to record',
            detail: this.mode === 'private'
              ? '✓ Private mode active. Your audio stays on-device.'
              : undefined
          };
          this.onStatusChange?.(readyStatus);
          store.setSTTStatus(readyStatus);
          break;
        }

        case 'STARTING': {
          const startingStatus: SttStatus = {
            type: 'initializing',
            message: 'Starting...',
            detail: undefined
          };
          this.onStatusChange?.(startingStatus);
          store.setSTTStatus(startingStatus);
          break;
        }

        case 'RECORDING': {
          const recordingStatus: SttStatus = {
            type: 'ready',
            message: 'Recording',
            detail: undefined
          };
          this.onStatusChange?.(recordingStatus);
          store.setSTTStatus(recordingStatus);
          break;
        }

        case 'STOPPING': {
          const finishingStatus: SttStatus = {
            type: 'initializing',
            message: 'Converting speech to text...',
            detail: undefined
          };
          this.onStatusChange?.(finishingStatus);
          store.setSTTStatus(finishingStatus);
          break;
        }

        case 'ERROR': {
          const err = error || this.lastError || new Error('Unknown error');
          const errorStatus: SttStatus = {
            type: 'error',
            message: this.getFriendlyError(err),
            detail: this.getErrorAction(err)
          };
          this.onStatusChange?.(errorStatus);
          store.setSTTStatus(errorStatus);
          break;
        }

        default: {
          const defaultStatus: SttStatus = { type: 'idle', message: 'Ready' };
          this.onStatusChange?.(defaultStatus);
          store.setSTTStatus(defaultStatus);
        }
      }
    };

    // ARCHITECTURE (Senior Architect): 
    // Decouple Store updates from State transitions using queueMicrotask.
    // This prevents "Should not already be working" errors in React 18 during unmount
    // or concurrent rendering cycles where store updates might trigger nested renders.
    queueMicrotask(() => {
      updateUI();
    });
  }

  /**
   * Primary Entry Point: Pre-warms the engine and optionally activates the microphone.
   * Following Option 1 (System Integrity): Decouples WASM warmup from hardware.
   */
  public async init(): Promise<{ success: boolean }> {
    if (this.state !== 'IDLE' && this.state !== 'ERROR') {
      logger.warn({ currentState: this.state }, '[TranscriptionService] init() called in non-IDLE state');
      return { success: this.state === 'READY' || this.state === 'RECORDING' || this.state === 'STARTING' };
    }

    this.transitionTo('ACTIVATING_MIC');

    // If a mock mic was injected (for E2E), use it directly
    if (this.mockMic) {
      logger.info('[TranscriptionService] Using injected mock microphone');
      this.mic = this.mockMic;
      this.transitionTo('READY');
      return { success: true };
    }

    logger.info('[TranscriptionService] Initializing mic stream...');
    try {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      logger.info('[TranscriptionService] Mic stream created.');
      this.micError = null;
      this.transitionTo('READY');
      return { success: true };
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] Failed to initialize mic');
      this.micError = error instanceof Error ? error : new Error(String(error));
      this.transitionTo('ERROR');
      return { success: false };
    }
  }

  /**
   * Starts the transcription process.
   * Auto-initializes the microphone if it's in IDLE or ERROR state.
   * 
   * @param runtimePolicy - Optional policy to apply immediately before starting.
   * Forces the service to use this policy for mode resolution, overriding constructor defaults.
   */
  public async startTranscription(runtimePolicy?: TranscriptionPolicy): Promise<void> {
    if (runtimePolicy) {
      this.updatePolicy(runtimePolicy);
    }

    if (this.state === 'RECORDING' || this.state === 'STARTING') {
      logger.warn({ currentState: this.state }, '[TranscriptionService] startTranscription() called while already active');
      return;
    }

    if (this.state !== 'READY') {
      // Auto-init if called while IDLE
      if (this.state === 'IDLE' || this.state === 'ERROR') {
        const initResult = await this.init();
        if (!initResult.success && resolveMode(this.policy) !== 'native') {
          throw new Error('Transcription cannot start: Initializing failed and no fallback possible.');
        }
      } else {
        throw new Error(`Invalid state for startTranscription: ${this.state}`);
      }
    }

    this.transitionTo('INITIALIZING_ENGINE');
    let resolvedMode = resolveMode(this.policy);
    useSessionStore.getState().setSTTMode(resolvedMode);
    this.mode = resolvedMode;
    this.startTimestamp = Date.now();
    logger.info({
      resolvedMode,
      policyIntent: this.policy.executionIntent,
      allowNative: this.policy.allowNative,
      allowCloud: this.policy.allowCloud,
      allowPrivate: this.policy.allowPrivate,
      preferred: this.policy.preferredMode
    }, '[TranscriptionService] startTranscription: Mode resolved');

    const proxy = this.callbackProxy.getProxy();
    const providerConfig: TranscriptionModeOptions = {
      onTranscriptUpdate: proxy.onTranscriptUpdate,
      onModelLoadProgress: proxy.onModelLoadProgress,
      onReady: proxy.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
      customVocabulary: this.customVocabulary,
      onAudioData: this.onAudioData,
      onError: (err) => {
        logger.error({ err }, '[TranscriptionService] Error from mode provider');
        this.transitionTo('ERROR');
        this.onStatusChange?.({ type: 'error', message: err.message });
      }
    };

    // CHECK MAX ATTEMPTS FOR PRIVATE MODE (with time-based decay)
    const effectiveFailures = TranscriptionService.getEffectiveFailureCount();
    logger.info({ effectiveFailures, threshold: STT_CONFIG.MAX_PRIVATE_ATTEMPTS }, '[TranscriptionService] Threshold check');
    if (resolvedMode === 'private' && effectiveFailures >= STT_CONFIG.MAX_PRIVATE_ATTEMPTS) {
      logger.warn({ attempts: effectiveFailures }, `[TranscriptionService] ⚠️ Max Private STT attempts reached. Forcing Native.`);

      this.onStatusChange?.({
        type: 'fallback',
        message: '⚠️ Too many failures. Switched to Native STT.',
        newMode: 'native'
      });

      resolvedMode = 'native';
    }

    try {
      // CHECK MICROPHONE REQUIREMENT
      if (resolvedMode !== 'native') {
        if (this.micError) {
          logger.error('[TranscriptionService] Blocking start: Mic initialization failed previously.');
          throw this.micError;
        }
        if (!this.mic) {
          logger.error('[TranscriptionService] Microphone not initialized.');
          throw new Error("Microphone not initialized. Call init() first.");
        }
      }

      await this.executeMode(resolvedMode, providerConfig);
    } catch (error) {
      // TRACK FAILURE with timestamp (Exclude CACHE_MISS which is just a loading state - Issue C)
      const isCacheMiss = error instanceof Error && error.message === 'CACHE_MISS';
      if (resolvedMode === 'private' && !isCacheMiss) {
        TranscriptionService.recordPrivateFailure();
        logger.warn({ failures: TranscriptionService.getEffectiveFailureCount() }, `[TranscriptionService] Private mode failed`);
      }

      // If fallback is allowed, try alternatives
      if (this.policy.allowFallback) {
        logger.warn({ error, failedMode: resolvedMode }, `[TranscriptionService] ⚠️ Mode failed, attempting fallback...`);
        await this.executeFallback(resolvedMode, providerConfig);
      } else {
        this.transitionTo('ERROR');
        throw error;
      }
    }
  }

  protected async executeMode(
    mode: TranscriptionMode,
    config: TranscriptionModeOptions
  ): Promise<void> {
    const normalizedMode = mode.trim().toLowerCase();
    logger.info({
      mode,
      normalizedMode,
      currentState: this.state,
      policyIntent: this.policy.executionIntent
    }, '[TranscriptionService] executeMode START');

    const isValidMode = (m: unknown): m is TranscriptionMode =>
      typeof m === 'string' && (VALID_MODES as readonly string[]).includes(m);

    if (!isValidMode(normalizedMode)) {
      throw new Error(`CRITICAL: Guard triggered. Invalid transcription mode: "${mode}" (normalized: "${normalizedMode}")`);
    }
    // EXECUTIVE REFINEMENT: Component Reusability
    // Only terminate if we are switching modes. If the current instance 
    // matches the requested mode (e.g., already warmed up), reuse it.
    const currentEngine = this.instance?.getEngineType() ?? null;
    const requestedEngine = mode === 'private' ? 'whisper-turbo' : mode;

    if (this.instance && currentEngine !== requestedEngine) {
      logger.info({ currentEngine, requestedEngine }, '[TranscriptionService] Mode mismatch, terminating previous instance...');
      await this.safeTerminateInstance();
    }

    const modeLabel = mode === 'native' ? 'Native Browser' : mode === 'cloud' ? 'Cloud' : 'Private';

    // Notify status: initializing (if not already warmed or different mode)
    if (!this.instance) {
      this.onStatusChange?.({ type: 'initializing', message: `Starting ${modeLabel} mode...` });
    }

    // CRITICAL (Expert RCA): Log exact bytes to detect hidden characters or stale artifacts
    logger.info({
      mode,
      modeType: typeof mode,
      modeValue: JSON.stringify(mode),
      modeCharCodes: Array.from(String(mode)).map(c => c.charCodeAt(0))
    }, '[TranscriptionService] executeMode diagnostics:');

    // Normalize (Expert RCA): Defensive trim and case normalization
    // (Already normalized at method start for validation)

    switch (normalizedMode) {
      case 'native':
        logger.info('[TranscriptionService] 🌐 Starting Native Browser mode');
        if (window.MockNativeBrowser && window.__E2E_MOCK_NATIVE__ === true) {
          logger.info('[TranscriptionService] 🧪 Using MockNativeBrowser for E2E');
          this.instance = new window.MockNativeBrowser(config);
          break;
        }
        this.instance = new NativeBrowser(config);
        break;

      case 'cloud':
        logger.info('[TranscriptionService] ☁️ Starting Cloud (AssemblyAI) mode');
        this.instance = new CloudAssemblyAI(config);
        break;
      case 'private': {
        const configObj = getE2EConfig();

        // PRIORITY 1: TestRegistry (Most Specific Injection)
        const factory = testRegistry.get<() => IPrivateSTT>('private');
        if (factory) {
          const fake = factory();
          logger.info({ engine: fake.getEngineType() }, '[TranscriptionService] 🧪 Injecting engine from Registry');
          this.instance = new (await import('./modes/PrivateWhisper')).default(config, fake);
          break;
        }

        // PRIORITY 2: E2E Config Mocks
        if (configObj.stt.mocks.private !== false && window.MockPrivateWhisper) {
          logger.info('[TranscriptionService] 🧪 Using MockPrivateWhisper from Config');
          this.instance = new window.MockPrivateWhisper(config);
          break;
        }

        // PRIORITY 3: Real Implementation
        const module = await import('./modes/PrivateWhisper');
        this.instance = new module.default(config);
        logger.info({ engine: this.instance.getEngineType() }, '[TranscriptionService] 🔒 Instance created');
        break;
      }

      default: {
        // Exhaustive check (Expert RCA)
        const exhaustiveCheck: never = normalizedMode;
        void exhaustiveCheck;
        throw new Error(
          `Unknown transcription mode: "${mode}" ` +
          `(normalized: "${normalizedMode}") ` +
          `[Type: ${typeof mode}] ` +
          `[Bytes: ${Array.from(String(mode)).map(c => c.charCodeAt(0)).join(',')}]`
        );
      }
    }

    try {
      // Optimistic Entry Logic
      if (mode === 'private') {
        const configObj = getE2EConfig();
        const isMock = configObj.stt.mode === 'mock' ||
          configObj.stt.mocks.private !== false ||
          testRegistry.has('private');

        if (isMock) {
          logger.info({ config: configObj.stt }, '[TranscriptionService] 🧪 Mock detected - Bypassing Optimistic Entry timeout');
          await this.instance!.init();
        } else {
          logger.info('[TranscriptionService] ⚡ Using Optimistic Entry for Private mode');
          const initPromise = this.instance!.init();
          const LOAD_CACHE_TIMEOUT_MS = 2000; /**** 🛡️ [System Integrity] Reduced to 2s for rapid Optimistic Entry / Fallback (from 30s) ****/
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('CACHE_MISS')), LOAD_CACHE_TIMEOUT_MS);
          });

          try {
            await Promise.race([initPromise, timeoutPromise]);
            logger.info('[TranscriptionService] ✅ Private model Cache Hit - Instant Start');
          } catch (err: unknown) {
            const error = err as Error;
            if (error.message === 'CACHE_MISS') {
              logger.info('[TranscriptionService] ⏳ Private model Cache Miss - Triggering Background Load + Fallback');
              this.onModelLoadProgress(0);

              initPromise.then(() => {
                logger.info('[TranscriptionService] ✨ Background Private model ready.');
                this.onModelLoadProgress(100);
                this.onReady();
              }).catch(backgroundErr => {
                logger.error({ backgroundErr }, '[TranscriptionService] Background model load failed');
              });
              throw err;
            }
            throw err;
          }
        }
      } else {
        await this.instance!.init();
      }

      await this.instance!.startTranscription(this.mic!);
      this.startTime = Date.now();
      this.mode = mode;
      this.onModeChange?.(this.mode);
      useSessionStore.getState().setActiveEngine(mode);

      // GUARD: Only transition if we haven't hit an error already (Issue C)
      if (this.state !== 'ERROR') {
        this.transitionTo('RECORDING');
        this.onStatusChange?.({ type: 'ready', message: `Recording active (${modeLabel})` });
      }

    } catch (error) {
      const isCacheMiss = error instanceof Error && error.message === 'CACHE_MISS';
      logger.error({ error, mode, isCacheMiss }, '[TranscriptionService] execution failed');

      // If it's a CACHE_MISS, we don't transition to ERROR here because 
      // the caller (startTranscription) will handle the fallback or final error transition.
      if (!isCacheMiss) {
        this.transitionTo('ERROR');
      }
      throw error;
    }
  }

  /**
   * Attempt fallback to an alternative mode after failure.
   * 
   * FALLBACK RULES:
   * - Native: No fallback (it's the base tier)
   * - Cloud: Falls back to Native only
   * - Private: Falls back to Native only (internal WebGPU→CPU handled by PrivateSTT)
   * 
   * Cloud and Private are Pro-only features and cannot be fallback targets.
   */
  private async executeFallback(
    failedMode: TranscriptionMode,
    config: TranscriptionModeOptions
  ): Promise<void> {
    // Native is the base tier - no further fallback available
    if (failedMode === 'native') {
      logger.error('[TranscriptionService] ❌ Native mode failed. No fallback available.');
      this.onStatusChange?.({ type: 'error', message: '❌ Native STT failed. No fallback available.' });
      throw new Error('[TranscriptionService] Native mode failed. No fallback available.');
    }

    // Cloud and Private both fall back to Native only
    logger.info({ failedMode, targetMode: 'native' }, '[TranscriptionService] 🔄 Fallback');

    try {
      this.onStatusChange?.({
        type: 'fallback',
        message: `⚠️ Switched to Native Browser mode (${failedMode} unavailable)`,
        newMode: 'native'
      });
      await this.executeMode('native', config);
    } catch (nativeError) {
      logger.error({ error: nativeError }, '[TranscriptionService] ❌ Native fallback also failed');
      this.transitionTo('ERROR');
      this.onStatusChange?.({
        type: 'error',
        message: 'Unable to start recording'
      });
      throw new Error('[TranscriptionService] All fallback modes failed');
    }
  }

  /**
   * Check if a mode is allowed by the current policy.
   */
  private isModeAllowedByPolicy(mode: TranscriptionMode): boolean {
    switch (mode) {
      case 'native': return this.policy.allowNative;
      case 'cloud': return this.policy.allowCloud;
      case 'private': return this.policy.allowPrivate;
      default: return false;
    }
  }

  public async stopTranscription(): Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null> {
    const elapsed = Date.now() - this.startTimestamp;

    // INDUSTRY STANDARD: Prevent rapid start/stop cycles
    if (elapsed < this.MIN_RECORDING_DURATION_MS) {
      logger.warn(
        `[TranscriptionService] ⚠️ Stop ignored - called too quickly (${elapsed}ms < ${this.MIN_RECORDING_DURATION_MS}ms)`
      );
      return null;
    }

    if (this.state !== 'RECORDING' && this.state !== 'STARTING') {
      logger.warn({ currentState: this.state }, '[TranscriptionService] stopTranscription() called while not active');
      return null;
    }

    logger.info(`[TranscriptionService] Stopping transcription (elapsed: ${elapsed}ms)`);

    this.transitionTo('STOPPING');
    logger.info('[TranscriptionService] Stopping transcription.');

    try {
      const finalTranscript = this.instance ? await this.instance.stopTranscription() : '';
      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

      const stats = calculateTranscriptStats(
        [{ text: finalTranscript }],
        [],
        '',
        duration
      );

      this.transitionTo('READY');
      useSessionStore.getState().setActiveEngine(null);
      return {
        success: true,
        transcript: finalTranscript,
        stats
      };
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] stopTranscription failed');
      this.transitionTo('ERROR');
      return { success: false, transcript: '', stats: { transcript: '', total_words: 0, accuracy: 0, duration: 0 } };
    } finally {
      this.startTime = null;
    }
  }

  public async getTranscript(): Promise<string> {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  public getMode(): TranscriptionMode | null {
    return this.mode;
  }

  public async destroy(): Promise<void> {
    if (this.state === 'IDLE') return;

    logger.info({ currentState: this.state }, '[TranscriptionService] Destroying service.');
    this.transitionTo('STOPPING');

    // CRITICAL: Stop microphone IMMEDIATELY to release hardware resources.
    try {
      if (this.mic) {
        this.mic.stop();
        this.mic = null;
        logger.info('[TranscriptionService] Microphone stopped.');
      }
    } catch (error) {
      logger.debug({ error }, '[TranscriptionService] Error stopping mic during destroy');
    }

    // Attempt strict termination if available
    await this.safeTerminateInstance();

    this.transitionTo('IDLE');
  }

  /**
   * Safely terminates the current instance with double-dispose guard.
   * Prevents race conditions where a new instance is created before the old one dies.
   */
  protected async safeTerminateInstance(): Promise<void> {
    if (!this.instance) return;

    // Guard against concurrent terminate calls
    if (this.isTerminating) {
      logger.warn('[TranscriptionService] Terminate already in progress, waiting...');

      // Retry loop: wait up to 2000ms (conservative for slow devices)
      let retries = 40; // 40 * 50ms = 2000ms
      while (this.isTerminating && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
        retries--;
      }

      if (this.isTerminating) {
        logger.warn('[TranscriptionService] Timeout waiting for concurrent termination. Proceeding forcibly.');
      }
    }

    this.isTerminating = true;

    try {
      // ARCHITECTURE (Senior Architect):
      // Re-check after waiting for lock. The instance might have been
      // nulled out by the previous holder of the lock.
      if (!this.instance) {
        return;
      }

      const instanceToTerminate = this.instance;
      // CRITICAL: Immediately null out to prevent use-after-free or zombie usage
      this.instance = null;

      logger.info('[TranscriptionService] Terminating active instance...');

      if (typeof instanceToTerminate.terminate === 'function') {
        await instanceToTerminate.terminate();
      } else if ('destroy' in instanceToTerminate && typeof (instanceToTerminate as unknown as { destroy: () => Promise<void> }).destroy === 'function') {
        await (instanceToTerminate as unknown as { destroy: () => Promise<void> }).destroy();
      } else {
        await instanceToTerminate.stopTranscription();
      }
      logger.info('[TranscriptionService] Instance terminated successfully.');
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] Error cleaning up instance');
    } finally {
      this.isTerminating = false;
    }
  }
}
