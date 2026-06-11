import { describe, it, expect } from 'vitest';
import { applyFinalTranscriptUpdate } from '../TranscriptionService';

/**
 * Contract for the rolling-final vs whole-utterance-replacement boundary.
 *
 * Root cause this guards: Private's post-Stop whole-utterance re-decode was APPENDED to the
 * accumulated rolling preview (rolling + final duplication -> inflated saved WER, e.g. Gate A
 * saved wer 0.906 / 352 words vs visible-at-stop 0.262 / 179 words). The `replacesRollingTranscript`
 * marker makes the engine's replacement intent explicit so the service replaces instead of merges.
 */
describe('applyFinalTranscriptUpdate — rolling vs whole-utterance replacement', () => {
  const rollingPreview =
    'On the one hand I was summoned by my country and love from a retreat which I had chosen';
  const wholeUtteranceFinal =
    'On the one hand, I was summoned by my country, whose voice I can never hear but with veneration.';

  it('Test 1: a replacement final REPLACES the rolling preview (no rolling+final duplication)', () => {
    const result = applyFinalTranscriptUpdate(rollingPreview, wholeUtteranceFinal, true);
    expect(result).toBe(wholeUtteranceFinal);
    expect(result).not.toContain('and love from a retreat'); // rolling-only text is gone
    expect(result.length).toBeLessThan((rollingPreview + wholeUtteranceFinal).length); // not concatenated
  });

  it('Test 2: a NON-flagged final still merges/appends (existing behavior preserved)', () => {
    const result = applyFinalTranscriptUpdate('first segment.', 'second segment.', false);
    expect(result).toContain('first segment');
    expect(result).toContain('second segment'); // appended, not replaced
  });

  it('Test 3: Native/Cloud-style final (flag undefined) is unaffected — growing superset still replaces by prefix', () => {
    const result = applyFinalTranscriptUpdate('hello world', 'hello world and more');
    expect(result).toBe('hello world and more');
  });

  it('Test 4: an EMPTY/whitespace replacement final never wipes a good transcript', () => {
    expect(applyFinalTranscriptUpdate(rollingPreview, '   ', true)).toBe(rollingPreview.trim());
    expect(applyFinalTranscriptUpdate(rollingPreview, '', true)).toBe(rollingPreview.trim());
  });

  it('the bug case: a clean re-decode that is NOT a prefix of the rolling text — append duplicates, replace is clean', () => {
    // Without the flag, the generic merge appends (the duplication bug).
    const appended = applyFinalTranscriptUpdate(rollingPreview, wholeUtteranceFinal, false);
    expect(appended.length).toBeGreaterThan(wholeUtteranceFinal.length);
    // With the flag, it replaces wholesale.
    const replaced = applyFinalTranscriptUpdate(rollingPreview, wholeUtteranceFinal, true);
    expect(replaced).toBe(wholeUtteranceFinal);
  });
});
