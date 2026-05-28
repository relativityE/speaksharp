import { describe, expect, it } from 'vitest';
import { shouldSkipMSW } from '../e2e-bridge';

describe('shouldSkipMSW', () => {
  it('skips MSW when Playwright route mocks own the network layer', () => {
    expect(shouldSkipMSW({ isPlaywright: true })).toBe(true);
  });

  it('skips MSW for explicit live backend/test flags', () => {
    expect(shouldSkipMSW({ isPlaywright: false, skipMSWEnv: 'true' })).toBe(true);
    expect(shouldSkipMSW({ isPlaywright: false, useLiveDBEnv: 'true' })).toBe(true);
  });

  it('allows MSW for manual mocked preview when no live/test skip flag is set', () => {
    expect(shouldSkipMSW({
      isPlaywright: false,
      skipMSWEnv: 'false',
      useLiveDBEnv: 'false',
    })).toBe(false);
  });
});
