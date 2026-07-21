import { describe, it, expect } from 'vitest';
import { getExecutiveRehearsalFlagState, EXEC_REHEARSAL_FLAG_KEYS } from '../executiveRehearsalFlags';

const reader = (on: Record<string, boolean>) => ({
  isFeatureEnabled: (key: string) => on[key] ?? false,
});

describe('getExecutiveRehearsalFlagState', () => {
  it('defaults OFF with no reader', () => {
    expect(getExecutiveRehearsalFlagState()).toEqual({ rehearsalEnabled: false, semanticNudgesEnabled: false });
    expect(getExecutiveRehearsalFlagState(null)).toEqual({ rehearsalEnabled: false, semanticNudgesEnabled: false });
  });

  it('defaults OFF when the reader has no isFeatureEnabled', () => {
    expect(getExecutiveRehearsalFlagState({} as never)).toEqual({ rehearsalEnabled: false, semanticNudgesEnabled: false });
  });

  it('never throws — resolves OFF when the reader throws', () => {
    const throwing = { isFeatureEnabled: () => { throw new Error('boom'); } };
    expect(getExecutiveRehearsalFlagState(throwing)).toEqual({ rehearsalEnabled: false, semanticNudgesEnabled: false });
  });

  it('turns the rehearsal layer ON only when the parent flag is true', () => {
    expect(getExecutiveRehearsalFlagState(reader({ [EXEC_REHEARSAL_FLAG_KEYS.enabled]: true })).rehearsalEnabled).toBe(true);
  });

  it('keeps semantic nudges OFF unless BOTH the parent and nudge flags are ON', () => {
    // nudge flag on but parent off => whole thing OFF (parent gates the child).
    expect(getExecutiveRehearsalFlagState(reader({ [EXEC_REHEARSAL_FLAG_KEYS.semanticNudges]: true }))).toEqual({
      rehearsalEnabled: false,
      semanticNudgesEnabled: false,
    });
    // parent on, nudge off => nudges OFF.
    expect(getExecutiveRehearsalFlagState(reader({ [EXEC_REHEARSAL_FLAG_KEYS.enabled]: true })).semanticNudgesEnabled).toBe(false);
    // both on => nudges ON (still separately consent-gated at the call site).
    expect(
      getExecutiveRehearsalFlagState(reader({
        [EXEC_REHEARSAL_FLAG_KEYS.enabled]: true,
        [EXEC_REHEARSAL_FLAG_KEYS.semanticNudges]: true,
      })).semanticNudgesEnabled,
    ).toBe(true);
  });
});
