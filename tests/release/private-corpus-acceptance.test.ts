import { describe, expect, it } from 'vitest';
import {
  validatePrivateRow,
  validatePrivateCorpusArtifact,
  PRIVATE_ACCEPTANCE,
  classifyPrivateAudioValidity,
  buildPrivateHarnessPrecheck,
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

  it('keeps Stop latency unqualified when the transcript is correct but finalization timing was not observed', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'They like fresh coffee.',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0.04, peak: 0.2 }],
      privateTrace: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
    };
    expect(validatePrivateRow({ ...row, stopFinalizationMs: 1200 }, ['fresh coffee']).pass).toBe(true);
    for (const timing of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '1200']) {
      const unobserved = { ...row, stopFinalizationMs: timing };
      const result = validatePrivateRow(unobserved, ['fresh coffee']);
      expect(result).toMatchObject({ pass: false, invalid: true, invalidReason: 'invalid_stop_finalization_unobserved' });
      expect(buildPrivateHarnessPrecheck(unobserved).valid).toBe(false);
    }
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

  it('marks rows with process_audio_ready but no captured audio chunks INVALID', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'anything',
      privateAudioChunks: [],
      privateTrace: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
      stopFinalizationMs: 1200,
    };

    expect(validatePrivateRow(row).invalidReason).toBe('invalid_no_audio_delivered');
  });

  it('marks rows with captured chunks but no process_audio_ready event INVALID', () => {
    const row = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'anything',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0.04, peak: 0.2 }],
      privateTrace: [{ event: 'speech_start_detected' }],
      stopFinalizationMs: 1200,
    };

    expect(validatePrivateRow(row).invalidReason).toBe('invalid_process_audio_ready_missing');
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

  it('builds a compact HARNESS_PRECHECK_PASS block for valid current proof rows', () => {
    const row = {
      fixture: 'h1_6',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0.04, peak: 0.2 }],
      privateTrace: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
      stopFinalizationMs: 1200,
    };

    expect(buildPrivateHarnessPrecheck(row)).toEqual({
      status: 'HARNESS_PRECHECK_PASS',
      valid: true,
      reason: null,
      checks: {
        fixture: 'h1_6',
        proofFieldsPresent: true,
        audioChunkCount: 1,
        processAudioReady: true,
        speechStartDetected: true,
        positiveEnergy: true,
        speechExpected: true,
        stopFinalizationMs: 1200,
      },
    });
  });

  it('builds HARNESS_PRECHECK_INVALID when current proof fields are missing', () => {
    const row = {
      fixture: 'h1_6',
      detailTranscript: 'legacy row',
      stopFinalizationMs: 1200,
    };

    expect(classifyPrivateAudioValidity(row)).toEqual({ valid: true, reason: null });
    expect(buildPrivateHarnessPrecheck(row)).toMatchObject({
      status: 'HARNESS_PRECHECK_INVALID',
      valid: false,
      reason: 'invalid_harness_proof_missing',
      checks: {
        fixture: 'h1_6',
        proofFieldsPresent: false,
        audioChunkCount: 0,
      },
    });
  });

  it('builds HARNESS_PRECHECK_INVALID for zero-energy current proof rows', () => {
    const row = {
      fixture: 'h1_6',
      privateAudioChunks: [{ samples: 16000, durationSec: 1, rms: 0, peak: 0 }],
      privateTrace: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
      stopFinalizationMs: 1200,
    };

    expect(buildPrivateHarnessPrecheck(row)).toMatchObject({
      status: 'HARNESS_PRECHECK_INVALID',
      valid: false,
      reason: 'invalid_zero_audio_energy',
    });
  });

  it('refuses corpus credit when an expected speech recording is absent or replaced', () => {
    const recorded = {
      fixture: 'h1_6',
      privateRuntime: 'wasm-singlethread',
      privateProvider: 'transformers-js',
      privateCloudFallbackAttempted: false,
      detailTranscript: 'They like fresh coffee.',
      stopFinalizationMs: 1200,
    };
    const required = { h1_2: ['pepper spoils'], h1_6: ['fresh coffee'] };
    const pepper = { ...recorded, fixture: 'h1_2', detailTranscript: 'A dash of pepper spoils beef stew.' };

    expect(validatePrivateCorpusArtifact({ results: [recorded, pepper] }, required).pass).toBe(true);
    expect(validatePrivateCorpusArtifact({ results: [recorded] }, { h1_6: ['fresh coffee'] }).pass).toBe(true);

    for (const replacement of [[], [{ ...pepper, fixture: 'different_speech', detailTranscript: '' }],
      [{ ...pepper, mode: 'native' }], [recorded]]) {
      expect(validatePrivateCorpusArtifact({ results: [recorded, ...replacement] }, required))
        .toMatchObject({ pass: false, missingExpectedFixtures: ['h1_2'] });
    }
  });

  it('reproduces the report failure classes with a portable synthetic corpus', () => {
    // Report-shaped synthetic rows, not a rerun of the original recordings.
    const artifact = {
      results: [
        { fixture: 'h1_2', privateRuntime: null, privateProvider: null, privateCloudFallbackAttempted: false,
          detailTranscript: 'A dash of pepper spurtles beef stew.', stopFinalizationMs: 4000 },
        { fixture: 'h1_6', privateRuntime: 'wasm-singlethread', privateProvider: 'transformers-js', privateCloudFallbackAttempted: false,
          detailTranscript: 'They like fresh coffee.', stopFinalizationMs: 4000 },
      ],
    };
    const verdict = validatePrivateCorpusArtifact(artifact, { h1_2: ['pepper spoils'], h1_6: ['they, like'] });
    expect(verdict.pass).toBe(false);
    expect(verdict.rows.find((row) => row.fixture === 'h1_2')?.failures)
      .toEqual(expect.arrayContaining(['runtime_telemetry_null', 'final_missing:pepper spoils']));
    expect(verdict.rows.find((row) => row.fixture === 'h1_6')?.failures).toContain('final_missing:they, like');
  });
});
