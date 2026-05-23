import logger from '../../../lib/logger';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript, Result } from './types';
import { TranscriptionError } from '../errors';
import { IPrivateSTTEngine, EngineType } from '../../../contracts/IPrivateSTTEngine';
import { MicStream } from '../utils/types';
import { STTEngine } from '../../../contracts/STTEngine';
import { ENV } from '../../../config/TestFlags';
import { NATIVE_STT } from '../sttConstants';
import { NativeBrowserStrategy, resolveNativeBrowserStrategy } from './nativeBrowserStrategies';

declare global {
  interface Window {
    __NATIVE_BROWSER_TRACE__?: Array<Record<string, unknown>>;
  }
}

function pushNativeTrace(event: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  window.__NATIVE_BROWSER_TRACE__ = window.__NATIVE_BROWSER_TRACE__ ?? [];
  window.__NATIVE_BROWSER_TRACE__.push({
    t: Number(performance.now().toFixed(1)),
    event,
    ...payload,
  });

  if (window.__NATIVE_BROWSER_TRACE__.length > 500) {
    window.__NATIVE_BROWSER_TRACE__.shift();
  }
}

// A simplified interface for the SpeechRecognition event
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    isFinal: boolean;
    [key: number]: {
      transcript: string;
    };
  }[];
}

// A simplified interface for the SpeechRecognition error event
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

// Define a type for the SpeechRecognition API to avoid using 'any'
interface SpeechRecognition {
  lang?: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onnomatch?: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionStatic {
  new(): SpeechRecognition;
}

/**
 * NativeBrowser implementation of the STTEngine abstract base class.
 * Leverages the browser's built-in SpeechRecognition API.
 */
export default class NativeBrowser extends STTEngine implements ITranscriptionEngine {
  public readonly type: EngineType = 'native-browser';
  private mockEngine?: IPrivateSTTEngine;
  private recognition: SpeechRecognition | null = null;
  private isSupported: boolean = true;
  private isListening: boolean = false;
  private isRestarting: boolean = false;
  public onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
  public onReady?: () => void;
  public onError?: (error: TranscriptionError) => void;
  private _engineType: EngineType | null = null;
  private finalizedResultIndexes = new Set<number>();
  private lastInterim = '';
  private browserStrategy: NativeBrowserStrategy | null = null;

  constructor(options: Partial<TranscriptionModeOptions> = {}, mockEngine?: IPrivateSTTEngine) {
    super(options as TranscriptionModeOptions);
    this.mockEngine = mockEngine;
    
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.runId || 'unknown';
  }

  private get modeOptions(): TranscriptionModeOptions | null {
    return this.options as TranscriptionModeOptions;
  }

  /**
   * STTStrategy Requirement: Probe availability and prerequisites.
   */
  public async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
    // Mock engine injected = availability is authoritatively declared by test harness
    if (this.mockEngine) {
      return { isAvailable: true };
    }

    // 1. Check for basic browser support
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    const strategy = resolveNativeBrowserStrategy({
      hasSpeechRecognition: Boolean(SpeechRecognition),
      userAgent: navigator.userAgent,
    });
    if (!SpeechRecognition) {
      return {
        isAvailable: false,
        reason: 'UNSUPPORTED',
        message: strategy.userMessage || 'This browser does not provide a usable SpeechRecognition API.'
      };
    }

