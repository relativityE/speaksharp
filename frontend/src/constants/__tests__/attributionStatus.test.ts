import { describe, it, expect } from 'vitest';
import { ATTRIBUTION_STATUS, ATTRIBUTION_STATUS_VALUES, isVerifiedAttribution } from '../attributionStatus';

describe('#1033 attribution status contract', () => {
  it('defines exactly the four lifecycle values (matches the DB CHECK constraint)', () => {
    expect(new Set(ATTRIBUTION_STATUS_VALUES)).toEqual(
      new Set(['legacy_unknown', 'pending', 'verified', 'unverified']),
    );
    expect(ATTRIBUTION_STATUS.PENDING).toBe('pending');
    expect(ATTRIBUTION_STATUS.VERIFIED).toBe('verified');
  });

  it('isVerifiedAttribution accepts ONLY verified — every other status (incl. legacy) is excluded from engine evidence', () => {
    expect(isVerifiedAttribution('verified')).toBe(true);
    for (const s of ['pending', 'unverified', 'legacy_unknown', null, undefined, '', 'transformers-js']) {
      expect(isVerifiedAttribution(s as string | null | undefined)).toBe(false);
    }
  });
});
