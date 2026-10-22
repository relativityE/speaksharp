import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    awaitStopTerminal,
    classifyStopOutcome,
    startOwnerId,
    verifySavedReadback,
    type CompletionEvidence,
} from '../canary/canaryStopSaveOracle';

/**
 * CO006 — the canary's stop/save decision must be able to FAIL. Each CASUALTY is a state the old race
 * (three locator waits whose timeouts became null, then `sessions[0]`) accepted as a passing canary.
 */
const TAKE = 'take-1';
const OWNER = 'owner-1';
const SAVED: CompletionEvidence = {
    requestSessionId: TAKE, status: 200,
    body: { success: true, session_saved: true, final_status: 'completed' },
};
const row = (over: Record<string, unknown> = {}) => ({
    id: TAKE, user_id: OWNER, total_words: 42, duration: 30, created_at: '2026-10-22T12:00:00Z', engine: 'private',
    status: 'completed', ...over,
});
const withoutStatus = () => Object.fromEntries(Object.entries(row()).filter(([key]) => key !== 'status'));
const never = <T>() => new Promise<T>(() => undefined);
const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const rejectAfter = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('locator timeout')), ms));

describe('CO006 classifyStopOutcome — only a saved completion of THIS take passes', () => {
    it('POSITIVE: the started session saved and completed', () => {
        expect(classifyStopOutcome(TAKE, { completion: SAVED, noSpeechShown: false, unrelatedDialog: false }))
            .toEqual({ kind: 'saved', sessionId: TAKE });
    });
    it('CASUALTY: a save for another session (stale take) is unresolved', () => {
        const other = { ...SAVED, requestSessionId: 'old-take' };
        expect(classifyStopOutcome(TAKE, { completion: other, noSpeechShown: false, unrelatedDialog: false }))
            .toEqual({ kind: 'unresolved', reason: 'completion_for_other_session' });
    });
    it.each([
        ['suppressed persistence', { ...SAVED, body: { success: true, session_saved: false, final_status: 'completed' } }, 'completion_not_saved'],
        ['failed save', { ...SAVED, body: { success: false } }, 'completion_not_saved'],
        ['non-completed status', { ...SAVED, body: { success: true, session_saved: true, final_status: 'active' } }, 'completion_not_saved'],
        ['HTTP error', { ...SAVED, status: 500 }, 'completion_http_500'],
    ] as const)('CASUALTY: %s is unresolved', (_label, completion, reason) => {
        expect(classifyStopOutcome(TAKE, { completion, noSpeechShown: false, unrelatedDialog: false })).toEqual({ kind: 'unresolved', reason });
    });
    it('CASUALTY: an unrelated dialog with no save is unresolved, not a pass', () => {
        expect(classifyStopOutcome(TAKE, { completion: null, noSpeechShown: false, unrelatedDialog: true }))
            .toEqual({ kind: 'unresolved', reason: 'unrelated_dialog_without_save' });
    });
    it('CASUALTY: nothing observed (every wait timed out) is unresolved', () => {
        expect(classifyStopOutcome(TAKE, { completion: null, noSpeechShown: false, unrelatedDialog: false }))
            .toEqual({ kind: 'unresolved', reason: 'no_terminal_save' });
    });
    it('no-speech is its own non-save outcome, never a persisted take', () => {
        expect(classifyStopOutcome(TAKE, { completion: null, noSpeechShown: true, unrelatedDialog: false })).toEqual({ kind: 'no_speech' });
    });
});

describe('CO006 awaitStopTerminal — timeouts cannot win, late callbacks cannot change the verdict', () => {
    it('CASUALTY: a valid DELAYED save is not lost to a faster locator timeout', async () => {
        const seen = await awaitStopTerminal({ completion: after(60, SAVED), noSpeech: rejectAfter(5), dialog: rejectAfter(5) }, 1_000);
        expect(classifyStopOutcome(TAKE, seen)).toEqual({ kind: 'saved', sessionId: TAKE });
    });
    it('a dialog alone does not end the wait; the later save still decides', async () => {
        const seen = await awaitStopTerminal({ completion: after(40, SAVED), noSpeech: never(), dialog: after(5, undefined) }, 1_000);
        expect(seen.unrelatedDialog).toBe(true);
        expect(classifyStopOutcome(TAKE, seen).kind).toBe('saved');
    });
    it('CASUALTY: all waits time out → the deadline returns an unresolved observation', async () => {
        const seen = await awaitStopTerminal({ completion: rejectAfter(5), noSpeech: rejectAfter(5), dialog: rejectAfter(5) }, 50);
        expect(seen).toEqual({ completion: null, noSpeechShown: false, unrelatedDialog: false });
        expect(classifyStopOutcome(TAKE, seen)).toEqual({ kind: 'unresolved', reason: 'no_terminal_save' });
    });
    it('CASUALTY: a save arriving after the deadline cannot mutate the returned observation', async () => {
        const late = after(80, SAVED);
        const seen = await awaitStopTerminal({ completion: late, noSpeech: never(), dialog: never() }, 20);
        await late;
        expect(seen.completion).toBeNull();
        expect(classifyStopOutcome(TAKE, seen).kind).toBe('unresolved');
    });
});

