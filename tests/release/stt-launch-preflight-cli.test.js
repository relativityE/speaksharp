import { describe, it, expect } from 'vitest';
import { evaluatePreflight } from '../../scripts/stt-launch-preflight.mjs';

// #1120 S1 (PR #1155) — the EXECUTABLE launch preflight release gate. CLI companion to the app-side pure
// acceptance function `evaluateSttLaunchPreflight` (frontend/src/config/sttLaunchPreflight.ts). The hierarchy is
// a PostHog RUNTIME flag not readable from the release env, so the CLI NEVER synthesizes a launch verdict from
// the environment: a launch/rollback verdict requires an EXPLICIT operator-verified hierarchy value; with none
// supplied only the Cloud invariant is checked. Falsification: no synthesized launch; mismatch/Cloud-ON fail.
describe('#1120 S1 — executable STT launch preflight release gate', () => {
  it('NO hierarchy supplied + Cloud OFF → Cloud-only OK, and does NOT synthesize a launch verdict', () => {
    const v = evaluatePreflight({});
    expect(v.cloudOnlyAcceptable).toBe(true);
    expect(v.launchAcceptable).toBe(false); // never invented from an empty env
    expect(v.hierarchyState).toBe('UNVERIFIED');
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('LAUNCH: explicit verified hierarchy ON + both Cloud gates OFF passes', () => {
    const v = evaluatePreflight({}, { hierarchyPrimary: true });
    expect(v.launchAcceptable).toBe(true);
    expect(v.hierarchyState).toBe('ON');
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('ROLLBACK: explicit verified hierarchy OFF + both Cloud gates OFF passes', () => {
    const v = evaluatePreflight({}, { hierarchyPrimary: false });
    expect(v.rollbackAcceptable).toBe(true);
    expect(v.hierarchyState).toBe('OFF');
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('CONTRADICTION: asserting hierarchy ON while hard-disabled is blocked', () => {
    const v = evaluatePreflight({ VITE_STT_PRIVATE_PRIMARY_DISABLED: 'true' }, { hierarchyPrimary: true });
    expect(v.launchAcceptable).toBe(false);
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/contradictory/i);
  });

  it('hard-disabled + explicit rollback + Cloud OFF is an acceptable rollback posture', () => {
    const v = evaluatePreflight({ VITE_STT_PRIVATE_PRIMARY_DISABLED: 'true' }, { hierarchyPrimary: false });
    expect(v.rollbackAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('BLOCKS a client/Edge Cloud gate disagreement (client ON, Edge OFF) even with no hierarchy', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'true' });
    expect(v.cloudOnlyAcceptable).toBe(false);
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/disagreement/i);
  });

  it('BLOCKS the reverse disagreement (Edge ON, client OFF)', () => {
    const v = evaluatePreflight({ CLOUD_STT_ENABLED: 'true' });
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/disagreement/i);
  });

  it('BLOCKS both Cloud gates ON — internal characterization, not public launch', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'true', CLOUD_STT_ENABLED: 'true' }, { hierarchyPrimary: true });
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/internal characterization/i);
  });

  it('hierarchy rollback NEVER makes Cloud valid — rollback + both Cloud ON is still blocked', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'true', CLOUD_STT_ENABLED: 'true' }, { hierarchyPrimary: false });
    expect(v.publicReleaseBlocked).toBe(true);
  });

  it('only exact "true" enables a gate — a non-"true" value stays OFF (fail-closed; Cloud-only OK)', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'TRUE', CLOUD_STT_ENABLED: '1' });
    expect(v.cloudOnlyAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });
});
