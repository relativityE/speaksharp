// #1337 RETURN — falsification for the three-recording entitlement decision.
//
// The defect this locks down: an ACTIVE TRIAL whose `trial_seconds_remaining` was missing or
// non-numeric bypassed the budget check entirely and passed. Trial headroom must fail closed.
import { describe, it, expect } from 'vitest';
import { evaluateThreeRecordingEntitlement } from '../live/helpers/entitlementAuthority.ts';

const NEED = 270;   // three bounded recordings

describe('three-recording entitlement authority', () => {
  it('active trial with headroom for all three: OK', () => {
    expect(evaluateThreeRecordingEntitlement(
      { trial_active: true, trial_seconds_remaining: NEED }, NEED).ok).toBe(true);
    expect(evaluateThreeRecordingEntitlement(
      { trial_active: true, trial_seconds_remaining: NEED + 1 }, NEED).ok).toBe(true);
  });

  it('active trial short of the budget: REJECTED', () => {
    const v = evaluateThreeRecordingEntitlement(
      { trial_active: true, trial_seconds_remaining: NEED - 1 }, NEED);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('trial_headroom_insufficient');
  });

  // THE RETURNED CASE: previously skipped the budget check and passed.
  it('active trial with MISSING trial_seconds_remaining: REJECTED (fails closed)', () => {
    const v = evaluateThreeRecordingEntitlement({ trial_active: true }, NEED);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('trial_seconds_remaining_not_finite');
  });

  it('active trial with a NON-NUMERIC or non-finite remaining: REJECTED', () => {
    for (const bad of [null, '300', NaN, Infinity, -Infinity, {}, [], true, undefined]) {
      const v = evaluateThreeRecordingEntitlement(
        { trial_active: true, trial_seconds_remaining: bad }, NEED);
      expect(v.ok, `remaining=${String(bad)} must be rejected`).toBe(false);
    }
  });

  it('a trial that ALSO reports pro is still governed by the trial budget', () => {
    // A trial can resolve to effective Pro. While the trial is live its finite budget governs, so
    // is_pro must not be usable as an escape from the headroom requirement.
    const v = evaluateThreeRecordingEntitlement(
      { trial_active: true, is_pro: true, trial_seconds_remaining: NEED - 1 }, NEED);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('trial_headroom_insufficient');
    const missing = evaluateThreeRecordingEntitlement({ trial_active: true, is_pro: true }, NEED);
    expect(missing.ok).toBe(false);
  });

  it('effective Pro without a trial passes WITHOUT a finite limit', () => {
    expect(evaluateThreeRecordingEntitlement({ is_pro: true }, NEED).ok).toBe(true);
    expect(evaluateThreeRecordingEntitlement(
      { is_pro: true, trial_active: false, trial_seconds_remaining: null }, NEED).ok).toBe(true);
  });

  it('neither trial nor pro: REJECTED even when can_start is true', () => {
    const v = evaluateThreeRecordingEntitlement({ can_start: true }, NEED);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('no_trial_and_not_pro');
    // can_start is a per-start verdict and must never stand in for journey entitlement.
    expect(evaluateThreeRecordingEntitlement(
      { can_start: true, trial_active: false, is_pro: false }, NEED).ok).toBe(false);
  });
});
