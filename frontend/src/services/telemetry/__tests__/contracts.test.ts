import { describe, it, expect } from 'vitest';
import {
  MODE_TELEMETRY_CAPABILITIES,
  type TelemetryEvent,
  type MetricsSnapshot,
} from '../contracts';

describe('telemetry contracts (Phase 1 — types + capture-ownership map)', () => {
  it('encodes one TRANSCRIPTION owner per mode; Native = Web Speech with a passive (non-transcribing) app-mic observer', () => {
    expect(MODE_TELEMETRY_CAPABILITIES.native).toEqual({
      transcriptionOwner: 'web-speech',
      emitsAudioFramesByDefault: false,
      hasPassiveAudioObserver: true,
      diagnosticDualCaptureAllowed: true,
      diagnosticCapture: 'opt-in',
    });
    expect(MODE_TELEMETRY_CAPABILITIES.private).toEqual({
      transcriptionOwner: 'app-mic-stream',
      emitsAudioFramesByDefault: true,
      hasPassiveAudioObserver: false,
      diagnosticDualCaptureAllowed: false,
      diagnosticCapture: 'none',
    });
    expect(MODE_TELEMETRY_CAPABILITIES.cloud).toEqual({
      transcriptionOwner: 'app-mic-stream',
      emitsAudioFramesByDefault: true,
      hasPassiveAudioObserver: false,
      diagnosticDualCaptureAllowed: false,
      diagnosticCapture: 'none',
    });
  });

  it('Native does NOT emit production audio.frame by default; its dual-capture is opt-in only (never a perf proof)', () => {
    const n = MODE_TELEMETRY_CAPABILITIES.native;
    expect(n.transcriptionOwner).toBe('web-speech');
    expect(n.emitsAudioFramesByDefault).toBe(false);
    expect(n.diagnosticCapture).toBe('opt-in');
    // Native has a passive observer at runtime, but it is NOT the transcription owner.
    expect(n.hasPassiveAudioObserver).toBe(true);
  });

  it('only app-mic-stream modes are the production audio.frame source', () => {
    for (const cap of Object.values(MODE_TELEMETRY_CAPABILITIES)) {
      // Any mode that emits audio frames by default must own transcription via the app mic stream.
      expect(!cap.emitsAudioFramesByDefault || cap.transcriptionOwner === 'app-mic-stream').toBe(true);
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
      sessionId: 's1', mode: 'native', updatedAt: 0, elapsedSeconds: 0,
      transcript: { finalText: '', interimText: '', wordCount: 0, finalWordCount: 0, partialWordCount: 0, maxRunOnWords: 0, confidence: 'low', trusted: false },
      delivery: { wpm: 0, fillerCount: 0, fillerRate: 0, clarityScore: 0 },
      engine: { resultCount: 0, finalCount: 0, interimCount: 0, errorCount: 0, restartCount: 0 },
      score: { value: 0, label: '', confidence: 'warming-up', breakdown: { messageStructure: 0, deliveryControl: 0, languageClarity: 0, audienceImpact: 0 }, qualityNote: null },
    };
    expect(snap.mode).toBe('native');
    expect(snap.audio).toBeUndefined();
  });
});
