import { describe, it, expect } from 'vitest';
import {
  MODE_TELEMETRY_CAPABILITIES,
  type TelemetryEvent,
  type MetricsSnapshot,
} from '../contracts';

describe('telemetry contracts (Phase 1 — types + capture-ownership map)', () => {
  it('encodes exactly one capture owner per mode; Native is Web Speech only (no app mic frames)', () => {
    expect(MODE_TELEMETRY_CAPABILITIES.native).toEqual({ captureOwner: 'web-speech', emitsAudioFrames: false });
    expect(MODE_TELEMETRY_CAPABILITIES.private).toEqual({ captureOwner: 'app-mic-stream', emitsAudioFrames: true });
    expect(MODE_TELEMETRY_CAPABILITIES.cloud).toEqual({ captureOwner: 'app-mic-stream', emitsAudioFrames: true });
  });

  it('only app-mic modes emit audio.frame — every frame-emitting mode has captureOwner=app-mic-stream', () => {
    for (const [mode, cap] of Object.entries(MODE_TELEMETRY_CAPABILITIES)) {
      if (cap.emitsAudioFrames) expect(cap.captureOwner).toBe('app-mic-stream');
      if (mode === 'native') expect(cap.emitsAudioFrames).toBe(false);
    }
  });

  it('TelemetryEvent union constrains audio.frame to private|cloud (Native uses webspeech.lifecycle)', () => {
    const frame: TelemetryEvent = { type: 'audio.frame', mode: 'private', t: 0, sampleRate: 16000, frame: new Float32Array(0) };
    expect(frame.mode).not.toBe('native');
    const nativeLifecycle: TelemetryEvent = { type: 'webspeech.lifecycle', mode: 'native', t: 0, event: 'start' };
    expect(nativeLifecycle.type).toBe('webspeech.lifecycle');
    const finalEvt: TelemetryEvent = { type: 'transcript.final', mode: 'native', t: 1, text: 'hi', sequence: 0, replacesRollingTranscript: true };
    expect(finalEvt.replacesRollingTranscript).toBe(true);
  });

  it('MetricsSnapshot is the single derived-metric shape; Native omits PCM audio by default', () => {
    const snap: MetricsSnapshot = {
      sessionId: 's1', mode: 'native', updatedAt: 0,
      transcript: { finalText: '', interimText: '', wordCount: 0, finalWordCount: 0, partialWordCount: 0, maxRunOnWords: 0, confidence: 'low', trusted: false },
      delivery: { wpm: 0, fillerCount: 0, fillerRate: 0, clarityScore: 0 },
      engine: { resultCount: 0, finalCount: 0, interimCount: 0, errorCount: 0, restartCount: 0 },
      score: { value: 0, label: '', confidence: 'warming-up', breakdown: { messageStructure: 0, deliveryControl: 0, languageClarity: 0, audienceImpact: 0 }, qualityNote: null },
    };
    expect(snap.mode).toBe('native');
    expect(snap.audio).toBeUndefined();
  });
});
