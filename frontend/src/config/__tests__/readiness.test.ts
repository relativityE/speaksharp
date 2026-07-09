import { describe, it, expect } from 'vitest';
import { CORE_READINESS_SIGNALS } from '../readiness';
import { READINESS_REQUIRED_GLOBAL } from '@/e2e/signalContract';

describe('config/readiness (deprecated compat export)', () => {
  it('forwards CORE_READINESS_SIGNALS to the canonical READINESS_REQUIRED_GLOBAL (no second source of truth)', () => {
    expect(CORE_READINESS_SIGNALS).toBe(READINESS_REQUIRED_GLOBAL);
    expect(Array.isArray(CORE_READINESS_SIGNALS)).toBe(true);
    expect(CORE_READINESS_SIGNALS.length).toBeGreaterThan(0);
  });
});
