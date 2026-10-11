import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetCoachingDiagnosticLinksForTests,
  coachingDiagnosticForSession,
  createCoachingDiagnosticId,
  rememberCoachingDiagnostic,
} from '../coachingDiagnosticLink';

const SESSION_A = '8d934b65-8b14-4b4a-9e18-bcfe9cbf7361';
const SESSION_B = '8d934b65-8b14-4b4a-9e18-bcfe9cbf7362';
const REQUEST_A = '9d934b65-8b14-4b4a-9e18-bcfe9cbf7361';
const REQUEST_B = '9d934b65-8b14-4b4a-9e18-bcfe9cbf7362';

describe('coaching diagnostic session link', () => {
  afterEach(() => __resetCoachingDiagnosticLinksForTests());

  it('creates only a cryptographic UUID token', () => {
    const id = createCoachingDiagnosticId();
    expect(id === null || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)).toBe(true);
  });

  it('returns the diagnostic only for its exact saved session', () => {
    expect(rememberCoachingDiagnostic(SESSION_A, REQUEST_A, 1000)).toBe(true);
    expect(coachingDiagnosticForSession(SESSION_A, 1001)).toBe(REQUEST_A);
    expect(coachingDiagnosticForSession(SESSION_B, 1001)).toBeNull();
    expect(coachingDiagnosticForSession(null, 1001)).toBeNull();
  });

  it('replaces only the same session and never borrows another session current request', () => {
    rememberCoachingDiagnostic(SESSION_A, REQUEST_A, 1000);
    rememberCoachingDiagnostic(SESSION_B, REQUEST_B, 1001);
    expect(coachingDiagnosticForSession(SESSION_A, 1002)).toBe(REQUEST_A);
    expect(coachingDiagnosticForSession(SESSION_B, 1002)).toBe(REQUEST_B);
    rememberCoachingDiagnostic(SESSION_A, REQUEST_B, 1003);
    expect(coachingDiagnosticForSession(SESSION_A, 1004)).toBe(REQUEST_B);
  });

  it('rejects malformed identities and expires old links', () => {
    expect(rememberCoachingDiagnostic('not-a-session', REQUEST_A, 1000)).toBe(false);
    expect(rememberCoachingDiagnostic(SESSION_A, 'not-a-request', 1000)).toBe(false);
    rememberCoachingDiagnostic(SESSION_A, REQUEST_A, 1000);
    expect(coachingDiagnosticForSession(SESSION_A, 1000 + 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });
});
