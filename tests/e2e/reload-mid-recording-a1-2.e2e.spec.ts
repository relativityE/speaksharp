/**
 * A1-2 — a take interrupted by a reload is honestly reported, never silently lost.
 *
 * The 10-24 cloud rehearsal listed "reload mid-recording" as untested, and no spec reloaded during a live take: the
 * recovery-draft spec only proves the banner stays away after a SUCCESSFUL save. This is the other half: while a take is
 * live, the runtime keeps a content-free recovery draft (`speaksharp_unsaved_session_draft`); a reload must surface it as
 * an interrupted take that was not saved, with one honest action, and dismissing it must not bring it back.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, programmaticLoginWithRoutes, startRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const RECOVERY_DRAFT_KEY = 'speaksharp_unsaved_session_draft';

test.describe('A1-2 reload during a live take', () => {
    test('the interrupted take is reported as not saved, and Dismiss clears it for good', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { userType: 'free' });
        await navigateToRoute(page, '/session');
        await expect(page.getByText(/Practice Session/i)).toBeVisible();

        await startRecording(page);
        await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
        await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CARD)).toContainText(/simulating multiple lines/i);

        // The live take's recovery draft exists before the interruption — the reload is the only thing that ends it.
        await expect.poll(
            () => page.evaluate((key) => {
                const raw = window.localStorage.getItem(key);
                return raw ? (JSON.parse(raw) as { recoveryState?: string }).recoveryState ?? null : null;
            }, RECOVERY_DRAFT_KEY),
            { message: 'the live take keeps a recovery draft', timeout: 10_000 },
        ).toBe('active_interrupted');

        // A real browser keeps localStorage across a reload, but `setupE2EManifest`'s init script clears it on EVERY document
        // load (keeping only its lease/obligation keys), which deleted the very draft under test (Sam 1792951882.028579).
        // Init scripts run in registration order, so this later one puts back exactly the value the live take left, once —
        // a per-tab sessionStorage marker keeps it from re-injecting on the reload after Dismiss.
        const draftBeforeReload = await page.evaluate((key) => window.localStorage.getItem(key), RECOVERY_DRAFT_KEY);
        expect(draftBeforeReload, 'the live take left a draft to survive the reload').not.toBeNull();
        await page.addInitScript(([key, value]) => {
            if (window.sessionStorage.getItem('__e2e_a1_2_draft_restored')) return;
            window.sessionStorage.setItem('__e2e_a1_2_draft_restored', '1');
            window.localStorage.setItem(key, value);
        }, [RECOVERY_DRAFT_KEY, draftBeforeReload as string] as const);

        await page.reload();
        await expect(page.getByText(/Practice Session/i)).toBeVisible({ timeout: 20_000 });

        const banner = page.getByTestId('session-recovery-actions');
        await expect(banner, 'the interrupted take is reported after the reload').toBeVisible({ timeout: 15_000 });
        await expect(banner).toHaveAttribute('data-recovery-state', 'active_interrupted');
        await expect(page.getByTestId('session-recovery-message')).toHaveText(
            /^Your last session was interrupted before it was saved\. No transcript was saved/,
        );
        // Nothing claims the take was saved, and no transcript is offered back.
        await expect(page.getByTestId(TEST_IDS.TRANSCRIPT_CARD)).not.toContainText(/simulating multiple lines/i);

        await page.getByTestId('session-recovery-dismiss').click();
        await expect(banner, 'Dismiss removes the report').toHaveCount(0);
        await expect.poll(
            () => page.evaluate((key) => window.localStorage.getItem(key), RECOVERY_DRAFT_KEY),
            { message: 'Dismiss clears the stored draft' },
        ).toBeNull();

        // It does not come back on a fresh mount.
        await page.reload();
        await expect(page.getByText(/Practice Session/i)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('mic-start')).toBeVisible({ timeout: 15_000 });
        await expect(banner).toHaveCount(0);
    });
});