describe('CO006 verifySavedReadback — the exact row, by id and owner, never rows[0]', () => {
    it('POSITIVE: the matching saved row in a list, and the single-object detail read', () => {
        expect(verifySavedReadback(TAKE, OWNER, [row({ id: 'newer-other' }), row()])).toEqual({ ok: true });
        expect(verifySavedReadback(TAKE, OWNER, row())).toEqual({ ok: true });
    });
    it('CASUALTY: a stale old row at rows[0] does not satisfy a missing take', () => {
        expect(verifySavedReadback(TAKE, OWNER, [row({ id: 'old-take' })])).toEqual({ ok: false, reason: 'row_missing' });
    });
    it.each([
        ['empty list', [], 'row_missing'],
        ['empty id', [row({ id: '' })], 'row_missing'],
        ['not a row', 'unexpected text', 'readback_not_a_row'],
        ['single row for another take', row({ id: 'old-take' }), 'row_missing'],
        ['wrong owner', [row({ user_id: 'someone-else' })], 'wrong_owner'],
        ['not completed', [row({ status: 'active' })], 'not_completed'],
        // Sam RETURN on 7efacb7c: the shipped detail select always reads `status`, so a row without it is not a completed take.
        ['status omitted, list readback', [withoutStatus()], 'not_completed'],
        ['status omitted, single-object readback', withoutStatus(), 'not_completed'],
        ['status undefined, list readback', [row({ status: undefined })], 'not_completed'],
        ['no words', [row({ total_words: 0 })], 'no_words'],
        ['missing schema field', [row({ engine: undefined })], 'missing_engine'],
    ] as const)('CASUALTY: %s fails', (_label, rows, reason) => {
        expect(verifySavedReadback(TAKE, OWNER, rows)).toEqual({ ok: false, reason });
    });
    it('CASUALTY: an unknown owner (start RPC gave none) never passes', () => {
        expect(verifySavedReadback(TAKE, null, [row()])).toEqual({ ok: false, reason: 'wrong_owner' });
    });
    it('startOwnerId reads only a non-empty string user_id', () => {
        expect(startOwnerId({ id: TAKE, user_id: OWNER })).toBe(OWNER);
        expect(startOwnerId({ id: TAKE })).toBeNull();
        expect(startOwnerId(null)).toBeNull();
    });
});

/**
 * Controlled old/new harness (observed RED). `legacyStopPhase` is the pre-CO006 stop phase copied verbatim from
 * main d160e907 tests/canary/smoke.canary.spec.ts L271–312 (blob 76d6cbce), with only `page` typed for the fake.
 * Each scenario drives that code and the new oracle from the SAME page behaviour: the legacy phase completes
 * (the canary passed) where the new oracle refuses. The delayed-save positive shows the legacy pass was vacuous.
 */
interface Scenario {
    save?: { at: number; evidence: CompletionEvidence };
    dialogAt?: number;
    noSpeechAt?: number;
    analyticsAt?: number;
    sessions?: unknown[];
}
const settleAt = (at: number | undefined, timeout: number) => new Promise<void>((resolve, reject) => {
    if (at !== undefined && at <= timeout) setTimeout(resolve, at);
    else setTimeout(() => reject(new Error(`locator timeout ${timeout}ms`)), timeout);
});
/** The slice of Playwright's Page the legacy stop phase touches; the fake implements it with fewer parameters. */
interface LegacyPage {
    locator(selector: string): { waitFor(opts: { timeout: number }): Promise<void>; isVisible(): Promise<boolean> };
    getByText(text: string): { waitFor(opts: { timeout: number }): Promise<void> };
    getByRole(role: string, opts: { name: string }): { isVisible(): Promise<boolean>; click(): Promise<void> };
    waitForURL(url: RegExp, opts: { timeout: number }): Promise<void>;
    url(): string;
    reload(): Promise<void>;
    waitForResponse(predicate: (res: { url(): string; status(): number }) => boolean): Promise<{ json(): Promise<Array<Record<string, unknown>>> }>;
}
const fakePage = (s: Scenario): LegacyPage => {
    let url = 'https://app.test/session';
    if (s.analyticsAt !== undefined) setTimeout(() => { url = 'https://app.test/analytics'; }, s.analyticsAt);
    return {
        locator: () => ({
            waitFor: ({ timeout }) => settleAt(s.dialogAt, timeout),
            isVisible: async () => false,
        }),
        getByText: () => ({ waitFor: ({ timeout }) => settleAt(s.noSpeechAt, timeout) }),
        getByRole: () => ({ isVisible: async () => false, click: async () => undefined }),
        waitForURL: (...[, { timeout }]) => settleAt(s.analyticsAt, timeout),
        url: () => url,
        reload: async () => undefined,
        waitForResponse: async () => ({ json: async () => (s.sessions ?? []) as Array<Record<string, unknown>> }),
    };
};
const debugLog: (message: string) => void = () => undefined;

