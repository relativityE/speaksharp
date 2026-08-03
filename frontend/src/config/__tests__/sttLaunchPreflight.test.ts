import { describe, it, expect } from 'vitest';
import { evaluateSttLaunchPreflight, type SttLaunchState } from '../sttLaunchPreflight';

const base: SttLaunchState = {
  hierarchyPrimary: true,
  hierarchyHardDisabled: false,
  clientCloudEnabled: false,
  serverCloudEnabled: false,
};

describe('#1120 S1 — STT launch preflight (contradictory-state falsification)', () => {
  it('LAUNCH acceptance: hierarchy ON + both Cloud gates OFF', () => {
    const v = evaluateSttLaunchPreflight(base);
    expect(v.launchAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
    expect(v.reasons).toHaveLength(0);
  });

  it('ROLLBACK acceptance: hierarchy OFF + both Cloud gates OFF (Cloud stays off, not launch)', () => {
    const v = evaluateSttLaunchPreflight({ ...base, hierarchyPrimary: false });
    expect(v.launchAcceptable).toBe(false);
    expect(v.rollbackAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('ROLLBACK also holds when the hierarchy is hard-disabled by env', () => {
    const v = evaluateSttLaunchPreflight({ ...base, hierarchyHardDisabled: true });
    expect(v.launchAcceptable).toBe(false);
    expect(v.rollbackAcceptable).toBe(true);
  });

  it('BLOCKS a client/server Cloud-gate disagreement (client ON, server OFF)', () => {
    const v = evaluateSttLaunchPreflight({ ...base, clientCloudEnabled: true });
    expect(v.launchAcceptable).toBe(false);
    expect(v.rollbackAcceptable).toBe(false);
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/disagreement/i);
  });

  it('BLOCKS the reverse disagreement (client OFF, server ON)', () => {
    const v = evaluateSttLaunchPreflight({ ...base, serverCloudEnabled: true });
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/disagreement/i);
  });

  it('BLOCKS both Cloud gates ON — internal characterization, not public launch', () => {
    const v = evaluateSttLaunchPreflight({ ...base, clientCloudEnabled: true, serverCloudEnabled: true });
    expect(v.launchAcceptable).toBe(false);
    expect(v.rollbackAcceptable).toBe(false);
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/internal characterization/i);
  });

  it('BLOCKS hierarchy ON + Cloud ON (Cloud can never ride a launch)', () => {
    const v = evaluateSttLaunchPreflight({
      ...base, hierarchyPrimary: true, clientCloudEnabled: true, serverCloudEnabled: true,
    });
    expect(v.launchAcceptable).toBe(false);
    expect(v.publicReleaseBlocked).toBe(true);
  });
});
