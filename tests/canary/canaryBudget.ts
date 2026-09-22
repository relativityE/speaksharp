/**
 * THE CANARY'S CLOCK: ENFORCED PHASE CEILINGS, AND A TOTAL DERIVED FROM THEM.
 *
 * #1518 P1 (Codex, exact head `fa322aa33`) then PM RETURN on `3492c5b9e`. Two rounds, and the second
 * one matters more than the first.
 *
 * ROUND 1 found that the cold wait could not elapse: `startTake` allows `COLD_START_RPC_TIMEOUT_MS` for
 * the authoritative RPC, `playwright.canary.config.ts` killed the test at 60s, and the spec raised that
 * ceiling only when the deploy-race gate was armed.
 *
 * ROUND 2 found that my fix's arithmetic was still a guess. I had ENUMERATED what I believed each phase
 * cost — 75s for navigation, 30s for the recording assertions — and PM showed the enumeration was simply
 * wrong: `navigateToRoute` alone contains `page.goto`, a 45s app-visible barrier (itself three separate
 * 45s waits), `waitForURL`, and `waitForRouteControls`' own 30s route-shell and control waits; the
 * pre-start path has a second visibility assertion on the config default; recording validation has FOUR
 * assertions, not three; and stop/save omitted the stop-control wait plus a `page.reload()` and a
 * `waitForResponse` on the default timeout.
 *
 * THE LESSON IS NOT "COUNT HARDER." A sum of estimated internal waits is unverifiable by construction —
 * every helper the canary calls can add a wait without telling the spec, which is exactly how the
 * enumeration went stale between two commits on the same day. So the phases are now BOUNDED rather than
 * estimated: each runs inside `withPhaseDeadline`, which fails with a named, distinct phase error the
 * moment its ceiling passes. The total is then the sum of ceilings that are actually enforced, so the
 * claim "the test timeout covers the path" is true by construction instead of by inventory.
 *
 * Every value is a CEILING on a phase, not a duration the canary spends. A healthy warm run still
 * finishes in well under a minute; a healthy cold run in two or three.
 */
import { COLD_START_TOTAL_BUDGET_MS } from './canaryStartTake';

/** The phases, in the order the canary performs them. */
export const PHASE_BUDGETS_MS = Object.freeze({
    /**
     * The #1106 deploy-race poll. STRICT, including navigation: every `page.goto` inside it is given only
     * the time remaining, so a navigation started near the ceiling cannot overrun it and eat the product
     * allowance (PM RETURN finding 1). Enforced INSIDE the poll, never by `withPhaseDeadline` — racing
     * it against a same-budget timer swallowed the DEPLOYMENT NOT LIVE verdict (Codex, `90a1eceb8`).
     */
    deploy_gate: 4 * 60_000,
    /** `canaryLogin`: the app-visible barrier plus the post-login redirect poll. */
    login: 90_000,
    /** `navigateToRoute(/session)`: goto, the app-visible barrier, `waitForURL`, the route-shell and control waits. */
    navigate_session: 150_000,
    /** Usage-limit poll, tier badge, and the control-visibility assertions before the press. */
    pre_start_checks: 60_000,
    /** `startTake`: both control waits plus the cold authoritative RPC. Unchanged at 150s + 2×15s. */
    start_take: COLD_START_TOTAL_BUDGET_MS,
    /** Runtime RECORDING, during-state shell, policy body and the live header — four assertions. */
    recording_checks: 60_000,
    /** The deliberate in-recording dwell, so the take has real audio to finalize. */
    recording_dwell: 15_000,
    /** Stop control, the end-state race, and the analytics reload plus sessions-response validation. */
    stop_and_settle: 120_000,
} as const);

export type CanaryPhase = keyof typeof PHASE_BUDGETS_MS;

/**
 * Time for the deploy poll to emit its verdict AFTER its deadline: attach `deployed-release` and throw
 * DEPLOYMENT NOT LIVE. Without it the outer test timeout and the poll deadline coincide exactly, and the
 * test can be killed mid-verdict — losing the evidence the gate exists to produce.
 */
export const DEPLOY_VERDICT_SLACK_MS = 15_000;

/**
 * Work BETWEEN phases: evidence attachments, response classification and logging. None of it waits on
 * the page, but it is not free, and a total that is exactly the sum of phase ceilings leaves it no room
 * (Codex, `90a1eceb8`). `tests/unit/canaryStartTake.test.ts` pins that nothing between phases may await
 * anything except an attachment, so this headroom cannot quietly become a place to hide a page wait.
 */
export const INTER_PHASE_HEADROOM_MS = 30_000;

/** Every phase except the deployment poll — i.e. the product flow proper. */
export const PRODUCT_PHASES: readonly CanaryPhase[] = Object.freeze(
    (Object.keys(PHASE_BUDGETS_MS) as CanaryPhase[]).filter((p) => p !== 'deploy_gate'),
);

export const DEPLOY_WAIT_MS = PHASE_BUDGETS_MS.deploy_gate;
/** How often the deploy poll re-reads `window.__APP_RELEASE__`. */
export const DEPLOY_POLL_MS = 15_000;

