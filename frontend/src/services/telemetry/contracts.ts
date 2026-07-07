/**
 * Telemetry Bus + Metrics Snapshot — CONTRACTS ONLY (Phase 1).
 *
 * Architecture (Option B): the Telemetry Bus is the raw-event TRANSPORT; it carries facts, never
 * derived opinions. The Metrics Engine (metric processors) is the ONLY place that derives metrics,
 * and it produces ONE canonical `MetricsSnapshot` — the single source of truth that every surface
 * (live coaching card, filler card, transcript-quality caveat, Analytics, PDF, AI-prompt context,
 * saved session detail) READS. No component recomputes a metric with its own formula.
 *
 * Capture ownership: exactly one capture owner per mode. Native = Web Speech ONLY (no app MicStream /
 * no PCM audio.frame events by default). Private/Cloud = app-owned MicStream (their engines require it).
 *
 * THIS FILE IS TYPES + DECLARATIVE CONFIG ONLY. No bus, no processors, no emitters, no behavior change.
 */
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { SpeakingScoreBreakdown } from '@/utils/speakingScore';

export type TelemetryMode = 'native' | 'private' | 'cloud';

// ---------------------------------------------------------------------------
// Raw events on the bus — FACTS only (no clarity/pause/filler/score in here).
// ---------------------------------------------------------------------------
export type TelemetryEvent =
  // Raw PCM frames — ONLY from app-mic-owned modes (Private/Cloud). Native never emits these by default.
  | { type: 'audio.frame'; mode: 'private' | 'cloud'; t: number; sampleRate: number; frame: Float32Array }
  // Native Web Speech lifecycle — the events an event-only Native path exposes.
  | { type: 'webspeech.lifecycle'; mode: 'native'; t: number; event: 'start' | 'audioStart' | 'speechStart' | 'speechEnd' | 'audioEnd' | 'end' }
  | { type: 'transcript.partial'; mode: TelemetryMode; t: number; text: string; sequence: number }
  | { type: 'transcript.final'; mode: TelemetryMode; t: number; text: string; sequence: number; replacesRollingTranscript?: boolean }
  | { type: 'engine.error'; mode: TelemetryMode; t: number; code: string; recoverable: boolean }
  | { type: 'engine.lifecycle'; mode: TelemetryMode; t: number; event: 'start' | 'stop' | 'restart' | 'ready' };

export type TelemetryEventType = TelemetryEvent['type'];

// ---------------------------------------------------------------------------
// The single source of truth for all DERIVED metrics.
// ---------------------------------------------------------------------------
export type TranscriptConfidence = 'low' | 'medium' | 'high';
export type ScoreConfidence = 'warming-up' | 'directional' | 'usable';

export interface MetricsSnapshot {
  sessionId: string;
  mode: TelemetryMode;
  updatedAt: number;
  transcript: {
    finalText: string;
    interimText: string;
    wordCount: number;
    finalWordCount: number;
    partialWordCount: number;
    maxRunOnWords: number;
    confidence: TranscriptConfidence;
    trusted: boolean;
  };
  delivery: {
    wpm: number;
    fillerCount: number;
    fillerRate: number;
    pauseMetrics?: PauseMetrics;
    clarityScore: number;
  };
  /** PCM-derived audio quality — present only for app-mic modes; Native omits it by default. */
  audio?: {
    rms: number;
    peak: number;
    micLevel: number;
    clipping: boolean;
    lowVolume: boolean;
    noiseWarning: boolean;
  };
  engine: {
    resultCount: number;
    finalCount: number;
    interimCount: number;
    errorCount: number;
    restartCount: number;
    firstTextMs?: number;
    lastResultMs?: number;
    starvationMs?: number;
  };
  score: {
    value: number;
    label: string;
    confidence: ScoreConfidence;
    breakdown: SpeakingScoreBreakdown;
    qualityNote: string | null;
  };
}

// ---------------------------------------------------------------------------
// Interfaces (NO implementations in Phase 1).
// ---------------------------------------------------------------------------
export interface TelemetryBus {
  publish(event: TelemetryEvent): void;
  subscribe(listener: (event: TelemetryEvent) => void): () => void;
  reset(sessionId: string): void;
}

export interface MetricProcessor {
  readonly name: string;
  onEvent(event: TelemetryEvent): void;
  getSnapshot(): Partial<MetricsSnapshot>;
  reset(sessionId: string): void;
}

// ---------------------------------------------------------------------------
// Capture ownership: exactly one capture owner per mode.
// ---------------------------------------------------------------------------
export interface ModeTelemetryCapability {
  /** Which subsystem owns microphone capture for this mode. */
  captureOwner: 'web-speech' | 'app-mic-stream';
  /** Whether this mode emits raw PCM `audio.frame` events by default. */
  emitsAudioFrames: boolean;
}

/**
 * The capture-ownership model. Native = Web Speech ONLY (no app MicStream / no PCM frames by default);
 * Private/Cloud = app MicStream. A Native diagnostic dual-capture is a separate, explicitly-flagged
 * mode (artifacts labeled `diagnostic-dual-capture`) — never the default and never a performance proof.
 */
export const MODE_TELEMETRY_CAPABILITIES: Record<TelemetryMode, ModeTelemetryCapability> = {
  native: { captureOwner: 'web-speech', emitsAudioFrames: false },
  private: { captureOwner: 'app-mic-stream', emitsAudioFrames: true },
  cloud: { captureOwner: 'app-mic-stream', emitsAudioFrames: true },
} as const;