async function legacyStopPhase(page: LegacyPage): Promise<'passed'> {
        // 7. Handle session end (dialog, empty state, or redirect)
        const dialogLocator = page.locator('div[role="alertdialog"]');
        const emptyStateLocator = page.getByText('No speech was detected');
        const analyticsUrl = page.waitForURL(/\/analytics/, { timeout: 15000 }).catch(() => null);

        // Wait for any end state
        await Promise.race([
            dialogLocator.waitFor({ timeout: 10000 }).catch(() => null),
            emptyStateLocator.waitFor({ timeout: 10000 }).catch(() => null),
            analyticsUrl,
        ]);

        // If we reached analytics, perform SCHEMA CHECK on Sessions
        if (page.url().includes('/analytics')) {
            debugLog('[CANARY] 🔍 Validating Sessions Schema...');
            // Intercept the next list fetch to validate fields
            const sessionResponsePromise = page.waitForResponse(res =>
                res.url().includes('/rest/v1/sessions') && res.status() === 200
            );

            // Force a reload or wait for data
            await page.reload();
            const response = await sessionResponsePromise;
            const sessions = await response.json();

            if (Array.isArray(sessions) && sessions.length > 0) {
                const latestSession = sessions[0];
                const requiredFields = ['id', 'user_id', 'total_words', 'duration', 'created_at', 'engine'];
                for (const field of requiredFields) {
                    expect(latestSession[field], `Schema Valid: Session missing ${field}`).toBeDefined();
                }
                debugLog('[CANARY] ✅ Sessions Schema Valid');
            }
        }

        // If dialog appeared, dismiss it
        if (await dialogLocator.isVisible().catch(() => false)) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            if (await stayButton.isVisible().catch(() => false)) {
                await stayButton.click();
            }
        }
    return 'passed';
}

/** The new stop phase's decision for the same scenario: the spec's 45 s save wait, then the exact-id readback. */
async function newStopDecision(s: Scenario): Promise<string> {
    const completion = s.save
        ? new Promise<CompletionEvidence>((resolve) => setTimeout(() => resolve(s.save!.evidence), s.save!.at))
        : settleAt(undefined, 45_000).then(() => never<CompletionEvidence>());
    const observation = await awaitStopTerminal({
        completion, noSpeech: settleAt(s.noSpeechAt, 45_000), dialog: settleAt(s.dialogAt, 45_000),
    }, 45_000);
    const outcome = classifyStopOutcome(TAKE, observation);
    if (outcome.kind !== 'saved') return outcome.kind === 'unresolved' ? outcome.reason : outcome.kind;
    const verdict = verifySavedReadback(TAKE, OWNER, s.sessions ?? []);
    return verdict.ok ? 'saved' : verdict.reason;
}

const runBoth = async (s: Scenario) => {
    vi.useFakeTimers();
    const legacy = legacyStopPhase(fakePage(s)).then((r) => r, (e: Error) => `threw: ${e.message}`);
    const next = newStopDecision(s);
    await vi.advanceTimersByTimeAsync(60_000);
    return { legacy: await legacy, next: await next };
};

describe('CO006 observed RED — the pre-CO006 stop phase passed each casualty; the new oracle refuses it', () => {
    afterEach(() => { vi.useRealTimers(); });

    it.each([
        ['suppressed persistence, page stays put', {
            save: { at: 2_000, evidence: { ...SAVED, body: { success: true, session_saved: false, final_status: 'completed' } } },
        }, 'completion_not_saved'],
        ['no save request at all (every wait times out)', {}, 'no_terminal_save'],
        ['unrelated dialog, no save', { dialogAt: 1_000 }, 'unrelated_dialog_without_save'],
        ['save for another session, navigates to analytics', {
            save: { at: 2_000, evidence: { ...SAVED, requestSessionId: 'old-take' } }, analyticsAt: 3_000, sessions: [row({ id: 'old-take' })],
        }, 'completion_for_other_session'],
        ['saved, but the take is missing and an older row sits at sessions[0]', {
            save: { at: 2_000, evidence: SAVED }, analyticsAt: 3_000, sessions: [row({ id: 'old-take' })],
        }, 'row_missing'],
        ['saved, but the row belongs to someone else', {
            save: { at: 2_000, evidence: SAVED }, analyticsAt: 3_000, sessions: [row({ user_id: 'someone-else' })],
        }, 'wrong_owner'],
    ] as const)('RED: %s', async (_label, scenario, newReason) => {
        const { legacy, next } = await runBoth(scenario as Scenario);
        expect(legacy).toBe('passed');
        expect(next).toBe(newReason);
    });

    it('POSITIVE: a valid delayed save — legacy "passed" without checking anything; the new oracle proves it', async () => {
        // The save lands at 20 s and the page reaches /analytics at 21 s: the legacy 10 s waits had already timed out
        // into null, so its schema check never ran. The new oracle waits for the save and reads the exact row back.
        const { legacy, next } = await runBoth({ save: { at: 20_000, evidence: SAVED }, analyticsAt: 21_000, sessions: [row()] });
        expect(legacy).toBe('passed');
        expect(next).toBe('saved');
    });
});
