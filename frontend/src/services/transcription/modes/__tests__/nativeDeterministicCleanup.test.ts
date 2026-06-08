import { describe, it, expect } from 'vitest';
import { normalizeNativeTranscript } from '../nativeDeterministicCleanup';
import { isWordPreserving } from '../nativeTranscriptFormatter';

describe('normalizeNativeTranscript (deterministic, word-preserving Native cleanup)', () => {
  it('returns empty for empty/whitespace input', () => {
    expect(normalizeNativeTranscript('')).toBe('');
    expect(normalizeNativeTranscript('   ')).toBe('');
    expect(normalizeNativeTranscript(undefined as unknown as string)).toBe('');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeNativeTranscript('  hello    world  ')).toBe('Hello world.');
  });

  it('capitalizes only the first character (leaves mid-sentence engine caps untouched)', () => {
    // Chrome emits erratic mid-sentence capitals ("Starts Now"); we must NOT touch them.
    expect(normalizeNativeTranscript('speak sharp microphone proof Starts Now basically i want')).toBe(
      'Speak sharp microphone proof Starts Now basically i want.',
    );
  });

  it('appends a terminal period only when missing', () => {
    expect(normalizeNativeTranscript('this is done')).toBe('This is done.');
    expect(normalizeNativeTranscript('already done.')).toBe('Already done.');
    expect(normalizeNativeTranscript('is it done?')).toBe('Is it done?');
    expect(normalizeNativeTranscript('stop!')).toBe('Stop!');
  });

  it('does not add a word when the transcript starts with a number', () => {
    expect(normalizeNativeTranscript('7 seconds elapsed')).toBe('7 seconds elapsed.');
  });

  it('is idempotent', () => {
    const once = normalizeNativeTranscript('hello world');
    expect(normalizeNativeTranscript(once)).toBe(once);
  });

  it('NEVER changes the word sequence (hard word-preservation gate) across varied inputs', () => {
    const samples = [
      'yes that is the point',
      'um basically i think the user will leave if the mic button looks frozen',
      'speak sharp microphone proof Starts Now basically I want to make one simple point',
      'send the pdf to maria and cc alex because the q2 notes mention soc 2 gdpr and hipaa risks',
      'can we ship the beta on monday or should we wait',
      '   weird     spacing   here   ',
    ];
    for (const raw of samples) {
      const out = normalizeNativeTranscript(raw);
      expect(isWordPreserving(raw, out)).toBe(true);
    }
  });
});
