import { describe, it, expect } from 'vitest';
import {
  validateNextActionSignal,
  renderNextActionCopy,
  REASON_CODES,
  ACTION_CODES,
  NEXT_ACTION_TEMPLATE_VERSION,
  type NextActionSignal,
} from '../nextActionSignal';

const valid: NextActionSignal = {
  reasonCode: 'HIGH_FILLER_RATE',
  actionCode: 'REDUCE_FILLERS',
  metric: 'filler_rate',
  value: 0.08,
  comparator: 'above_baseline',
  templateVersion: NEXT_ACTION_TEMPLATE_VERSION,
};

describe('#1306 next-action contract — fail-closed, prose-proof', () => {
  it('accepts a well-formed enum/numeric signal', () => {
    const r = validateNextActionSignal(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(valid);
  });

  it('REJECTS an unknown key (a prose field cannot be smuggled in)', () => {
    const r = validateNextActionSignal({ ...valid, what_to_try_next: 'Try to slow down and breathe.' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/unknown key 'what_to_try_next'/);
  });

  it('REJECTS a free-form string in an enum field', () => {
    const r = validateNextActionSignal({ ...valid, reasonCode: 'You spoke a bit too fast today' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/reasonCode must be one of/);
  });

  it('REJECTS a non-numeric value', () => {
    const r = validateNextActionSignal({ ...valid, value: '0.08' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/value must be a finite number/);
  });

  it('REJECTS a non-finite value', () => {
    expect(validateNextActionSignal({ ...valid, value: Number.NaN }).ok).toBe(false);
    expect(validateNextActionSignal({ ...valid, value: Infinity }).ok).toBe(false);
  });

  it('REJECTS missing required fields', () => {
    const { reasonCode, ...rest } = valid;
    void reasonCode;
    expect(validateNextActionSignal(rest).ok).toBe(false);
  });

  it('REJECTS non-objects, arrays, and null', () => {
    expect(validateNextActionSignal('slow down next time').ok).toBe(false);
    expect(validateNextActionSignal([valid]).ok).toBe(false);
    expect(validateNextActionSignal(null).ok).toBe(false);
  });

  it('REJECTS an unknown template version (forces an explicit contract bump)', () => {
    expect(validateNextActionSignal({ ...valid, templateVersion: 'rec_v2' }).ok).toBe(false);
  });

  it('every reason+action code renders non-empty copy at render time (no stored prose needed)', () => {
    for (const reasonCode of REASON_CODES) {
      for (const actionCode of ACTION_CODES) {
        const copy = renderNextActionCopy({ ...valid, reasonCode, actionCode });
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.body.length).toBeGreaterThan(0);
      }
    }
  });
});
