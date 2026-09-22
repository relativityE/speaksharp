/**
 * THE CANARY'S CLOCK, AS CODE RATHER THAN AS TWO NUMBERS IN TWO FILES.
 *
 * #1518 P1 (Codex, exact head `fa322aa33`; PM RETURN). `canaryStartTake` waits up to
 * `COLD_START_RPC_TIMEOUT_MS` for the authoritative session RPC on a cold account, while
 * `playwright.canary.config.ts` kills the test at 60s and the spec raised that ceiling ONLY when the
 * deploy-race gate was armed. Two consequences, both of which turn a healthy cold account into a
 * generic Playwright timeout — indistinguishable from the product regression this canary exists to find:
 *
 *   UNGATED (no `EXPECTED_RELEASE_SHA` — every local, staging and non-prod run): the ceiling stayed at
 *   60s, so the 150s wait could never elapse at all.
 *
 *   GATED: a near-maximum four-minute deployment poll left only a flat two-minute "product" share, which
 *   was already shorter than the cold wait before login, navigation or the stop/save assertions were paid
 *   for.
 *
 * The lesson is not "raise a number". It is that a budget nobody can compute is a budget that drifts: the
 * cold wait lived in the helper, the ceiling in the spec, the job ceiling in the workflow, and nothing
 * related them. So the whole sequential path is enumerated here, the total is DERIVED, and
 * `tests/unit/canaryStartTake.test.ts` asserts the outer budgets exceed it in BOTH modes. Change any one
 * wait and the arithmetic follows; break the relationship and the unit gate fails in milliseconds instead
 * of a paid Production run failing in fifteen minutes.
 *
 * Every value below is a CEILING on a wait, not a duration the canary spends. A healthy warm run still
 * finishes in well under a minute.
 */
import { COLD_START_TOTAL_BUDGET_MS } from './canaryStartTake';

/** Vercel post-merge publish budget: how long the deploy-race gate may wait for the expected SHA. */
export const DEPLOY_WAIT_MS = 4 * 60_000;
/** How often that poll re-reads `window.__APP_RELEASE__`. */
export const DEPLOY_POLL_MS = 15_000;

// --- the product flow, in the order the canary performs it -------------------------------------------
/**
 * `canaryLogin`: the app-visible barrier (45s in `waitForAppVisibleReady`) plus the post-login redirect
 * poll (30s), which are sequential.
 */
export const LOGIN_FLOW_BUDGET_MS = 75_000;
/** `navigateToRoute(/session)`: the same app-visible barrier plus `waitForRouteControls` (30s). */
export const NAVIGATION_BUDGET_MS = 75_000;
/** Before the press: either control visible (15s), the usage-limit poll (15s), the tier badge (15s). */
export const PRE_START_CHECK_BUDGET_MS = 45_000;
/** After the press: runtime RECORDING, the during-state surface, and the exact engine authority (10s each). */
export const RECORDING_CHECK_BUDGET_MS = 30_000;
/** The deliberate in-recording dwell, so the take has real audio to finalize. */
export const RECORDING_DWELL_MS = 5_000;
/** Stop and settle: the analytics URL (15s) and the terminal dialog / empty state (10s). */
export const STOP_SAVE_BUDGET_MS = 25_000;

/**
 * The complete COLD product path, deployment poll excluded. This is the number the old flat two-minute
 * share was supposed to be and was not — `COLD_START_TOTAL_BUDGET_MS` alone exceeds it.
 */
export const PRODUCT_SMOKE_BUDGET_MS =
    LOGIN_FLOW_BUDGET_MS
    + NAVIGATION_BUDGET_MS
    + PRE_START_CHECK_BUDGET_MS
    + COLD_START_TOTAL_BUDGET_MS
    + RECORDING_CHECK_BUDGET_MS
    + RECORDING_DWELL_MS
    + STOP_SAVE_BUDGET_MS;

/**
 * The per-test ceiling the spec installs, UNCONDITIONALLY.
 *
 * The product allowance applies in both modes — that is the fix. The deployment allowance is ADDED only
 * when the gate will actually poll, so an ungated run is not given time to wait for a deployment nobody
 * is waiting for, and a gated run cannot have its product allowance eaten by a slow publish.
 */
export function canaryTestTimeoutMs(deployGateArmed: boolean): number {
    return (deployGateArmed ? DEPLOY_WAIT_MS : 0) + PRODUCT_SMOKE_BUDGET_MS;
}
