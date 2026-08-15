import { describe, expect, it } from 'vitest';
import { validateCanaryIdentityConfig, CANARY_LANES } from '../../scripts/lib/canaryIdentityConfig.mjs';

describe('protected canary identity configuration (#1294 lane-scoped)', () => {
  // Both emails are always validated (distinctness/domain is a config invariant); ONLY the SELECTED lane's
  // password is required. A routine active-trial run must never depend on CANARY_PAID_PASSWORD.
  const EMAILS = { trialEmail: 'trial@example.test', paidEmail: 'paid@example.test' };

  it('active-trial: requires only the trial password (paid password absent is OK)', () => {
    expect(validateCanaryIdentityConfig({ ...EMAILS, lane: 'active-trial', lanePassword: 'trial-secret' })).toEqual({
      valid: true, distinct: true, prohibited_domain: false, lane: 'active-trial', lane_password_present: true,
    });
  });

  it('paid-continuation: requires only the paid password', () => {
    expect(validateCanaryIdentityConfig({ ...EMAILS, lane: 'paid-continuation', lanePassword: 'paid-secret' })).toEqual({
      valid: true, distinct: true, prohibited_domain: false, lane: 'paid-continuation', lane_password_present: true,
    });
  });

  it('exports exactly the two canary lanes', () => {
    expect(CANARY_LANES).toEqual(['active-trial', 'paid-continuation']);
  });

  it.each([
    // Email distinctness/domain is validated for BOTH identities regardless of lane.
    [{ ...EMAILS, trialEmail: '', lane: 'active-trial', lanePassword: 'x' }, 'missing or invalid'],
    [{ ...EMAILS, paidEmail: 'not-an-email', lane: 'active-trial', lanePassword: 'x' }, 'missing or invalid'],
    [{ trialEmail: 'same@example.test', paidEmail: ' SAME@example.test ', lane: 'active-trial', lanePassword: 'x' }, 'must be distinct'],
    [{ ...EMAILS, paidEmail: 'paid@speaksharp.app', lane: 'active-trial', lanePassword: 'x' }, 'prohibited domain'],
    [{ ...EMAILS, trialEmail: 'trial@sub.speaksharp.app', lane: 'active-trial', lanePassword: 'x' }, 'prohibited domain'],
    // Unknown lane fails closed.
    [{ ...EMAILS, lane: 'freeform', lanePassword: 'x' }, 'unknown canary lane'],
    [{ ...EMAILS, lane: undefined, lanePassword: 'x' }, 'unknown canary lane'],
    // The SELECTED lane's password (present-only check) is required.
    [{ ...EMAILS, lane: 'active-trial', lanePassword: '' }, 'password secret is missing for lane active-trial'],
    [{ ...EMAILS, lane: 'paid-continuation', lanePassword: undefined }, 'password secret is missing for lane paid-continuation'],
    [{ ...EMAILS, lane: 'active-trial', lanePassword: '   ' }, 'password secret is missing for lane active-trial'],
  ])('fails closed without disclosing either identity', (input, expected) => {
    expect(() => validateCanaryIdentityConfig(input)).toThrow(expected);
  });

  it('never includes the password value in the thrown message', () => {
    const call = () => validateCanaryIdentityConfig({ ...EMAILS, lane: 'active-trial', lanePassword: '' });
    expect(call).toThrow('password secret is missing');
    expect(call).not.toThrow('trial-secret');
  });
});
