import { vi, describe, it, expect, beforeEach } from 'vitest';
import posthog from 'posthog-js';
import { getV4FlagState, V4_FLAG_KEYS } from '../privateV4Flags';

vi.mock('posthog-js', () => ({ default: { isFeatureEnabled: vi.fn(() => false) } }));

/**
 * #1263 — Private v4 flag inventory. The code-level "no accidental cohort" proof: the flag set is exactly
 * the four documented keys, every flag off resolves to the v2-base default, and the distil accuracy tier
 * can never activate without the master v4 switch. Actual PostHog flag STATE (removing the ad-hoc
 * single-distinct-id target, archiving the unused distil flag) is a separate PO/ops action.
 */
describe('#1263 — Private v4 flag inventory (no accidental cohort)', () => {
  beforeEach(() => {
    vi.mocked(posthog.isFeatureEnabled).mockReset();
    vi.mocked(posthog.isFeatureEnabled).mockReturnValue(false);
  });

  it('the flag inventory is exactly the four documented v4 keys', () => {
    expect(V4_FLAG_KEYS).toEqual({
      ENABLED: 'private_stt_v4_enabled',
      DISTIL_ENABLED: 'private_stt_v4_distil_enabled',
      INTERNAL_ONLY: 'private_stt_v4_internal_only',
      ALLOWLIST: 'private_stt_v4_allowlist',
    });
  });

  it('with every flag off, v4 is never selected — the v2-base default (no accidental cohort)', () => {
    const s = getV4FlagState();
    expect(s.v4Enabled).toBe(false);
    expect(s.distilEnabled).toBe(false);
    expect(s.allowlisted).toBe(false);
    expect(s.internalOnly).toBe(false);
  });

  it('the distil tier can NEVER activate without the master v4 switch (a stray distil flag is inert)', () => {
    vi.mocked(posthog.isFeatureEnabled).mockImplementation((k) => k === V4_FLAG_KEYS.DISTIL_ENABLED);
    const s = getV4FlagState();
    expect(s.v4Enabled).toBe(false);
    expect(s.distilEnabled).toBe(false); // gated on v4Enabled — cannot cohort into distil alone
  });

  it('v4 activates ONLY on the explicit master flag; distil requires BOTH flags', () => {
    vi.mocked(posthog.isFeatureEnabled).mockImplementation((k) => k === V4_FLAG_KEYS.ENABLED);
    expect(getV4FlagState().v4Enabled).toBe(true);
    expect(getV4FlagState().distilEnabled).toBe(false);

    vi.mocked(posthog.isFeatureEnabled).mockImplementation(
      (k) => k === V4_FLAG_KEYS.ENABLED || k === V4_FLAG_KEYS.DISTIL_ENABLED,
    );
    expect(getV4FlagState().distilEnabled).toBe(true);
  });
});
