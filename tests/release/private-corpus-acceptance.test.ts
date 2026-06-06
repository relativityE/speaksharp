import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  validatePrivateRow,
  validatePrivateCorpusArtifact,
  PRIVATE_ACCEPTANCE,
  classifyPrivateAudioValidity,
} from '../../scripts/private-corpus-acceptance.mjs';

describe('private corpus acceptance validator', () => {
  it('passes a clean row with telemetry, correct final, fast finalization', () => {
    const row = {
      fixture: 'h1_1',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'Um, the stale smell of old beer, like, lingers.',
      stopFinalizationMs: 4200,
    };
    expect(validatePrivateRow(row, ['stale smell of old beer']).pass).toBe(true);
  });

  it('fails when runtime telemetry is null (the P0.1 gate)', () => {
    const row = {
      fixture: 'h1_1',
      privateRuntime: null,
      privateProvider: null,
      privateCloudFallbackAttempted: null,
      detailTranscript: 'anything',
      stopFinalizationMs: 4000,
    };
    const result = validatePrivateRow(row);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('runtime_telemetry_null');
    expect(result.failures).toContain('cloud_fallback_not_proven_false');
  });

  it('fails when cloud fallback is not provably false (privacy invariant)', () => {
    const row = {
      fixture: 'h1_1',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: true,
      detailTranscript: 'x',
      stopFinalizationMs: 4000,
    };
    expect(validatePrivateRow(row).failures).toContain('cloud_fallback_not_proven_false');
  });

  it('fails when the final transcript drops a truth-preserving fragment', () => {
    const row = {
      fixture: 'h1_2',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'Basically, a dash of pepper spurtles beef stew.',
      stopFinalizationMs: 4000,
    };
    expect(validatePrivateRow(row, ['pepper spoils']).failures).toContain('final_missing:pepper spoils');
  });

  it('fails when stop finalization exceeds the hard limit', () => {
    const row = {
      fixture: 'h1_8',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'The puppy, like, chewed up the new shoes.',
      stopFinalizationMs: PRIVATE_ACCEPTANCE.STOP_FINALIZATION_HARD_LIMIT_MS + 1,
    };
    expect(validatePrivateRow(row, ['chewed up']).failures.some((f) => f.startsWith('stop_finalization_over_limit'))).toBe(true);
  });

  it('marks zero-audio delivery INVALID before model accuracy verdicts', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: '',
      privateAudioChunks: [],
      privateTrace: [],
      stopFinalizationMs: 1200,
    };

    const result = validatePrivateRow(row, ['they like']);
    expect(result.pass).toBe(false);
    expect(result.invalid).toBe(true);
    expect(result.invalidReason).toBe('invalid_no_audio_delivered');
    expect(result.failures).not.toContain('final_missing:they like');
  });

  it('marks all-zero RMS/peak chunks INVALID', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: '',
      privateAudioChunks: [
        { samples: 16000, durationSec: 1, rms: 0, peak: 0 },
        { samples: 16000, durationSec: 1, rms: 0, peak: 0 },
      ],
      privateTrace: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
      stopFinalizationMs: 1200,
    };

    expect(classifyPrivateAudioValidity(row)).toEqual({
      valid: false,
      reason: 'invalid_zero_audio_energy',
    });
  });

  it('marks impossible stop timing INVALID', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'anything',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0.04, peak: 0.2 }],
      privateTrace: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
      stopFinalizationMs: -12020,
    };

    expect(validatePrivateRow(row).invalidReason).toBe('invalid_impossible_timing:-12020');
  });

  it('marks speech fixtures without speech_start_detected INVALID when timeline proof exists', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'anything',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0.04, peak: 0.2 }],
      privateTrace: [{ event: 'process_audio_ready' }],
      stopFinalizationMs: 1200,
    };

    expect(validatePrivateRow(row).invalidReason).toBe('invalid_no_speech_start_detected');
  });

  it('does not require speech_start_detected for explicit silence fixtures', () => {
    const row = {
      fixture: 'near_silence',
      expectedSilence: true,
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: '',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0.04, peak: 0.2 }],
      privateTrace: [{ event: 'process_audio_ready' }],
      stopFinalizationMs: 1200,
    };

    expect(classifyPrivateAudioValidity(row).valid).toBe(true);
  });

  // Cross-check against the REAL failing artifact from the test-agent report so the
  // validator provably reproduces the report's verdict (not just synthetic cases).
  it('reproduces the report verdict on the real pre-fix corpus artifact (if present)', () => {
    const artifactPath = '/private/tmp/speaksharp-stt-corpus-1780341387199.json';
    if (!existsSync(artifactPath)) {
      // Artifact is environment-local; skip cleanly elsewhere.
      return;
    }
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const verdict = validatePrivateCorpusArtifact(artifact, {
      h1_2: ['pepper spoils'],
      h1_6: ['they, like'],
    });
    // The report classified this run as gatePass=false. The validator must agree.
    expect(verdict.pass).toBe(false);
    const h1_2 = verdict.rows.find((r) => r.fixture === 'h1_2');
    const h1_6 = verdict.rows.find((r) => r.fixture === 'h1_6');
    // Pre-fix run: telemetry null + wrong finals are the documented failures.
    expect(h1_2?.failures).toContain('runtime_telemetry_null');
    expect(h1_2?.failures).toContain('final_missing:pepper spoils');
    expect(h1_6?.failures).toContain('final_missing:they, like');
  });
});
