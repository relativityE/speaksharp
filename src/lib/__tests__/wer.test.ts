import { describe, it, expect } from 'vitest';
import { calculateWordErrorRate } from '../wer';

describe('calculateWordErrorRate', () => {
  it('should return 0 for identical strings', () => {
    const ref = 'this is a test';
    const hyp = 'this is a test';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0);
  });

  it('should handle a single substitution', () => {
    const ref = 'this is a test';
    const hyp = 'this was a test';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0.25); // 1 error / 4 words
  });

  it('should handle a single deletion', () => {
    const ref = 'this is a test';
    const hyp = 'this is test';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0.25); // 1 error / 4 words
  });

  it('should handle a single insertion', () => {
    const ref = 'this is a test';
    const hyp = 'this is a great test';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0.25); // 1 error / 4 words
  });

  it('should handle multiple errors', () => {
    const ref = 'this is a test';
    const hyp = 'this was test'; // 1 substitution, 1 deletion
    expect(calculateWordErrorRate(ref, hyp)).toBe(0.5); // 2 errors / 4 words
  });

  it('should handle empty reference string', () => {
    const ref = '';
    const hyp = 'this is a test';
    expect(calculateWordErrorRate(ref, hyp)).toBe(4);
  });

  it('should handle empty hypothesis string', () => {
    const ref = 'this is a test';
    const hyp = '';
    expect(calculateWordErrorRate(ref, hyp)).toBe(1); // 4 errors / 4 words
  });

  it('should handle both strings being empty', () => {
    const ref = '';
    const hyp = '';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0);
  });
});