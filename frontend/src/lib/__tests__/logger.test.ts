import { describe, expect, it } from 'vitest';
import { resolveLoggerLevel } from '../logger';

describe('resolveLoggerLevel', () => {
  it('keeps development logs visible for local debugging', () => {
    expect(resolveLoggerLevel({ mode: 'development' })).toBe('info');
  });

  it('keeps production, test, and unknown browser modes quiet by default', () => {
    expect(resolveLoggerLevel({ mode: 'production' })).toBe('warn');
    expect(resolveLoggerLevel({ mode: 'test' })).toBe('warn');
    expect(resolveLoggerLevel({ mode: undefined })).toBe('warn');
  });

  it('allows explicit safe log-level overrides', () => {
    expect(resolveLoggerLevel({ mode: 'production', explicitLevel: 'debug' })).toBe('debug');
    expect(resolveLoggerLevel({ mode: 'production', explicitLevel: 'silent' })).toBe('silent');
  });

  it('ignores invalid explicit log levels', () => {
    expect(resolveLoggerLevel({ mode: 'production', explicitLevel: 'verbose' })).toBe('warn');
  });
});
