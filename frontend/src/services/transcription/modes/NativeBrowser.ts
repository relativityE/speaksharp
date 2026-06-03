import logger from '../../../lib/logger';
import { redactTranscript } from '../../../lib/logRedaction';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript, Result } from './types';
import { TranscriptionError } from '../errors';
import { IPrivateSTTEngine, EngineType } from '../../../contracts/IPrivateSTTEngine';
import { MicStream } from '../utils/types';
import { STTEngine } from '../../../contracts/STTEngine';
import { ENV } from '../../../config/TestFlags';
import { NATIVE_STT } from '../sttConstants';
import { NativeBrowserStrategy, resolveNativeBrowserStrategy } from './nativeBrowserStrategies';
import { formatNativeTranscript } from './nativeTranscriptFormatter';
import { registerNativeProductionFormatter } from './nativeGeminiFormatter';

declare global {
  interface Window {
    __NATIVE_BROWSER_TRACE__?: Array<Record<string, unknown>>;
    __NATIVE_PARALLEL_CAPTURE_TRACE__?: boolean;
    __NATIVE_PARALLEL_CAPTURE__?: NativeParallelMicCapture[];
    __activeSpeechRecognition?: unknown;
  }
}

type NativeParallelMicCapture = {
  createdAt: string;
  startedAt: string;
  endedAt: string;
  samples: number;
  durationSec: number;
  sampleRate: number;
  rms: number;
  peak: number;
  speechStartMs: number | null;
  speechEndMs: number | null;
  speechDurationMs: number;
  segmentCount: number;
  speechSegments: Array<{ startMs: number; endMs: number; rms: number; peak: number }>;
  wavDataUrl: string;
};

const NATIVE_BROWSER_TRACE_LIMIT = 5_000;

function pushNativeTrace(event: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  const safePayload = import.meta.env.MODE === 'production' && !ENV.debug
    ? Object.fromEntries(Object.entries(payload).map(([key, value]) => {
      if (/transcript|interim|currentTranscript/i.test(key) && typeof value === 'string') {
        return [key, { redacted: true, length: value.length }];
      }
      return [key, value];
    }))
    : payload;

  window.__NATIVE_BROWSER_TRACE__ = window.__NATIVE_BROWSER_TRACE__ ?? [];
  window.__NATIVE_BROWSER_TRACE__.push({
    t: Number(performance.now().toFixed(1)),
    event,
    ...safePayload,
  });

  if (window.__NATIVE_BROWSER_TRACE__.length > NATIVE_BROWSER_TRACE_LIMIT) {
    window.__NATIVE_BROWSER_TRACE__.shift();
  }
}

function isNativeParallelCaptureEnabled(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__NATIVE_PARALLEL_CAPTURE_TRACE__);
}

function summarizeAudioEnergy(audio: Float32Array) {
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < audio.length; i += 1) {
    const sample = audio[i] ?? 0;
    const abs = Math.abs(sample);
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
  }

  return {
    rms: audio.length > 0 ? Math.sqrt(sumSquares / audio.length) : 0,
    peak,
  };
}

function concatenateFrames(frames: Float32Array[]): Float32Array {
  const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;

  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }

  return output;
}

function analyzeSpeechSegments(audio: Float32Array, sampleRate: number) {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.05));
  const minSegmentMs = 120;
  const mergeGapMs = 180;
  const energy = summarizeAudioEnergy(audio);
  const threshold = Math.max(0.006, energy.rms * 1.8);
  const windows: Array<{ startMs: number; endMs: number; rms: number; peak: number; speech: boolean }> = [];

  for (let start = 0; start < audio.length; start += windowSize) {
    const end = Math.min(audio.length, start + windowSize);
    const slice = audio.subarray(start, end);
    const sliceEnergy = summarizeAudioEnergy(slice);
    windows.push({
      startMs: (start / sampleRate) * 1000,
      endMs: (end / sampleRate) * 1000,
      rms: sliceEnergy.rms,
      peak: sliceEnergy.peak,
      speech: sliceEnergy.rms >= threshold || sliceEnergy.peak >= threshold * 3,
    });
  }

  const segments: Array<{ startMs: number; endMs: number; rms: number; peak: number }> = [];
  for (const window of windows) {
    if (!window.speech) continue;
    const previous = segments[segments.length - 1];
    if (previous && window.startMs - previous.endMs <= mergeGapMs) {
      previous.endMs = window.endMs;
      previous.rms = Math.max(previous.rms, window.rms);
      previous.peak = Math.max(previous.peak, window.peak);
    } else {
      segments.push({
        startMs: window.startMs,
        endMs: window.endMs,
        rms: window.rms,
        peak: window.peak,
      });
    }
  }

  const filtered = segments
    .filter(segment => segment.endMs - segment.startMs >= minSegmentMs)
    .map(segment => ({
      startMs: Math.round(segment.startMs),
      endMs: Math.round(segment.endMs),
      rms: Number(segment.rms.toFixed(6)),
      peak: Number(segment.peak.toFixed(6)),
    }));
  return {
    speechStartMs: filtered[0]?.startMs ?? null,
    speechEndMs: filtered[filtered.length - 1]?.endMs ?? null,
    speechDurationMs: Math.round(filtered.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0)),
    segmentCount: filtered.length,
    speechSegments: filtered,
  };
}

