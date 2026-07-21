import { describe, it, expect } from 'vitest';
import {
  validateRehearsalBrief,
  TALKING_POINTS_MIN,
  TALKING_POINTS_MAX,
  TARGET_DURATION_MAX_SEC,
} from '../rehearsalBrief';

const base = () => ({
  audience: 'Board of directors',
  objective: 'Secure approval for the FY budget',
  desiredDecision: 'Approve the $2M platform investment',
  talkingPoints: ['Revenue impact', 'Risk and mitigation', 'Timeline to value'],
});

describe('validateRehearsalBrief', () => {
  it('accepts a well-formed brief and returns a trimmed, normalized value', () => {
    const r = validateRehearsalBrief({
      ...base(),
      audience: '  Board  ',
      talkingPoints: ['  Revenue impact  ', 'Risk', 'Timeline', ''],
      targetDurationSec: 300.6,
    });
    expect(r.ok).toBe(true);
    expect(r.value?.audience).toBe('Board');
    expect(r.value?.talkingPoints).toEqual(['Revenue impact', 'Risk', 'Timeline']); // blank dropped
    expect(r.value?.targetDurationSec).toBe(301); // rounded
  });

  it('flags each required field when missing', () => {
    const r = validateRehearsalBrief({ talkingPoints: [] });
    expect(r.ok).toBe(false);
    const fields = r.errors.map((e) => e.field);
    expect(fields).toContain('audience');
    expect(fields).toContain('objective');
    expect(fields).toContain('desiredDecision');
    expect(fields).toContain('talkingPoints');
  });

  it(`requires at least ${TALKING_POINTS_MIN} talking points`, () => {
    const r = validateRehearsalBrief({ ...base(), talkingPoints: ['only one', 'two'] });
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field === 'talkingPoints')?.code).toBe('too_few_talking_points');
  });

  it(`rejects more than ${TALKING_POINTS_MAX} talking points`, () => {
    const r = validateRehearsalBrief({ ...base(), talkingPoints: Array.from({ length: 8 }, (_, i) => `point ${i}`) });
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.field === 'talkingPoints')?.code).toBe('too_many_talking_points');
  });

  it('treats target duration as optional but range-checks it when present', () => {
    expect(validateRehearsalBrief(base()).ok).toBe(true); // omitted is fine
    expect(validateRehearsalBrief({ ...base(), targetDurationSec: 5 }).errors[0]?.code).toBe('duration_out_of_range');
    expect(validateRehearsalBrief({ ...base(), targetDurationSec: TARGET_DURATION_MAX_SEC + 1 }).errors[0]?.code).toBe('duration_out_of_range');
    expect(validateRehearsalBrief({ ...base(), targetDurationSec: Number.NaN }).errors[0]?.code).toBe('duration_not_a_number');
  });

  it('never throws on null/garbage input', () => {
    expect(validateRehearsalBrief(null).ok).toBe(false);
    expect(validateRehearsalBrief(undefined).ok).toBe(false);
    expect(validateRehearsalBrief({ talkingPoints: 'not-an-array' } as never).ok).toBe(false);
  });
});
