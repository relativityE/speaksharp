import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { reducePrivateTiming } from '../../scripts/private-timing-reducer.mjs';
import { reducePrivateStatus } from '../../scripts/private-status-reducer.mjs';
import { sanitizeTranscriptText } from '../../frontend/src/services/transcription/transcriptSanitizer';

// Implements the test-agent report's "Unit-testable checks without browser" list
// verbatim, so dev verification matches the test agent's acceptance criteria.

describe('Private no-browser check #1: timing reducer', () => {
  it('computes firstDraftDelay, stopToWholeStart, wholeDecodeDuration from trace events', () => {
    const trace = [
      { event: 'stream_start', epochMs: 1000 },
      { event: 'first_transcript_provisional_partial_emit', epochMs: 5000 },
      { event: 'stop_requested', epochMs: 10000 },
      { event: 'whole_utterance_commit_start', epochMs: 15000 },
      { event: 'whole_utterance_commit_accept', epochMs: 18000 },
      { event: 'stop_force_processing_complete', epochMs: 18100 },
      { event: 'stop_force_tail_skipped', epochMs: 18100 },
    ];
    const t = reducePrivateTiming(trace);
    expect(t.firstDraftDelay).toBe(4000);
    expect(t.stopToWholeStart).toBe(5000);
    expect(t.wholeDecodeDuration).toBe(3000);
    expect(t.stopFinalizationMs).toBe(8100);
    expect(t.forcedTailSkipped).toBe(true);
  });

  it('reproduces the report timing math on the real pre-fix artifact (if present)', () => {
    const p = '/private/tmp/speaksharp-stt-corpus-1780341387199.json';
    if (!existsSync(p)) return;
    const artifact = JSON.parse(readFileSync(p, 'utf8'));
    for (const fixture of ['h1_2', 'h1_6']) {
      const row = artifact.results.find((r: { fixture: string }) => r.fixture === fixture);
      const t = reducePrivateTiming(row.privateTrace, row);
      // Report: ~5s pre-decode wait — the dead time the latency fix removes.
      expect(t.stopToWholeStart).toBeGreaterThan(4500);
      expect(t.stopToWholeStart).toBeLessThan(5500);
      // Pre-fix runs did NOT skip the forced tail (the fix is not in this artifact).
      expect(t.forcedTailSkipped).toBe(false);
    }
  });
});

describe('Private no-browser check #3: candidate sanitizer does not alter clean finals', () => {
  it('leaves h1_2 / h1_6 correct finals unchanged through cleanup', () => {
    const cleanFinals = [
      'Basically, a dash of pepper spoils beef stew.',
      'They, like, told wild tales to frighten him.',
      'The puppy, like, chewed up the new shoes.',
    ];
    for (const text of cleanFinals) {
      expect(sanitizeTranscriptText(text)).toBe(text);
    }
  });

  it('still strips genuine metadata/markers (sanity)', () => {
    expect(sanitizeTranscriptText('hello [BLANK_AUDIO] world')).toBe('hello world');
    expect(sanitizeTranscriptText('hello *cough* world')).toBe('hello world');
  });
});

describe('Private no-browser check #4: status reducer', () => {
  it('prefers "Processing speech locally..." over "Recording active" during STOPPING', () => {
    const result = reducePrivateStatus({
      runtimeState: 'STOPPING',
      currentStatus: { type: 'recording', message: 'Recording active' },
      engineStatus: { type: 'info', message: 'Processing speech locally…' },
    });
    expect(result.type).toBe('info');
    expect(result.message).toBe('Processing speech locally…');
  });

  it('also surfaces local finalization while RECORDING', () => {
    const result = reducePrivateStatus({
      runtimeState: 'RECORDING',
      currentStatus: { type: 'recording', message: 'Recording active' },
      engineStatus: { type: 'info', message: 'Processing speech locally…' },
    });
    expect(result.message).toBe('Processing speech locally…');
  });

  it('does not override recording status when idle/ready (no active finalization)', () => {
    const result = reducePrivateStatus({
      runtimeState: 'READY',
      currentStatus: { type: 'ready', message: 'Ready to record' },
      engineStatus: { type: 'info', message: 'Processing speech locally…' },
    });
    expect(result.type).toBe('ready');
  });
});
