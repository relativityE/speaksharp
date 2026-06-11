import { describe, it, expect } from 'vitest';
import { sanitizeTranscriptText } from '../transcriptSanitizer';

describe('sanitizeTranscriptText — asterisk metadata stripping (review F3)', () => {
  it('strips a short asterisk tag', () => {
    expect(sanitizeTranscriptText('hello *cough* world')).toBe('hello world');
  });

  it('strips an asterisk tag LONGER than 40 chars (the old {1,40} cap let these escape)', () => {
    const longTag = '*this is a very long metadata annotation well over forty characters total*';
    expect(sanitizeTranscriptText(`start ${longTag} end`)).toBe('start end');
  });

  it('strips an asterisk tag containing punctuation/symbols', () => {
    expect(sanitizeTranscriptText('a *[BLANK_AUDIO!! — long]* b')).toBe('a b');
  });

  it('strips multiple separate asterisk tags without eating text between them', () => {
    expect(sanitizeTranscriptText('*Spits* keep this *applause sound effect over forty chars long here yes*'))
      .toBe('keep this');
  });

  it('preserves normal text with no metadata', () => {
    expect(sanitizeTranscriptText('the quick brown fox')).toBe('the quick brown fox');
  });
});
