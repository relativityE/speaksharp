import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPT_STATE,
  TRANSCRIPT_STATE_VALUES,
  TRANSCRIPT_STATE_COPY,
  hasReadableTranscript,
  resolveTranscriptState,
} from '../transcriptState';

describe('#1047 PR-U1 transcript state contract', () => {
  it('exposes exactly the closed value set', () => {
    expect([...TRANSCRIPT_STATE_VALUES].sort()).toEqual(['available', 'expired', 'not_captured']);
  });

  it('only `available` counts as a readable transcript (text/AI actions gate on this)', () => {
    expect(hasReadableTranscript(TRANSCRIPT_STATE.AVAILABLE)).toBe(true);
    expect(hasReadableTranscript(TRANSCRIPT_STATE.EXPIRED)).toBe(false);
    expect(hasReadableTranscript(TRANSCRIPT_STATE.NOT_CAPTURED)).toBe(false);
    expect(hasReadableTranscript(undefined)).toBe(false);
    expect(hasReadableTranscript('anything-else')).toBe(false);
  });

  it('a present server state always wins over the transcript-presence fallback', () => {
    // expired MUST survive even though a transcript string is (implausibly) present — server owns it.
    expect(resolveTranscriptState('expired', 'still here')).toBe('expired');
    expect(resolveTranscriptState('not_captured', 'still here')).toBe('not_captured');
    expect(resolveTranscriptState('available', '')).toBe('available');
  });

  it('legacy rows (no server state) derive available/not_captured from transcript presence — never expired', () => {
    expect(resolveTranscriptState(undefined, 'hello world')).toBe('available');
    expect(resolveTranscriptState(undefined, '   ')).toBe('not_captured');
    expect(resolveTranscriptState(undefined, '')).toBe('not_captured');
    expect(resolveTranscriptState(undefined, null)).toBe('not_captured');
    expect(resolveTranscriptState(null, undefined)).toBe('not_captured');
    // Emptiness is never inferred as expired.
    expect(resolveTranscriptState(undefined, '')).not.toBe('expired');
  });

  it('carries the canonical single-source copy for the two non-available states', () => {
    expect(TRANSCRIPT_STATE_COPY.EXPIRED).toBe('Transcript expired. Your measurements are still available.');
    expect(TRANSCRIPT_STATE_COPY.NOT_CAPTURED).toBe('No transcript was captured.');
  });
});
