import { describe, it, expect } from 'vitest';
import {
  isExpectedAuthLanding,
  DEFAULT_AUTH_LANDING,
  SESSION_LANDING,
  ANALYTICS_INDEX_LANDING,
  ANALYTICS_SESSION_LANDING,
} from '../canaryLanding';

describe('canary authenticated-landing contract (default = /practice, deep-links explicit)', () => {
  it('default is exactly /practice', () => {
    expect(DEFAULT_AUTH_LANDING).toBe('/practice');
  });

  describe('ordinary login (default expectation)', () => {
    it('login → /practice PASSES', () => {
      expect(isExpectedAuthLanding('/practice')).toBe(true);
    });
    it('login → /session FAILS (must not silently accept a session regression)', () => {
      expect(isExpectedAuthLanding('/session')).toBe(false);
    });
    it('login → /analytics FAILS', () => {
      expect(isExpectedAuthLanding('/analytics')).toBe(false);
    });
    it('login → /analytics/:id FAILS', () => {
      expect(isExpectedAuthLanding('/analytics/7e7aca2c-c192-4a80-8976-df5637859164')).toBe(false);
    });
    it('a look-alike prefix like /practiced FAILS (exact match, not startsWith)', () => {
      expect(isExpectedAuthLanding('/practiced')).toBe(false);
    });
  });

  describe('explicit /session deep-link caller', () => {
    it('accepts /session ONLY when that caller requests /session', () => {
      expect(isExpectedAuthLanding('/session', SESSION_LANDING)).toBe(true);
      // The same landing is NOT accepted by the default (ordinary-login) contract.
      expect(isExpectedAuthLanding('/session', DEFAULT_AUTH_LANDING)).toBe(false);
    });
    it('a /session caller still rejects a /practice or /analytics landing', () => {
      expect(isExpectedAuthLanding('/practice', SESSION_LANDING)).toBe(false);
      expect(isExpectedAuthLanding('/analytics', SESSION_LANDING)).toBe(false);
    });
  });

  describe('explicit analytics deep-link caller', () => {
    it('accepts /analytics index ONLY when requested', () => {
      expect(isExpectedAuthLanding('/analytics', ANALYTICS_INDEX_LANDING)).toBe(true);
      expect(isExpectedAuthLanding('/analytics', DEFAULT_AUTH_LANDING)).toBe(false);
    });
    it('accepts an /analytics/:sessionId detail ONLY when the analytics-session pattern is requested', () => {
      expect(isExpectedAuthLanding('/analytics/7e7aca2c-c192-4a80-8976-df5637859164', ANALYTICS_SESSION_LANDING)).toBe(true);
      // Ordinary login must NOT accept an analytics detail landing.
      expect(isExpectedAuthLanding('/analytics/7e7aca2c-c192-4a80-8976-df5637859164', DEFAULT_AUTH_LANDING)).toBe(false);
      // The analytics-session pattern must NOT accept the bare index or /practice.
      expect(isExpectedAuthLanding('/analytics', ANALYTICS_SESSION_LANDING)).toBe(false);
      expect(isExpectedAuthLanding('/practice', ANALYTICS_SESSION_LANDING)).toBe(false);
    });
  });
});
