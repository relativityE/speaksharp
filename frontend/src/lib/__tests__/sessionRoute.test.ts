import { describe, it, expect } from 'vitest';
import { deriveSessionIdFromPath, isUuid } from '../sessionRoute';

const UUID = '130bbc6c-5d89-465d-91e6-51f5a5951e34';

describe('isUuid', () => {
  it('accepts valid UUIDs and rejects everything else', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('123')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});

describe('deriveSessionIdFromPath', () => {
  it('returns the session id for a valid /analytics/:sessionId route', () => {
    expect(deriveSessionIdFromPath(`/analytics/${UUID}`)).toBe(UUID);
    expect(deriveSessionIdFromPath(`/analytics/${UUID}/`)).toBe(UUID); // trailing slash
    expect(deriveSessionIdFromPath(`/analytics/${UUID}?from=history`)).toBe(UUID); // query stripped
    expect(deriveSessionIdFromPath(`/analytics/${UUID}#top`)).toBe(UUID); // hash stripped
  });

  it('returns null for the non-session Analytics route and other routes (no fabrication)', () => {
    expect(deriveSessionIdFromPath('/analytics')).toBeNull();
    expect(deriveSessionIdFromPath('/analytics/')).toBeNull();
    expect(deriveSessionIdFromPath('/session')).toBeNull();
    expect(deriveSessionIdFromPath('/')).toBeNull();
    expect(deriveSessionIdFromPath('/pricing')).toBeNull();
  });

  it('NEVER fabricates a session id from a malformed/non-UUID segment', () => {
    expect(deriveSessionIdFromPath('/analytics/not-a-uuid')).toBeNull();
    expect(deriveSessionIdFromPath('/analytics/12345')).toBeNull();
    expect(deriveSessionIdFromPath(`/analytics/${UUID}/extra`)).toBeNull(); // deeper path, not the id route
    expect(deriveSessionIdFromPath('/analytics/%E0%A4%A')).toBeNull(); // malformed percent-encoding
    expect(deriveSessionIdFromPath('/ANALYTICS/' + UUID)).toBeNull(); // case-sensitive route prefix
  });

  it('is deterministic and null-safe on non-string input', () => {
    expect(deriveSessionIdFromPath(null)).toBeNull();
    expect(deriveSessionIdFromPath(undefined)).toBeNull();
    expect(deriveSessionIdFromPath(42 as never)).toBeNull();
  });
});
