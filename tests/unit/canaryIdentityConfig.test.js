import { describe, expect, it } from 'vitest';
import { validateCanaryIdentityConfig } from '../../scripts/lib/canaryIdentityConfig.mjs';

describe('protected canary identity configuration', () => {
  // #1294 sourcing split: emails (Variables) + passwords (Secrets) must ALL be present. A valid config
  // supplies both distinct identities AND both password secrets.
  const VALID = {
    trialEmail: 'trial@example.test',
    paidEmail: 'paid@example.test',
    trialPassword: 'trial-secret',
    paidPassword: 'paid-secret',
  };

  it('accepts two distinct valid identities + both password secrets present', () => {
    expect(validateCanaryIdentityConfig(VALID)).toEqual({
      valid: true, distinct: true, prohibited_domain: false, passwords_present: true,
    });
  });

  it.each([
    [{ ...VALID, trialEmail: '' }, 'missing or invalid'],
    [{ ...VALID, trialEmail: 'not-an-email' }, 'missing or invalid'],
    [{ ...VALID, trialEmail: 'same@example.test', paidEmail: ' SAME@example.test ' }, 'must be distinct'],
    [{ ...VALID, trialEmail: 'trial@speaksharp.app' }, 'prohibited domain'],
    [{ ...VALID, trialEmail: 'trial@sub.speaksharp.app' }, 'prohibited domain'],
    // Password secrets are required (present-only check; the value is never logged/compared here).
    [{ ...VALID, trialPassword: '' }, 'password secret is missing'],
    [{ ...VALID, paidPassword: undefined }, 'password secret is missing'],
    [{ ...VALID, trialPassword: '   ' }, 'password secret is missing'],
  ])('fails closed without disclosing either identity', (input, expected) => {
    expect(() => validateCanaryIdentityConfig(input)).toThrow(expected);
  });

  it('never includes any password value in the thrown message', () => {
    const call = () => validateCanaryIdentityConfig({ ...VALID, paidPassword: '' });
    // It throws the content-free reason, and the message never echoes either password value.
    expect(call).toThrow('password secret is missing');
    expect(call).not.toThrow('trial-secret');
    expect(call).not.toThrow('paid-secret');
  });
});
