/**
 * #1360 — offline browser proof for abandoning a recording and returning to Open Mic.
 *
 * These cases use the existing context-shared lease RPC double. They prove browser behavior against that test double,
 * not server/database persistence or deployed release behavior. An abandoned take is deliberately never stopped or
 * reported as saved; a later take must get its own identity and save once.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording, waitForModelReady } from './helpers';

const LEASE_KEY = '__e2e_shared_lease_1476';
const BLOCKED = /A recording is active on .+\. Stop it there, or press Start again to take over here/;
const TRANSCRIPT = 'This later take belongs to the returning Open Mic session.';

type Lease = { lease_id: string; heartbeat_at: number; started_at: string };
type Engine = { controllerState?: string; serviceState?: string | null; sessionId?: string | null };

async function optIntoSharedLease(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (window as unknown as { __E2E_SHARED_LEASE_1476__?: boolean }).__E2E_SHARED_LEASE_1476__ = true;
    });
    await page.evaluate(() => {
        (window as unknown as { __E2E_SHARED_LEASE_1476__?: boolean }).__E2E_SHARED_LEASE_1476__ = true;
    }).catch(() => undefined);
}

type HeartbeatControl = {
    leaseAcquired: boolean;
    obligationsResolved: boolean;
    confirmationClaimed: boolean;
    confirmationAt: number | null;
    periodicSuccessAt: number | null;
    heldStates: string[];
};

async function installHeartbeatControl(page: Page, mode: 'before-first-periodic' | 'after-one-periodic'): Promise<void> {
    await page.evaluate((controlMode) => {
        type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown> };
        type Control = HeartbeatControl;
        const w = window as unknown as {
            supabase?: RpcClient;
            __1360_HEARTBEAT_CONTROL__?: Control;
        };
        if (!w.supabase) throw new Error('E2E RPC client is missing');
        const client = w.supabase;
        const original = client.rpc.bind(client);
        const control: Control = {
            leaseAcquired: false,
            obligationsResolved: false,
            confirmationClaimed: false,
            confirmationAt: null,
            periodicSuccessAt: null,
            heldStates: [],
        };
        w.__1360_HEARTBEAT_CONTROL__ = control;
        const heartbeatAt = () => {
            try {
                const lease = JSON.parse(localStorage.getItem('__e2e_shared_lease_1476') || 'null') as Lease | null;
                return lease?.heartbeat_at ?? null;
            } catch { return null; }
        };
        client.rpc = async (fn, args) => {
            if (fn === 'acquire_recording_lease') {
                const result = await original(fn, args);
                if ((result as { data?: { acquired?: boolean } } | null)?.data?.acquired === true) control.leaseAcquired = true;
                return result;
            }
            if (fn === 'get_progress_obligations' && control.leaseAcquired) {
                const result = await original(fn, args);
                control.obligationsResolved = true;
                return result;
            }
            if (fn === 'heartbeat_recording_lease' && control.leaseAcquired) {
                const state = document.documentElement.getAttribute('data-runtime-state') ?? 'unknown';
                // Permit the explicit Start confirmation, which follows the obligations read. All timer heartbeats are
                // intercepted from before Start, so none can silently succeed around the pre-periodic baseline.
                if (!control.confirmationClaimed && control.obligationsResolved && state !== 'RECORDING') {
                    control.confirmationClaimed = true;
                    const result = await original(fn, args);
                    const valid = (result as { data?: { valid?: boolean } } | null)?.data?.valid === true;
                    if (valid) control.confirmationAt = heartbeatAt();
                    return result;
                }
                // For the post-heartbeat case, admit exactly one timer call after RECORDING is visible, then hold all
                // later timer calls. For the first-periodic case, every timer call remains pending.
                if (controlMode === 'after-one-periodic' && control.confirmationAt !== null
                    && state === 'RECORDING' && control.periodicSuccessAt === null) {
                    const result = await original(fn, args);
                    const valid = (result as { data?: { valid?: boolean } } | null)?.data?.valid === true;
                    if (valid) control.periodicSuccessAt = heartbeatAt();
                    return result;
                }
                control.heldStates.push(state);
                return new Promise(() => undefined);
            }
            return original(fn, args);
        };
    }, mode);
}

const heartbeatControl = (page: Page) => page.evaluate(() =>
    (window as unknown as { __1360_HEARTBEAT_CONTROL__?: HeartbeatControl }).__1360_HEARTBEAT_CONTROL__ ?? null);

const rpcCalls = (page: Page, name: string) => page.evaluate((fn) =>
    (window as unknown as { __E2E_RPC_CALLS_1476__?: Record<string, number> }).__E2E_RPC_CALLS_1476__?.[fn] ?? 0, name);

async function captureSaveKeys(page: Page): Promise<void> {
    await page.evaluate(() => {
        type Client = { rpc: (fn: string, args?: Record<string, unknown>) => unknown };
        const w = window as unknown as { supabase?: Client; __1360_SAVE_KEYS__?: string[] };
        if (!w.supabase || w.__1360_SAVE_KEYS__) return;
        const client = w.supabase;
        const original = client.rpc.bind(client);
        w.__1360_SAVE_KEYS__ = [];
        client.rpc = (fn, args) => {
            if (fn === 'create_session_and_update_usage') {
                w.__1360_SAVE_KEYS__!.push(String(args?.p_idempotency_key ?? ''));
            }
            return original(fn, args);
        };
    });
}

const saveKeys = (page: Page) => page.evaluate(() =>
    (window as unknown as { __1360_SAVE_KEYS__?: string[] }).__1360_SAVE_KEYS__ ?? []);

const lease = (page: Page) => page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') as Lease | null; } catch { return null; }
}, LEASE_KEY);

const engine = (page: Page) => page.evaluate(() => {
    const debug = (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Engine }).__SPEECH_RUNTIME_DEBUG__?.() ?? {};
    return {
        ...debug,
        micHeld: (window as unknown as { __TRANSCRIPTION_SERVICE__?: { service?: { mic?: unknown } | null } })
            .__TRANSCRIPTION_SERVICE__?.service?.mic != null,
    };
});

async function returnInSameAccount(page: Page, expectedUserId: string): Promise<Page> {
    const context = page.context();
    await page.close(); // Playwright does not run beforeunload by default: this abandons without Stop or save.
    const returned = await context.newPage();
    await optIntoSharedLease(returned);
    const login = await programmaticLoginWithRoutes(returned, { userType: 'pro' });
    expect(login.user).toMatchObject({ id: expectedUserId });
    await navigateToRoute(returned, '/session');
    await waitForModelReady(returned);
    await captureSaveKeys(returned);
    return returned;
}

for (const checkpoint of ['held before first periodic success', 'after one successful periodic heartbeat'] as const) {
    test(`#1360: abandon during recording ${checkpoint}, return safely, recover stale lease, and save only the new take`, async ({ proPage: page }) => {
        test.setTimeout(120_000);
        await optIntoSharedLease(page);
        await navigateToRoute(page, '/session');
        await installHeartbeatControl(page, checkpoint === 'held before first periodic success' ? 'before-first-periodic' : 'after-one-periodic');
        await captureSaveKeys(page);
        await startRecording(page);
        await mockLiveTranscript(page, [
            'This first take is deliberately abandoned before Stop and must never be reported as saved.',
        ]);

        const activeTakeId = String((await engine(page)).sessionId ?? '');
        expect(activeTakeId, 'the abandoned recording has an identity for comparison').not.toBe('');
        const abandonedSaveKeys = await saveKeys(page);
        expect(abandonedSaveKeys, 'the first recording has one idempotency identity').toHaveLength(1);
        expect(abandonedSaveKeys[0]).not.toBe('');
        const accountId = await page.evaluate(() => {
            const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('sb-') && candidate.endsWith('-auth-token'));
            if (!key) return '';
            try { return String(JSON.parse(localStorage.getItem(key) || '{}')?.user?.id ?? ''); } catch { return ''; }
        });
        expect(accountId, 'the starting page has a known mock account identity').not.toBe('');
        const initialLease = await lease(page);
        expect(initialLease, 'Start owns a context-shared account lease').not.toBeNull();

        const control = await heartbeatControl(page);
        expect(control?.confirmationAt, 'the explicit Start lease confirmation succeeded before the periodic boundary').not.toBeNull();
        if (checkpoint === 'held before first periodic success') {
            await expect.poll(async () => (await heartbeatControl(page))?.heldStates.includes('RECORDING'), { timeout: 12_000 })
                .toBe(true);
            expect((await lease(page))?.heartbeat_at, 'held periodic calls did not advance the lease after the Start confirmation')
                .toBe(control?.confirmationAt);
        } else {
            await expect.poll(async () => (await heartbeatControl(page))?.periodicSuccessAt, { timeout: 12_000 })
                .toBeGreaterThan(control?.confirmationAt ?? 0);
            await expect.poll(async () => (await heartbeatControl(page))?.heldStates.includes('RECORDING'), { timeout: 12_000 })
                .toBe(true);
        }

        const abandonedLease = await lease(page);
        expect(abandonedLease).not.toBeNull();
        const returned = await returnInSameAccount(page, accountId);
        try {
            await expect(returned.locator('html')).not.toHaveAttribute('data-session-persisted', 'true');
            await expect(returned.locator('html')).not.toHaveAttribute('data-session-persisted-id', activeTakeId);
            expect((await engine(returned)).controllerState).not.toBe('RECORDING');
            expect((await engine(returned)).micHeld, 'return does not auto-open a microphone').toBe(false);

            // A still-fresh lease must refuse Start truthfully and before the returned page opens an engine.
            await returned.getByTestId('mic-start').click();
            await expect(returned.getByText(BLOCKED)).toBeVisible({ timeout: 15_000 });
            expect((await engine(returned)).controllerState).not.toBe('RECORDING');
            expect((await engine(returned)).micHeld).toBe(false);
            // The UI's next explicit Start is a deliberate takeover, so keep this negative control to one blocked
            // action and observe that the refusal persists while the original lease is still fresh.
            for (let observation = 0; observation < 5; observation += 1) {
                await returned.waitForTimeout(200);
                expect((await engine(returned)).controllerState).not.toBe('RECORDING');
                expect((await engine(returned)).micHeld).toBe(false);
                await expect(returned.locator('html')).not.toHaveAttribute('data-session-persisted', 'true');
                await expect(returned.locator('html')).not.toHaveAttribute('data-session-persisted-id', activeTakeId);
            }

            const heartbeatAt = abandonedLease!.heartbeat_at;
            const remainingFreshMs = Math.max(0, 15_250 - (Date.now() - heartbeatAt));
            if (remainingFreshMs > 0) await returned.waitForTimeout(remainingFreshMs);

            // After natural expiry, another explicit Start can recover. The new take must have a distinct identity.
            await returned.getByTestId('mic-start').click();
            await expect(returned.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 30_000 });
            const newTakeId = String((await engine(returned)).sessionId ?? '');
            expect(newTakeId).not.toBe('');

            await mockLiveTranscript(returned, [TRANSCRIPT]);
            await expect(returned.getByTestId('live-transcript')).toContainText(TRANSCRIPT, { timeout: 15_000 });
            await returned.waitForTimeout(5_200); // Honor the product's minimum-duration save guard.
            await returned.getByTestId('recorder-stop').click();
            await expect(returned.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
            const savedId = await returned.locator('html').getAttribute('data-session-persisted-id');
            expect(savedId, 'only the recovered take is saved').toBe(newTakeId);
            expect(await rpcCalls(returned, 'create_session_and_update_usage'), 'the recovered take saves exactly once').toBe(1);
            const recoveredSaveKeys = await saveKeys(returned);
            expect(recoveredSaveKeys, 'the recovered take has one save identity').toHaveLength(1);
            // The current E2E session DB is page-local and generated row ids can collide across fresh pages. The
            // production-path idempotency key is the supported distinct-take identity here; backend row uniqueness
            // remains unproven by this mock and is reported as a limitation rather than patched into shared helpers.
            expect(recoveredSaveKeys[0], 'the next recording has a distinct idempotency identity').not.toBe(abandonedSaveKeys[0]);
        } finally {
            await returned.close().catch(() => undefined);
        }
    });
}