    // 2. Check for microphone permission if API is available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (result.state === 'denied') {
          return {
            isAvailable: false,
            reason: 'PERMISSION_DENIED',
            message: 'Microphone access is denied. Please grant permission in your browser settings.'
          };
        }
      } catch (err) {
        logger.warn({ err }, '[NativeBrowser] Permission query failed.');
      }
    }

    return { isAvailable: true };
  }


  protected override async onInit(timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>> {
    // Use injected mock if available
    if (this.mockEngine) {
        logger.info('[NativeBrowser] 🧪 Using injected MockEngine');
        if (this.mockEngine.init) {
            await this.mockEngine.init(timeoutMs, isMock);
        }
        return Result.ok(undefined);
    }

    if (typeof window === 'undefined') return Result.ok(undefined);
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    this.isSupported = !!SpeechRecognition;
    this.browserStrategy = resolveNativeBrowserStrategy({
      hasSpeechRecognition: this.isSupported,
      userAgent: navigator.userAgent,
    });

    if (!this.isSupported) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Native browser speech recognition not supported');
      return Result.err(new Error('Native browser speech recognition not supported'));
    }

    this.recognition = new SpeechRecognition();
    this.browserStrategy.configure(this.recognition);

    pushNativeTrace('configured', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      browserFamily: this.browserStrategy.browserFamily,
      compatibilityMode: this.browserStrategy.compatibilityMode,
      userMessage: this.browserStrategy.userMessage,
      continuous: this.recognition.continuous,
      interimResults: this.recognition.interimResults,
      lang: this.recognition.lang || '(browser default)',
      userAgent: navigator.userAgent,
    });
    logger.info({
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      browserFamily: this.browserStrategy.browserFamily,
      compatibilityMode: this.browserStrategy.compatibilityMode,
      userMessage: this.browserStrategy.userMessage,
      continuous: this.recognition.continuous,
      interimResults: this.recognition.interimResults,
      lang: this.recognition.lang || '(browser default)',
      userAgent: navigator.userAgent,
    }, '[NativeBrowser] Recognition configured');

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      try {
        this.updateHeartbeat();
        const strategy = this.browserStrategy ?? resolveNativeBrowserStrategy({
          hasSpeechRecognition: true,
          userAgent: navigator.userAgent,
        });
        const { rawResults, finalTranscript, interimTranscript } = strategy.extractTranscripts(
          event,
          this.finalizedResultIndexes,
        );
        pushNativeTrace('onresult_raw', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          browserFamily: strategy.browserFamily,
          compatibilityMode: strategy.compatibilityMode,
          resultIndex: event.resultIndex,
          resultsLength: event.results?.length,
          rawResults,
        });
        logger.info({ sId: this.serviceId, rId: this.runId, resultIndex: event.resultIndex, resultsLength: event.results?.length, rawResults }, '[NativeBrowser] onresult called!');
        if (finalTranscript) {
          pushNativeTrace('final_candidate', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            finalTranscript,
          });
          logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, finalTranscript }, '[NativeBrowser] Final transcript received');
        }
        if (interimTranscript) {
          pushNativeTrace('interim_candidate', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            interimTranscript,
          });
          logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, interimTranscript }, '[NativeBrowser] Interim transcript received');
        }

        if (this.onTranscriptUpdate) {
          const latestInterim = this.getLatestInterimTranscript(interimTranscript);
          if (latestInterim) {
            pushNativeTrace('emit_partial', {
              sId: this.serviceId,
              rId: this.runId,
              eId: this.instanceId,
              interimTranscript,
              latestInterim,
              currentTranscript: this.currentTranscript,
            });
            this.onTranscriptUpdate({ 
                transcript: { partial: latestInterim }
            });
          }
          if (finalTranscript) {
            this.lastInterim = '';
            this.currentTranscript = this.currentTranscript
              ? `${this.currentTranscript} ${finalTranscript.trim()}`
              : finalTranscript.trim();
            pushNativeTrace('emit_final', {
              sId: this.serviceId,
              rId: this.runId,
              eId: this.instanceId,
              finalTranscript,
              currentTranscript: this.currentTranscript,
            });
            this.onTranscriptUpdate({ 
                transcript: { final: finalTranscript }
            });
          }
        }
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onresult handler:");
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      try {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error: event.error }, `[NativeBrowser] Speech recognition error: ${event.error}`);

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Microphone permission denied by user or browser settings');
          if (this.onError) {
            this.onError(TranscriptionError.permission('Microphone permission denied. Please allow microphone access in your browser/system settings.'));
          }
        }
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onerror handler:");
      }
    };

    this.recognition.onaudiostart = () => {
      pushNativeTrace('onaudiostart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onaudiostart');
    };

    this.recognition.onaudioend = () => {
      pushNativeTrace('onaudioend', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onaudioend');
    };

    this.recognition.onsoundstart = () => {
      pushNativeTrace('onsoundstart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onsoundstart');
    };

    this.recognition.onsoundend = () => {
      pushNativeTrace('onsoundend', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onsoundend');
    };

    this.recognition.onspeechstart = () => {
      pushNativeTrace('onspeechstart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onspeechstart');
    };

    this.recognition.onspeechend = () => {
      pushNativeTrace('onspeechend', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onspeechend');
    };

    this.recognition.onnomatch = () => {
      pushNativeTrace('onnomatch', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onnomatch');
    };

    this.recognition.onend = () => {
      pushNativeTrace('onend', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        isListening: this.isListening,
        isRestarting: this.isRestarting,
      });
      if (!this.isListening || this.isRestarting) return;

      try {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onend reached, attempting immediate restart...');
        this.isRestarting = true;

        queueMicrotask(() => {
          if (this.isListening && this.recognition) {
            try {
              this.recognition.start();
              this.isRestarting = false;
            } catch (err) {
              logger.warn({ err }, "[NativeBrowser] Immediate restart failed, using backoff");
              this.retryWithBackoff(0);
            }
          } else {
            this.isRestarting = false;
          }
        });
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onend handler:");
        this.isRestarting = false;
      }
    };

    this.recognition.onstart = () => {
      pushNativeTrace('onstart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Recognition started');
      this.isListening = true;
      this.updateHeartbeat();
      this.onReady?.();
    };

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Init complete.');

    return Result.ok(undefined);
  }

  protected async onStart(_mic?: MicStream): Promise<void> {
    pushNativeTrace('onStart_enter', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      hasMockEngine: Boolean(this.mockEngine),
      hasRecognition: Boolean(this.recognition),
      isListening: this.isListening,
    });
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] start called');
    
    // E2E Test Bridge (Strict Zero)
    const win = window as unknown as Record<string, unknown>;

    if (ENV.isE2E || win.dispatchMockTranscript) {
      win.__activeSpeechRecognition = this.recognition as unknown;
      (win as Record<string, boolean>)['__e2e_e2e:speech-recognition-ready_fired__'] = true;
      window.dispatchEvent(new CustomEvent('e2e:speech-recognition-ready'));
    }

    if (this.mockEngine) {
      pushNativeTrace('onStart_mock_engine_branch', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
      });
      logger.info('[NativeBrowser] 🧪 Using injected MockEngine');
      if (this.mockEngine.start) await this.mockEngine.start(_mic);
      this.isListening = true;
      this.currentTranscript = '';
      this.finalizedResultIndexes.clear();
      this.lastInterim = '';
      return;
    }

    if (this.recognition) {
      pushNativeTrace('onStart_real_recognition_branch', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
      });
      this.currentTranscript = '';
      this.finalizedResultIndexes.clear();
      this.lastInterim = '';
      await this.startRecognitionAndWaitForReady();
    }

    pushNativeTrace('onStart_exit', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      isListening: this.isListening,
    });
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] recognition.start() called successfully.');
  }

  private async startRecognitionAndWaitForReady(): Promise<void> {
    if (!this.recognition) return;

    const recognition = this.recognition;
    const originalOnStart = recognition.onstart;
    const originalOnError = recognition.onerror;
    pushNativeTrace('recognition_start_attempt', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      continuous: recognition.continuous,
      interimResults: recognition.interimResults,
      lang: recognition.lang || '(browser default)',
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        recognition.onstart = originalOnStart;
        recognition.onerror = originalOnError;
        logger.error({
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          timeoutMs: NATIVE_STT.START_TIMEOUT_MS,
        }, '[NativeBrowser] SpeechRecognition start timed out before onstart');
        reject(TranscriptionError.unknown('Browser speech recognition did not start. Please try again or switch STT mode.'));
      }, NATIVE_STT.START_TIMEOUT_MS);

      recognition.onstart = () => {
        if (originalOnStart) originalOnStart();
        pushNativeTrace('recognition_start_onstart', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
        });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        recognition.onstart = originalOnStart;
        recognition.onerror = originalOnError;
        resolve();
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (originalOnError) originalOnError(event);
        pushNativeTrace('recognition_start_onerror', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          error: event.error,
        });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        recognition.onstart = originalOnStart;
        recognition.onerror = originalOnError;
        reject(TranscriptionError.unknown(`Browser speech recognition failed to start: ${event.error}`));
      };

      try {
        recognition.start();
        pushNativeTrace('recognition_start_invoked', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
        });
      } catch (err) {
        pushNativeTrace('recognition_start_throw', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        recognition.onstart = originalOnStart;
        recognition.onerror = originalOnError;
        reject(err);
      }
    });
  }

  protected async onStop(): Promise<void> {
    if (this.isTerminated) return;
    pushNativeTrace('onStop_enter', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      hasRecognition: Boolean(this.recognition),
      isListening: this.isListening,
      currentTranscript: this.currentTranscript,
    });
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Finalizing transcription shutdown');
    
    if (this.mockEngine) {
      pushNativeTrace('onStop_mock_engine_branch', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
      });
      if (this.mockEngine.stop) await this.mockEngine.stop();
      this.isListening = false;
      return;
    }

    if (!this.recognition || !this.isListening) {
      pushNativeTrace('onStop_skip_no_active_recognition', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        hasRecognition: Boolean(this.recognition),
        isListening: this.isListening,
      });
      this.isListening = false;
      this.isRestarting = false;
      return;
    }

    this.isListening = false;
    this.isRestarting = false;
    this.updateHeartbeat();

    // DETERMINISTIC SHUTDOWN: Await the 'onend' event
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('[NativeBrowser] SpeechRecognition stop timed out. Resolving.');
        resolve();
      }, NATIVE_STT.STOP_TIMEOUT_MS);

      if (this.recognition) {
        const originalOnEnd = this.recognition.onend;
        this.recognition.onend = () => {
          if (originalOnEnd) originalOnEnd();
          pushNativeTrace('recognition_stop_onend', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            currentTranscript: this.currentTranscript,
          });
          clearTimeout(timeout);
          resolve();
        };
        try {
          this.recognition.stop();
          pushNativeTrace('recognition_stop_invoked', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
          });
        } catch (err) {
          pushNativeTrace('recognition_stop_throw', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            error: err instanceof Error ? err.message : String(err),
          });
          logger.warn({ err }, '[NativeBrowser] Error in recognition.stop()');
          resolve();
        }
      } else {
        resolve();
      }
    });

    this.recognition = null; // Clear to prevent reuse
    pushNativeTrace('onStop_exit', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      currentTranscript: this.currentTranscript,
    });
  }

  private getLatestInterimTranscript(nextInterim: string): string {
    const normalizedNext = nextInterim.trim();
    if (!normalizedNext) {
      pushNativeTrace('latest_interim_empty_next_clear_previous', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        lastInterim: this.lastInterim,
      });
      this.lastInterim = '';
      return '';
    }

    this.lastInterim = normalizedNext;
    pushNativeTrace('latest_interim_update', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      normalizedNext,
    });
    return this.lastInterim;
  }

  public async pause(): Promise<void> {
    await super.pause();
  }

  protected async onPause(): Promise<void> {
    // Native browser handles audio internally; no-op for pause loop
  }

  public async resume(): Promise<void> {
    await super.resume();
  }

  protected async onResume(): Promise<void> {
    // Native browser handles audio internally; no-op for resume loop
  }

  protected async onDestroy(): Promise<void> {
    // Already handled in onStop via destroy() calling stop()
  }

  public async terminate(): Promise<void> {
    if (this.isTerminated) return;
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] 🛑 Nuclear termination requested');
    
    if (this.mockEngine) {
      if (typeof this.mockEngine.terminate === 'function') await this.mockEngine.terminate();
      else await this.mockEngine.destroy();
    }
    
    await this.onStop();
    await super.terminate();
  }

  public override async getTranscript(): Promise<string> {
    const engineWithGet = this.mockEngine as unknown as { getTranscript?: () => Promise<string> };
    if (engineWithGet && engineWithGet.getTranscript) {
        return engineWithGet.getTranscript();
    }
    return super.getTranscript();
  }

  public getLastHeartbeatTimestamp(): number {
    return this.mockEngine ? this.mockEngine.getLastHeartbeatTimestamp() : super.getLastHeartbeatTimestamp();
  }

  async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
    // Native browser handles audio internally.
    this.updateHeartbeat();
    return Result.ok(this.currentTranscript);
  }

  /** @internal */
  public override updateHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  private retryWithBackoff(attempt: number): void {
    if (attempt >= NATIVE_STT.RESTART_MAX_ATTEMPTS) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Max restart attempts reached, giving up');
      this.isRestarting = false;
      this.onError?.(TranscriptionError.unknown('Speech recognition restart failed after multiple attempts'));
      return;
    }

    const delay = NATIVE_STT.RESTART_BASE_DELAY_MS * Math.pow(2, attempt);
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, attempt, delay }, '[NativeBrowser] Scheduling retry with backoff');

    setTimeout(() => {
      if (!this.isListening || !this.recognition) {
        this.isRestarting = false;
        return;
      }

      try {
        this.recognition.start();
        this.isRestarting = false;
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, attempt }, '[NativeBrowser] Restart succeeded after backoff');
      } catch (err) {
        logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err, attempt }, '[NativeBrowser] Backoff retry failed, trying next attempt');
        this.retryWithBackoff(attempt + 1);
      }
    }, delay);
  }
}
