import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('#1047 U3 customer-claim source contract', () => {
  it('contains no testimonial or unsupported quantified social-proof source', () => {
    const files = readdirSync('frontend/src', { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.includes('__tests__/'))
      .map((file) => join('frontend/src', file));
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/testimonial/i);
    expect(source).not.toMatch(/\b\d[\d,]*\+?\s+(?:customers|speakers|teams|users)\b/i);
    expect(source).not.toMatch(/trusted by|customers (?:love|say)/i);
  });
});
