import { describe, expect, it } from 'vitest';
import { validateCanaryIdentityConfig } from '../../scripts/lib/canaryIdentityConfig.mjs';

describe('protected canary identity configuration', () => {
  it('accepts two distinct syntactically valid identities outside the prohibited domain', () => {
    expect(validateCanaryIdentityConfig({
      trialEmail: 'trial@example.test',
      paidEmail: 'paid@example.test',
    })).toEqual({ valid: true, distinct: true, prohibited_domain: false });
  });

  it.each([
    [{ trialEmail: '', paidEmail: 'paid@example.test' }, 'missing or invalid'],
    [{ trialEmail: 'not-an-email', paidEmail: 'paid@example.test' }, 'missing or invalid'],
    [{ trialEmail: 'same@example.test', paidEmail: ' SAME@example.test ' }, 'must be distinct'],
    [{ trialEmail: 'trial@speaksharp.app', paidEmail: 'paid@example.test' }, 'prohibited domain'],
    [{ trialEmail: 'trial@sub.speaksharp.app', paidEmail: 'paid@example.test' }, 'prohibited domain'],
  ])('fails closed without disclosing either identity', (input, expected) => {
    expect(() => validateCanaryIdentityConfig(input)).toThrow(expected);
  });
});
