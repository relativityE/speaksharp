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

  it('drops blank/whitespace-only talking points and counts only the non-empty ones', () => {
    // Enough non-empty after dropping blanks => ok, blanks removed.
    const ok = validateRehearsalBrief({ ...base(), talkingPoints: ['A', '   ', 'B', '', 'C', '\t'] });
    expect(ok.ok).toBe(true);
    expect(ok.value?.talkingPoints).toEqual(['A', 'B', 'C']);

    // Blanks that reduce the effective count below the minimum => too_few (no separate blank error).
    const tooFew = validateRehearsalBrief({ ...base(), talkingPoints: ['A', '  ', 'B', ''] });
    expect(tooFew.ok).toBe(false);
    expect(tooFew.errors.map((e) => e.code)).toContain('too_few_talking_points');
    expect(tooFew.errors.some((e) => (e.code as string) === 'blank_talking_point')).toBe(false);

    // All-blank => too_few.
    const allBlank = validateRehearsalBrief({ ...base(), talkingPoints: ['', '  ', '\n'] });
    expect(allBlank.ok).toBe(false);
    expect(allBlank.errors.map((e) => e.code)).toContain('too_few_talking_points');
  });

  it('handles malformed talking-point entries (non-strings) deterministically as blanks', () => {
    const r = validateRehearsalBrief({ ...base(), talkingPoints: ['A', 42, null, undefined, 'B', 'C'] as never });
    expect(r.ok).toBe(true);
    expect(r.value?.talkingPoints).toEqual(['A', 'B', 'C']);
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
