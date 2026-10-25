import { describe, it, expect } from 'vitest';
import { canonicalProgressPath, deriveSessionIdFromPath, isUuid } from '../sessionRoute';

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

describe('canonicalProgressPath (#1548 legacy alias)', () => {
  it('rewrites the /analytics first segment to /progress, keeping the rest of the path', () => {
    expect(canonicalProgressPath('/analytics')).toBe('/progress');
    expect(canonicalProgressPath('/analytics/')).toBe('/progress/');
    expect(canonicalProgressPath(`/analytics/${UUID}`)).toBe(`/progress/${UUID}`);
  });

  it('matches the case-insensitive legacy routes, so a mixed-case alias can never re-target itself', () => {
    expect(canonicalProgressPath('/Analytics')).toBe('/progress');
    expect(canonicalProgressPath(`/ANALYTICS/${UUID}`)).toBe(`/progress/${UUID}`);
    expect(canonicalProgressPath('/aNaLyTiCs/session-1')).toBe('/progress/session-1');
  });

  it('leaves non-alias paths untouched', () => {
    expect(canonicalProgressPath('/progress')).toBe('/progress');
    expect(canonicalProgressPath('/analytics-archive')).toBe('/analytics-archive');
    expect(canonicalProgressPath('/session/analytics')).toBe('/session/analytics');
  });

  // Sam RETURN 1792964160.252279: the router matches the DECODED segment, so an encoded alias must leave the alias too.
  it('rewrites a percent-encoded alias segment (which the router matches decoded), keeping the rest of the raw path', () => {
    expect(canonicalProgressPath('/%61nalytics')).toBe('/progress');
    expect(canonicalProgressPath(`/%61nalytics/${UUID}`)).toBe(`/progress/${UUID}`);
    expect(canonicalProgressPath('/%41NALYTIC%53/session-1')).toBe('/progress/session-1');
    expect(canonicalProgressPath('/%61nalytics/a%20b/c')).toBe('/progress/a%20b/c');
  });

  it('CONTROL an encoded slash, a malformed escape or an encoded non-alias is not the alias', () => {
    expect(canonicalProgressPath('/analytics%2Fx')).toBe('/analytics%2Fx');
    expect(canonicalProgressPath('/%E0%A4%A/x')).toBe('/%E0%A4%A/x');
    expect(canonicalProgressPath('/%61nalytics-archive')).toBe('/%61nalytics-archive');
    expect(canonicalProgressPath('/session/%61nalytics')).toBe('/session/%61nalytics');
  });
});

describe('deriveSessionIdFromPath', () => {
  it('returns the session id for the canonical /progress/:sessionId route (#1548)', () => {
    expect(deriveSessionIdFromPath(`/progress/${UUID}`)).toBe(UUID);
    expect(deriveSessionIdFromPath(`/progress/${UUID}/`)).toBe(UUID);
    expect(deriveSessionIdFromPath(`/progress/${UUID}?from=history#top`)).toBe(UUID);
    expect(deriveSessionIdFromPath('/progress')).toBeNull();
    expect(deriveSessionIdFromPath('/progress/not-a-uuid')).toBeNull();
    expect(deriveSessionIdFromPath(`/progress/${UUID}/extra`)).toBeNull();
    expect(deriveSessionIdFromPath(`/progress-archive/${UUID}`)).toBeNull();
  });

  it('returns the session id for a valid legacy /analytics/:sessionId route', () => {
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