/**
 * The complete product path as a sum of ENFORCED ceilings. Because each phase fails at its own ceiling,
 * this is a real bound on the product flow rather than an inventory of internal waits.
 */
export const PRODUCT_SMOKE_BUDGET_MS =
    PRODUCT_PHASES.reduce((total, phase) => total + PHASE_BUDGETS_MS[phase], 0) + INTER_PHASE_HEADROOM_MS;

/**
 * The per-test ceiling the spec installs, UNCONDITIONALLY.
 *
 * The product allowance applies in both modes — that is the round-1 fix. The deployment allowance is
 * ADDED only when the poll will actually run, and because that phase is strictly bounded it cannot spend
 * the product allowance when a publish is slow.
 */
export function canaryTestTimeoutMs(deployGateArmed: boolean): number {
    return (deployGateArmed ? PHASE_BUDGETS_MS.deploy_gate + DEPLOY_VERDICT_SLACK_MS : 0) + PRODUCT_SMOKE_BUDGET_MS;
}

/**
 * THE JOB CEILING MUST FIT EVERY PERMITTED ATTEMPT, NOT ONE.
 *
 * Codex P1 on `3492c5b`: `playwright.canary.config.ts` had `retries: 1`, so a late first-attempt failure
 * was followed by a whole second attempt that a one-attempt job ceiling would kill before it could pass
 * or report. PM's decision (2026-09-22) is FAIL FAST: `retries: 0`, a failure stays red, and a rerun is
 * separate operator evidence. The requirement below is still computed from the configured retry count,
 * so reintroducing a retry cannot silently outgrow the job ceiling.
 */
/** Checkout, dependency install, browser install and account provisioning before the first attempt. */
export const JOB_SETUP_ALLOWANCE_MS = 4 * 60_000;
/** After the last attempt: the always-run account-ceiling check, artifact upload, cleanup, diagnostics. */
export const JOB_FINALIZATION_ALLOWANCE_MS = 5 * 60_000;

/** The least `canary-check` job ceiling that lets every permitted attempt finish and report. */
export function requiredCanaryJobCeilingMs(retries: number): number {
    return JOB_SETUP_ALLOWANCE_MS
        + (retries + 1) * canaryTestTimeoutMs(true)
        + JOB_FINALIZATION_ALLOWANCE_MS;
}

/** Thrown when a phase passes its ceiling, so the report names the phase instead of timing out generically. */
export class CanaryPhaseTimeout extends Error {
    constructor(public readonly phase: CanaryPhase, public readonly budgetMs: number) {
        super(`CANARY_PHASE_TIMEOUT:${phase} exceeded its ${budgetMs}ms ceiling — see tests/canary/canaryBudget.ts`);
        this.name = 'CanaryPhaseTimeout';
    }
}

/**
 * Run one phase under its enforced ceiling.
 *
 * The deadline bounds the phase's contribution to the VERDICT: when it expires the phase fails with a
 * named error rather than letting the work run on until Playwright kills the whole test with a generic
 * timeout. (The underlying awaited work is not itself cancellable from here — nothing in Playwright's API
 * makes it so — which is why the failure is named and the ceiling is asserted against the outer test and
 * job ceilings in `tests/unit/canaryStartTake.test.ts`.)
 *
 * `remainingMs()` lets a phase hand its own remaining time to a call that takes a timeout, which is how
 * the deploy poll bounds `page.goto` instead of letting a late navigation overrun the phase.
 */
export async function withPhaseDeadline<T>(
    phase: CanaryPhase,
    run: (deadline: { remainingMs: () => number }) => Promise<T>,
): Promise<T> {
    const budgetMs = PHASE_BUDGETS_MS[phase];
    const startedAt = Date.now();
    const remainingMs = () => Math.max(1, budgetMs - (Date.now() - startedAt));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            run({ remainingMs }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new CanaryPhaseTimeout(phase, budgetMs)), budgetMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * The `timeout-minutes` of ONE named job, in ms.
 *
 * PM RETURN finding 3: the previous assertion took the MAXIMUM `timeout-minutes` anywhere in the
 * workflow, so an unrelated job with a larger ceiling would let `canary-check` regress to 15 minutes
 * while the test stayed green. This reads the block belonging to the named job and nothing else.
 *
 * Deliberately a line scanner rather than a YAML parse: the test tree has no YAML dependency, and the
 * property under test is a single scalar inside one top-level `jobs:` entry.
 */
export function parseJobTimeoutMs(workflowYaml: string, jobName: string): number | null {
    const lines = workflowYaml.split('\n');
    const jobHeader = new RegExp(`^  ${jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`);
    let inJob = false;
    for (const line of lines) {
        if (jobHeader.test(line)) { inJob = true; continue; }
        // Any other two-space key ends this job's block (the next job, or a later top-level section).
        if (inJob && /^ {2}\S/.test(line)) break;
        if (inJob) {
            const m = /^\s{4}timeout-minutes:\s*(\d+)\s*$/.exec(line);
            if (m) return Number(m[1]) * 60_000;
        }
    }
    return null;
}
