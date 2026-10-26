import { withDeadline } from './rwtMainThreadTrace';

/**
 * #1258 / #1550 — the filler counts a person sees after Stop, read from the Session page's FillerBreakdown.
 *
 * The whole read runs inside ONE outer deadline (Codex P1 r4161811889). The deployed-live config sets no action
 * timeout, so a stalled renderer can leave `locator.all()` or a parameterless `isVisible()` pending forever; per-row
 * timeouts only start after `all()` returns. A bounded read can never consume the test's own timeout.
 *
 * Results are collected locally and returned only on completion, so a read that resumes after the deadline cannot
 * change what the spec already recorded.
 */
export type BreakdownRead =
    | { state: 'read'; perWord: Record<string, number>; headline: number | null }
    | { state: 'absent' }
    | { state: 'timeout' };

/** The slice of a Playwright `Page` this reads — stubbable in unit tests. */
export interface BreakdownPage {
    getByTestId(id: string): BreakdownLocator;
}
interface BreakdownLocator {
    waitFor(o: { state: 'visible'; timeout: number }): Promise<unknown>;
    all(): Promise<BreakdownLocator[]>;
    getAttribute(name: string, o: { timeout: number }): Promise<string | null>;
    getByTestId(id: string): BreakdownLocator;
    innerText(o: { timeout: number }): Promise<string>;
    isVisible(): Promise<boolean>;
}

export async function readFillerBreakdown(
    page: BreakdownPage,
    o: { boundMs: number; visibleTimeoutMs: number; readTimeoutMs: number; normaliseKey: (word: string) => string },
): Promise<BreakdownRead> {
    const outcome = await withDeadline(async (): Promise<BreakdownRead> => {
        const visible = await page.getByTestId('filler-breakdown').waitFor({ state: 'visible', timeout: o.visibleTimeoutMs })
            .then(() => true).catch(() => false);
        if (!visible) return { state: 'absent' };
        const perWord: Record<string, number> = {};
        for (const row of await page.getByTestId('filler-breakdown-word').all()) {
            const word = o.normaliseKey((await row.getAttribute('data-word', { timeout: o.readTimeoutMs }).catch(() => null)) ?? '');
            const shown = await row.getByTestId('filler-breakdown-count').innerText({ timeout: o.readTimeoutMs }).catch(() => '');
            const count = Number(shown.replace(/[^0-9]/g, ''));
            if (word && shown && Number.isInteger(count)) perWord[word] = count;
        }
        const stats = await page.getByTestId('after-stats').innerText({ timeout: o.readTimeoutMs }).catch(() => '');
        const headline = /(\d+)\s+fillers?\b/.exec(stats);
        const empty = await page.getByTestId('filler-breakdown-empty').isVisible().catch(() => false);
        return { state: 'read', perWord, headline: headline ? Number(headline[1]) : empty ? 0 : null };
    }, o.boundMs);
    if (outcome.kind === 'ok') return outcome.value;
    return outcome.kind === 'timeout' ? { state: 'timeout' } : { state: 'absent' };
}
