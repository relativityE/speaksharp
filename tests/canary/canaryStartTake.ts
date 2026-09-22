/**
 * #1184: Private is the ONLY engine — there is no selector and no Native/Cloud choice.
 *
 * Start the take with its ONE control, arming the authoritative start BEFORE the click. A warm browser
 * shows `mic-start`. A cold one shows `mic-download`, and since #1415/#1416 that single activation
 * downloads the model AND records — it is not a download-only step. The retired `ensurePrivateReady`
 * clicked `mic-download` to "ready" the recorder and then waited for an idle, enabled `mic-start` that its
 * own click had already consumed: Production was recording while the canary waited for a Start it could
 * never see (run 35646081865, `594e95ac`). Either path is exactly one click, so the
 * `create_session_and_update_usage` response is armed first and captured on both, and exactly one
 * session is written. The cold budget covers the one-time model download that precedes the start.
 *
 * The path taken is returned and attached, so a warm run can never again pass while silently skipping
 * the first-run journey every new account takes.
 */

/**
 * ---- Not part of the reviewed comment above. Why this lives in a module, and why the assertions are
 * injected (the only behavioural difference from the reviewed patch, two call sites).
 *
 * Playwright's `expect` matchers require a real `Locator`, and a module importing `@playwright/test`
 * cannot be pulled into the unit lane — which is why the sibling `canaryRuntimeContract.ts` imports
 * nothing either. Passing the two assertions in keeps this file importable by a vitest test, so the cold
 * path is covered in milliseconds instead of only by a paid Production run: four attempts across two
 * paid runs were spent observing what `canaryStartTake.test.ts` now states in ~175ms.
 *
 * The spec supplies Playwright's own `expect`, so shipped behaviour is identical. The unit test proves
 * the logic; the paid canary proves this seam.
 */

/** The slice of Playwright's `Locator` this helper uses; the real `Locator` satisfies it. */
export interface TakeLocator<L> {
    count(): Promise<number>;
    first(): L;
    or(other: L): L;
    click(options?: { timeout?: number }): Promise<void>;
}

/** The slice of Playwright's `Response` the predicate reads. */
export interface TakeResponse {
    url(): string;
    request(): { method(): string };
}

/** The slice of Playwright's `Page` this helper uses. */
export interface TakePage<L, R> {
    getByTestId(testId: string): L;
    waitForResponse(predicate: (response: R) => boolean, options?: { timeout?: number }): Promise<R>;
}

/** Injected by the spec as Playwright's `expect`; by the test as a recorder. */
export interface TakeAssertions<L> {
    visible(locator: L, timeoutMs: number): Promise<unknown>;
    enabled(locator: L, timeoutMs: number): Promise<unknown>;
}

/**
 * THE BUDGETS THIS HELPER SPENDS, EXPORTED SO THE SPEC CANNOT UNDER-BUDGET THEM.
 *
 * #1518 P1 (Codex, exact head fa322aa33): the cold wait was a bare `150000` here while
 * `playwright.canary.config.ts` kills the test at 60s and the spec only raised that when the deploy gate
 * was armed. Ungated, the 150s could never elapse; gated, the 2-minute product share was already smaller
 * than the wait itself. A healthy cold account therefore died on a generic Playwright timeout instead of
 * completing the journey — the same class of false failure this file exists to remove, moved from the
 * selector to the clock.
 *
 * A number the caller has to remember is a number the caller gets wrong, so the spec now derives its
 * timeout from these and a unit test pins the relationship.
 */
/** Either control must render, then be enabled, before the press. */
export const CONTROL_WAIT_MS = 15_000;
/**
 * A cold account's press downloads the model AND records, so the authoritative RPC can legitimately take
 * over two minutes; the repository documents observed 126s cold starts.
 */
export const COLD_START_RPC_TIMEOUT_MS = 150_000;
/** A warm account has the model already; the RPC is immediate. */
export const WARM_START_RPC_TIMEOUT_MS = 20_000;
/** What `startTake` can spend end to end on the slower path: both control waits plus the cold RPC. */
export const COLD_START_TOTAL_BUDGET_MS = CONTROL_WAIT_MS * 2 + COLD_START_RPC_TIMEOUT_MS;

export async function startTake<L extends TakeLocator<L>, R extends TakeResponse>(
    page: TakePage<L, R>,
    assertions: TakeAssertions<L>,
): Promise<{ authoritativeStart: Promise<R>; path: 'cold' | 'warm' }> {
    const downloadBtn = page.getByTestId('mic-download');
    const startBtn = page.getByTestId('mic-start');
    await assertions.visible(downloadBtn.or(startBtn).first(), CONTROL_WAIT_MS);
    const path: 'cold' | 'warm' = (await downloadBtn.count()) > 0 ? 'cold' : 'warm';
    const control: L = path === 'cold' ? downloadBtn.first() : startBtn;
    await assertions.enabled(control, CONTROL_WAIT_MS);
    const authoritativeStart = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && response.url().includes('/rest/v1/rpc/create_session_and_update_usage'),
    { timeout: path === 'cold' ? COLD_START_RPC_TIMEOUT_MS : WARM_START_RPC_TIMEOUT_MS });
    await control.click();
    return { authoritativeStart, path };
}