function encodePcm16WavDataUrl(audio: Float32Array, sampleRate: number): string {
  const bytesPerSample = 2;
  const dataBytes = audio.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < audio.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, audio[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
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
  maxAlternatives?: number;
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
  abort?: () => void;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionStatic {
  new(): SpeechRecognition;
}

type NavigatorWithNativeBrowserHints = Navigator & {
  brave?: unknown;
  userAgentData?: {
    brands?: Array<{ brand: string; version?: string }>;
  };
};

const getNativeBrowserDetectionOptions = (nav: NavigatorWithNativeBrowserHints) => ({
  userAgent: nav.userAgent,
  browserBrands: nav.userAgentData?.brands?.map((brand) => brand.brand).filter(Boolean),
  isBrave: Boolean(nav.brave),
});

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
  /**
   * True after an explicit user Stop. Hard-stops the transcript: any subsequent
   * onresult (the stopping cycle's final flush OR a stray second recognition cycle,
   * e.g. "Hey Dad" spoken after Stop) is dropped, never appended to the completed
   * session. Reset on the next onStart.
   */
  private stopRequested: boolean = false;
  public onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
  public onReady?: () => void;
  public onError?: (error: TranscriptionError) => void;
  private _engineType: EngineType | null = null;
  private finalizedResultIndexes = new Set<number>();
  private lastInterim = '';
  private interimTranscriptBuffer = '';
  private lastMeaningfulInterim = '';
  private browserStrategy: NativeBrowserStrategy | null = null;
  private acousticReadySignaled = false;
  private parallelCaptureDisposer: (() => void) | null = null;
  private parallelCaptureFrames: Float32Array[] = [];
  private parallelCaptureSampleRate = 0;
  private parallelCaptureStartedAtMs = 0;
  private recognitionCycleId = 0;
  private cycleStartedAtMs = 0;
  private cycleAudioStartedAtMs = 0;
  private cycleSoundStartedAtMs = 0;
  private cycleSpeechStartedAtMs = 0;
  private cycleResultCount = 0;
  private cycleFinalResultCount = 0;
  private cycleInterimResultCount = 0;
  private cycleNomatchCount = 0;
  private cycleErrorCount = 0;
  private resultStallRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private resultStallRestartCount = 0;
  private noResultSpeechRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private noResultSpeechRestartCount = 0;
  private preserveInterimOnNextStart = false;
  private terminatePromise: Promise<void> | null = null;

  constructor(options: Partial<TranscriptionModeOptions> = {}, mockEngine?: IPrivateSTTEngine) {
    super(options as TranscriptionModeOptions);
    this.mockEngine = mockEngine;
    
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.runId || 'unknown';

    // Activate the trusted Native punctuation/casing formatter on the REAL production
    // construction path. Production builds engines via STTStrategyFactory (NOT
    // EngineSelector/EngineFactory, which has no production callers), so the formatter
    // was never registered and __NATIVE_FORMATTER_LAST__ came back null. Registering
    // here guarantees a real Native session restores punctuation on the saved
    // transcript. Production-gated: skip for injected mock engines / E2E.
    if (!mockEngine && !ENV.isE2E) {
      try {
        registerNativeProductionFormatter('native');
      } catch (err) {
        logger.warn({ err }, '[NativeBrowser] Native formatter registration skipped');
      }
    }
  }

  private get modeOptions(): TranscriptionModeOptions | null {
    return this.options as TranscriptionModeOptions;
  }

  private resetRecognitionCycle(reason: string): void {
    this.recognitionCycleId += 1;
    this.cycleStartedAtMs = performance.now();
    this.cycleAudioStartedAtMs = 0;
    this.cycleSoundStartedAtMs = 0;
    this.cycleSpeechStartedAtMs = 0;
    this.cycleResultCount = 0;
    this.cycleFinalResultCount = 0;
    this.cycleInterimResultCount = 0;
    this.cycleNomatchCount = 0;
    this.cycleErrorCount = 0;

    pushNativeTrace('recognition_cycle_reset', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      cycleId: this.recognitionCycleId,
      reason,
    });
    logger.info({
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      cycleId: this.recognitionCycleId,
      reason,
    }, '[NativeBrowser] cycle reset');
  }

  private getRecognitionCycleSummary(reason: string): Record<string, unknown> {
    const now = performance.now();
    const speechDurationMs = this.cycleSpeechStartedAtMs > 0 ? Number((now - this.cycleSpeechStartedAtMs).toFixed(1)) : null;
    const audioDurationMs = this.cycleAudioStartedAtMs > 0 ? Number((now - this.cycleAudioStartedAtMs).toFixed(1)) : null;
    const cycleDurationMs = this.cycleStartedAtMs > 0 ? Number((now - this.cycleStartedAtMs).toFixed(1)) : null;

    return {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      cycleId: this.recognitionCycleId,
      reason,
      cycleDurationMs,
      audioDurationMs,
      speechDurationMs,
      sawAudio: this.cycleAudioStartedAtMs > 0,
      sawSound: this.cycleSoundStartedAtMs > 0,
      sawSpeech: this.cycleSpeechStartedAtMs > 0,
      resultCount: this.cycleResultCount,
      finalResultCount: this.cycleFinalResultCount,
      interimResultCount: this.cycleInterimResultCount,
      nomatchCount: this.cycleNomatchCount,
      errorCount: this.cycleErrorCount,
      currentTranscriptLength: this.currentTranscript.length,
    };
  }

  private logRecognitionCycleSummary(reason: string): void {
    const summary = this.getRecognitionCycleSummary(reason);
    pushNativeTrace('recognition_cycle_summary', summary);
    logger.info(summary, '[NativeBrowser] recognition cycle summary');

    const speechDurationMs = typeof summary.speechDurationMs === 'number' ? summary.speechDurationMs : 0;
    if (summary.sawSpeech && speechDurationMs > 500 && this.cycleResultCount === 0) {
      pushNativeTrace('vad_truncation_drop', summary);
      logger.warn(summary, '[NativeBrowser] VAD_TRUNCATION_DROP speech detected but no result returned');
    }
  }

  /**
   * STTStrategy Requirement: Probe availability and prerequisites.
   */
  public async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return {
        isAvailable: false,
        reason: 'UNSUPPORTED',
        message: 'Browser speech recognition is not available outside a browser context.',
      };
    }

    // Mock engine injected = availability is authoritatively declared by test harness
    if (this.mockEngine) {
      return { isAvailable: true };
    }

    // 1. Check for minimum browser support
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    const strategy = resolveNativeBrowserStrategy({
      hasSpeechRecognition: Boolean(SpeechRecognition),
      ...getNativeBrowserDetectionOptions(navigator as NavigatorWithNativeBrowserHints),
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
      ...getNativeBrowserDetectionOptions(navigator as NavigatorWithNativeBrowserHints),
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
      maxAlternatives: this.recognition.maxAlternatives,
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
      maxAlternatives: this.recognition.maxAlternatives,
      lang: this.recognition.lang || '(browser default)',
      userAgent: navigator.userAgent,
    }, '[NativeBrowser] Recognition configured');

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      try {
        // Hard-stop guard: after an explicit user Stop, the transcript is frozen.
        // Drop the stopping cycle's trailing final flush AND any stray second
        // recognition cycle (e.g. "Hey Dad" spoken after Stop) so nothing can
        // append to the completed session. Reset on the next onStart.
        if (this.stopRequested) {
          pushNativeTrace('onresult_dropped_after_stop', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            cycleId: this.recognitionCycleId,
          });
          return;
        }
        this.updateHeartbeat();
        const strategy = this.browserStrategy ?? resolveNativeBrowserStrategy({
          hasSpeechRecognition: true,
          ...getNativeBrowserDetectionOptions(navigator as NavigatorWithNativeBrowserHints),
        });
        const { rawResults, finalTranscript, interimTranscript } = strategy.extractTranscripts(
          event,
          this.finalizedResultIndexes,
        );
        this.cycleResultCount += 1;
        if (finalTranscript) this.cycleFinalResultCount += 1;
        if (interimTranscript) this.cycleInterimResultCount += 1;
        if (finalTranscript || interimTranscript) {
          this.cancelNoResultSpeechRestart('result');
        }
        pushNativeTrace('onresult_raw', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          cycleId: this.recognitionCycleId,
          browserFamily: strategy.browserFamily,
          compatibilityMode: strategy.compatibilityMode,
          resultIndex: event.resultIndex,
          resultsLength: event.results?.length,
          rawResults,
          finalTranscriptLength: finalTranscript.length,
          interimTranscriptLength: interimTranscript.length,
          cycleResultCount: this.cycleResultCount,
        });
        logger.info({
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          cycleId: this.recognitionCycleId,
          resultIndex: event.resultIndex,
          resultsLength: event.results?.length,
          rawResults,
          finalTranscriptLength: finalTranscript.length,
          interimTranscriptLength: interimTranscript.length,
          cycleResultCount: this.cycleResultCount,
        }, '[NativeBrowser] onresult called!');
        if (finalTranscript) {
          pushNativeTrace('final_candidate', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            finalTranscript,
          });
          logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, finalTranscript: redactTranscript(finalTranscript) }, '[NativeBrowser] Final transcript received');
        }
        if (interimTranscript) {
          pushNativeTrace('interim_candidate', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            interimTranscript,
          });
          logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, interimTranscript: redactTranscript(interimTranscript) }, '[NativeBrowser] Interim transcript received');
        }

        if (this.onTranscriptUpdate) {
          const latestInterim = this.getLatestInterimTranscript(interimTranscript);
          if (latestInterim) {
            this.scheduleResultStallRestart('interim');
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
            this.cancelResultStallRestart('final');
            const trimmedFinal = finalTranscript.trim();
            const pendingInterim = this.lastMeaningfulInterim.trim();
            const bestFinalCandidate = pendingInterim &&
              NativeBrowser.isSameInterimWindow(trimmedFinal, pendingInterim) &&
              pendingInterim.length > trimmedFinal.length
              ? pendingInterim
              : trimmedFinal;
            const finalForEmission = bestFinalCandidate;
            this.lastInterim = '';
            this.interimTranscriptBuffer = '';
            this.currentTranscript = this.currentTranscript
              ? NativeBrowser.appendTranscriptSegment(this.currentTranscript, finalForEmission)
              : finalForEmission;
            pushNativeTrace('emit_final', {
              sId: this.serviceId,
              rId: this.runId,
              eId: this.instanceId,
              finalTranscript: redactTranscript(finalForEmission),
              currentTranscript: redactTranscript(this.currentTranscript),
            });
            this.onTranscriptUpdate({ 
                transcript: { final: finalForEmission }
            });
          }
        }
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onresult handler:");
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      try {
        pushNativeTrace('onerror', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          cycleId: this.recognitionCycleId,
          error: event.error,
          isListening: this.isListening,
          isRestarting: this.isRestarting,
          currentTranscript: this.currentTranscript,
        });
        this.cycleErrorCount += 1;
        logger.warn({
          ...this.getRecognitionCycleSummary('onerror'),
          error: event.error,
        }, '[NativeBrowser] recognition cycle error');

        if (event.error === 'no-speech') {
          logger.warn({
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            error: event.error,
            isListening: this.isListening,
            isRestarting: this.isRestarting,
            currentTranscript: this.currentTranscript,
          }, '[NativeBrowser] Speech recognition reported no-speech; this is recoverable if the session restarts and later results arrive');
          return;
        }

        logger.error({
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          error: event.error,
          isListening: this.isListening,
          isRestarting: this.isRestarting,
          currentTranscript: this.currentTranscript,
        }, `[NativeBrowser] Speech recognition error: ${event.error}`);

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
      this.cycleAudioStartedAtMs = performance.now();
      pushNativeTrace('onaudiostart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] onaudiostart');
      this.signalAcousticReady('onaudiostart');
    };

    this.recognition.onaudioend = () => {
      pushNativeTrace('onaudioend', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] onaudioend');
    };

    this.recognition.onsoundstart = () => {
      this.cycleSoundStartedAtMs = performance.now();
      pushNativeTrace('onsoundstart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] onsoundstart');
    };

    this.recognition.onsoundend = () => {
      pushNativeTrace('onsoundend', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] onsoundend');
    };

    this.recognition.onspeechstart = () => {
      this.cycleSpeechStartedAtMs = performance.now();
      pushNativeTrace('onspeechstart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] onspeechstart');
      this.signalAcousticReady('onspeechstart');
      this.scheduleNoResultSpeechRestart('speechstart');
    };

    this.recognition.onspeechend = () => {
      pushNativeTrace('onspeechend', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] onspeechend');
    };

    this.recognition.onnomatch = () => {
      this.cycleNomatchCount += 1;
      pushNativeTrace('onnomatch', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.warn(this.getRecognitionCycleSummary('onnomatch'), '[NativeBrowser] onnomatch');
    };

    this.recognition.onend = () => {
      this.logRecognitionCycleSummary('onend');
      this.cancelNoResultSpeechRestart('onend');
      pushNativeTrace('onend', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        cycleId: this.recognitionCycleId,
        isListening: this.isListening,
        isRestarting: this.isRestarting,
      });
      if (!this.isListening || this.isRestarting) return;

      try {
        logger.info({
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          debounceMs: NATIVE_STT.RESTART_DEBOUNCE_MS,
          cycleId: this.recognitionCycleId,
          resultCount: this.cycleResultCount,
          finalResultCount: this.cycleFinalResultCount,
          interimResultCount: this.cycleInterimResultCount,
        }, '[NativeBrowser] onend reached, attempting debounced restart...');
        this.isRestarting = true;

        setTimeout(() => {
          if (this.isListening && this.recognition) {
            try {
              pushNativeTrace('recognition_restart_attempt', {
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                previousCycleId: this.recognitionCycleId,
                debounceMs: NATIVE_STT.RESTART_DEBOUNCE_MS,
              });
              logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                previousCycleId: this.recognitionCycleId,
                debounceMs: NATIVE_STT.RESTART_DEBOUNCE_MS,
              }, '[NativeBrowser] recognition restart attempt');
              this.recognition.start();
              this.isRestarting = false;
              pushNativeTrace('recognition_restart_invoked', {
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                previousCycleId: this.recognitionCycleId,
              });
            } catch (err) {
              logger.warn({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                err,
                previousCycleId: this.recognitionCycleId,
                debounceMs: NATIVE_STT.RESTART_DEBOUNCE_MS,
              }, "[NativeBrowser] Immediate restart after onend failed; falling back to retryWithBackoff");
              this.retryWithBackoff(0);
            }
          } else {
            this.isRestarting = false;
          }
        }, NATIVE_STT.RESTART_DEBOUNCE_MS);
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onend handler:");
        this.isRestarting = false;
      }
    };

    this.recognition.onstart = () => {
      this.resetRecognitionCycle('onstart');
      pushNativeTrace('onstart', { sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId });
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, cycleId: this.recognitionCycleId }, '[NativeBrowser] Recognition started');
      this.finalizedResultIndexes.clear();
      if (this.lastInterim || this.interimTranscriptBuffer || this.lastMeaningfulInterim || this.preserveInterimOnNextStart) {
        pushNativeTrace('recognition_restart_preserved_interim', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          cycleId: this.recognitionCycleId,
          lastInterim: this.lastInterim,
          interimTranscriptBuffer: this.interimTranscriptBuffer,
          lastMeaningfulInterim: this.lastMeaningfulInterim,
        });
        this.preserveInterimOnNextStart = false;
      }
      this.isListening = true;
      this.updateHeartbeat();
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

    // New recording session: clear the explicit-stop guard so onresult is accepted again.
    this.stopRequested = false;

    // E2E Test Bridge (Strict Zero)
    const win = window as unknown as Record<string, unknown>;

    if (ENV.isE2E) {
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
      this.interimTranscriptBuffer = '';
      this.lastMeaningfulInterim = '';
      this.resultStallRestartCount = 0;
      this.noResultSpeechRestartCount = 0;
      this.preserveInterimOnNextStart = false;
      this.cancelResultStallRestart('mock-start');
      this.cancelNoResultSpeechRestart('mock-start');
      this.acousticReadySignaled = false;
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
      this.interimTranscriptBuffer = '';
      this.lastMeaningfulInterim = '';
      this.resultStallRestartCount = 0;
      this.noResultSpeechRestartCount = 0;
      this.preserveInterimOnNextStart = false;
      this.cancelResultStallRestart('start');
      this.cancelNoResultSpeechRestart('start');
      this.acousticReadySignaled = false;
      try {
        this.startParallelCapture(_mic);
        await this.startRecognitionAndWaitForReady();
      } catch (err) {
        this.flushParallelCapture();
        this.clearRecognitionReferences(this.recognition);
        this.recognition = null;
        this.isListening = false;
        this.isRestarting = false;
        throw err;
      }
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
    // Freeze the transcript the instant Stop is requested, before awaiting the
    // browser's recognition.stop(). onresult fires synchronously off the recognizer,
    // so this flag must be set ahead of any await to reject post-stop results.
    this.stopRequested = true;
    pushNativeTrace('onStop_enter', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      hasRecognition: Boolean(this.recognition),
      isListening: this.isListening,
      currentTranscript: this.currentTranscript,
    });
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Finalizing transcription shutdown');
    this.cancelResultStallRestart('stop');
    this.cancelNoResultSpeechRestart('stop');
    this.flushParallelCapture();
    
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
      this.clearRecognitionReferences(this.recognition);
      this.recognition = null;
      return;
    }

    this.isListening = false;
    this.isRestarting = false;
    this.updateHeartbeat();

    const stoppedRecognition = this.recognition;
    await new Promise<void>((resolve) => {
      let settled = false;
      const originalOnEnd = stoppedRecognition.onend;
      const finish = (source: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        stoppedRecognition.onend = originalOnEnd;
        pushNativeTrace('recognition_stop_finished', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          source,
          cycleId: this.recognitionCycleId,
          currentTranscript: this.currentTranscript,
        });
        resolve();
      };
      const timeout = setTimeout(() => {
        logger.warn('[NativeBrowser] SpeechRecognition stop timed out. Resolving.');
        finish('timeout');
      }, NATIVE_STT.STOP_TIMEOUT_MS);

      stoppedRecognition.onend = () => {
        if (originalOnEnd) originalOnEnd();
        pushNativeTrace('recognition_stop_onend', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          cycleId: this.recognitionCycleId,
          currentTranscript: this.currentTranscript,
        });
        finish('onend');
      };
      try {
        stoppedRecognition.stop();
        pushNativeTrace('recognition_stop_invoked', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          cycleId: this.recognitionCycleId,
        });
      } catch (err) {
        pushNativeTrace('recognition_stop_throw', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
        logger.warn({
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          err,
          currentTranscript: this.currentTranscript,
        }, '[NativeBrowser] recognition.stop() threw during shutdown; resolving stop promise to avoid hanging the UI');
        finish('throw');
      }
    });

    this.promoteMeaningfulInterimTranscript('stop');
    if (typeof window !== 'undefined' && window.__activeSpeechRecognition === stoppedRecognition) {
      delete window.__activeSpeechRecognition;
    }
    pushNativeTrace('onStop_exit', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      cycleId: this.recognitionCycleId,
      currentTranscript: this.currentTranscript,
    });
  }

  private startParallelCapture(mic?: MicStream): void {
    this.flushParallelCapture();
    this.parallelCaptureFrames = [];
    this.parallelCaptureSampleRate = mic?.sampleRate ?? 0;
    this.parallelCaptureStartedAtMs = 0;

    if (!isNativeParallelCaptureEnabled() || !mic || typeof mic.onFrame !== 'function') {
      pushNativeTrace('parallel_capture_skipped', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        enabled: isNativeParallelCaptureEnabled(),
        hasMic: Boolean(mic),
        hasOnFrame: Boolean(mic && typeof mic.onFrame === 'function'),
      });
      return;
    }

    this.parallelCaptureStartedAtMs = Date.now();
    this.parallelCaptureDisposer = mic.onFrame((frame: Float32Array) => {
      this.parallelCaptureFrames.push(frame.slice(0));
    });

    pushNativeTrace('parallel_capture_started', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      sampleRate: this.parallelCaptureSampleRate,
    });
  }

  private flushParallelCapture(): void {
    if (this.parallelCaptureDisposer) {
      this.parallelCaptureDisposer();
      this.parallelCaptureDisposer = null;
    }

    if (!isNativeParallelCaptureEnabled() || this.parallelCaptureFrames.length === 0) {
      this.parallelCaptureFrames = [];
      this.parallelCaptureSampleRate = 0;
      return;
    }

    const sampleRate = this.parallelCaptureSampleRate || 16000;
    const audio = concatenateFrames(this.parallelCaptureFrames);
    const energy = summarizeAudioEnergy(audio);
    const speech = analyzeSpeechSegments(audio, sampleRate);
    const endedAtMs = Date.now();
    const startedAtMs = this.parallelCaptureStartedAtMs || endedAtMs - (audio.length / sampleRate) * 1000;
    const capture: NativeParallelMicCapture = {
      createdAt: new Date().toISOString(),
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      samples: audio.length,
      durationSec: audio.length / sampleRate,
      sampleRate,
      rms: Number(energy.rms.toFixed(6)),
      peak: Number(energy.peak.toFixed(6)),
      ...speech,
      wavDataUrl: encodePcm16WavDataUrl(audio, sampleRate),
    };

    window.__NATIVE_PARALLEL_CAPTURE__ = window.__NATIVE_PARALLEL_CAPTURE__ ?? [];
    window.__NATIVE_PARALLEL_CAPTURE__.push(capture);
    pushNativeTrace('parallel_capture_saved', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      samples: capture.samples,
      durationSec: Number(capture.durationSec.toFixed(3)),
      sampleRate: capture.sampleRate,
      rms: capture.rms,
      peak: capture.peak,
      speechStartMs: capture.speechStartMs,
      speechEndMs: capture.speechEndMs,
      speechDurationMs: capture.speechDurationMs,
      segmentCount: capture.segmentCount,
    });
    logger.info({
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      samples: capture.samples,
      durationSec: Number(capture.durationSec.toFixed(3)),
      sampleRate: capture.sampleRate,
      rms: capture.rms,
      peak: capture.peak,
    }, '[NativeBrowser] Parallel mic capture saved');

    this.parallelCaptureFrames = [];
    this.parallelCaptureSampleRate = 0;
    this.parallelCaptureStartedAtMs = 0;
  }

  private getLatestInterimTranscript(nextInterim: string): string {
    const normalizedNext = nextInterim.trim();
    if (!normalizedNext) {
      pushNativeTrace('latest_interim_empty_next_clear_previous', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        lastInterim: this.lastInterim,
        interimTranscriptBuffer: this.interimTranscriptBuffer,
      });
      this.lastInterim = '';
      return '';
    }

    this.lastInterim = normalizedNext;
    this.interimTranscriptBuffer = '';
    const visibleInterim = normalizedNext;
    if (
      this.isMeaningfulInterimTranscript(visibleInterim) &&
      visibleInterim.length >= this.lastMeaningfulInterim.length
    ) {
      this.lastMeaningfulInterim = visibleInterim;
    }
    pushNativeTrace('latest_interim_update', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      normalizedNext,
      visibleInterim,
      interimTranscriptBuffer: this.interimTranscriptBuffer,
      lastMeaningfulInterim: this.lastMeaningfulInterim,
    });
    return visibleInterim;
  }

  private isMeaningfulInterimTranscript(transcript: string): boolean {
    const normalizedWords = transcript
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}']/gu, ''))
      .filter(Boolean);
    if (normalizedWords.length < 2 || transcript.trim().length < 12) return false;

    const stopwords = new Set([
      'a', 'an', 'and', 'are', 'but', 'in', 'is', 'it', 'of', 'on', 'or', 'that',
      'the', 'then', 'this', 'to', 'uh', 'um',
    ]);
    const meaningfulWords = normalizedWords.filter((word, index) => {
      if (stopwords.has(word)) return false;
      return index === 0 || word !== normalizedWords[index - 1];
    });

    return meaningfulWords.length >= 2;
  }

  private cancelResultStallRestart(reason: string): void {
    if (!this.resultStallRestartTimer) return;
    clearTimeout(this.resultStallRestartTimer);
    this.resultStallRestartTimer = null;
    pushNativeTrace('result_stall_restart_cancelled', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      reason,
    });
  }

  private cancelNoResultSpeechRestart(reason: string): void {
    if (!this.noResultSpeechRestartTimer) return;
    clearTimeout(this.noResultSpeechRestartTimer);
    this.noResultSpeechRestartTimer = null;
    pushNativeTrace('no_result_speech_restart_cancelled', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      reason,
    });
  }

  private scheduleNoResultSpeechRestart(reason: string): void {
    if (!this.recognition || !this.isListening) return;
    if (this.cycleResultCount > 0 || this.currentTranscript.trim()) return;
    if (this.noResultSpeechRestartCount >= NATIVE_STT.NO_RESULT_SPEECH_RESTART_MAX_ATTEMPTS) {
      pushNativeTrace('no_result_speech_restart_limit_reached', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        reason,
        noResultSpeechRestartCount: this.noResultSpeechRestartCount,
      });
      return;
    }

    this.cancelNoResultSpeechRestart(`reschedule:${reason}`);
    const scheduledCycleId = this.recognitionCycleId;
    this.noResultSpeechRestartTimer = setTimeout(() => {
      this.noResultSpeechRestartTimer = null;
      if (!this.recognition || !this.isListening || scheduledCycleId !== this.recognitionCycleId) return;
      if (this.cycleResultCount > 0 || this.currentTranscript.trim()) return;

      this.noResultSpeechRestartCount += 1;
      pushNativeTrace('no_result_speech_restart_stop_requested', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        reason,
        cycleId: this.recognitionCycleId,
        attempt: this.noResultSpeechRestartCount,
      });
      logger.info({
        ...this.getRecognitionCycleSummary('no-result-speech-restart'),
        attempt: this.noResultSpeechRestartCount,
      }, '[NativeBrowser] speech detected but no transcript result yet; restarting recognition to prompt browser flush');
      try {
        this.recognition.stop();
      } catch (err) {
        pushNativeTrace('no_result_speech_restart_stop_throw', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, NATIVE_STT.NO_RESULT_SPEECH_RESTART_MS);
    pushNativeTrace('no_result_speech_restart_scheduled', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      reason,
      cycleId: this.recognitionCycleId,
      delayMs: NATIVE_STT.NO_RESULT_SPEECH_RESTART_MS,
    });
  }

  private scheduleResultStallRestart(reason: string): void {
    if (!this.recognition || !this.isListening) return;
    if (!this.isMeaningfulInterimTranscript(this.lastMeaningfulInterim)) return;
    if (this.resultStallRestartCount >= NATIVE_STT.RESULT_STALL_RESTART_MAX_ATTEMPTS) {
      pushNativeTrace('result_stall_restart_limit_reached', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        reason,
        resultStallRestartCount: this.resultStallRestartCount,
        lastMeaningfulInterim: this.lastMeaningfulInterim,
      });
      return;
    }

    this.cancelResultStallRestart(`reschedule:${reason}`);
    const scheduledCycleId = this.recognitionCycleId;
    const scheduledInterim = this.lastMeaningfulInterim;
    this.resultStallRestartTimer = setTimeout(() => {
      this.resultStallRestartTimer = null;
      if (!this.recognition || !this.isListening || scheduledCycleId !== this.recognitionCycleId) return;
      if (this.currentTranscript.trim()) return;
      if (this.lastMeaningfulInterim !== scheduledInterim) return;

      this.resultStallRestartCount += 1;
      this.preserveInterimOnNextStart = true;
      pushNativeTrace('result_stall_restart_stop_requested', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        reason,
        cycleId: this.recognitionCycleId,
        attempt: this.resultStallRestartCount,
        lastMeaningfulInterim: this.lastMeaningfulInterim,
      });
      try {
        this.recognition.stop();
      } catch (err) {
        pushNativeTrace('result_stall_restart_stop_throw', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, NATIVE_STT.RESULT_STALL_RESTART_MS);
    pushNativeTrace('result_stall_restart_scheduled', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      reason,
      cycleId: this.recognitionCycleId,
      delayMs: NATIVE_STT.RESULT_STALL_RESTART_MS,
      lastMeaningfulInterim: this.lastMeaningfulInterim,
    });
  }

  private promoteMeaningfulInterimTranscript(reason: string): void {
    if (this.currentTranscript.trim()) {
      const pendingTranscript = this.lastMeaningfulInterim.trim();
      if (pendingTranscript && !NativeBrowser.normalizeForComparison(this.currentTranscript).includes(NativeBrowser.normalizeForComparison(pendingTranscript))) {
        const transcript = NativeBrowser.mergeFinalWithPendingInterim(this.currentTranscript, pendingTranscript);
        if (NativeBrowser.normalizeForComparison(transcript) === NativeBrowser.normalizeForComparison(this.currentTranscript)) {
          pushNativeTrace('native_interim_append_skipped_duplicate', {
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            reason,
            pendingTranscript,
            currentTranscript: this.currentTranscript,
          });
          logger.info({
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            reason,
          }, '[NativeBrowser] Skipped duplicate pending interim transcript on stop');
          return;
        }
        this.currentTranscript = transcript;
        pushNativeTrace('native_interim_appended_to_final', {
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          reason,
          pendingTranscript,
          transcript,
        });
        logger.info({
          sId: this.serviceId,
          rId: this.runId,
          eId: this.instanceId,
          reason,
          transcript,
        }, '[NativeBrowser] Appended pending meaningful interim transcript on stop');
        this.onTranscriptUpdate?.({
          transcript: { final: transcript },
        });
        return;
      }

      pushNativeTrace('native_interim_promotion_skipped', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        reason,
        skipReason: 'final_transcript_present',
        currentTranscript: this.currentTranscript,
        lastInterim: this.lastInterim,
        interimTranscriptBuffer: this.interimTranscriptBuffer,
        lastMeaningfulInterim: this.lastMeaningfulInterim,
      });
      return;
    }

    const transcript = this.lastMeaningfulInterim.trim();
    if (!transcript) {
      pushNativeTrace('native_interim_promotion_skipped', {
        sId: this.serviceId,
        rId: this.runId,
        eId: this.instanceId,
        reason,
        skipReason: 'no_meaningful_interim',
        lastInterim: this.lastInterim,
        interimTranscriptBuffer: this.interimTranscriptBuffer,
      });
      return;
    }

    this.currentTranscript = transcript;
    pushNativeTrace('native_interim_promoted', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      reason,
      transcript,
    });
    logger.info({
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      reason,
      transcript,
    }, '[NativeBrowser] Promoted meaningful interim transcript on stop');
    this.onTranscriptUpdate?.({
      transcript: { final: transcript },
    });
  }

  private static normalizeForComparison(transcript: string): string {
    return transcript
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static wordsForComparison(transcript: string): string[] {
    const normalized = NativeBrowser.normalizeForComparison(transcript);
    return normalized ? normalized.split(' ') : [];
  }

  private static isSameInterimWindow(previous: string, next: string): boolean {
    const previousNormalized = NativeBrowser.normalizeForComparison(previous);
    const nextNormalized = NativeBrowser.normalizeForComparison(next);
    if (!previousNormalized || !nextNormalized) return true;
    return previousNormalized.startsWith(nextNormalized) || nextNormalized.startsWith(previousNormalized);
  }

  private static wordOverlapRatio(base: string, candidate: string): number {
    const baseWords = new Set(NativeBrowser.wordsForComparison(base));
    const candidateWords = NativeBrowser.wordsForComparison(candidate);
    if (candidateWords.length === 0) return 0;

    const overlappingWords = candidateWords.filter((word) => baseWords.has(word)).length;
    return overlappingWords / candidateWords.length;
  }

  private static isSubstantiallyDuplicatePendingInterim(finalTranscript: string, pendingInterim: string): boolean {
    const finalWords = NativeBrowser.wordsForComparison(finalTranscript);
    const pendingWords = NativeBrowser.wordsForComparison(pendingInterim);
    if (finalWords.length === 0 || pendingWords.length === 0) return false;

    const shorterLength = Math.min(finalWords.length, pendingWords.length);
    const longerLength = Math.max(finalWords.length, pendingWords.length);
    const comparableLengthRatio = shorterLength / longerLength;
    const pendingOverlap = NativeBrowser.wordOverlapRatio(finalTranscript, pendingInterim);
    const finalOverlap = NativeBrowser.wordOverlapRatio(pendingInterim, finalTranscript);

    return comparableLengthRatio >= 0.75 && pendingOverlap >= 0.75 && finalOverlap >= 0.75;
  }

  private static appendTranscriptSegment(base: string, segment: string): string {
    const baseText = base.trim();
    const segmentText = segment.trim();
    if (!baseText) return segmentText;
    if (!segmentText) return baseText;

    const baseNormalized = NativeBrowser.normalizeForComparison(baseText);
    const segmentNormalized = NativeBrowser.normalizeForComparison(segmentText);
    if (!baseNormalized) return segmentText;
    if (!segmentNormalized) return baseText;
    if (baseNormalized.endsWith(segmentNormalized)) return baseText;
    if (segmentNormalized.startsWith(baseNormalized)) return segmentText;

    const baseWords = NativeBrowser.wordsForComparison(baseText);
    const segmentWords = NativeBrowser.wordsForComparison(segmentText);
    const maxOverlap = Math.min(baseWords.length, segmentWords.length);
    let overlap = 0;
    for (let size = maxOverlap; size > 0; size -= 1) {
      const baseSuffix = baseWords.slice(baseWords.length - size).join(' ');
      const segmentPrefix = segmentWords.slice(0, size).join(' ');
      if (baseSuffix === segmentPrefix) {
        overlap = size;
        break;
      }
    }

    const originalSegmentWords = segmentText.split(/\s+/).filter(Boolean);
    return [baseText, originalSegmentWords.slice(overlap).join(' ')].filter(Boolean).join(' ').trim();
  }

  private static mergeFinalWithPendingInterim(finalTranscript: string, pendingInterim: string): string {
    const finalText = finalTranscript.trim();
    const pendingText = pendingInterim.trim();
    if (!finalText) return pendingText;
    if (!pendingText) return finalText;

    const finalNormalized = NativeBrowser.normalizeForComparison(finalText);
    const pendingNormalized = NativeBrowser.normalizeForComparison(pendingText);
    if (!finalNormalized) return pendingText;
    if (!pendingNormalized) return finalText;

    if (pendingNormalized.includes(finalNormalized)) {
      return pendingText;
    }
    if (finalNormalized.includes(pendingNormalized)) {
      return finalText;
    }
    if (NativeBrowser.isSubstantiallyDuplicatePendingInterim(finalText, pendingText)) {
      return finalText;
    }

    return NativeBrowser.appendTranscriptSegment(finalText, pendingText);
  }

  private clearRecognitionReferences(recognition: SpeechRecognition | null): void {
    if (!recognition) return;

    if (typeof window !== 'undefined' && window.__activeSpeechRecognition === recognition) {
      delete window.__activeSpeechRecognition;
    }

    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognition.onaudiostart = null;
    recognition.onaudioend = null;
    recognition.onspeechstart = null;
    recognition.onspeechend = null;
    recognition.onsoundstart = null;
    recognition.onsoundend = null;
    recognition.onnomatch = null;
  }

  private signalAcousticReady(source: 'onaudiostart' | 'onspeechstart'): void {
    if (this.acousticReadySignaled) return;
    this.acousticReadySignaled = true;
    pushNativeTrace('acoustic_ready', {
      sId: this.serviceId,
      rId: this.runId,
      eId: this.instanceId,
      source,
    });
    this.onReady?.();
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
    if (this.terminatePromise) return this.terminatePromise;

    this.terminatePromise = this.doTerminate();
    try {
      await this.terminatePromise;
    } finally {
      this.terminatePromise = null;
    }
  }

  private async doTerminate(): Promise<void> {
    if (this.isTerminated) return;
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] 🛑 Nuclear termination requested');

    await this.stop();
    if (this.mockEngine) {
      if (typeof this.mockEngine.terminate === 'function') await this.mockEngine.terminate();
      else await this.mockEngine.destroy();
    }
    await this.onDestroy();
    this.clearRecognitionReferences(this.recognition);
    this.recognition = null;
    this.isInitialized = false;
    this.isTerminated = true;
  }

  public override async getTranscript(): Promise<string> {
    const engineWithGet = this.mockEngine as unknown as { getTranscript?: () => Promise<string> };
    if (engineWithGet && engineWithGet.getTranscript) {
        return engineWithGet.getTranscript();
    }
    const transcript = await super.getTranscript();
    const saved = transcript || this.lastMeaningfulInterim || this.interimTranscriptBuffer;
    // Apply the trusted punctuation/casing restoration formatter to the SAVED
    // transcript only (never live partials). Identity no-op until a trusted
    // formatter is registered; failures fall back to the unformatted text.
    return formatNativeTranscript(saved);
  }

  public getLastHeartbeatTimestamp(): number {
    return this.mockEngine ? this.mockEngine.getLastHeartbeatTimestamp() : super.getLastHeartbeatTimestamp();
  }

  async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
    if (this.mockEngine && typeof this.mockEngine.transcribe === 'function') {
      return this.mockEngine.transcribe(audio);
    }

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
