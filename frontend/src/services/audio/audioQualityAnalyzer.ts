import { PauseDetector } from './pauseDetector';

/**
 * Headless, deterministic audio-quality analysis.
 *
 * This mirrors the per-frame mic-quality logic in `useVocalAnalysis` (RMS/peak, mic level EMA,
 * clipping, low-volume, and noise/hum detection) but with no React state and an injected timestamp,
 * so it can run inside a telemetry MetricProcessor and in unit tests.
 *
 * Semantics note: this exposes the INSTANTANEOUS conditions (currently clipping / currently low /
 * currently noisy). The legacy hook collapses these into one sticky `micWarning` string for the live
 * UX; that string remains owned by `useVocalAnalysis`. This analyzer is a shadow diagnostic — the
 * `audio` snapshot section is NOT a scored/persisted metric and is not a cutover target.
 */
export interface AudioQualitySample {
  rms: number;
  peak: number;
  micLevel: number;
  clipping: boolean;
  lowVolume: boolean;
  noiseWarning: boolean;
}

const CLIPPING_PEAK = 0.98;
const CLIPPING_FRAMES = 3;
const LOW_VOLUME_RMS = 0.003;
const LOW_VOLUME_MS = 5000;
const NOISE_RMS = 0.025;
const MIC_LEVEL_INTERVAL_MS = 100;

export function calculateRms(frame: Float32Array): number {
  const sum = frame.reduce((acc, val) => acc + val * val, 0);
  return Math.sqrt(sum / frame.length);
}

export function calculatePeak(frame: Float32Array): number {
  let max = 0;
  for (let i = 0; i < frame.length; i++) {
    const abs = Math.abs(frame[i]);
    if (abs > max) max = abs;
  }
  return max;
}

export class AudioQualityAnalyzer {
  private readonly silence: PauseDetector;
  private micLevel = 0;
  private lastMicLevelUpdate = 0;
  private clippingFrames = 0;
  private lowVolumeStart: number | null = null;
  private lastRms = 0;
  private lastPeak = 0;

  constructor(startTime?: number) {
    // A private PauseDetector supplies the exact same "meaningfully silent" signal the legacy
    // noise check uses, so the noise/hum condition matches useVocalAnalysis.
    this.silence = new PauseDetector(undefined, undefined, startTime);
    if (startTime !== undefined) this.lastMicLevelUpdate = 0;
  }

  processFrame(frame: Float32Array, nowMs: number): void {
    this.silence.processAudioFrame(frame, nowMs);
    const rms = calculateRms(frame);
    const peak = calculatePeak(frame);
    this.lastRms = rms;
    this.lastPeak = peak;

    if (nowMs - this.lastMicLevelUpdate >= MIC_LEVEL_INTERVAL_MS) {
      const nextLevel = Math.min(rms * 8, 1);
      this.micLevel = this.micLevel * 0.65 + nextLevel * 0.35;
      this.lastMicLevelUpdate = nowMs;
    }

    if (peak >= CLIPPING_PEAK) {
      this.clippingFrames += 1;
    } else {
      this.clippingFrames = 0;
    }

    if (rms <= LOW_VOLUME_RMS) {
      if (this.lowVolumeStart === null) this.lowVolumeStart = nowMs;
    } else {
      this.lowVolumeStart = null;
    }
  }

  private isNoisy(nowMs: number): boolean {
    return this.silence.isMeaningfullySilent(nowMs) && this.lastRms >= NOISE_RMS;
  }

  getSample(nowMs: number): AudioQualitySample {
    return {
      rms: this.lastRms,
      peak: this.lastPeak,
      micLevel: this.micLevel,
      clipping: this.clippingFrames >= CLIPPING_FRAMES,
      lowVolume: this.lowVolumeStart !== null && nowMs - this.lowVolumeStart >= LOW_VOLUME_MS,
      noiseWarning: this.isNoisy(nowMs),
    };
  }

  reset(startTime?: number): void {
    this.silence.reset(startTime);
    this.micLevel = 0;
    this.lastMicLevelUpdate = 0;
    this.clippingFrames = 0;
    this.lowVolumeStart = null;
    this.lastRms = 0;
    this.lastPeak = 0;
  }
}
