import { expect, type Page } from '@playwright/test';
import type { CoachingGenerationTap, CoachingSuggestionPair } from './coachingGenerationTap';
import { CONSENT_MODES, privacyChoiceVerdict, readPracticeChoice, type ChoiceClient } from './rwtPracticeConsent';
import { isCoachingUnavailableHeadline, takeExchangeEvidence } from './coachingExternal';
import { j3bUpstreamStatus } from './rwtJ3Evidence';
import { armOneCoachingProviderBoundary, singleCoachingProof } from './rwtSingleCoachingProof';

const TIMEOUT = 45_000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Low-quota hosted probe: record and prove all takes with saving ON and coaching OFF.
 * After all captures finish, opt in through the product's real privacy control, then
 * explicitly request coaching on one saved take through the supported review UI.
 * The runner's cleanup and all supported readbacks remain the caller's responsibility.
 * Do not use this on a take that already received a generation request.
 */
export async function runSavedTakeCoaching(input: {
    page: Page;
    tap: CoachingGenerationTap;
    client: ChoiceClient;
    ownerId: string;
    takeId: string;
    product: 'open_mic' | 'focus_points';
    /** Reads the exact repeat's saved coverage on this tab, while all coaching is still blocked. */
    verifyBeforeOptIn?: () => Promise<boolean>;
    /** Owner-scoped exact completed row, including an explicit null pair if no coaching was saved. */
    readSavedTake: (takeId: string) => Promise<{
        takeId: string;
        product: 'open_mic' | 'focus_points';
        pair: CoachingSuggestionPair | null;
    } | null>;
}) {
    const { page, tap, client, ownerId, takeId, product } = input;
    if (!SESSION_ID.test(takeId)) throw new Error('HOLD single coaching: invalid saved take');
    const zero = () => { if (tap.sentCount !== 0 || tap.readinessSentCount !== 0) throw new Error('FAIL single coaching: request before opt-in'); };
    const choiceIs = async (mode: 'save_on' | 'save_on_coaching_on') =>
        privacyChoiceVerdict(await readPracticeChoice(client, ownerId), ownerId, CONSENT_MODES[mode]).verdict === 'PASS';
    let requested = false;
    await armOneCoachingProviderBoundary(page, tap, {
        blockReadiness: true,
        permit: (sent) => requested && sent.sessionId === takeId && sent.product === product,
    });
    zero();
    await expect.poll(() => choiceIs('save_on'), { timeout: TIMEOUT }).toBe(true);
    if (input.verifyBeforeOptIn) {
        const verified = await input.verifyBeforeOptIn();
        zero();
        if (!verified) return { outcome: 'HOLD', reason: 'saved_coverage_not_verified',
            proof: { browserPosts: 0, pendingPosts: 0, providerAttempts: 0, terminal: null } } as const;
    }

    // This is a restored review, never the old after-Stop view with an automatic request.
    await page.goto('/session?review=' + encodeURIComponent(takeId));
    const restored = page.getByTestId('saved-session-return');
    await expect(restored).toHaveAttribute('data-session-id', takeId, { timeout: TIMEOUT });
    await expect(restored.getByTestId('restored-review-retry')).toHaveAttribute('data-retry', 'coaching_off', { timeout: TIMEOUT });
    zero();
    await restored.getByTestId('restored-review-privacy-link').click({ timeout: TIMEOUT });
    await expect(page).toHaveURL(/\/account#privacy-data$/, { timeout: TIMEOUT });
    const toggle = page.getByTestId('privacy-ai-switch');
    await expect(page.getByTestId('privacy-save-switch')).toHaveAttribute('aria-checked', 'true', { timeout: TIMEOUT });
    await expect(toggle).toBeEnabled({ timeout: TIMEOUT });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: TIMEOUT });
    await expect.poll(() => choiceIs('save_on_coaching_on'), { timeout: TIMEOUT }).toBe(true);
    zero();

    // Back is itself an assertion: opting in must not request coaching on entry.
    await page.goBack();
    await expect(restored).toHaveAttribute('data-session-id', takeId, { timeout: TIMEOUT });
    await expect(restored.getByTestId('restored-review-retry')).toHaveAttribute('data-retry', 'available', { timeout: TIMEOUT });
    zero();
    requested = true;
    await restored.getByTestId('restored-review-retry-button').click({ timeout: TIMEOUT });
    const card = restored.getByTestId('restored-review-requested').getByTestId('ai-suggestions-card');
    await expect(card).toHaveAttribute('data-review-state', /^(ready|error)$/, { timeout: 65_000 });
    await tap.settle();
    const proof = singleCoachingProof({ takeId, product, browserPosts: tap.sentCount, exchanges: tap.exchanges });
    if (proof.status !== 'PASS') return { proof, outcome: proof.status, reason: proof.reason } as const;
    const attempt = takeExchangeEvidence(tap.forSession(takeId));
    if (!attempt.unique) return { proof, outcome: 'HOLD', reason: 'terminal_receipt_not_bound' } as const;
    const state = await card.getAttribute('data-review-state');
    const visible = async (id: string) => {
        const item = card.getByTestId(id);
        return await item.isVisible().catch(() => false) ? (await item.innerText({ timeout: 2_000 })).trim() : '';
    };
    const saved = await input.readSavedTake(takeId);
    if (saved?.takeId !== takeId || saved.product !== product) {
        return { proof, outcome: 'HOLD', reason: 'owner_saved_take_not_proved' } as const;
    }
    if (state === 'error') {
        const verifiedExternal = j3bUpstreamStatus(attempt.evidence);
        const retry = card.getByTestId('ai-suggestions-retry');
        const graceful = saved.pair === null && isCoachingUnavailableHeadline(await visible('ai-suggestions-headline'))
            && await visible('ai-suggestions-retry') === 'Try again' && await retry.isEnabled({ timeout: 2_000 }).catch(() => false);
        return verifiedExternal && graceful
            ? { proof, outcome: 'EXTERNAL', reason: 'provider_limited_saved_take', providerStatus: verifiedExternal } as const
            : { proof, outcome: 'FAIL', reason: 'failure_not_proved_external_or_missing_retry' } as const;
    }

    const pair = proof.terminal?.suggestions;
    const samePair = (a: CoachingSuggestionPair | null | undefined, b: CoachingSuggestionPair | null | undefined) =>
        !!a && !!b && a.version === b.version && a.what_worked === b.what_worked && a.what_to_try_next === b.what_to_try_next;
    if (state !== 'ready' || proof.terminal?.status !== 200 || attempt.evidence.providerStatus !== 200 || !pair || !samePair(pair, saved.pair)
        || pair.what_worked !== await visible('review-what-went-well') || pair.what_to_try_next !== await visible('review-try-next')) {
        return { proof, outcome: 'FAIL', reason: 'generated_pair_not_rendered_and_saved' } as const;
    }

    // Reopen without pressing Retry. The actual saved view, not the successful live card, must show the same pair.
    const sentBefore = tap.sentCount;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(restored).toHaveAttribute('data-session-id', takeId, { timeout: TIMEOUT });
    const savedCard = restored.getByTestId('saved-review');
    await expect(savedCard).toHaveAttribute('data-session-id', takeId, { timeout: TIMEOUT });
    await expect(savedCard.getByTestId('review-what-went-well')).toHaveText(pair.what_worked, { timeout: TIMEOUT });
    await expect(savedCard.getByTestId('review-try-next')).toHaveText(pair.what_to_try_next, { timeout: TIMEOUT });
    await tap.settle();
    if (tap.sentCount !== sentBefore || tap.readinessSentCount !== 0) return { proof, outcome: 'FAIL', reason: 'reopen_sent_coaching' } as const;
    return { proof, outcome: 'PASS', reason: 'one_bound_provider_answer_saved_and_reopened' } as const;
}
