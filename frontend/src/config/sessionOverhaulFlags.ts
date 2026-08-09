/**
 * ============================================================================
 * #1222 — SESSION OVERHAUL (default ON in production)
 * ============================================================================
 *
 * The session-page overhaul (one page, three states, four fixed slots) is the DEFAULT session page for
 * real users — no URL param, no opt-in: you load the session page and it is there (PO 2026-08-08).
 *
 * Determinism for the test suites (so this ships without a 200-test rewrite while the legacy page remains
 * the fallback):
 *  - Production (MODE=production) => ON.
 *  - Unit + E2E builds => OFF by default, so the existing legacy-page suites stay valid. A bounded, prod-inert
 *    E2E manifest override (`ENV.e2eSessionOverhaulOverride`) turns it ON for the overhaul's own e2e.
 *  - Build env `VITE_SESSION_OVERHAUL_DISABLED=true` => HARD global kill switch overriding everything.
 *
 * Safety: never throws. SSR/no-window resolves to OFF.
 */
import { ENV } from '@/config/TestFlags';

const HARD_DISABLED: boolean = (() => {
  try {
    // Direct static access so Vite statically replaces exactly this key at build time.
    return import.meta.env.VITE_SESSION_OVERHAUL_DISABLED === 'true';
  } catch {
    return false;
  }
})();

/**
 * Is the #1222 session overhaul active right now? Production default is ON; test builds default OFF unless
 * the E2E manifest opts in. The HARD kill switch always wins.
 */
export function isSessionOverhaulEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (HARD_DISABLED) return false;
  // Deterministic E2E override (prod-inert) wins so the overhaul's own e2e can drive the new page while
  // legacy-page e2e (which leave it unset) keep the default-OFF test behavior.
  const e2e = ENV.e2eSessionOverhaulOverride;
  if (e2e !== undefined) return e2e;
  // Keep the legacy page under test (unit + e2e) so its suites remain valid; ship ON everywhere else.
  if (ENV.isTest) return false;
  return true;
}
