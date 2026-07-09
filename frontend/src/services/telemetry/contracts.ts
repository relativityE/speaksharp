/**
 * Telemetry Bus + Metrics Snapshot — CONTRACTS ONLY (Phase 1).
 *
 * Architecture (Option B): the Telemetry Bus is the raw-event TRANSPORT; it carries facts, never
 * derived opinions. The Metrics Engine (metric processors) is the ONLY place that derives metrics,
 * and it produces ONE canonical `MetricsSnapshot` — the single source of truth that every surface
 * (live coaching card, filler card, transcript-quality caveat, Analytics, PDF, AI-prompt context,
 * saved session detail) READS. No component recomputes a metric with its own formula.
 *
 * Ownership: ONE TRANSCRIPTION OWNER PER MODE. Native transcription = Web Speech; a passive, non-
 * transcribing app-mic OBSERVER may also run (vocal/volume metrics, diagnostics) — it is NOT the owner,
 * and Native emits no production PCM `audio.frame` by default. Private/Cloud transcription = app MicStream.
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
  // Native Web Speech lifecycle — the events the Web Speech transcription path exposes.
  | { type: 'webspeech.lifecycle'; mode: 'native'; t: number; event: 'start' | 'audioStart' | 'speechStart' | 'speechEnd' | 'audioEnd' | 'end' }
  | { type: 'transcript.partial'; mode: TelemetryMode; t: number; text: string; sequence: number }
  | { type: 'transcript.final'; mode: TelemetryMode; t: number; text: string; sequence: number; replacesRollingTranscript?: boolean }
  | { type: 'engine.error'; mode: TelemetryMode; t: number; code: string; recoverable: boolean }
  | { type: 'engine.lifecycle'; mode: TelemetryMode; t: number; event: 'start' | 'stop' | 'restart' | 'ready' }
  // Session-level elapsed clock — the authoritative duration basis (matches the legacy elapsedTime timer)
  // that pace/clarity/score derive from. Published by the session lifecycle, not a transcription engine.
  | { type: 'session.tick'; mode: TelemetryMode; t: number; elapsedSeconds: number };

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
  /** Authoritative session duration (seconds) — the basis for wpm/clarity/score, from session.tick. */
  elapsedSeconds: number;
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

/**
 * A one-level-deep partial of MetricsSnapshot: a processor may contribute individual fields WITHIN a
 * section (e.g. Pace owns delivery.wpm while Filler owns delivery.fillerCount) without having to
 * provide the rest of that section. The engine section-merges these patches.
 */
export interface MetricsSnapshotPatch {
  sessionId?: string;
  mode?: TelemetryMode;
  updatedAt?: number;
  elapsedSeconds?: number;
  transcript?: Partial<MetricsSnapshot['transcript']>;
  delivery?: Partial<MetricsSnapshot['delivery']>;
  audio?: Partial<NonNullable<MetricsSnapshot['audio']>>;
  engine?: Partial<MetricsSnapshot['engine']>;
  score?: Partial<MetricsSnapshot['score']>;
}

/**
 * Tier-1: derives its slice from RAW events only. Sees no other processor's output.
 */
export interface MetricProcessor {
  readonly name: string;
  onEvent(event: TelemetryEvent): void;
  getSnapshot(): MetricsSnapshotPatch;
  reset(sessionId: string): void;
}

/**
 * Tier-2: a SECOND-tier metric that is a function of OTHER derived metrics (e.g. clarity needs
 * wpm+fillerCount; score needs wpm+clarity+fillerCount+pauseMetrics+elapsed). The engine runs derivers
 * in registration order AFTER the tier-1 merge, each seeing the accumulated snapshot, so a later deriver
 * (score) reads an earlier one's output (clarity).
 */
export interface MetricDeriver {
  readonly name: string;
  derive(base: MetricsSnapshot): MetricsSnapshotPatch;
  reset(sessionId: string): void;
}

// ---------------------------------------------------------------------------
// Ownership model: ONE TRANSCRIPTION OWNER PER MODE; passive diagnostics/audio
// observers must be explicitly labeled, non-transcribing, and non-interfering.
// ---------------------------------------------------------------------------
export interface ModeTelemetryCapability {
  /** Which subsystem owns TRANSCRIPTION. Native = browser Web Speech; Private/Cloud = app MicStream. */
  transcriptionOwner: 'web-speech' | 'app-mic-stream';
  /**
   * Whether this mode is the raw PCM `audio.frame` telemetry source BY DEFAULT (production path).
   * Native is false (Web Speech owns capture; no PCM by default). NOTE: the bus is currently SHADOW —
   * nothing consumes it yet — so this models the target once the Private/Cloud telemetry migration lands.
   * It is NOT a claim that migration or MetricsSnapshot ownership is complete.
   */
  emitsAudioFramesByDefault: boolean;
  /**
   * Whether a PASSIVE, NON-TRANSCRIBING app-mic observer runs for this mode (diagnostics / vocal-volume
   * metrics). Native = true at runtime today: the app mic is an OBSERVER, not the transcription owner.
   * Removing it is deferred — #30 found no evidence it interferes; this does NOT make it a capture owner.
   */
  hasPassiveAudioObserver: boolean;
  /** Whether an explicit diagnostic dual-capture path exists for this mode. */
  diagnosticDualCaptureAllowed: boolean;
  /** How diagnostic dual-capture is enabled. Never a production default and never a performance proof. */
  diagnosticCapture: 'none' | 'opt-in';
}

/**
 * ONE TRANSCRIPTION OWNER PER MODE; passive observers are labeled, non-transcribing, non-interfering.
 *
 * - Native: transcription owner = Web Speech. At runtime an app-mic PASSIVE OBSERVER also runs
 *   (vocal/volume metrics) — NOT the transcription owner and NOT PCM `audio.frame` telemetry. Native
 *   does NOT emit production `audio.frame` by default. A diagnostic dual-capture exists but is OPT-IN
 *   only (`?nativeDiag=1` / flag), labeled `diagnostic-dual-capture`, never a performance proof.
 * - Private/Cloud: transcription owner = app MicStream (the `audio.frame` source once the telemetry
 *   migration reaches that phase; the bus is SHADOW today).
 *
 * This models capture OWNERSHIP + observer presence only. It makes NO claim that the Metrics Snapshot
 * SSOT is implemented or that duplicate metric writers are removed — those phases are still ahead.
 */
export const MODE_TELEMETRY_CAPABILITIES: Record<TelemetryMode, ModeTelemetryCapability> = {
  native: {
    transcriptionOwner: 'web-speech',
    emitsAudioFramesByDefault: false,
    hasPassiveAudioObserver: true,
    diagnosticDualCaptureAllowed: true,
    diagnosticCapture: 'opt-in',
  },
  private: {
    transcriptionOwner: 'app-mic-stream',
    emitsAudioFramesByDefault: true,
    hasPassiveAudioObserver: false,
    diagnosticDualCaptureAllowed: false,
    diagnosticCapture: 'none',
  },
  cloud: {
    transcriptionOwner: 'app-mic-stream',
    emitsAudioFramesByDefault: true,
    hasPassiveAudioObserver: false,
    diagnosticDualCaptureAllowed: false,
    diagnosticCapture: 'none',
  },
} as const;
