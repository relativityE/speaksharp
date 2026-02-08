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

  it('should unify whitespace handling (multiple spaces, tabs, newlines)', () => {
    const ref = 'this   is\ta\ntest';
    const hyp = 'this is a test';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0);
  });

  it('should handle leading/trailing whitespace and mixed case', () => {
    const ref = '  This IS a test  ';
    const hyp = 'this is a TEST';
    expect(calculateWordErrorRate(ref, hyp)).toBe(0);
  });

  it('should utilize the cache for repeated calls', () => {
    const ref = 'consistent reference';
    const hyp = 'consistent hypothesis';
    const result1 = calculateWordErrorRate(ref, hyp);
    const result2 = calculateWordErrorRate(ref, hyp);
    expect(result1).toBe(result2);
    expect(result1).toBeGreaterThan(0);
  });

  it('should correctly calculate WER for very long strings (testing 1D DP robustness)', () => {
    const ref = Array(1000).fill('word').join(' ');
    const hyp = Array(900).fill('word').join(' ');
    expect(calculateWordErrorRate(ref, hyp)).toBeCloseTo(0.1, 5);
  });
});