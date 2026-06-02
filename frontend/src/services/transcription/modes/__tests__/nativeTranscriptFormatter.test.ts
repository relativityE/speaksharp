import { describe, it, expect, afterEach, vi } from 'vitest';

vi.unmock('../nativeTranscriptFormatter');

import {
  formatNativeTranscript,
  registerNativeTranscriptFormatter,
  hasNativeTranscriptFormatter,
  isWordPreserving,
  transcriptWordSequence,
} from '../nativeTranscriptFormatter';

afterEach(() => {
  // Always restore identity behavior between tests.
  registerNativeTranscriptFormatter(null);
});

describe('nativeTranscriptFormatter', () => {
  it('is identity by default (no behavior change until a formatter is registered)', async () => {
    expect(hasNativeTranscriptFormatter()).toBe(false);
    const input = 'point. Starts Now basically i want to make one point';
    expect(await formatNativeTranscript(input)).toBe(input);
  });

  it('applies a registered formatter to the saved transcript', async () => {
    registerNativeTranscriptFormatter((raw) => raw.toUpperCase());
    expect(hasNativeTranscriptFormatter()).toBe(true);
    expect(await formatNativeTranscript('hello world')).toBe('HELLO WORLD');
  });

  it('supports async (network/model) formatters', async () => {
    registerNativeTranscriptFormatter(async (raw) => `${raw.trim()}.`);
    expect(await formatNativeTranscript('no terminal punctuation')).toBe('no terminal punctuation.');
  });

  it('falls back to the original text when the formatter throws', async () => {
    registerNativeTranscriptFormatter(() => {
      throw new Error('model offline');
    });
    expect(await formatNativeTranscript('keep me')).toBe('keep me');
  });

  it('falls back to the original text when an async formatter rejects', async () => {
    registerNativeTranscriptFormatter(async () => {
      throw new Error('network timeout');
    });
    expect(await formatNativeTranscript('still here')).toBe('still here');
  });

  it('never blanks a non-empty transcript when the formatter returns empty', async () => {
    registerNativeTranscriptFormatter(() => '   ');
    expect(await formatNativeTranscript('original words')).toBe('original words');
  });

  it('returns empty input unchanged without invoking the formatter', async () => {
    const formatter = vi.fn((raw: string) => raw.toUpperCase());
    registerNativeTranscriptFormatter(formatter);
    expect(await formatNativeTranscript('')).toBe('');
    expect(await formatNativeTranscript('   ')).toBe('   ');
    expect(formatter).not.toHaveBeenCalled();
  });

  it('registerNativeTranscriptFormatter returns the previous formatter for restoration', async () => {
    const first = (raw: string) => `${raw}!`;
    const prevNull = registerNativeTranscriptFormatter(first);
    expect(prevNull).toBeNull();
    const prevFirst = registerNativeTranscriptFormatter(null);
    expect(prevFirst).toBe(first);
  });

  // --- Word-preservation guard (saved-transcript safety contract) ---

  it('ACCEPTS punctuation + casing restoration (run-on -> sentences), same words', async () => {
    registerNativeTranscriptFormatter(
      () => 'Starts now. I want to make one point. Basically the puppy chewed the shoes.',
    );
    const raw = 'starts now i want to make one point basically the puppy chewed the shoes';
    expect(await formatNativeTranscript(raw)).toBe(
      'Starts now. I want to make one point. Basically the puppy chewed the shoes.',
    );
  });

  it('REJECTS output that drops a filler word -> returns raw', async () => {
    // "um" removed by the formatter -> word change -> guard rejects.
    registerNativeTranscriptFormatter(() => 'Basically the puppy chewed the shoes.');
    const raw = 'um basically the puppy chewed the shoes';
    expect(await formatNativeTranscript(raw)).toBe(raw);
  });

  it('REJECTS output that adds a word -> returns raw', async () => {
    registerNativeTranscriptFormatter((raw) => `${raw} extra`);
    expect(await formatNativeTranscript('keep these words')).toBe('keep these words');
  });

  it('REJECTS output that reorders / "corrects" words -> returns raw', async () => {
    registerNativeTranscriptFormatter(() => 'going to the store'); // "gonna" -> "going to"
    expect(await formatNativeTranscript('gonna the store')).toBe('gonna the store');
  });

  it('isWordPreserving: true for punctuation/casing-only, false for word edits', () => {
    expect(isWordPreserving('hello world', 'Hello, world.')).toBe(true);
    expect(isWordPreserving('um like basically', 'Um, like, basically.')).toBe(true);
    expect(isWordPreserving('um like basically', 'like basically')).toBe(false); // dropped um
    expect(isWordPreserving('one two', 'one two three')).toBe(false); // added word
    expect(isWordPreserving('a b c', 'a c b')).toBe(false); // reordered
  });

  it('transcriptWordSequence strips punctuation/case', () => {
    expect(transcriptWordSequence('Um, the Puppy—chewed it!')).toEqual(['um', 'the', 'puppy', 'chewed', 'it']);
  });
});
