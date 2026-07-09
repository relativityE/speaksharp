/* @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDevEnvironmentStatus, DEV_PORTS } from '../devEnvironmentGuard';

// getDevEnvironmentStatus reads import.meta.env + window.location.port. In vitest MODE==='test',
// so isTestMode is true and the expected port is DEV_PORTS.TEST (5173).
const setPort = (port: string) =>
  Object.defineProperty(window, 'location', { configurable: true, value: { port } as Location });

describe('devEnvironmentGuard — getDevEnvironmentStatus', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', { configurable: true, value: window.location });
  });

  it('is VALID when the unsafe-config override is set (bypasses all checks)', () => {
    vi.stubEnv('ALLOW_UNSAFE_MIXED_SUPABASE_CONFIG', 'true');
    setPort('9999'); // wrong port, but override wins
    const s = getDevEnvironmentStatus();
    expect(s.valid).toBe(true);
    expect(s.expectedPort).toBe(DEV_PORTS.TEST);
  });

  it('is INVALID with a clear message on a port mismatch', () => {
    setPort('9999');
    const s = getDevEnvironmentStatus();
    expect(s.valid).toBe(false);
    expect(s.currentPort).toBe(9999);
    expect(s.message).toMatch(/must run on port 5173/);
  });

  it('is INVALID when test mode points at a real Supabase without explicit mock/live-db opt-in', () => {
    setPort(String(DEV_PORTS.TEST)); // port OK so we reach the supabase check
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdef.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'a-real-looking-anon-key-123');
    vi.stubEnv('VITE_AUTH_MODE', 'real');
    const s = getDevEnvironmentStatus();
    expect(s.valid).toBe(false);
    expect(s.message).toMatch(/real Supabase project/i);
    expect(s.authMode).toBe('real');
  });

  it('is VALID in test mode against real Supabase when live-db evidence mode is explicitly enabled', () => {
    setPort(String(DEV_PORTS.TEST));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdef.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'a-real-looking-anon-key-123');
    vi.stubEnv('VITE_AUTH_MODE', 'real');
    vi.stubEnv('VITE_USE_LIVE_DB', 'true');
    const s = getDevEnvironmentStatus();
    expect(s.valid).toBe(true);
  });

  it('resolves authMode from VITE_USE_MOCK_AUTH when VITE_AUTH_MODE is unset', () => {
    setPort(String(DEV_PORTS.TEST));
    vi.stubEnv('VITE_AUTH_MODE', '');
    vi.stubEnv('VITE_USE_MOCK_AUTH', 'true');
    vi.stubEnv('VITE_USE_LIVE_DB', 'true'); // avoid the real-supabase invalid branch
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdef.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'a-real-looking-anon-key-123');
    const s = getDevEnvironmentStatus();
    expect(s.authMode).toBe('mock');
  });
});
