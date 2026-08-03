import { describe, it, expect } from 'vitest';
import { evaluatePreflight } from '../../scripts/stt-launch-preflight.mjs';

// #1120 S1 (PR #1155) — the EXECUTABLE launch preflight release gate. Canonical mirror of the app-side
// `evaluateSttLaunchPreflight` (frontend/src/config/sttLaunchPreflight.ts). Falsification per the contract:
// launch passes; hierarchy rollback with Cloud OFF passes; client/Edge mismatch fails; either/both Cloud ON fails.
describe('#1120 S1 — executable STT launch preflight release gate', () => {
  it('LAUNCH: hierarchy ON (default) + both Cloud gates OFF passes', () => {
    const v = evaluatePreflight({});
    expect(v.launchAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('ROLLBACK: hierarchy OFF + both Cloud gates OFF passes', () => {
    const v = evaluatePreflight({}, { rollback: true });
    expect(v.rollbackAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('hierarchy hard-disabled + Cloud OFF is an acceptable rollback posture (rollback never needs Cloud)', () => {
    const v = evaluatePreflight({ VITE_STT_PRIVATE_PRIMARY_DISABLED: 'true' });
    expect(v.rollbackAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });

  it('BLOCKS a client/Edge Cloud gate disagreement (client ON, Edge OFF)', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'true' });
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/disagreement/i);
  });

  it('BLOCKS the reverse disagreement (Edge ON, client OFF)', () => {
    const v = evaluatePreflight({ CLOUD_STT_ENABLED: 'true' });
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/disagreement/i);
  });

  it('BLOCKS both Cloud gates ON — internal characterization, not public launch', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'true', CLOUD_STT_ENABLED: 'true' });
    expect(v.publicReleaseBlocked).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/internal characterization/i);
  });

  it('hierarchy rollback NEVER makes Cloud valid — rollback + both Cloud ON is still blocked', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'true', CLOUD_STT_ENABLED: 'true' }, { rollback: true });
    expect(v.publicReleaseBlocked).toBe(true);
  });

  it('only exact "true" enables a gate — a non-"true" value stays OFF (fail-closed; launch passes)', () => {
    const v = evaluatePreflight({ VITE_CLOUD_STT_ENABLED: 'TRUE', CLOUD_STT_ENABLED: '1' });
    expect(v.launchAcceptable).toBe(true);
    expect(v.publicReleaseBlocked).toBe(false);
  });
});
