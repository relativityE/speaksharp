import { vi } from 'vitest';

/**
 * P0.1 test helper. The global test env defaults to FAIL-CLOSED (payments disabled) so the broad suite
 * catches any Upgrade control that forgets to check arePaymentsEnabled(). A test that specifically
 * exercises the payments-ENABLED paid-enrollment state opts in LOCALLY by calling this — which stubs
 * BOTH required signals (the explicit flag AND a live-class key). The global afterEach in
 * frontend/tests/setup.ts resets both flags after every test, so an opt-in never leaks.
 */
export const LIVE_KEY_FIXTURE = 'pk_live_FAKE_FOR_TESTS_0000000000000000';

export function enablePaymentsForTest(): void {
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', LIVE_KEY_FIXTURE);
  vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true');
}
