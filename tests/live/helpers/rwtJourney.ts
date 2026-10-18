/**
 * RWT two-product journey suites — shared, content-free helpers (PO script 2026-09-24, #1258).
 *
 * The two suites (`rwt-open-mic-first-session`, `rwt-focus-points-session`) and the tiny Products bridge are
 * INDEPENDENT: each signs up its own disposable account, plays its own pinned fixture, writes its own receipt and
 * cleans up its own rows. Nothing here holds state shared between suites.
 *
 * What this module guarantees, so each suite does not have to re-argue it:
 *   - the audio is the manifest's pinned file (sha256 checked) and is labelled synthetic or human;
 *   - telemetry is read from the page's own outgoing PostHog requests for CORRELATION KEYS ONLY (event name,
 *     journey/attempt/boot ids, release, traffic class). A captured event is "sent", never "received": receipt is
 *     proven afterwards by scripts/telemetry-readback-qualification.mts against PostHog;
 *   - the receipt holds verdicts, counts, durations, ids and booleans — never a transcript, coaching text, point
 *     text, feedback text, email or credential.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateSync } from 'node:zlib';
import { expect, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COACHING_DEPENDENT_ANALYTICS_ROWS, guardReceiptOutput, humanWorksheet, receiptAcceptance, rowAfterHalt, type ReadbackActionBinding, type ReadbackActionStage, type ReceiptRow, type Verdict } from './rwtAcceptance';
import { RWT_BROWSER_IDENTITY_ARGS } from './rwtBrowserIdentity';
import {
    coachingFailureReason, coachingParentVerdict, coachingRequestBindingRow, focusExternalDependentRows, providerStatusFrom, takeExchangeEvidence,
    UNAVAILABLE_HEADLINE,
} from './coachingExternal';
import type { CoachingGenerationTap } from './coachingGenerationTap';
import type { ActionCaptureAttempt, ActionCaptureOutcome } from './rwtOracles';
import {
    AUDIO_ARGS,
    expectBenchmarkRecordingStarted,
    startBenchmarkRecording,
    stopBenchmarkRecording,
} from './benchmark-utils';
import { extractUidFromAuthStorage } from './proofAuthority';
import { waitForAppVisibleReady } from '../../e2e/helpers';
import {
    acquisitionTimingVerdict, feedbackRetentionVerdict, focusCoachingProvenanceVerdict, runJourneyIds, surfaceReadinessFailures,
    type AcquisitionTiming, type ReadbackPlan, isNewPersistedSession } from './rwtOracles';
import { evaluateThreeRecordingEntitlement } from './entitlementAuthority';
import { readFeedbackUiState, readPracticeActionState, type PracticeActionState } from './rwtStepDiagnostics';
import { activeHumanReflexMs } from './rwtHumanReflex';
import { resolveProductsTrigger } from './productsMenu';

export const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';
/** The disposable-account prefix these suites own; `runOwnedCleanup` refuses any other. */
export const RWT_ACCOUNT_PREFIX = 'rwt-journey-';
/**
 * The exact acknowledgement a dispatch must pass (rc-gates.yml input `rwt_writes_ack`). These suites create and
 * delete a Production account, save sessions, call the coaching function and (Open Mic) file one feedback report.
 * Without this value they refuse before any navigation — an unacknowledged run is a HOLD, never a silent write.
 */
export const RWT_WRITES_ACK_VALUE = 'RWT-DISPOSABLE-ACCOUNT-WRITES';

export { humanWorksheet, receiptAcceptance, type ReceiptRow, type Verdict };
// #1258 (PM 6174134686): the closed coaching failure vocabulary lives with the EXTERNAL classifier, which publishes it.
export { COACHING_FAILURE_REASONS, coachingFailureReason } from './coachingExternal';
import { characterCeilingVerdict, openPointReferenceVerdict } from './rwtCoachingConsistency';

/**
 * #1258 (Codex r4188372882 / r4188372897) — read a failed coaching response's closed reason as a PROMISE the spec
 * awaits before writing the receipt row. A Playwright listener does not await what it returns, so a fire-and-forget
 * parse could still be pending when the row is written, and a named reason would be receipted as null. Never throws:
 * a body that is not JSON (an intermediary's HTML error page) reads 'unrecognized', inside the closed contract.
 */
/**
 * #1258 (Codex r4189408872) — which side of the 8-10-word band the out-of-band phrase(s) fall on, so the receipt text
 * never contradicts its own word counts ("over" for a 3-word phrase did).
 */
export function bandSide(well: number, next: number, min: number, max: number): 'below' | 'above' | 'below and above' {
    const below = well < min || next < min;
    const above = well > max || next > max;
    return below && above ? 'below and above' : below ? 'below' : 'above';
}

export async function readCoachingFailureReason(response: { json(): Promise<unknown> }): Promise<string | null> {
    return (await readCoachingFailureEvidence(response)).reason;
}

/**
 * #1258 (PM 6171519534) — the failed response read ONCE, keeping only allowlisted scalars: the closed reason and the
 * provider's integer HTTP status from `diagnostics.provider_status`. Never throws; an unparseable body is `unrecognized`
 * with no provider status, so it can never prove an external outage.
 */
export async function readCoachingFailureEvidence(response: { json(): Promise<unknown> }): Promise<{ reason: string | null; providerStatus: number | null }> {
    try {
        const body = await response.json();
        return { reason: coachingFailureReason(body), providerStatus: providerStatusFrom(body) };
    } catch {
        return { reason: 'unrecognized', providerStatus: null };
    }
}

/**
 * Receipt-side value for a failure reason whose read did not settle within the bound (PM 6003371116): explicitly
 * UNKNOWN, a HOLD for classification — never `null`, which would claim the response carried no reason.
 */
export const COACHING_REASON_UNKNOWN = 'unknown';

/**
 * Wait for a pending reason read, bounded so a body that never completes cannot hold the receipt. Returns whether the
 * read SETTLED: `false` means the caller must record COACHING_REASON_UNKNOWN, not a confirmed absence.
 */
export async function settleCoachingReason(pending: Promise<unknown> | null | undefined, boundMs = 5_000): Promise<boolean> {
    if (!pending) return true;
    return Promise.race([
        pending.then(() => true, () => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), boundMs)),
    ]);
}

/** #1258 (PO 2026-10-02) — the Edge coaching contract's SOFT word target per phrase: measured, never a failure. */
const COACHING_PHRASE_TARGET_WORDS = 10;
/** #1258 (Codex r4188372867): the target is ABOUT 8-10 words; a shorter phrase is not within it. */
const COACHING_PHRASE_TARGET_MIN_WORDS = 8;

export type FixtureKey = 'open_mic_tts' | 'focus_points_tts' | 'focus_points_partial_tts';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/rwt/', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'rwt-fixtures.manifest.json'), 'utf8')) as {
    fixtures: Record<string, FixtureEntry>;
};

export interface FixtureEntry {
    file: string;
    sha256: string;
    kind: 'synthetic' | 'human';
    speechSeconds: number;
    trailingSilenceSeconds: number;
    groundTruthFillers?: Record<string, number>;
    topic?: string;
    points?: string[];
    expectedFinal?: string[];
    /** Per point, [start, end] seconds in the audio where it is spoken; null when never spoken. */
    pointAudioWindows?: Array<[number, number] | null>;
    knownFixtureLimits?: string[];
}

export interface LoadedFixture { key: string; path: string; entry: FixtureEntry }

const sha256File = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * The pinned fixture, checksum-verified. A PRIVATE human recording (never committed — this repository is public)
 * replaces the synthetic Open Mic file only when BOTH its path and its expected sha256 are supplied; it is then
 * labelled `human` and its filler ground truth becomes a hard PASS/FAIL row instead of a fixture-limited HOLD.
 */
export function loadRwtFixture(key: FixtureKey): LoadedFixture {
    const entry = MANIFEST.fixtures[key];
    if (!entry) throw new Error(`FIXTURE GATE: no manifest entry for ${key}`);
    const humanPath = key === 'open_mic_tts' ? process.env.RWT_OPEN_MIC_HUMAN_WAV : undefined;
    const humanSha = key === 'open_mic_tts' ? process.env.RWT_OPEN_MIC_HUMAN_SHA256 : undefined;
    if (humanPath || humanSha) {
        if (!humanPath || !/^[0-9a-f]{64}$/.test(humanSha ?? '')) {
            throw new Error('FIXTURE GATE: a human Open Mic fixture needs both RWT_OPEN_MIC_HUMAN_WAV and its sha256');
        }
        const actual = sha256File(humanPath);
        if (actual !== humanSha) throw new Error('FIXTURE GATE: the human Open Mic fixture does not match its pinned sha256');
        return { key: 'open_mic_human', path: humanPath, entry: { ...entry, kind: 'human', knownFixtureLimits: [] } };
    }
    const file = path.join(FIXTURE_DIR, entry.file);
    const actual = sha256File(file);
    if (actual !== entry.sha256) throw new Error(`FIXTURE GATE: ${entry.file} sha256 ${actual} != manifest ${entry.sha256}`);
    return { key, path: file, entry };
}

/**
 * Chromium launch args feeding the fixture to the fake microphone. `webgpu: false` forces the no-WebGPU (WASM)
 * route — GitHub's Linux runners have no GPU, so a WebGPU result can only come from a GPU-capable runner/device
 * and is reported separately, never inferred.
 */
export function rwtLaunchArgs(fixture: LoadedFixture, opts: { webgpu: boolean }): string[] {
    return [
        ...AUDIO_ARGS,
        ...(opts.webgpu ? ['--enable-unsafe-webgpu'] : ['--disable-gpu', '--disable-webgpu']),
        `--use-file-for-fake-audio-capture=${fixture.path}`,
        // #1258: `navigator.webdriver` off, so PostHog's bot filter does not discard the run's telemetry.
        ...RWT_BROWSER_IDENTITY_ARGS,
    ];
}

/** Hard preconditions. Returned as a list so the suite can refuse with every reason at once. */
export function rwtPreconditionFailures(): string[] {
    const failures: string[] = [];
    let origin = '';
    try { origin = new URL(process.env.BASE_URL ?? '').origin; } catch { origin = ''; }
    if (origin !== APPROVED_ORIGIN) failures.push(`ORIGIN GATE: BASE_URL origin must be exactly ${APPROVED_ORIGIN}`);
    const expected = (process.env.EXPECTED_RELEASE_SHA ?? process.env.EXPECT_RELEASE_SHA ?? '').trim();
    if (!/^[0-9a-f]{40}$/.test(expected)) failures.push('SHA GATE: EXPECTED_RELEASE_SHA must be the full 40-character deployed SHA');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        failures.push('CAPABILITY GATE: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required for server rows and UID-scoped cleanup');
    }
    if (process.env.RWT_WRITES_ACK !== RWT_WRITES_ACK_VALUE) {
        failures.push('AUTHORIZATION GATE: RWT_WRITES_ACK is not the exact acknowledgement; no Production write is attempted');
    }
    return failures;
}

export const expectedReleaseSha = (): string => (process.env.EXPECTED_RELEASE_SHA ?? process.env.EXPECT_RELEASE_SHA ?? '').trim();

/** The run-owned address, minted BEFORE the form is touched so cleanup can recover the account by exact email. */
export function newDisposableEmail(label: string): string {
    const unique = `${label}-${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
    return `${RWT_ACCOUNT_PREFIX}${unique}@${process.env.LIVE_TEST_EMAIL_DOMAIN || 'example.com'}`;
}

/** The part of a Playwright locator the sign-out helper uses (so it can be exercised offline). */
interface SignOutLocator {
    or(other: SignOutLocator): SignOutLocator;
    first(): SignOutLocator;
    isVisible(): Promise<boolean>;
    waitFor(options: { state: 'visible'; timeout: number }): Promise<void>;
    click(options?: { timeout?: number }): Promise<void>;
}

/**
 * #1601 compatibility (PM 6149152089, P1 r4252374522) — sign out through the product's OWN control on either header:
 * the direct Sign Out button shipped today, or the account menu (#1601) that opens from the signed-in avatar. A visible
 * direct button is used as-is; otherwise the avatar is REQUIRED, opened, and its `nav-sign-out-button` item REQUIRED
 * and clicked. Throws when neither path is present, so a caller can report the failure instead of passing silently.
 */
export async function signOutThroughProduct(page: { getByTestId(id: string): SignOutLocator }, timeoutMs = 30_000): Promise<'direct' | 'menu'> {
    const direct = page.getByTestId('sign-out-button').or(page.getByTestId('nav-sign-out-button')).first();
    const avatar = page.getByTestId('nav-account-avatar');
    await direct.or(avatar).first().waitFor({ state: 'visible', timeout: timeoutMs });
    if (await direct.isVisible()) {
        await direct.click({ timeout: 10_000 });
        return 'direct';
    }
    await avatar.click({ timeout: 10_000 });
    const item = page.getByTestId('nav-sign-out-button');
    await item.waitFor({ state: 'visible', timeout: 10_000 });
    await item.click({ timeout: 10_000 });
    return 'menu';
}

/**
 * Fresh disposable signup through the real form. The generated password exists only inside the returned
 * `signInAgain` closure (trace, video and screenshots are off in both suites, so no artifact can hold it); the UID
 * is captured from the session the moment it exists, so cleanup has authority even if a later step fails.
 */
export async function signUpDisposableAccount(page: Page, email: string): Promise<{
    uid: string;
    signupMs: number;
    /** Sign out through the product's own control, then sign back in through the real sign-in form. */
    signOutAndSignIn: () => Promise<{ signinMs: number }>;
    /**
     * #1258 R2 (PM 6207105255): sign THIS account in on another page (an isolated browser context: another device) through
     * the real sign-in form. The password never leaves this closure.
     */
    signInOn: (other: Page) => Promise<void>;
}> {
    const password = `Rwt-${randomBytes(18).toString('base64url')}-9a!`;
    const startedAt = Date.now();
    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('email-input').fill(email);
    // Random, never derived from anything observable, never logged; the account is deleted at the end of the run.
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('sign-up-submit').click();
    const readUid = async () => extractUidFromAuthStorage(await page.evaluate(
        () => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
    ));
    await expect.poll(readUid, { timeout: 60_000, message: 'signup must produce a session (UID captured for cleanup)' }).toBeTruthy();
    const uid = (await readUid()) ?? '';
    const signupMs = Date.now() - startedAt;
    const signOutAndSignIn = async () => {
        await signOutThroughProduct(page as never);
        await expect.poll(readUid, { timeout: 30_000, message: 'sign-out must clear the session' }).toBeFalsy();
        const signinStarted = Date.now();
        await page.goto('/auth/signin');
        await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('email-input').fill(email);
        await page.getByTestId('password-input').fill(password);
        await page.getByTestId('sign-in-submit').click();
        await expect.poll(readUid, { timeout: 60_000, message: 'sign-in must produce a session' }).toBe(uid);
        return { signinMs: Date.now() - signinStarted };
    };
    const signInOn = async (other: Page) => {
        const otherUid = async () => extractUidFromAuthStorage(await other.evaluate(
            () => Object.keys(localStorage).map((k) => ({ key: k, value: localStorage.getItem(k) ?? '' })),
        ));
        await other.goto('/auth/signin');
        await expect(other.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
        await other.getByTestId('email-input').fill(email);
        await other.getByTestId('password-input').fill(password);
        await other.getByTestId('sign-in-submit').click();
        await expect.poll(otherUid, { timeout: 60_000, message: 'the other device must sign in to the same account' }).toBe(uid);
    };
    return { uid, signupMs, signOutAndSignIn, signInOn };
}

/**
 * The separate acknowledgement for the canary claim (rc-gates.yml input `rwt_canary_claim_ack`). PM ruling
 * 2026-09-24 (#1258): automated browser journeys are `canary` traffic (`internal_test` is reserved for a human
 * tester), and setting the claim is its own Production write, authorized separately from the run's other writes.
 */
export const RWT_CANARY_CLAIM_ACK_VALUE = 'RWT-CANARY-CLAIM-RUN-OWNED';
export const canaryClaimAuthorized = (): boolean => process.env.RWT_CANARY_CLAIM_ACK === RWT_CANARY_CLAIM_ACK_VALUE;

/**
 * CONTROLLED TRAFFIC CLASS. The readback qualifies only `canary` or `internal_test` traffic, and a fresh signup is
 * `user`. With the separate acknowledgement, the service role sets the product's own server-issued claim
 * (`app_metadata.canary`, read by AuthProvider — never user-writable metadata) on THIS run's account only, after the
 * UID/email cross-check. It takes effect at the next sign-in. Events sent before it stay `user` and are reported as
 * the signup stage, never as canary. Without the acknowledgement nothing is written and the readback rows HOLD.
 */
export async function markRunOwnedAccountCanary(
    admin: { auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null }; error: { code?: string } | null }>; updateUserById: (id: string, attrs: { app_metadata: Record<string, unknown> }) => Promise<{ error: { code?: string } | null }> } } },
    uid: string,
    email: string,
): Promise<boolean> {
    if (!canaryClaimAuthorized()) return false;
    if (!email.startsWith(RWT_ACCOUNT_PREFIX)) throw new Error('refusing to mark an account this run does not own');
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error) throw new Error(`UID/email cross-check failed (fail closed): ${error.code ?? 'unknown'}`);
    if ((data.user?.email ?? '').toLowerCase() !== email.toLowerCase()) throw new Error('captured UID does not match the created email (fail closed)');
    const { error: updateError } = await admin.auth.admin.updateUserById(uid, { app_metadata: { canary: true } });
    if (updateError) throw new Error(`canary claim could not be set (fail closed): ${updateError.code ?? 'unknown'}`);
    return true;
}

/**
 * Telemetry classes, reported separately (PM ruling): the pre-claim signup stage is `user`; the journey after the
 * claim is `canary`. Rows only — the readback of each journey is a workflow step.
 */
/**
 * `qualifies` (#1532 Codex P1 r4121232394): a suite that qualifies no journey (the returning-user navigation suite never
 * claims and declares no stages) writes no canary-class or received rows — they could only ever be HOLD by construction,
 * which would make its receipt permanently INCOMPLETE. Its journeys are still reported by the readback step.
 */
export function telemetryClassRows(receipt: RwtReceipt, tap: AnalyticsTap, claimed: boolean, qualifies = true): { canaryJourneys: string[]; userJourneys: string[] } {
    const canaryJourneys = tap.journeyIds('canary');
    const userJourneys = tap.journeyIds('user');
    // Codex r4199883459: the claim is limited to bodies the browser EXPOSES; Blob beacons are counted, never claimed decoded.
    receipt.row('telemetry decodable', tap.undecodable === 0 && tap.events.length > 0 ? 'PASS' : 'FAIL',
        tap.blindBeacons === 0 ? 'every analytics body decoded'
            : `every exposed analytics body decoded; ${tap.blindBeacons} beacon body(ies) not exposed by the browser (not claimed — the received readback decides)`,
        { events: tap.events.length, undecodable: tap.undecodable, blindBeacons: tap.blindBeacons });
    receipt.row('signup-stage telemetry (user class)', userJourneys.length > 0 ? 'PASS' : 'HOLD',
        'pre-claim signup events were sent as ordinary user traffic (sent, not yet received)',
        { userEvents: tap.events.filter((e) => e.trafficType === 'user').length, userJourneys: userJourneys.length });
    receipt.row('signup-stage telemetry received', 'HOLD', 'reported by the report-only user-stage readback step (received counts per family; never qualifying)');
    if (!qualifies) return { canaryJourneys, userJourneys };
    if (!claimed) {
        receipt.row('journey telemetry (canary class)', 'HOLD', 'the canary claim was not authorized for this run; no journey is readback-eligible');
    } else {
        const stray = tap.trafficTypes().filter((t) => t !== 'user' && t !== 'canary');
        receipt.row('journey telemetry (canary class)', canaryJourneys.length > 0 && stray.length === 0 ? 'PASS' : 'FAIL',
            canaryJourneys.length > 0 ? 'post-claim journey events were sent as canary' : 'no canary-class journey after the claim',
            { canaryEvents: tap.events.filter((e) => e.trafficType === 'canary').length, canaryJourneys: canaryJourneys.length, otherClasses: stray.join(',') });
    }
    receipt.row('journey telemetry received', 'HOLD', 'proven by the readback step and merged at finalization (pnpm rwt:finalize --readback)');
    return { canaryJourneys, userJourneys };
}

/**
 * FIRST-VISIT IDENTITY (PM contract #1258 §3). Immediately after signup — and regardless of any canary claim — the
 * captured UID must belong to exactly the address this run minted, and the signup must have produced its profile.
 * Returns failures, content-free; the caller turns any failure into a hard stop before the journey writes anything else.
 */
export async function runOwnedIdentityFailures(
    admin: {
        auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null }; error: { code?: string } | null }> } };
        from: (table: string) => { select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: { code?: string } | null }> } } };
    },
    uid: string,
    email: string,
): Promise<string[]> {
    const failures: string[] = [];
    if (!email.startsWith(RWT_ACCOUNT_PREFIX)) failures.push('the account is not run-owned');
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error) failures.push(`UID lookup failed (${error.code ?? 'unknown'})`);
    else if ((data.user?.email ?? '').toLowerCase() !== email.toLowerCase()) failures.push('captured UID does not match the created email');
    const { data: profile, error: pErr } = await admin.from('user_profiles').select('id').eq('id', uid).maybeSingle();
    if (pErr) failures.push(`profile lookup failed (${pErr.code ?? 'unknown'})`);
    else if (!profile) failures.push('signup produced no user profile');
    return failures;
}

/**
 * ENTITLEMENT AS THE PRODUCT SAW IT. Captures the `check-usage-limit` responses the page itself received (closed
 * fields only), the same server authority `three-session-retention-proof` reads. A new account must be allowed to
 * start and must have room for this journey's recordings; the decision reuses `evaluateThreeRecordingEntitlement`.
 */
export class EntitlementTap {
    readonly responses: Array<{ can_start?: unknown; is_pro?: unknown; trial_active?: unknown; trial_seconds_remaining?: unknown }> = [];
    private readonly pending: Array<Promise<void>> = [];

    attach(page: Page): void {
        page.on('response', (res) => {
            let fn = '';
            try { fn = new URL(res.url()).pathname.split('/').pop() ?? ''; } catch { fn = ''; }
            if (fn !== 'check-usage-limit') return;
            this.pending.push(res.json().then((b) => {
                const body = (b ?? {}) as Record<string, unknown>;
                this.responses.push({
                    can_start: body.can_start, is_pro: body.is_pro,
                    trial_active: body.trial_active, trial_seconds_remaining: body.trial_seconds_remaining,
                });
            }, () => undefined));
        });
    }

    async settle(): Promise<void> { await Promise.all(this.pending); }
}

/**
 * The pre-credential surface: exact origin, exact deployed SHA, no test/mock injection — and, first, the app's own
 * centralized readiness authority (`data-app-visible-ready`; #1532 Codex P1 r4105978609): a visible form on a route the
 * app has not committed is not an approved surface. Returns failures, content-free.
 */
export async function approvedSurfaceFailures(page: Page): Promise<string[]> {
    const appVisibleReady = await waitForAppVisibleReady(page, 45_000).then(() => true, () => false);
    const surface = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string; __APP_RUNTIME_CONFIG__?: { testMode?: boolean } };
        return {
            origin: location.origin,
            release: w.__APP_RELEASE__ ?? null,
            testMode: w.__APP_RUNTIME_CONFIG__?.testMode ?? false,
            injected: Object.keys(w).some((k) => /__E2E|__MOCK|__MSW|TEST_MODE/i.test(k)),
        };
    });
    const failures: string[] = [...surfaceReadinessFailures(appVisibleReady)];
    if (surface.origin !== APPROVED_ORIGIN) failures.push('origin is not the approved Production origin');
    if (surface.release !== expectedReleaseSha()) failures.push(`deployed release ${String(surface.release)} != EXPECTED_RELEASE_SHA`);
    if (surface.injected) failures.push('a test/mock injection surface is present');
    if (surface.testMode) failures.push('runtime config is in test mode');
    return failures;
}

/**
 * The pre-write surface preflight (PM 5881740741). A refused surface halts the receipt before any Production write, so
 * every later row is HOLD "not reached" rather than a zero-count FAIL, and then raises the named HOLD.
 */
export async function requireApprovedSurface(page: Page, receipt: RwtReceipt): Promise<void> {
    const surface = await approvedSurfaceFailures(page);
    if (surface.length === 0) return;
    receipt.halt('surface preflight', `HOLD before any Production write: ${surface.join('; ')}`);
    throw new Error(`HOLD surface: ${surface.join('; ')}`);
}

/**
 * Playwright writes `error-context.md` (a full DOM snapshot) on failure unless an attachment of that name already
 * exists. After signup the DOM holds transcript and coaching text, so a content-free one is attached up front.
 */
export async function suppressPageSnapshot(testInfo: TestInfo): Promise<void> {
    await testInfo.attach('error-context', {
        contentType: 'text/markdown',
        body: '# Page snapshot suppressed\n\nThis journey runs against an authenticated Production session whose DOM holds '
            + 'transcript and coaching text. The failure reason is in the receipt and the assertion message, both content-free.',
    });
}

/**
 * Counts microphone acquisitions (time only, no stream data). Open Mic's contract is that visiting a page never
 * opens the microphone; only the person's explicit consent/Start does.
 */
export async function installMicAcquisitionCounter(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const marks: number[] = [];
        const streams: MediaStream[] = [];
        const w = window as unknown as { __rwtMicAcquisitions__?: number[]; __rwtMicStreams__?: MediaStream[] };
        w.__rwtMicAcquisitions__ = marks;
        w.__rwtMicStreams__ = streams; // references only, to read track readyState; never audio data
        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) return;
        const original = media.getUserMedia.bind(media);
        media.getUserMedia = (constraints?: MediaStreamConstraints) => {
            const audio = Boolean(constraints && (constraints as { audio?: unknown }).audio);
            if (audio) marks.push(Date.now());
            return original(constraints).then((stream) => { if (audio) streams.push(stream); return stream; });
        };
    });
}

/** Audio tracks the page acquired that are still live. Zero means the microphone is really off. */
export async function liveMicTracks(page: Page): Promise<number> {
    return page.evaluate(() => ((window as unknown as { __rwtMicStreams__?: MediaStream[] }).__rwtMicStreams__ ?? [])
        .flatMap((stream) => stream.getAudioTracks())
        .filter((track) => track.readyState === 'live').length);
}

export async function micAcquisitions(page: Page): Promise<number[]> {
    return page.evaluate(() => ((window as unknown as { __rwtMicAcquisitions__?: number[] }).__rwtMicAcquisitions__ ?? []).slice());
}

export const sha256Hex = (value: unknown): string => createHash('sha256').update(String(value ?? '')).digest('hex');

export interface SentEvent {
    event: string;
    at: number;
    /** #1258 R11: when the PAGE captured the event (PostHog `timestamp` / `$time`), so order survives flush reordering. */
    capturedAt?: number;
    /**
     * #1258 R11 (Browser PM RETURN 6145711360): which decoded PostHog request carried the event, and its position in that
     * payload. One payload is the page's FIFO queue at flush, so position within it IS capture order; arrival order across
     * payloads is not. Memory only, like `journeyId`.
     */
    batch?: number;
    batchIndex?: number;
    /**
     * #1258 R11 (PM RETURN 6144366004): `ai_coaching_diagnostic` only — the opaque request id and the closed outcome, so a
     * later `practice_loop_review_failed` can be bound to ITS request. In memory like `journeyId`; never in OUTCOME_FIELDS,
     * whose keys can reach receipt evidence.
     */
    diagnosticRequestId?: string;
    diagnosticOutcome?: string;
    /**
     * #1258 (Codex P2 r4286195504, PM 6198278021): `model_attribution_receipt` only — the take it SETTLED (`subject_*`).
     * A Retry Save can settle take A while take B is current, so the envelope names B; the subject names A
     * (telemetryAllowlist contract, completenessGate binding). In memory like `journeyId`; never written to a receipt.
     */
    subjectJourneyId?: string;
    subjectAttemptId?: string;
    journeyId?: string;
    attemptId?: string;
    bootId?: string;
    releaseSha?: string;
    trafficType?: string;
    /** Closed enums / opaque ids only — never content. */
    reason?: string;
    stage?: string;
    /** Closed route-transition fields retained only to bind a later action before its own event is sent. */
    journeyStep?: string;
    toRoute?: string;
    /** `private_model_acquisition_success` timing only (integers and closed enums; v12 download-vs-setup row). */
    acquisition?: AcquisitionTiming;
    /** #1258: closed enum / integer fields of the outcome events (OUTCOME_FIELDS only) — never content. */
    fields?: Readonly<Record<string, string | number | boolean>>;
}

/** #1258 (#1563): the ONLY properties kept from these events, so a press can be paired with its arrival and a feedback
 * attempt with its outcome inside the receipt. Every key is a governed closed enum or bounded integer. */
export const OUTCOME_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    saved_review_practice_action: ['action', 'action_seq', 'intended_route', 'link_state'],
    saved_review_practice_arrived: ['action_seq', 'route_class'],
    saved_review_linked_attempt: ['outcome', 'action_seq', 'intended_route'],
    feedback_submit: ['outcome', 'submit_seq', 'error_category'],
});
function outcomeFields(event: string, props: Record<string, unknown>): SentEvent['fields'] {
    const keys = OUTCOME_FIELDS[event];
    if (!keys) return undefined;
    const kept: Record<string, string | number | boolean> = {};
    for (const key of keys) {
        const v = props[key];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') kept[key] = v;
    }
    return kept;
}

/**
 * #1258 (RWT run 37514078995, F2): a "sent" row may FAIL only when the tap could read every PostHog body that could carry
 * the event. posthog-js flushes its queue on page-hide with `navigator.sendBeacon(url, new Blob([body]))`, and Chromium
 * exposes no body for a Blob beacon — neither `postDataBuffer()` nor CDP `Network.getRequestPostData` (verified locally).
 * Those events DID leave the page (PostHog received `feedback_submit` and `session_pdf_downloaded` that the tap reported as
 * unsent), so an event missing while a beacon that could carry it was blind is missing EVIDENCE — HOLD, decided by the
 * received readback — never FAIL.
 * Codex r4199883470: only a blind beacon sent AT OR AFTER the step that emits the event can carry it, so `sinceMs` scopes
 * the uncertainty: an earlier reload's blind beacon never turns a later genuine absence into HOLD.
 */
type BlindTimes = Pick<AnalyticsTap, 'blindAt'>;
const blindSince = (tap: BlindTimes, sinceMs: number): number => tap.blindAt.filter((t) => t >= sinceMs).length;
export function sentVerdict(allSeen: boolean, tap: BlindTimes, sinceMs: number): 'PASS' | 'FAIL' | 'HOLD' {
    if (allSeen) return 'PASS';
    return blindSince(tap, sinceMs) > 0 ? 'HOLD' : 'FAIL';
}
/**
 * #1258 (#1570, Codex r4201644107; CLI PM option 1a, 6029321428) — a blind HOLD is settled only by RECEIVED evidence the
 * finalizer can actually read: `receivedBy` names the qualification stages whose readback requires these events
 * (`QUALIFICATION_STAGES` in completenessGate.ts). Rows whose events no stage receives say so and stay HOLD.
 */
export function sentDetail(detail: string, allSeen: boolean, tap: BlindTimes, sinceMs: number, receivedBy: readonly string[] = []): string {
    const blind = blindSince(tap, sinceMs);
    if (allSeen || blind === 0) return detail;
    const unseen = `${detail} — not seen, but ${blind} PostHog beacon(s) sent after this step carried a body the browser does not expose`;
    return receivedBy.length > 0
        ? `${unseen}; settled at finalization only if every bound journey declaring ${receivedBy.join(', ')} qualifies in the PostHog readback`
        : `${unseen}; no readback stage receives these events, so this row stays HOLD`;
}

/** Flat evidence that lets `finalizeReceipt --readback` settle this row's blind HOLD from the named received stages. */
export function readbackSettlement(receivedBy: readonly string[], tap: BlindTimes, sinceMs: number): { receivedByStages: string; blindSinceStep: number } {
    return { receivedByStages: receivedBy.join(','), blindSinceStep: blindSince(tap, sinceMs) };
}

/**
 * #1258 (#1570, Codex r4200925124) — an EXACT-count "sent" claim (e.g. "the Analytics revisit generated no second review")
 * is proven only when no beacon that could carry an extra event was blind. Counted between `fromMs` (the step that starts
 * the window, e.g. Stop) and `toMs` (when the count was snapshotted): an observed EXTRA is definitive (FAIL); the expected
 * count — or fewer — with an in-window blind beacon is unproven (HOLD); the expected count with every body exposed PASSes.
 */
export function exactCountVerdict(count: number, expected: number, tap: BlindTimes, fromMs: number, toMs: number): 'PASS' | 'FAIL' | 'HOLD' {
    if (count > expected) return 'FAIL';
    const blind = tap.blindAt.filter((t) => t >= fromMs && t <= toMs).length;
    if (blind > 0) return 'HOLD';
    return count === expected ? 'PASS' : 'FAIL';
}

/** An Analytics page path (`/analytics`, `/analytics/<id>`, or the app's normalized `/analytics/id`); anything else is not. */
export function analyticsRoute(path: string | null | undefined): boolean {
    return typeof path === 'string' && /^\/analytics(\/[^/]+)?\/?$/.test(path);
}

/**
 * #1258 smoke item 2 (PM 6182446740) — the closed HTTP outcome of ONE PostHog request, taken from that same Playwright
 * request object. A `2xx` is an HTTP acknowledgement, NOT proof of ingestion. `failed`/`aborted` only when the browser
 * reported that request failed; `pending` while no outcome is known; `unobservable` when capture ended first.
 */
export type TransportOutcome = '2xx' | '3xx' | '4xx' | '5xx' | 'other_status' | 'failed' | 'aborted' | 'pending' | 'unobservable';
/** One PostHog request the tap saw carry events (decoded) or an opaque body (blind), and its outcome. Names only. */
export interface BatchTransport {
    /** Every decoded batch number taken from this request (a repeated attach decodes the same request again). */
    batches: number[]; names: string[]; blind: boolean; outcome: TransportOutcome;
}
export function statusClass(status: number | null | undefined): TransportOutcome {
    if (typeof status !== 'number' || !Number.isInteger(status)) return 'other_status';
    return status >= 200 && status < 300 ? '2xx' : status >= 300 && status < 400 ? '3xx'
        : status >= 400 && status < 500 ? '4xx' : status >= 500 && status < 600 ? '5xx' : 'other_status';
}
/** A request failure reported by the browser: an abort only when its error text says so; anything else is a failure. */
export function failureClass(errorText: string | null | undefined): TransportOutcome {
    return typeof errorText === 'string' && /ERR_ABORTED|NS_BINDING_ABORTED|\babort/i.test(errorText) ? 'aborted' : 'failed';
}

/**
 * The take a decoded event belongs to, for transport evidence. `model_attribution_receipt` is bound by its SUBJECT take
 * (Codex P2 r4286195504) — and only by a complete subject identity: an absent or partial subject is unbound, never
 * rescued by the envelope. Every other family is bound by its envelope journey/attempt.
 */
function transportIdentityOf(e: SentEvent): { journeyId: string; attemptId: string } | null {
    const [journeyId, attemptId] = e.event === 'model_attribution_receipt' ? [e.subjectJourneyId, e.subjectAttemptId] : [e.journeyId, e.attemptId];
    return journeyId && attemptId ? { journeyId, attemptId } : null;
}

/** Reads correlation keys from the page's own PostHog requests. "Sent", not "received". */
export class AnalyticsTap {
    /** #1258 smoke item 2: every event-carrying PostHog request and its outcome, in send order (retries are new entries). */
    readonly transports: BatchTransport[] = [];
    private readonly transportByRequest = new Map<Request, BatchTransport>();
    private listeners: Array<[string, (...args: never[]) => void]> = [];
    private attachedTo: Page | null = null;
    /** PM 6182647952 §2: transport capture is open only between `attach` and `detachTransport`; a callback started under one
     * capture never writes after it closed (the generation it captured no longer matches). */
    private transportOpen = false;
    private transportGeneration = 0;
    readonly events: SentEvent[] = [];
    readonly actionBindings: ReadbackActionBinding[] = [];
    /** #1258 F3: every capture attempt's closed outcome, so a missing binding says WHY in the receipt (content-free). */
    readonly actionCaptures: ActionCaptureAttempt[] = [];
    undecodable = 0;
    /** #1258 R11: sequence number of decoded event payloads, so each event keeps its batch (see `SentEvent.batch`). */
    private batchSeq = 0;
    /** PostHog POSTs whose body the browser does not expose (a Blob `sendBeacon` on page-hide). See `sentVerdict`. */
    blindBeacons = 0;
    /** When each blind request was sent (ms), so uncertainty is scoped to the step that could have produced it. */
    readonly blindAt: number[] = [];
    /** The latest main-frame document load (ms) and its path: every boot after it is the page the person is on now. */
    documentAt = 0;
    documentPath: string | null = null;

    noteDocument(url: string, at = Date.now()): void {
        this.documentAt = at;
        try { this.documentPath = new URL(url).pathname; } catch { this.documentPath = null; }
    }

    attach(page: Page): void {
        // A repeated attach replaces the outcome listeners instead of stacking a second set.
        this.removeTransportListeners();
        this.attachedTo = page;
        this.transportOpen = true;
        const generation = ++this.transportGeneration;
        const live = () => this.transportOpen && this.transportGeneration === generation;
        // Smoke item 2: the outcome is read from the SAME request object the batch was decoded from.
        const onFinished = (request: Request) => {
            const transport = this.transportByRequest.get(request);
            if (!transport || !live()) return;
            // The response may resolve after capture closed: only a still-open capture may write it.
            void request.response().then((response) => { if (live()) transport.outcome = response ? statusClass(response.status()) : 'unobservable'; })
                .catch(() => { if (live()) transport.outcome = 'unobservable'; });
        };
        const onFailed = (request: Request) => {
            const transport = this.transportByRequest.get(request);
            if (!transport || !live()) return;
            let text: string | null = null;
            try { text = request.failure()?.errorText ?? null; } catch { text = null; }
            transport.outcome = failureClass(text);
        };
        page.on('requestfinished', onFinished);
        page.on('requestfailed', onFailed);
        this.listeners.push(['requestfinished', onFinished as never], ['requestfailed', onFailed as never]);
        page.on('request', (request) => {
            let mainDocument = false;
            try { mainDocument = request.isNavigationRequest() && request.frame() === page.mainFrame(); } catch { mainDocument = false; }
            if (mainDocument) { this.noteDocument(request.url()); return; }
            let host = '';
            try { host = new URL(request.url()).host; } catch { host = ''; }
            if (!/posthog\.com$/i.test(host)) return;
            const body = request.postDataBuffer();
            // A blind POST is an event beacon too, so it also marks a flush; non-event requests (flags, recorder) never do.
            if (request.method() === 'POST' && (!body || body.length === 0)) {
                this.blindBeacons += 1; this.blindAt.push(Date.now()); this.notePosthogRequest();
                this.track(request, { batches: [], names: [], blind: true, outcome: 'pending' });
                return;
            }
            const before = this.events.length;
            const batch = ++this.batchSeq;
            let batchIndex = 0;
            for (const entry of this.decode(body)) {
                const record = entry as { event?: unknown; properties?: Record<string, unknown>; timestamp?: unknown };
                if (typeof record?.event !== 'string') continue;
                const props = record.properties ?? {};
                const text = (key: string) => (typeof props[key] === 'string' ? props[key] as string : undefined);
                const capturedAt = typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp)) ? Date.parse(record.timestamp)
                    : typeof props.$time === 'number' && Number.isFinite(props.$time) ? Math.round(props.$time * 1000) : undefined;
                this.events.push({
                    event: record.event,
                    at: Date.now(),
                    batch,
                    batchIndex: batchIndex++,
                    ...(capturedAt === undefined ? {} : { capturedAt }),
                    ...(record.event === 'ai_coaching_diagnostic' ? { diagnosticRequestId: text('diagnostic_request_id'), diagnosticOutcome: text('outcome') } : {}),
                    ...(record.event === 'model_attribution_receipt'
                        ? { subjectJourneyId: text('subject_journey_id'), subjectAttemptId: text('subject_attempt_id') } : {}),
                    journeyId: text('journey_id'),
                    attemptId: text('attempt_id'),
                    bootId: text('boot_id'),
                    releaseSha: text('release_sha'),
                    trafficType: text('traffic_type'),
                    reason: text('reason'),
                    stage: text('stage'),
                    journeyStep: text('step'),
                    toRoute: text('to_route'),
                    ...(OUTCOME_FIELDS[record.event] ? { fields: outcomeFields(record.event, props) } : {}),
                    ...(record.event === 'private_model_acquisition_success' ? { acquisition: {
                        cacheResult: text('cache_result'), completeness: text('measurement_completeness'),
                        downloadMs: typeof props.download_ms === 'number' ? props.download_ms : null,
                        initMs: typeof props.init_ms === 'number' ? props.init_ms : null,
                        totalMs: typeof props.total_ms === 'number' ? props.total_ms : null,
                    } } : {}),
                });
            }
            if (this.events.length > before) {
                this.notePosthogRequest();
                this.track(request, { batches: [batch], names: this.events.slice(before).map((e) => e.event), blind: false, outcome: 'pending' });
            }
        });
    }

    private track(request: Request, transport: BatchTransport): void {
        // After capture closed no new transport record is made; the sent-event capture itself is unchanged.
        if (!this.transportOpen) return;
        // The SAME request decoded again (a repeated attach) joins its existing record — one request, one outcome.
        const existing = this.transportByRequest.get(request);
        if (existing) { existing.batches.push(...transport.batches); return; }
        this.transports.push(transport);
        this.transportByRequest.set(request, transport);
    }

    private removeTransportListeners(): void {
        if (this.attachedTo) for (const [name, fn] of this.listeners) this.attachedTo.off(name as 'requestfinished', fn as never);
        this.listeners = [];
    }

    /**
     * Smoke item 2: stop listening for outcomes; every request still `pending` becomes `unobservable` — capture ended before
     * the browser reported it, which is never read as delivered or as lost.
     */
    detachTransport(): void {
        this.transportOpen = false;
        this.transportGeneration += 1;
        this.removeTransportListeners();
        this.attachedTo = null;
        for (const t of this.transports) if (t.outcome === 'pending') t.outcome = 'unobservable';
    }

    /**
     * Content-free transport evidence for named event families of ONE take: for each, the outcome of the request that
     * carried each of that take's decoded events, as `outcome:count` sorted (`none` when none was decoded; `take_unknown`
     * when the take's identity is unknown). Opaque (blind) requests are counted separately: they may have carried any
     * family, so they can never prove one was or was not sent.
     */
    transportEvidence(take: { journeyId: string; attemptId: string } | null, names: readonly string[]): Record<string, string | number> {
        // PM 6182647952 §1: ONLY the selected take's own decoded events — the exact journey AND attempt its `session_started`
        // named (`takeStartedAfter`) — each mapped back through its batch to the request that carried it. Never inferred from
        // the event name or the newest take; a mixed batch contributes its outcome for the selected events only.
        const out: Record<string, string | number> = {};
        const byBatch = new Map<number, BatchTransport>();
        for (const t of this.transports) for (const b of t.batches) byBatch.set(b, t);
        for (const name of names) {
            if (!take) { out[`transport_${name}`] = 'take_unknown'; continue; }
            // Counted per distinct REQUEST, so a decoded duplicate of one request never counts twice.
            const requests = new Set<BatchTransport>();
            let untracked = 0;
            for (const e of this.events) {
                const id = transportIdentityOf(e);
                if (e.event !== name || !id || id.journeyId !== take.journeyId || id.attemptId !== take.attemptId || e.batch === undefined) continue;
                const transport = byBatch.get(e.batch);
                if (transport) requests.add(transport); else untracked += 1;
            }
            const counts = new Map<TransportOutcome, number>();
            for (const r of requests) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
            if (untracked > 0) counts.set('unobservable', (counts.get('unobservable') ?? 0) + untracked);
            out[`transport_${name}`] = counts.size === 0 ? 'none' : [...counts].map(([o, n]) => `${o}:${n}`).sort().join(',');
        }
        // Same-family events that carry no journey/attempt identity cannot be attributed to any take: counted, never bound.
        out.transport_unbound_events = this.events.filter((e) => names.includes(e.event) && !transportIdentityOf(e)).length;
        const blind = this.transports.filter((t) => t.blind);
        out.transport_blind_requests = blind.length;
        out.transport_blind_outcomes = blind.length === 0 ? 'none'
            : [...blind.reduce((m, t) => m.set(t.outcome, (m.get(t.outcome) ?? 0) + 1), new Map<TransportOutcome, number>())].map(([o, n]) => `${o}:${n}`).sort().join(',');
        return out;
    }

    /** Same encodings as the practice-loop journey: JSON, form `data=` (base64, maybe gzip), gzip, deflate, base64. */
    private decode(raw: Buffer | null): unknown[] {
        if (!raw || raw.length === 0) return [];
        const attempts: Array<() => unknown> = [
            () => JSON.parse(raw.toString('utf8')),
            () => {
                const data = new URLSearchParams(raw.toString('utf8')).get('data');
                if (!data) throw new Error('no data field');
                const decoded = Buffer.from(data, 'base64');
                try { return JSON.parse(gunzipSync(decoded).toString('utf8')); } catch { /* not gzipped */ }
                return JSON.parse(decoded.toString('utf8'));
            },
            () => JSON.parse(gunzipSync(raw).toString('utf8')),
            () => JSON.parse(inflateSync(raw).toString('utf8')),
            () => JSON.parse(Buffer.from(raw.toString('utf8'), 'base64').toString('utf8')),
        ];
        for (const attempt of attempts) {
            try {
                const parsed = attempt();
                return Array.isArray(parsed) ? parsed : [parsed];
            } catch { /* next encoding */ }
        }
        this.undecodable += 1;
        return [];
    }

    sent(event: string): SentEvent[] { return this.events.filter((e) => e.event === event); }

    /** #1258 F3: when the page last sent a PostHog request (decoded or blind), so `settleQueuedTelemetry` sees a flush. */
    lastPosthogRequestAt = 0;
    notePosthogRequest(at = Date.now()): void { this.lastPosthogRequestAt = at; }

    /**
     * #1258 F3 (run 38104864048, PostHog readback 6108757201): PostHog batches events for ~3 s, so right after a reload
     * the CURRENT boot's positive control and its latest route were still queued in the page when the PDF click and the
     * feedback submit happened (control emitted 02:23:23.362, sent 02:23:26.307; both actions before that). The capture
     * then found no current-boot control and refused. Before an action, wait — bounded — until PostHog has flushed
     * whatever was queued: the first request sent after `started` carries the whole queue (plus a short grace for a
     * sibling batch request of the same flush), or, when nothing was queued, a quiet period longer than the flush
     * interval. Identity is still snapshotted BEFORE the action's own anchor exists.
     */
    async settleQueuedTelemetry(
        wait: (ms: number) => Promise<unknown>,
        opts: { quietMs?: number; graceMs?: number; pollMs?: number; now?: () => number } = {},
    ): Promise<'flushed' | 'quiet'> {
        const { quietMs = 5_000, graceMs = 500, pollMs = 100, now = Date.now } = opts;
        const started = now();
        while (now() - started < quietMs) {
            if (this.lastPosthogRequestAt > started) {
                await wait(graceMs);
                return 'flushed';
            }
            await wait(pollMs);
        }
        return 'quiet';
    }

    /**
     * #1258 R8/R9 (PM review): before a journey leaves the page or ends, wait — BOUNDED — until the tap has OBSERVED the
     * events this step must have sent, and say whether it did. One elapsed batching interval is not delivery proof.
     * PostHog batches for ~3 s; scenario 1 navigated 0.9 s after Share Feedback and scenario 4 ended under 7 s after
     * sign-in, before their events were seen. An offline Chromium + posthog-js 1.298.1 run showed events captured < 3 s
     * before a page or context close were never sent. Staying until the events are observed lets them leave on the
     * ordinary flush this tap decodes. `observed` false is reported, never converted into PASS. Never throws.
     */
    async awaitObserved(
        page: Pick<Page, 'waitForTimeout' | 'isClosed'>, expected: Readonly<Record<string, number>>, opts: { timeoutMs?: number; pollMs?: number } = {},
    ): Promise<{ observed: boolean; missing: string[] }> {
        const { timeoutMs = 8_000, pollMs = 100 } = opts;
        const missing = () => Object.entries(expected).filter(([event, count]) => this.sent(event).length < count).map(([event]) => event);
        const deadline = Date.now() + timeoutMs;
        while (missing().length > 0 && Date.now() < deadline && !page.isClosed()) {
            try { await page.waitForTimeout(pollMs); } catch { break; }
        }
        const left = missing();
        return { observed: left.length === 0, missing: left };
    }

    /** `captureActionBinding` after `settleQueuedTelemetry` — what live call sites use before the feedback/PDF action. */
    async captureActionBindingSettled(
        page: Pick<Page, 'waitForTimeout' | 'url'>, stage: ReadbackActionStage, releaseSha: string, runId: string, runAttempt: string,
    ): Promise<ReadbackActionBinding | null> {
        await this.settleQueuedTelemetry((ms) => page.waitForTimeout(ms));
        return this.captureActionBinding(stage, releaseSha, runId, runAttempt, page.url());
    }

    /**
     * Snapshot the current Analytics journey immediately BEFORE the feedback/PDF event is serialized.
     * The identity must already be visible on decoded events of the CURRENT boot; the action anchor is deliberately not
     * consulted, so a blind Blob beacon cannot erase the readback target or supply its own identity.
     * #1570 Codex P1 r4212726964: the current boot is the one whose positive control was sent after the latest document
     * load. A hard reload emits no `route_change` on its first render, so a boot without one is bound to the journey its
     * own positive control carries (entered directly on Analytics) — never to the pre-reload boot's route.
     */
    captureActionBinding(stage: ReadbackActionStage, releaseSha: string, runId: string, runAttempt: string, pageUrl: string): ReadbackActionBinding | null {
        const refuse = (outcome: Exclude<ActionCaptureOutcome, 'captured'>): null => {
            this.actionCaptures.push({ stage, outcome, at: Date.now() });
            return null;
        };
        if (!/^[a-f0-9]{40}$/.test(releaseSha) || !/^\d{1,20}$/.test(runId) || !/^\d{1,4}$/.test(runAttempt)) return refuse('invalid_identity_input');
        let pagePath: string | null = null;
        try { pagePath = new URL(pageUrl).pathname; } catch { pagePath = null; }
        if (!analyticsRoute(pagePath)) return refuse('not_analytics_page');
        const control = [...this.events].reverse().find((e) => e.event === 'telemetry_positive_control'
            && e.at >= this.documentAt && e.trafficType === 'canary' && e.releaseSha === releaseSha);
        if (!control?.bootId || !control.journeyId) return refuse('no_current_boot_control');
        const route = [...this.events].reverse().find((e) => e.event === 'journey_step' && e.journeyStep === 'route_change'
            && e.bootId === control.bootId);
        let journeyId: string | undefined;
        let entry: ReadbackActionBinding['entry'];
        if (route) {
            if (!analyticsRoute(route.toRoute) || route.releaseSha !== releaseSha || route.trafficType !== 'canary') return refuse('route_not_analytics');
            journeyId = route.journeyId;
            entry = 'route_change';
        } else {
            if (!analyticsRoute(this.documentPath)) return refuse('boot_not_on_analytics');
            journeyId = control.journeyId;
            entry = 'boot_load';
        }
        if (!journeyId) return refuse('no_journey');
        const binding: ReadbackActionBinding = {
            stage, journeyId, bootId: control.bootId, releaseSha,
            trafficType: 'canary', runId, runAttempt, entry, capturedAt: Date.now(),
        };
        this.actionBindings.push(binding);
        this.actionCaptures.push({ stage, outcome: 'captured', at: binding.capturedAt });
        return binding;
    }
    /** Journeys to read back. With a class, only journeys whose events carried it (the pre-claim signup is `user`). */
    journeyIds(trafficType?: string): string[] {
        return [...new Set(this.events
            .filter((e) => trafficType === undefined || e.trafficType === trafficType)
            .map((e) => e.journeyId).filter((v): v is string => Boolean(v)))];
    }
    trafficTypes(): string[] { return [...new Set(this.events.map((e) => e.trafficType).filter((v): v is string => Boolean(v)))]; }
}

/** The runtime's own identity accessor — the model that ACTUALLY ran, never the configured intent. */
export async function readSttIdentity(page: Page): Promise<Record<string, unknown> | null> {
    return page.evaluate(() => {
        const w = window as unknown as { __STT_IDENTITY__?: () => Record<string, unknown> };
        try { return w.__STT_IDENTITY__ ? w.__STT_IDENTITY__() : null; } catch { return null; }
    });
}

/**
 * #1258 (Open Mic Stop stall, #1546): the CPU engine's thread configuration as the page reports it — numbers and a flag
 * only, never content. Recorded as evidence on the model-identity row so a rerun can be read against the thread policy
 * that actually ran (reported hardware threads, isolation, and the threads the worker configured). Diagnostic only: it
 * changes no verdict.
 */
export async function readCpuRuntime(page: Page): Promise<Record<string, number | boolean | null>> {
    return page.evaluate(() => {
        const w = window as unknown as { __PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__?: Record<string, unknown> };
        const e = w.__PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__ ?? {};
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        return {
            hardwareConcurrency: num(navigator.hardwareConcurrency),
            crossOriginIsolated: globalThis.crossOriginIsolated === true,
            requestedThreads: num(e.requestedThreads),
            configuredThreads: num(e.configuredThreads),
            workerReportedThreads: num(e.workerReportedThreads),
        };
    }).catch(() => ({ hardwareConcurrency: null, crossOriginIsolated: null, requestedThreads: null, configuredThreads: null, workerReportedThreads: null }));
}

export const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;


/**
 * One product's receipt. A FAIL is recorded AND raised as a soft expectation, so the suite keeps collecting the
 * remaining rows and still ends red; a HOLD is recorded and never raised (it is not a pass and not a finding).
 */
export class RwtReceipt {
    readonly rows: ReceiptRow[] = [];
    readonly meta: Record<string, string | number | boolean | null> = {};
    /** Values this receipt must never publish (#1532 Codex P1 r4125567004); registered as soon as each exists. */
    private readonly forbidden = new Set<string>();

    constructor(readonly suite: string) {
        // #1258 PO 2026-10-12: the think-time this journey pressed with, so a reader knows human vs machine timing.
        this.meta.humanReflexMs = activeHumanReflexMs();
    }

    forbid(...values: Array<string | null | undefined>): void {
        for (const value of values) if (typeof value === 'string' && value.length > 3) this.forbidden.add(value);
    }

    /** The preflight step this journey stopped at, before any Production write; later rows are "not reached". */
    private haltedAt: string | null = null;

    /** Records a pre-write preflight HOLD. Every row recorded after it is HOLD "not reached" (`rowAfterHalt`). */
    halt(step: string, detail: string): void {
        this.rows.push({ step, verdict: 'HOLD', detail });
        this.haltedAt = step;
    }

    row(step: string, verdict: Verdict, detail: string, evidence?: ReceiptRow['evidence']): void {
        const recorded = rowAfterHalt({ step, verdict, detail, evidence }, this.haltedAt);
        this.rows.push(recorded);
        if (recorded.verdict === 'FAIL') expect.soft(recorded.verdict, `${step}: ${recorded.detail}`).toBe('PASS');
    }

    /**
     * #1532 Codex P1 r4119969323: the readback plan binds each stage set to the journey that exercised it
     * (`bindReadbackJourneys`). A required binding with no anchor event is a HOLD row here as well as in the workflow.
     */
    write(testInfo: TestInfo, plan: ReadbackPlan, trafficTypes: string[], userStageJourneyIds: string[] = []): void {
        if (plan.missingBindings.length > 0) {
            // #1258 F3: the closed reason per missing binding (e.g. `share_feedback=no_capture/no_current_boot_control`).
            const reasons = plan.missingBindings.map((label) => `${label}=${plan.bindingReasons?.[label] ?? 'unknown'}`).join(',');
            this.row('readback journey binding', 'HOLD', `no journey emitted the anchor for: ${plan.missingBindings.join(', ')}`,
                { missingBindings: plan.missingBindings.join(','), reasons, sequence: plan.bindingSequence ?? '' });
        }
        const journeyIds = runJourneyIds(plan);
        const dir = path.resolve('test-results', 'rwt');
        mkdirSync(dir, { recursive: true });
        const body = {
            suite: this.suite,
            release: expectedReleaseSha(),
            meta: this.meta,
            rows: this.rows,
            summary: {
                pass: this.rows.filter((r) => r.verdict === 'PASS').length,
                fail: this.rows.filter((r) => r.verdict === 'FAIL').length,
                hold: this.rows.filter((r) => r.verdict === 'HOLD').length,
                human: this.rows.filter((r) => r.verdict === 'HUMAN').length,
            },
            /**
             * PO 2026-09-25 — ACCEPTANCE, not a count. PASS only when every row passed, including every named human
             * observation (recorded PASS). Any open HOLD or HUMAN row makes it INCOMPLETE, so an all-green automated
             * part can never be read as a completed runbook. `automatedRowsAllPass` states the automated part alone.
             */
            ...receiptAcceptance(this.rows),
            // For the readback step: which journeys to read back, under which traffic class and declared stages.
            readback: {
                journeys: plan.journeys, reportedJourneyIds: plan.reportedJourneyIds, missingBindings: plan.missingBindings,
                trafficType: 'canary', trafficTypes, userStageJourneyIds,
            },
            testStatus: testInfo.status ?? null,
        };
        // The leak check runs HERE, over the final outputs, after every row (including the binding HOLD above) exists.
        const out = guardReceiptOutput({
            suite: this.suite, release: body.release, body, worksheet: humanWorksheet(this.suite, body.release, journeyIds, this.rows),
            forbidden: this.forbidden, testStatus: body.testStatus,
        });
        writeFileSync(path.join(dir, `${this.suite}.receipt.json`), out.receiptText);
        const worksheetPath = path.join(dir, `${this.suite}.human-worksheet.md`);
        if (out.worksheetText === null) rmSync(worksheetPath, { force: true });
        else writeFileSync(worksheetPath, out.worksheetText);
        console.log(out.logLine);
        if (out.leakCount > 0) {
            throw new Error(`RWT receipt contaminated: ${out.leakCount} registered value(s) found; only a redacted failure receipt was written`);
        }
    }
}

/**
 * A named human RWT observation. Content-free: the question and criterion are product copy, never the speech or the
 * coaching text. The run always writes it as `HUMAN` (to be judged — not a pass). The human records PASS/FAIL and an
 * observer in the run's worksheet, and `pnpm rwt:finalize` binds that worksheet to this receipt (suite, deployed SHA,
 * journey ids) and emits the final verdict. There is deliberately NO in-run shortcut: a result supplied during the
 * run would skip that binding.
 */
export function humanObservation(receipt: RwtReceipt, id: string, runbookRow: string, question: string, passCriterion: string): void {
    receipt.row(`human: ${question}`, 'HUMAN', 'named human RWT observation; record PASS/FAIL in this run\'s worksheet, then run pnpm rwt:finalize',
        { observationId: id, runbookRow, passCriterion, recorded: 'pending' });
}

/** v12 preflight: first-use model download vs engine setup timing, from the app's own acquisition receipt(s). */
export function acquisitionTimingRow(receipt: RwtReceipt, tap: AnalyticsTap, journeyIds: readonly string[]): void {
    // Bound to the deployed release and to this run's own journeys (PM 5860859136).
    const release = expectedReleaseSha();
    const own = tap.sent('private_model_acquisition_success')
        .filter((e) => e.releaseSha === release && typeof e.journeyId === 'string' && journeyIds.includes(e.journeyId));
    const v = acquisitionTimingVerdict(own.map((e) => e.acquisition ?? {}));
    receipt.row('model download vs setup timing', v.verdict, v.detail, v.evidence);
}

/** Serialized evidence must never carry these; a match is itself a FAIL row. */
export function receiptContentLeaks(receipt: RwtReceipt, forbidden: readonly string[]): string[] {
    receipt.forbid(...forbidden);   // write() re-checks the final outputs against every registered value
    const serialized = JSON.stringify({ meta: receipt.meta, rows: receipt.rows });
    return forbidden.filter((needle) => needle.length > 3 && serialized.includes(needle));
}

/**
 * WHICH MODEL THIS RUN TARGETS — through the repository's existing one-run switch, never a flag or default change.
 *
 * rc-gates.yml mints a per-run authorization for exactly one cell (`candidate/journey`, e.g. `v4:distil:q4/open_mic`)
 * when dispatched with `comparison_cell`. With no cell, the run records the DEPLOYED DEFAULT and labels it a
 * diagnostic. With a cell, the authorization is checked in Node against GitHub's own record of this run attempt
 * (the same check the #1437 journey uses) and the page is switched to that candidate. Any refusal is a named HOLD
 * — an operator/evidence state, never a finding about a model.
 *
 * Neither path proves the intended base_q4 primary: the switch cannot select base_q4 yet (PM 2026-09-24), so the
 * base_q4 row of every receipt stays HOLD.
 */
export type RunTarget =
    | { mode: 'default'; label: string }
    | { mode: 'switch'; target: string; label: string; authorization: unknown };

export async function resolveRunTarget(journey: 'open_mic' | 'focus_points'): Promise<RunTarget> {
    const file = process.env.MODEL_COMPARISON_AUTHORIZATION_FILE;
    if (!file) return { mode: 'default', label: 'deployed default (diagnostic)' };
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { throw new Error('HOLD comparison_authorization_unreadable'); }
    const { diagnosticAuthorizationFor } = await import('./practiceLoopJourney');
    const { checkRunAuthority, githubApiGetter, loadRunAuthority } = await import('../../../scripts/human-test/modelComparisonRunAuthority.mjs');
    const runId = process.env.GITHUB_RUN_ID ?? null;
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? null;
    const parsed = JSON.parse(text) as { candidateId?: unknown; journey?: unknown };
    if (parsed.journey !== journey) throw new Error(`HOLD comparison_authorization_wrong_journey (authorized ${String(parsed.journey)}, suite ${journey})`);
    let bundle = null;
    if (runId && /^\d{1,20}$/.test(runId) && runAttempt && /^\d{1,4}$/.test(runAttempt)) {
        try {
            bundle = await loadRunAuthority({
                runId: Number(runId),
                runAttempt: Number(runAttempt),
                githubGet: githubApiGetter({ token: process.env.MODEL_COMPARISON_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? null }),
                fetchRunArtifact: () => Promise.resolve(parsed),
            });
        } catch { bundle = null; }
    }
    const target = String(parsed.candidateId ?? '');
    const decision = diagnosticAuthorizationFor({
        authorizationText: text, runId, runAttempt, bundle, target, origin: APPROVED_ORIGIN, now: Date.now(), check: checkRunAuthority, journey,
    });
    if (!decision.ok) throw new Error(`HOLD ${decision.hold}: ${decision.problems.join('; ')}`);
    const label = target.startsWith('v4:') ? `${target} (comparison evidence, not the base_q4 primary)` : `${target} (diagnostic)`;
    return { mode: 'switch', target, label, authorization: decision.authority.authorization };
}

/** Arms the page (before navigating to /practice) and performs the guarded switch. Returns the switch outcome. */
export async function armCandidateSwitch(page: Page, run: RunTarget, authKey: string): Promise<void> {
    if (run.mode !== 'switch') return;
    await page.addInitScript(({ key, authorization }) => {
        if (location.pathname !== '/practice') return;
        Object.defineProperty(globalThis, Symbol.for(key), { value: authorization, enumerable: false, configurable: true, writable: false });
    }, { key: authKey, authorization: run.authorization });
}

export async function performCandidateSwitch(page: Page, run: RunTarget, journey: string): Promise<string> {
    if (run.mode !== 'switch') return 'not_requested';
    const installed = await expect.poll(async () => page.evaluate(
        () => typeof (window as unknown as { __SS_SWITCH_CANDIDATE__?: unknown }).__SS_SWITCH_CANDIDATE__,
    ), { timeout: 60_000 }).toBe('function').then(() => true).catch(() => false);
    if (!installed) return 'switch_surface_not_installed';
    return page.evaluate(async ({ id, j }) => {
        const w = window as unknown as { __SS_SWITCH_CANDIDATE__?: (c: string, jj: string) => Promise<{ ok: boolean; code?: string }> };
        const result = await w.__SS_SWITCH_CANDIDATE__!(id, j);
        return result.ok ? 'ok' : (result.code ?? 'unknown_failure');
    }, { id: run.target, j: journey });
}

/**
 * THE NEXT START (#1471 / #1521 pattern). From a fresh `/session`, the next take must begin without the Progress
 * hold: no "Finishing up your last session" at rest or during Start, recording within the ceiling, and the actual wait
 * reported. It must then STOP and the microphone must be confirmed OFF (every acquired audio track ended). A take
 * that cannot be stopped, or a microphone left live, is a failure (PM 2026-09-25) — never a successful next Start.
 * On any failure a bounded teardown is attempted before run-owned cleanup; its outcome is reported, not assumed.
 */
export async function nextStartEvidence(page: Page, label: string): Promise<{
    holdSeen: boolean; nextStartMs: number | null; stopped: boolean; liveTracksAfterStop: number | null; reason: string | null;
    startFailure: StartFailureState | null;
}> {
    const FINISHING_UP = /Finishing up your last session/;
    await page.goto('/session');
    try {
        await expect(page.getByTestId('mic-status')).toContainText('Mic ready on this device', { timeout: 60_000 });
    } catch {
        return { holdSeen: false, nextStartMs: null, stopped: false, liveTracksAfterStop: null, reason: 'the session page did not reach rest (mic-status)', startFailure: null };
    }
    let holdSeen = (await page.getByText(FINISHING_UP).count()) > 0;
    const watch = setInterval(() => {
        void page.getByText(FINISHING_UP).count().then((n) => { if (n > 0) holdSeen = true; }).catch(() => undefined);
    }, 250);
    const startedAt = Date.now();
    let nextStartMs: number | null = null;
    try {
        await startBenchmarkRecording(page, label);
        await expectBenchmarkRecordingStarted(page, label);
        nextStartMs = Date.now() - startedAt;
    } catch {
        clearInterval(watch);
        const startFailure = await readStartFailureState(page);
        const tracks = await boundedTeardown(page, label);
        return { holdSeen, nextStartMs: null, stopped: false, liveTracksAfterStop: tracks, reason: 'the next Start did not begin recording', startFailure };
    }
    clearInterval(watch);
    try {
        await stopBenchmarkRecording(page, label);
    } catch {
        const tracks = await boundedTeardown(page, label);
        return { holdSeen, nextStartMs, stopped: false, liveTracksAfterStop: tracks, reason: 'the next take could not be stopped', startFailure: null };
    }
    const live = await expect.poll(() => liveMicTracks(page), { timeout: 10_000 }).toBe(0).then(() => 0).catch(async () => liveMicTracks(page));
    return { holdSeen, nextStartMs, stopped: true, liveTracksAfterStop: live, reason: live === 0 ? null : 'the microphone stayed live after Stop', startFailure: null };
}

/**
 * Last-resort teardown: one more Stop attempt, read the live-track count ON THIS PAGE (a new document has no
 * counter, so a later read would prove nothing), then leave the page so the browser releases the capture.
 */
async function boundedTeardown(page: Page, label: string): Promise<number | null> {
    await stopBenchmarkRecording(page, `${label}-teardown`, 20_000).catch(() => undefined);
    const live = await liveMicTracks(page).catch(() => null);
    await page.goto('about:blank').catch(() => undefined);
    return live;
}

/**
 * #1258 PM 6132878919 — FAIL FAST AFTER A FATAL START FAILURE. Alpha run 38304068207 hung for 32 minutes: the next
 * Start failed, `boundedTeardown` left the page on about:blank, and the Focus-only product-switch step then waited
 * forever for the Products menu on that blank page. A step that drives the CURRENT page (no fresh navigation of its own)
 * first calls `stopIfPageTornDown`: on a torn-down page it records one FAIL row naming why and throws
 * `RwtJourneyStopped`, so the spec's `finally` still writes the receipt and runs run-owned cleanup, and the test fails.
 */
export const JOURNEY_STOPPED_ROW = 'journey stopped after a fatal failure';
export class RwtJourneyStopped extends Error {
    constructor(readonly afterStep: string) {
        super(`${JOURNEY_STOPPED_ROW}: the page was torn down after "${afterStep}"`);
        this.name = 'RwtJourneyStopped';
    }
}
export function stopIfPageTornDown(receipt: RwtReceipt, page: Page, afterStep: string, nextStep: string): void {
    if (!page.isClosed() && page.url() !== 'about:blank') return;
    receipt.row(JOURNEY_STOPPED_ROW, 'FAIL',
        `the page was torn down after "${afterStep}", so "${nextStep}" and the steps after it did not run`,
        { afterStep, nextStep });
    throw new RwtJourneyStopped(afterStep);
}

/**
 * One entitlement row from the first `check-usage-limit` verdict the page received. `requiredSeconds` is the
 * recording time this journey needs; no observed verdict is a HOLD (the gate proves nothing), never a pass.
 */
export async function entitlementRow(receipt: RwtReceipt, tap: EntitlementTap, requiredSeconds: number): Promise<void> {
    await tap.settle();
    const first = tap.responses[0];
    if (!first) { receipt.row('new-account entitlement', 'HOLD', 'no check-usage-limit response was observed'); return; }
    const verdict = evaluateThreeRecordingEntitlement(first, requiredSeconds);
    const canStart = first.can_start === true;
    receipt.row('new-account entitlement', canStart && verdict.ok ? 'PASS' : 'FAIL',
        canStart && verdict.ok ? 'the server let the new account start, with room for this journey'
            : `the server did not entitle the new account (${verdict.ok ? 'can_start false' : verdict.reason})`,
        { canStart, trialActive: first.trial_active === true, isPro: first.is_pro === true });
}

/**
 * "PRACTICE AGAIN", THROUGH THE CONTROLS A PERSON PRESSES (PM 2026-09-26, after #1533).
 *
 * The fresh-session next Start (`nextStartEvidence`) never touches the two repeat actions the runbook uses, and
 * #1533 showed that is where a stale "Finishing up" could land. So, from the saved session's Analytics detail:
 *   1. press the ONE practice action (`saved-review-practice`): the same product opens — for Focus Points the same set,
 *      every point pending again (compared in memory; only booleans reach the receipt);
 *   2. record a short take that SAVES (≥ the 5 s no-persist guard), so the completed-session review appears;
 *   3. press that review's own repeat action (Open Mic "Practice this again" / Focus "Retry this set") at once — the
 *      just-saved take's own evaluation must not hold it: it is enabled, no "Finishing up" shows, recording starts;
 *   4. stop within the no-persist guard (nothing more is saved) and confirm every microphone track ended.
 * A step the page never reached is a HOLD with its reason — never a PASS. The detail is opened by URL; the list path
 * into it is proven by the reopen rows.
 */
/**
 * #1258 R6 (PM 6134474736) — the reopened Focus set is the SAME set, in the SAME order, every point pending again:
 * exactly as many rows as points, each row's own label equal to its point, and every status `pending`.
 */
export function sameOrderedPendingSet(labels: readonly string[], statuses: readonly (string | null)[], points: readonly string[]): boolean {
    return labels.length === points.length && statuses.length === points.length
        && points.every((point, i) => labels[i].trim() === point.trim())
        && statuses.every((status) => status === 'pending');
}

/** #1258 (PM 5944997435): one outer bound per diagnostic read, and a short per-call timeout inside it. */
const STEP_DIAGNOSTIC_BOUND_MS = 10_000;
const STEP_DIAGNOSTIC_READ_MS = 3_000;

/**
 * #1258 alpha run 38298685079: the review's repeat Start and a fresh next Start both failed to begin recording, and the
 * helper's catch swallowed WHY. When a Start does not begin, the page's visible state is classified into a closed enum.
 * The status text is read only to classify it and is never recorded. Product copy: `ENGINE_RETIRE_UNCONFIRMED_MESSAGE`
 * (useSessionLifecycle.ts), the lease block (recordingLeasePolicy.ts) and the Progress hold.
 */
export type StartRefusalClass = 'engine_unconfirmed' | 'lease_blocked' | 'finishing_up' | 'prior_unsaved' | 'start_error' | 'none_visible';
const START_REFUSAL_PATTERNS: ReadonlyArray<readonly [StartRefusalClass, RegExp]> = [
    ['engine_unconfirmed', /could not confirm the last recording stopped/i],
    ['lease_blocked', /A recording is active on .*press Start again to take over/i],
    ['finishing_up', /Finishing up your last session/i],
    // #1600 review (6133231405): the controller's refusal while a previous recording is unresolved — the likely next-Start
    // refusal in runs 38298685079 / 38304068207. Before `start_error`, whose generic "save" wording it would otherwise hit.
    ['prior_unsaved', /Finish saving your previous recording before starting a new one/i],
    ['start_error', /(?:could ?n[o']t|unable to|failed to) (?:start|record|save)|microphone (?:access )?(?:is )?(?:blocked|denied)/i],
];
export function classifyStartRefusal(texts: readonly string[]): StartRefusalClass {
    for (const [kind, pattern] of START_REFUSAL_PATTERNS) if (texts.some((t) => pattern.test(t))) return kind;
    return 'none_visible';
}

/** Content-free page state when a Start did not begin recording: closed enums, booleans and the controller's own states. */
export interface StartFailureState {
    refusalClass: StartRefusalClass | null; runtimeState: string | null; sessionState: string | null;
    persisted: boolean | null; modelStatus: string | null;
    micStartPresent: boolean | null; micStartDisabled: boolean | null; recorderStopPresent: boolean | null;
    repeatActionPresent: boolean | null; repeatActionDisabled: boolean | null;
    controllerState: string | null; serviceState: string | null; readTimedOut: boolean;
}
const UNREAD_START_FAILURE: StartFailureState = {
    refusalClass: null, runtimeState: null, sessionState: null, persisted: null, modelStatus: null,
    micStartPresent: null, micStartDisabled: null, recorderStopPresent: null, repeatActionPresent: null, repeatActionDisabled: null,
    controllerState: null, serviceState: null, readTimedOut: true,
};
export async function readStartFailureState(page: Page): Promise<StartFailureState> {
    const read = page.evaluate(() => {
        const root = document.documentElement;
        const node = (tid: string) => document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
        const control = (tid: string) => { const n = node(tid); return { present: !!n, disabled: n ? n.hasAttribute('disabled') : null }; };
        const short = (v: unknown) => (typeof v === 'string' && /^[A-Za-z_-]{1,40}$/.test(v) ? v : null);
        const debug = (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown> }).__SPEECH_RUNTIME_DEBUG__?.() ?? {};
        const texts = Array.from(document.querySelectorAll('[role="alert"],[role="status"],[data-testid="mic-status"]'))
            .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400));
        const start = control('mic-start'); const repeat = control('verdict-practice-again');
        return {
            texts,
            runtimeState: short(root.getAttribute('data-runtime-state')),
            sessionState: short(document.querySelector('[data-testid="session-shell"]')?.getAttribute('data-session-state')),
            persisted: root.hasAttribute('data-session-persisted') ? root.getAttribute('data-session-persisted') === 'true' : null,
            modelStatus: short(document.querySelector('[data-model-status]')?.getAttribute('data-model-status')),
            micStartPresent: start.present, micStartDisabled: start.disabled, recorderStopPresent: !!node('recorder-stop'),
            repeatActionPresent: repeat.present, repeatActionDisabled: repeat.disabled,
            controllerState: short(debug.controllerState), serviceState: short(debug.serviceState),
        };
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), STEP_DIAGNOSTIC_READ_MS));
    const raw = await Promise.race([read, timeout]).catch(() => null);
    if (!raw) return UNREAD_START_FAILURE;
    // The status texts are classified here and dropped: only the closed enum leaves this function.
    const { texts, ...state } = raw;
    return { ...state, refusalClass: classifyStartRefusal(texts), readTimedOut: false };
}

/** Flat receipt evidence for a Start that did not begin; every field null when the Start was not a failure. */
export function startFailureEvidence(s: StartFailureState | null): Record<string, string | boolean | null> {
    const v = s ?? { ...UNREAD_START_FAILURE, readTimedOut: false };
    return {
        refusalClass: v.refusalClass, runtimeState: v.runtimeState, sessionState: v.sessionState, persisted: v.persisted,
        modelStatus: v.modelStatus, micStartPresent: v.micStartPresent, micStartDisabled: v.micStartDisabled,
        recorderStopPresent: v.recorderStopPresent, repeatActionPresent: v.repeatActionPresent, repeatActionDisabled: v.repeatActionDisabled,
        controllerState: v.controllerState, serviceState: v.serviceState, startFailureReadTimedOut: s ? s.readTimedOut : null,
    };
}

export interface PracticeAgainEvidence {
    analyticsActionOpened: boolean | null; sameSetPending: boolean | null;
    reviewReached: boolean | null; afterActionEnabledMs: number | null; holdSeen: boolean;
    /** The session id of the short take this pass saved (for the saved-product-marker row); null when not reached. */
    savedSessionId: string | null;
    afterStartMs: number | null; stopped: boolean; liveTracksAfterStop: number | null; reason: string | null;
    /** #1258 (PM 5944997435): the practice action's content-free state before the click, and after a click that did not open /session. */
    actionBefore: PracticeActionState | null; actionAfter: PracticeActionState | null;
    /** #1258 run 38298685079: did the short (save) take persist as a NEW session, read from the page's own attributes. */
    saveTakePersisted: boolean | null; saveTakeNewSession: boolean | null;
    /**
     * #1258 (PM 6200778538) — the gate assertions that replace "no Finishing up copy at all": was the repeat action ever
     * ENABLED while the honest "Finishing up" wait was still shown (a fence violation), and the four separately recorded
     * timings. Null where not observed; `pressToWarmupDoneMs` is null when the product's native trace is unavailable.
     */
    enabledWhileHolding: boolean | null;
    stopToSaveMs: number | null; saveToGateClearMs: number | null; pressToWarmupDoneMs: number | null; pressToRecordingMs: number | null;
    /** Content-free page state when the review's repeat Start did not begin recording; null when it began or was not tried. */
    startFailure: StartFailureState | null;
    /**
     * #1258 smoke run 38654466793 (PM 6181247850): the closed sub-step at which the SAVE take stopped progressing — the step
     * being attempted when it failed. Null when the review was reached or the save take was never tried.
     */
    saveTakeFailedStep: PracticeSaveTakeStep | null;
    /** Whether the save take's Start and Stop presses were actually completed (never inferred from teardown). */
    saveTakeStartPressed: boolean; saveTakeStopPressed: boolean;
    /** Content-free page state read BEFORE teardown when the save take did not reach the review (bounded; may be unread). */
    saveTakeFailure: StartFailureState | null;
}
/** The save take's sub-steps, in order: mic ready → Start pressed → recording confirmed → Stop pressed → review shown. */
export type PracticeSaveTakeStep = 'mic_ready' | 'start' | 'recording_started' | 'stop' | 'review';
/**
 * #1593 — the saved take's identity as the page reports it NOW (`data-session-persisted-id` / `data-session-persisted`).
 * Read after the persistence wait; `saveTakeNewSession` is null while no id is reported.
 */
export async function savedTakeIdentity(
    page: Pick<Page, 'evaluate'>, previousSessionId: string | null,
): Promise<{ savedSessionId: string | null; saveTakePersisted: boolean; saveTakeNewSession: boolean | null }> {
    const savedSessionId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
    const saveTakePersisted = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted') === 'true');
    return { savedSessionId, saveTakePersisted, saveTakeNewSession: savedSessionId !== null ? savedSessionId !== previousSessionId : null };
}

export async function practiceAgainEvidence(
    page: Page, label: string, sessionId: string, product: 'open_mic' | 'focus_points', pointLabels: readonly string[] = [],
    /** #1532 Codex P1 r4124290575: called right after the SAVE take's Stop, so the caller can close that take's sent-stream window. */
    onSaveTakeStopped?: () => void,
): Promise<PracticeAgainEvidence> {
    const FINISHING_UP = /Finishing up your last session/;
    const ev: PracticeAgainEvidence = {
        analyticsActionOpened: null, sameSetPending: null, reviewReached: null, afterActionEnabledMs: null,
        holdSeen: false, afterStartMs: null, stopped: false, liveTracksAfterStop: null, reason: null, savedSessionId: null,
        actionBefore: null, actionAfter: null, saveTakePersisted: null, saveTakeNewSession: null, enabledWhileHolding: null, stopToSaveMs: null, saveToGateClearMs: null, pressToWarmupDoneMs: null, pressToRecordingMs: null, startFailure: null,
        saveTakeFailedStep: null, saveTakeStartPressed: false, saveTakeStopPressed: false, saveTakeFailure: null,
    };
    await page.goto(`/analytics/${sessionId}`);
    const practice = page.getByTestId('saved-review-practice');
    try {
        await expect(practice).toBeEnabled({ timeout: 30_000 });
    } catch {
        ev.reason = 'the Analytics detail showed no enabled practice action';
        return ev;
    }
    ev.actionBefore = await readPracticeActionState(page, { boundMs: STEP_DIAGNOSTIC_BOUND_MS, readTimeoutMs: STEP_DIAGNOSTIC_READ_MS });
    await practice.click();
    ev.analyticsActionOpened = await page.waitForURL('**/session', { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!ev.analyticsActionOpened) {
        ev.actionAfter = await readPracticeActionState(page, { boundMs: STEP_DIAGNOSTIC_BOUND_MS, readTimeoutMs: STEP_DIAGNOSTIC_READ_MS });
        ev.reason = 'the practice action did not open the session page';
        return ev;
    }
    if (product === 'focus_points') {
        const rail = page.getByTestId('focus-points-rail');
        const shown = await rail.waitFor({ timeout: 30_000 }).then(async () => {
            const rows = await rail.getByTestId(/^focus-point-\d+$/).all();
            // #1258 R6: the row's text starts with its numbered marker ("1", "2", …), so the label is read from the row's
            // own label paragraph, never the whole row (run 38304068207 failed the same pending set on that prefix).
            const labels = await Promise.all(rows.map((r) => r.locator('p').first().innerText({ timeout: 5_000 }).catch(() => '')));
            const statuses = await Promise.all(rows.map((r) => r.getAttribute('data-status')));
            return sameOrderedPendingSet(labels, statuses, pointLabels);
        }).catch(() => false);
        ev.sameSetPending = shown;
    }
    // PM 6181247850: one catch used to cover the whole save take and lose which boundary failed. Each sub-step is now
    // named before it is attempted, and the presses that actually completed are recorded.
    let step: PracticeSaveTakeStep = 'mic_ready';
    let savedAtForGate: number | null = null;
    try {
        await expect(page.getByTestId('mic-status')).toContainText('Mic ready on this device', { timeout: 60_000 });
        step = 'start';
        await startBenchmarkRecording(page, `${label}-save`);
        ev.saveTakeStartPressed = true;
        step = 'recording_started';
        await expectBenchmarkRecordingStarted(page, `${label}-save`);
        await page.waitForTimeout(7_000); // past the 5 s no-persist guard, so this take saves
        step = 'stop';
        // Codex P2 r4278702635: the flag is set when the CLICK resolves, inside the helper — so `stop` with the flag true
        // means the click happened and the post-Stop settle failed; false means the click itself failed.
        let stopClickedAt: number | null = null;
        await stopBenchmarkRecording(page, `${label}-save`, undefined, () => { ev.saveTakeStopPressed = true; stopClickedAt = Date.now(); });
        onSaveTakeStopped?.();
        step = 'review';
        await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 60_000 });
        ev.reviewReached = true;
        ev.savedSessionId = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'));
        ev.saveTakePersisted = await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted') === 'true');
        ev.saveTakeNewSession = ev.savedSessionId !== null ? ev.savedSessionId !== sessionId : null;
        // Stop → save: when the take is actually persisted (bounded; null when it never was within the wait).
        // A timing is evidence only: its read can never change the step's outcome.
        const savedAt = await Promise.resolve()
            .then(() => page.waitForFunction(() => document.documentElement.getAttribute('data-session-persisted') === 'true',
                null, { timeout: 60_000 }))
            .then(() => Date.now()).catch(() => null);
        ev.stopToSaveMs = stopClickedAt !== null && savedAt !== null ? savedAt - stopClickedAt : null;
        savedAtForGate = savedAt;
        // #1593 (Sam case-1 diagnosis, run 39136771332): the identity read above is a snapshot taken when the review
        // appeared — BEFORE persistence (`saveTakePersisted:false` there while the take saved 7.9 s later). Re-read it after
        // the bounded persistence wait, so downstream readers (the two-take coaching read, product markers) bind the take
        // that was actually saved, never a stale pre-save value.
        Object.assign(ev, await savedTakeIdentity(page, sessionId));
    } catch {
        ev.reviewReached = false;
        ev.saveTakeFailedStep = step;
        // Read WHY before teardown navigates away; a timed-out read stays marked unread and the failure stands.
        ev.saveTakeFailure = await readStartFailureState(page).catch(() => UNREAD_START_FAILURE);
        ev.liveTracksAfterStop = await boundedTeardown(page, `${label}-save`);
        ev.reason = `the practice take did not reach the completed-session review (stopped at: ${step})`;
        return ev;
    }
    // The completed review's own repeat action, pressed as soon as it is offered.
    const again = page.getByTestId(product === 'focus_points' ? 'focus-points-retry' : 'verdict-practice-again');
    ev.holdSeen = (await page.getByText(FINISHING_UP).count()) > 0;
    ev.enabledWhileHolding = false;
    // The FENCE, observed: the action must never be enabled while the honest "Finishing up" wait is still shown.
    const watch = setInterval(() => {
        void Promise.all([page.getByText(FINISHING_UP).count(), again.isEnabled().catch(() => false)]).then(([n, enabled]) => {
            if (n > 0) ev.holdSeen = true;
            if (n > 0 && enabled) ev.enabledWhileHolding = true;
        }).catch(() => undefined);
    }, 250);
    const offeredAt = Date.now();
    try {
        await expect(again).toBeEnabled({ timeout: 15_000 });
        ev.afterActionEnabledMs = Date.now() - offeredAt;
        ev.saveToGateClearMs = savedAtForGate !== null ? Math.max(0, Date.now() - savedAtForGate) : null;
        // The product's own controller trace, armed just before the press, times press → warm-up done.
        const pressPerf = await Promise.resolve().then(() => page.evaluate(() => {
            const w = window as unknown as { __NATIVE_BROWSER_TRACE__?: unknown[] };
            w.__NATIVE_BROWSER_TRACE__ = w.__NATIVE_BROWSER_TRACE__ ?? [];
            return performance.now();
        })).catch(() => null);
        const pressedAt = Date.now();
        await again.click();
        await expectBenchmarkRecordingStarted(page, `${label}-again`);
        ev.afterStartMs = Date.now() - pressedAt;
        ev.pressToRecordingMs = ev.afterStartMs;
        ev.pressToWarmupDoneMs = pressPerf === null ? null : await Promise.resolve().then(() => page.evaluate((from) => {
            const trace = (window as unknown as { __NATIVE_BROWSER_TRACE__?: Array<{ t: number; event: string }> }).__NATIVE_BROWSER_TRACE__ ?? [];
            const done = trace.find((e) => e.event === 'controller_warmup_done' && e.t >= from);
            return done ? Math.round(done.t - from) : null;
        }, pressPerf)).catch(() => null);
    } catch {
        clearInterval(watch);
        // Read WHY before teardown navigates away (#1258 run 38298685079: the reason was swallowed here).
        if (ev.afterActionEnabledMs !== null) ev.startFailure = await readStartFailureState(page);
        ev.liveTracksAfterStop = await boundedTeardown(page, `${label}-again`);
        ev.reason = ev.afterActionEnabledMs === null ? 'the review\'s repeat action was not enabled within 15 s' : 'the repeat action did not begin recording';
        return ev;
    }
    clearInterval(watch);
    try {
        await stopBenchmarkRecording(page, `${label}-again`);
    } catch {
        ev.liveTracksAfterStop = await boundedTeardown(page, `${label}-again`);
        ev.reason = 'the repeated take could not be stopped';
        return ev;
    }
    ev.stopped = true;
    ev.liveTracksAfterStop = await expect.poll(() => liveMicTracks(page), { timeout: 10_000 }).toBe(0).then(() => 0).catch(async () => liveMicTracks(page));
    if (ev.liveTracksAfterStop !== 0) ev.reason = 'the microphone stayed live after Stop';
    return ev;
}

/**
 * #1258 / #1537 — THE SAVED PRODUCT MARKER, on Production. Every session row this run-owned journey created and evaluated
 * (the journey's take, and the Practice-again pass's take when it saved one) must carry exactly the journey's product.
 * Read through the existing service-role seam, scoped to the disposable run-owned account and these ids only; the receipt
 * carries counts and a boolean — never row content.
 */
export async function productMarkerRows(
    receipt: RwtReceipt,
    admin: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { in: (k: string, v: string[]) => PromiseLike<{ data: Array<{ id: string; product: string | null }> | null; error: { code?: string } | null }> } } } } | null,
    ownerUid: string | null,
    expected: 'open_mic' | 'focus_points',
    sessionIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
    const ids = [...new Set(sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (!admin || !ownerUid || ids.length === 0) {
        receipt.row('saved product marker', 'HOLD', !admin ? 'no service-role seam in this run' : 'no saved session id to check', { checked: ids.length });
        return;
    }
    const { data, error } = await admin.from('sessions').select('id,product').eq('user_id', ownerUid).in('id', ids);
    if (error || !data) {
        receipt.row('saved product marker', 'FAIL', `the saved-product read failed (fail closed): ${error?.code ?? 'no data'}`, { checked: ids.length });
        return;
    }
    const matched = data.filter((r) => r.product === expected).length;
    const ok = data.length === ids.length && matched === ids.length;
    receipt.row('saved product marker', ok ? 'PASS' : 'FAIL',
        ok ? `every session this journey saved carries product ${expected}` : `a saved session is missing or does not carry product ${expected}`,
        { checked: ids.length, found: data.length, matched, expected });
}

/** The practice action's closed-enum state as flat receipt evidence: which click branch the page was in. */
export function practiceActionEvidence(ev: Pick<PracticeAgainEvidence, 'actionBefore' | 'actionAfter'>): Record<string, string | boolean | null> {
    const b = ev.actionBefore; const a = ev.actionAfter;
    return {
        beforeLinkState: b?.linkState ?? null, beforeLabel: b?.label ?? null,
        afterRoute: a?.route ?? null, afterLinkState: a?.linkState ?? null, afterLabel: a?.label ?? null, afterEnabled: a?.enabled ?? null,
        diagnosticTimedOut: Boolean(b?.timedOut || a?.timedOut),
    };
}

/** Rows from one Practice-again pass: the Analytics action, the review's repeat action, and the microphone off. */
export const REPEAT_START_ROW = 'review Practice again starts after the gate clears';
/** Ceiling for the gate to clear after the take saved, and for recording to begin after the press. */
export const REPEAT_START_CEILING_MS = 15_000;

/**
 * #1258 (PM ruling): an honest "Finishing up your last session" wait is allowed. The repeat action must stay fenced while
 * it shows, the gate must clear, and recording must begin after the press. FAIL when the action was enabled while the wait
 * showed, when the gate never cleared within the ceiling, or when recording did not begin within the ceiling.
 */
export function repeatStartVerdict(ev: Pick<PracticeAgainEvidence,
    'afterActionEnabledMs' | 'afterStartMs' | 'holdSeen' | 'enabledWhileHolding' | 'reason'>): { status: 'PASS' | 'FAIL'; detail: string } {
    if (ev.enabledWhileHolding === true) {
        return { status: 'FAIL', detail: 'the repeat action was enabled while "Finishing up your last session" was still shown' };
    }
    if (ev.afterActionEnabledMs === null || ev.afterActionEnabledMs >= REPEAT_START_CEILING_MS) {
        return { status: 'FAIL', detail: 'the start gate did not clear: the repeat action was not enabled within 15 s of the review' };
    }
    if (ev.afterStartMs === null) return { status: 'FAIL', detail: ev.reason ?? 'recording did not begin' };
    if (ev.afterStartMs >= REPEAT_START_CEILING_MS) return { status: 'FAIL', detail: 'recording did not begin within 15 s of the press' };
    return {
        status: 'PASS',
        detail: ev.holdSeen
            ? 'the honest "Finishing up" wait kept the action fenced, the gate cleared, and recording began'
            : 'the repeat action was offered at once and recording began',
    };
}

export function practiceAgainRows(receipt: RwtReceipt, product: 'open_mic' | 'focus_points', ev: PracticeAgainEvidence): void {
    if (ev.analyticsActionOpened === null) {
        receipt.row('Analytics Practice again opens the product', 'HOLD', ev.reason ?? 'not reached');
    } else {
        const ok = ev.analyticsActionOpened && (product === 'open_mic' || ev.sameSetPending === true);
        receipt.row('Analytics Practice again opens the product', ok ? 'PASS' : 'FAIL',
            ok ? (product === 'focus_points' ? 'the same Focus set opened, every point pending' : 'Open Mic opened, ready to record')
                : !ev.analyticsActionOpened ? (ev.reason ?? 'the session page did not open') : 'the Focus set that opened was not the saved set, or not pending',
            { sameSetPending: ev.sameSetPending, ...practiceActionEvidence(ev) });
    }
    if (ev.reviewReached !== true) {
        // The sub-step and page state EXPLAIN an incomplete save take; they never turn it into PASS. A zero live-track count
        // after teardown does not prove the repeated take stopped, so that row stays HOLD as well.
        const saveTake = {
            saveTakeFailedStep: ev.saveTakeFailedStep, saveTakeStartPressed: ev.saveTakeStartPressed, saveTakeStopPressed: ev.saveTakeStopPressed,
            ...startFailureEvidence(ev.saveTakeFailure),
        };
        receipt.row(REPEAT_START_ROW, 'HOLD', ev.reason ?? 'the completed-session review was not reached', saveTake);
        receipt.row('repeated take stopped, microphone off', 'HOLD', ev.reason ?? 'not reached', { liveTracksAfterStop: ev.liveTracksAfterStop, ...saveTake });
        return;
    }
    const verdict = repeatStartVerdict(ev);
    receipt.row(REPEAT_START_ROW, verdict.status, verdict.detail,
        {
            afterActionEnabledMs: ev.afterActionEnabledMs, afterStartMs: ev.afterStartMs, holdSeen: ev.holdSeen,
            enabledWhileHolding: ev.enabledWhileHolding, stopToSaveMs: ev.stopToSaveMs, saveToGateClearMs: ev.saveToGateClearMs,
            pressToWarmupDoneMs: ev.pressToWarmupDoneMs, pressToRecordingMs: ev.pressToRecordingMs,
            saveTakePersisted: ev.saveTakePersisted, saveTakeNewSession: ev.saveTakeNewSession, ...startFailureEvidence(ev.startFailure),
        });
    const offOk = ev.stopped && ev.liveTracksAfterStop === 0;
    receipt.row('repeated take stopped, microphone off', offOk ? 'PASS' : 'FAIL',
        offOk ? 'the take stopped and every microphone track ended' : (ev.reason ?? 'the take could not be stopped'),
        { stopped: ev.stopped, liveTracksAfterStop: ev.liveTracksAfterStop });
}

/** Two rows from one next-Start attempt: the Start itself, and the Stop with the microphone confirmed off. */
export function nextStartRows(receipt: RwtReceipt, next: Awaited<ReturnType<typeof nextStartEvidence>>): void {
    const started = next.nextStartMs !== null;
    const startOk = started && !next.holdSeen && next.nextStartMs! < 15_000;
    receipt.row('next Start', startOk ? 'PASS' : 'FAIL',
        startOk ? 'the next take started without "Finishing up"'
            : !started ? (next.reason ?? 'the next Start did not begin') : next.holdSeen ? '"Finishing up" was shown' : 'the next Start exceeded the 15 s ceiling',
        { nextStartMs: next.nextStartMs, holdSeen: next.holdSeen, ...startFailureEvidence(next.startFailure) });
    const offOk = next.stopped && next.liveTracksAfterStop === 0;
    receipt.row('next take stopped, microphone off', offOk ? 'PASS' : 'FAIL',
        offOk ? 'the take stopped and every microphone track ended'
            : !next.stopped ? (next.reason ?? 'the take could not be stopped') : 'the microphone stayed live after Stop',
        { stopped: next.stopped, liveTracksAfterStop: next.liveTracksAfterStop });
}

/** The saved coaching response (`sessions.ai_suggestions`), held in memory only. */
export interface SavedCoaching { well: string; next: string }
export interface CoachingShown {
    /** Each saved phrase is the text inside the saved review block, word for word (G20). */
    well: boolean; next: boolean;
    /** The saved review is the FIRST block of the detail, ahead of the Progress panel. */
    first: boolean;
    /** A "From this session" evidence line is shown, and matches the product's expected measurement. */
    evidenceShown: boolean; evidenceMatches: boolean;
    /** ONE practice action: the review's own, with no competing Progress sentence or button. */
    oneAction: boolean;
}

/** Case, spacing and sentence-final punctuation do not change a phrase. */
export const normalisePhraseText = (t: string): string =>
    t.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+(\s|$)/g, '$1').trim();

/**
 * The saved review on the Analytics detail (G20), read from its own block. Compared in Node; only booleans leave.
 * `evidencePattern` is the product's measurement shape (Open Mic: per-minute delivery; Focus Points: detected points).
 */
async function coachingShownOnPage(page: Page, saved: SavedCoaching, evidencePattern?: RegExp): Promise<CoachingShown> {
    const none: CoachingShown = { well: false, next: false, first: false, evidenceShown: false, evidenceMatches: false, oneAction: false };
    const block = page.getByTestId('saved-review');
    if (!(await block.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false))) return none;
    await expect.poll(async () => block.getAttribute('data-review-state'), { timeout: 30_000 }).not.toBe('loading').catch(() => undefined);
    const text = async (id: string) => (await block.getByTestId(id).innerText().catch(() => '')).trim();
    const same = (a: string, b: string) => a !== '' && normalisePhraseText(a) === normalisePhraseText(b);
    const evidence = await text('review-evidence');
    const first = await page.evaluate(() => {
        const review = document.querySelector('[data-testid="saved-review"]');
        const progress = document.querySelector('[data-testid="progress-panel"]');
        return Boolean(review) && (!progress || Boolean(review!.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    const actions = await page.getByTestId('saved-review-practice').count();
    const competing = (await page.getByTestId('progress-accept').count()) + (await page.getByTestId('progress-practice-next').count());
    return {
        well: same(await text('review-what-went-well'), saved.well),
        next: same(await text('review-try-next'), saved.next),
        first,
        evidenceShown: /From this session/i.test(evidence),
        evidenceMatches: evidencePattern ? evidencePattern.test(evidence) : evidence !== '',
        oneAction: actions === 1 && competing === 0,
    };
}

/**
 * ANALYTICS THROUGH THE CONTROLS THE PERSON USES (PM 2026-09-25). From the post-save screen: click the on-screen
 * Analytics action, confirm the destination lists THIS saved session, open it through its own control and compare
 * the rendered transcript to the saved one by digest; then reload and compare again. No direct URL navigation into
 * the detail — that would skip the button the PO clicks. Digests only; the text is never returned.
 */
/**
 * `afterReload` (PM RETURN 5870036039: the PO's manual v12 order) runs AFTER the detail's reload checks — the Open Mic
 * PDF is downloaded there, as the person does it. The reload minted a new journey, so its receipt is qualified in that
 * journey (`bindReadbackJourneys` … `pdfExport`), never claimed for the recording journey.
 */
export async function analyticsThroughActions(page: Page, sessionId: string, savedDigest: string, savedCoaching?: SavedCoaching, evidencePattern?: RegExp,
    afterReload?: () => Promise<void>): Promise<{
    actionClicked: boolean; listed: boolean; detailOpened: boolean; detailMatches: boolean; reloadMatches: boolean;
    coachingBefore: CoachingShown | null; coachingAfter: CoachingShown | null;
}> {
    const result = {
        actionClicked: false, listed: false, detailOpened: false, detailMatches: false, reloadMatches: false,
        coachingBefore: null as CoachingShown | null, coachingAfter: null as CoachingShown | null,
    };
    // The live after state's review link, or — after Back restored the session (#1258 D1) — its "See all sessions".
    const action = page.getByTestId('post-save-review-session-link').or(page.getByTestId('saved-session-return-see-all')).first();
    if (!(await action.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false))) return result;
    await action.click();
    result.actionClicked = await page.waitForURL(/\/analytics(\?|$|#)/, { timeout: 30_000 }).then(() => true).catch(() => false);
    const open = page.getByTestId(`open-session-detail-${sessionId}`).or(page.getByTestId(`open-session-detail-mobile-${sessionId}`)).first();
    result.listed = await open.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    if (!result.listed) return result;
    await open.click();
    result.detailOpened = await page.waitForURL(new RegExp(`/analytics/${sessionId}`), { timeout: 30_000 }).then(() => true).catch(() => false);
    const detail = page.getByTestId('session-detail-transcript');
    const shown = await detail.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    result.detailMatches = shown && savedDigest !== '' && sha256Hex(await detail.innerText()) === savedDigest;
    if (savedCoaching) result.coachingBefore = await coachingShownOnPage(page, savedCoaching, evidencePattern);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = await page.getByTestId('session-detail-transcript').waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    result.reloadMatches = again && sha256Hex(await page.getByTestId('session-detail-transcript').innerText()) === savedDigest;
    if (savedCoaching) result.coachingAfter = await coachingShownOnPage(page, savedCoaching, evidencePattern);
    if (afterReload) await afterReload();
    return result;
}

/**
 * #1258 D1 (PO 2026-10-09) — the person's own repro, on the deployed real engine: after a saved take, open Progress from the
 * header, stay until it has rendered, press the browser's Back. The page must restore THAT saved session read-only (never
 * the idle recorder) and its review must be the saved coaching, or — when none was saved and the transcript is still kept
 * — an explicit Try again. Nothing is pressed here, so no coaching is requested. Only booleans leave.
 */
/**
 * #1576 Codex P1 4237614257 — wait for a NEW durable save (see `isNewPersistedSession`). Returns its id, or null when none
 * is proven within the timeout: a caller never inspects a stale or missing take as if it were the new one.
 */
export async function waitForNewPersistedSession(page: Page, previous: string | null, timeoutMs = 120_000): Promise<string | null> {
    const read = () => page.evaluate(() => ({
        persisted: document.documentElement.getAttribute('data-session-persisted'),
        id: document.documentElement.getAttribute('data-session-persisted-id'),
    }));
    const proven = await expect.poll(async () => isNewPersistedSession(await read(), previous), { timeout: timeoutMs })
        .toBe(true).then(() => true).catch(() => false);
    if (!proven) return null;
    const state = await read();
    return isNewPersistedSession(state, previous) ? state.id : null;
}

export async function backFromProgressRestoresSession(page: Page, sessionId: string, savedCoaching?: SavedCoaching): Promise<{
    left: boolean; restored: boolean; idleShown: boolean; liveTracks: number | null; review: 'saved' | 'try_again' | 'not_available' | 'missing';
}> {
    const result = { left: false, restored: false, idleShown: false, liveTracks: null as number | null, review: 'missing' as 'saved' | 'try_again' | 'not_available' | 'missing' };
    const progress = page.getByTestId('nav-analytics-link').first();
    if (!(await progress.click({ timeout: 20_000 }).then(() => true).catch(() => false))) return result;
    result.left = await page.waitForURL(/\/analytics(\?|$|#)/, { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!result.left) return result;
    await page.getByTestId('dashboard-heading').waitFor({ state: 'visible', timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000); // past the session page's exit transition, as the person stayed on Progress
    await page.goBack();
    // #1576 Codex P1 4237614260 / Browser PM 6097554446: the capture state is the FIRST read after Back — before the restored
    // UI wait, the idle control or the review — so a transient or leaked track cannot end unseen during those waits.
    result.liveTracks = await liveMicTracks(page).catch(() => null);
    const restored = page.getByTestId('saved-session-return');
    result.restored = await restored.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
        && (await restored.getAttribute('data-session-id').catch(() => null)) === sessionId;
    result.idleShown = (await page.getByTestId('mic-start').count()) > 0;
    if (!result.restored) return result;
    result.review = await readRestoredReview(page, savedCoaching);
    return result;
}

/**
 * The review a restored saved session shows: its saved coaching word for word, the Try again band (retry offered) or the
 * terminal not-available band. Shared by the Back and reload checks so both read the SAME state (Browser PM RETURN on
 * c76283d12). Only a label leaves.
 */
async function readRestoredReview(page: Page, savedCoaching?: SavedCoaching): Promise<'saved' | 'try_again' | 'not_available' | 'missing'> {
    const retry = page.getByTestId('restored-review-retry');
    const settled = page.getByTestId('review-try-next').or(retry).first();
    await settled.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => undefined);
    if (await retry.isVisible().catch(() => false)) {
        return (await retry.getAttribute('data-retry').catch(() => null)) === 'available' ? 'try_again' : 'not_available';
    }
    if (savedCoaching) {
        const shown = await coachingShownOnPage(page, savedCoaching);
        return shown.well && shown.next ? 'saved' : 'missing';
    }
    return 'missing';
}

/**
 * #1258 (Browser PM 6093772463) — after Back restored a saved session, a reload must restore the SAME session read-only:
 * its id, its saved transcript (digest compared in Node only), no idle recorder and no live microphone. Only booleans leave.
 */
export async function reloadRestoredSession(page: Page, sessionId: string, savedDigest: string, savedCoaching?: SavedCoaching): Promise<{
    restored: boolean; sameSession: boolean; idleShown: boolean; liveTracks: number | null; transcriptMatches: boolean;
    review: 'saved' | 'try_again' | 'not_available' | 'missing';
}> {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const restored = page.getByTestId('saved-session-return');
    const shown = await restored.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    const sameSession = shown && (await restored.getAttribute('data-session-id').catch(() => null)) === sessionId;
    const idleShown = (await page.getByTestId('mic-start').count()) > 0;
    const liveTracks = await liveMicTracks(page).catch(() => null);
    const transcript = page.getByTestId('review-transcript');
    const transcriptMatches = savedDigest !== '' && await transcript.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
        && sha256Hex(await transcript.innerText()) === savedDigest;
    // The review is read AFTER the reload too, never inferred from the Back state.
    const review = sameSession ? await readRestoredReview(page, savedCoaching) : 'missing';
    return { restored: shown, sameSession, idleShown, liveTracks, transcriptMatches, review };
}

export function backFromProgressRows(receipt: RwtReceipt, b: Awaited<ReturnType<typeof backFromProgressRestoresSession>>,
    coachingSaved: boolean, requestsBefore: number, requestsAfter: number): void {
    receipt.row('Back from Progress restores the session', b.left && b.restored && !b.idleShown && b.liveTracks === 0 ? 'PASS' : 'FAIL',
        !b.left ? 'the header Progress link did not open Progress'
            : !b.restored ? 'browser Back did not restore this saved session'
                : b.idleShown ? 'browser Back showed the idle recorder'
                    : b.liveTracks !== 0 ? 'a microphone was live (or unreadable) right after Back'
                        : 'browser Back from Progress restored this saved session read-only, microphone off', { liveTracksAfterBack: b.liveTracks });
    // A saved pair must come back word for word; with none saved, the newest session keeps its transcript, so Try again.
    const reviewOk = coachingSaved ? b.review === 'saved' : b.review === 'try_again';
    receipt.row('restored review', !b.restored ? 'HOLD' : reviewOk ? 'PASS' : 'FAIL',
        !b.restored ? 'no restored session to read'
            : coachingSaved ? (reviewOk ? 'the restored session shows its saved coaching' : `the saved coaching did not come back (${b.review})`)
                : (reviewOk ? 'no coaching was saved; the restored session offers Try again' : `no Try again offered (${b.review})`));
    receipt.row('Back requests no coaching', requestsAfter === requestsBefore ? 'PASS' : 'FAIL',
        requestsAfter === requestsBefore ? 'Progress and Back requested no review' : 'Back or Progress requested coaching',
        { coachingRequestsBefore: requestsBefore, coachingRequestsAfter: requestsAfter });
}

/**
 * #1532 Codex P1 r4121232419 (PO disposition: full loop 4) — open the header Products menu IN PLACE on the session
 * page (a product route, so no journey boundary) and close it again, so `products_menu_opened` is emitted inside the
 * recording journey where the `analytics_inventory` stage proves it was received. Navigates nowhere.
 */
export async function openProductsMenuInPlace(page: Page): Promise<boolean> {
    const resolved = await resolveProductsTrigger(page).catch(() => null);
    const opened = resolved ? await resolved.trigger.click({ timeout: 20_000 }).then(() => true).catch(() => false) : false;
    await page.keyboard.press('Escape').catch(() => undefined);
    return opened;
}

export function analyticsRows(receipt: RwtReceipt, a: Awaited<ReturnType<typeof analyticsThroughActions>>, externalCoaching = false): void {
    receipt.row('Analytics action', a.actionClicked && a.listed ? 'PASS' : 'FAIL',
        a.actionClicked ? (a.listed ? 'the on-screen Analytics action opened Analytics and it lists this session' : 'Analytics opened but does not list this session')
            : 'the post-save Analytics action was not shown or did not open Analytics');
    receipt.row('analytics session detail', a.detailOpened && a.detailMatches ? 'PASS' : 'FAIL',
        a.detailMatches ? 'the session opened from its own control with the saved transcript (digest equal)'
            : a.detailOpened ? 'the opened transcript differs from the saved one' : 'the session detail did not open from its control');
    receipt.row('reopen after reload', a.reloadMatches ? 'PASS' : 'FAIL',
        a.reloadMatches ? 'after a hard reload the detail still shows the saved transcript' : 'after reload the detail was missing or differed');
    // Runbook (3) row 6 (PM 2026-09-25): the reopened session's Analytics detail shows BOTH saved AI suggestions,
    // before and after a reload. Home may show only the next-action teaser; it is not checked here.
    if (a.coachingBefore && a.coachingAfter) {
        const both = (c: CoachingShown) => c.well && c.next;
        const ok = both(a.coachingBefore) && both(a.coachingAfter);
        receipt.row('analytics detail shows both AI suggestions', ok ? 'PASS' : 'FAIL',
            ok ? 'the session detail shows both saved suggestions, before and after reload'
                : 'the session detail does not show both saved suggestions (Practice Loop product repair)',
            { wellBefore: a.coachingBefore.well, nextBefore: a.coachingBefore.next, wellAfterReload: a.coachingAfter.well, nextAfterReload: a.coachingAfter.next });
        // G20 (runbook v12 row 6): the saved review leads the page, carries a product-specific "From this session"
        // measurement, and owns the ONE next action — before and after the reload.
        const after = a.coachingAfter;
        receipt.row('saved review is the first block', a.coachingBefore.first && after.first ? 'PASS' : 'FAIL',
            after.first ? 'the saved review sits above the Progress panel' : 'the saved review is not the first block');
        receipt.row('"From this session" evidence', after.evidenceShown && after.evidenceMatches ? 'PASS' : after.evidenceShown ? 'FAIL' : 'HOLD',
            after.evidenceShown ? (after.evidenceMatches ? 'a product-specific measured line is shown' : 'the evidence line is not this product\'s measurement')
                : 'no evidence line (acceptable only when no truthful persisted signal exists; reviewed by PM)',
            { evidenceShown: after.evidenceShown, evidenceMatches: after.evidenceMatches });
        receipt.row('one practice action', a.coachingBefore.oneAction && after.oneAction ? 'PASS' : 'FAIL',
            after.oneAction ? 'exactly one practice action, with no competing Progress sentence or button' : 'zero or several practice actions, or a competing Progress action');
    } else if (externalCoaching) {
        for (const step of COACHING_DEPENDENT_ANALYTICS_ROWS) {
            receipt.row(step, 'EXTERNAL', 'not exercised: the take has no saved coaching because the provider was unavailable (external, non-blocking per PO)');
        }
    }
}

/**
 * After the fresh sign-in, the session the page holds must itself bear the server-issued canary claim (read from the
 * stored session's user.app_metadata; booleans only). Traffic class is checked separately by telemetryClassRows.
 */
export async function canaryClaimRow(page: Page, receipt: RwtReceipt, claimed: boolean): Promise<void> {
    if (!claimed) { receipt.row('session bears canary claim', 'HOLD', 'the canary claim was not authorized for this run'); return; }
    const bears = await page.evaluate(() => Object.keys(localStorage).some((key) => {
        if (!/^sb-.*-auth-token$/.test(key)) return false;
        try {
            const value = JSON.parse(localStorage.getItem(key) ?? '{}') as { user?: { app_metadata?: { canary?: unknown } } };
            return value.user?.app_metadata?.canary === true;
        } catch { return false; }
    }));
    receipt.row('session bears canary claim', bears ? 'PASS' : 'FAIL',
        bears ? 'after the fresh sign-in the session carries the server-issued canary claim' : 'the claim was set but the fresh session does not carry it');
}

/**
 * SHARE FEEDBACK through the product's own dialog: acknowledgement shown, stored exactly once for this account.
 * Returns the stored report's id (kept in memory only) so retention can be proven AFTER the account is deleted
 * (`feedbackRetentionAfterDeletionRow`, #1532 Codex P1 r4105978630) — a pre-deletion read proves only insertion.
 */
export async function shareFeedbackRows(
    page: Page,
    receipt: RwtReceipt,
    admin: { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ data: Array<{ id: unknown }> | null; error: { code?: string } | null }> } } } },
    uid: string,
    tap?: AnalyticsTap,
): Promise<string | null> {
    const since = new Date(Date.now() - 1_000).toISOString();
    const feedbackBefore = tap?.sent('feedback_submit').length ?? 0;
    await page.getByTestId('nav-report-issue-button').first().click();
    await expect(page.getByTestId('issue-report-dialog')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('feedback-type-praise').click();
    await page.getByTestId('issue-report-description').fill('RWT automated journey check from a disposable account. Please ignore.');
    await tap?.captureActionBindingSettled(page, 'share_feedback', expectedReleaseSha(), process.env.GITHUB_RUN_ID ?? '', process.env.GITHUB_RUN_ATTEMPT ?? '');
    await page.getByTestId('issue-report-submit').click();
    const acknowledged = await page.getByText('Thanks — we’ve got it.').first()
        .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    // #1258 R8: before the next step navigates away, wait (bounded) until the tap has observed this submission's
    // feedback_submit events — `attempted` plus its outcome — so they leave on an ordinary flush, not at unload.
    const settled = tap ? await tap.awaitObserved(page, { feedback_submit: feedbackBefore + (acknowledged ? 2 : 1) }) : null;
    if (settled) receipt.meta.feedbackTelemetryObserved = settled.observed;
    const { data, error } = await admin.from('user_issue_reports').select('id').eq('user_id', uid).gte('created_at', since);
    if (error) throw new Error(`feedback read failed (fail closed): ${error.code ?? 'unknown'}`);
    const storedOnce = data?.length === 1;
    // #1258 (PM 5944997435): without an acknowledgement, say which branch the dialog is in (closed booleans only).
    const ui = acknowledged ? null
        : await readFeedbackUiState(page, { boundMs: STEP_DIAGNOSTIC_BOUND_MS, readTimeoutMs: STEP_DIAGNOSTIC_READ_MS, kindTestId: 'feedback-type-praise' });
    receipt.row('feedback', acknowledged && storedOnce ? 'PASS' : 'FAIL',
        acknowledged ? (storedOnce ? 'acknowledged and stored once' : 'acknowledged but not stored exactly once') : 'no acknowledgement shown',
        { stored: data?.length ?? 0, ...(ui ? { errorShown: ui.errorShown, dialogOpen: ui.dialogOpen, submitEnabled: ui.submitEnabled, kindChosen: ui.kindChosen, diagnosticTimedOut: ui.timedOut } : {}) });
    const id = storedOnce ? data?.[0]?.id : null;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

/**
 * FEEDBACK RETENTION, proven after deletion (#1532 Codex P1 r4105978630). Deletes the run-owned account (the shared
 * `cleanupRunOwnedAccount`, via `deleteAccount`), then reads the stored report by its id: PASS only when it still
 * exists with its user link cleared (user_issue_reports.user_id ON DELETE SET NULL, product policy). Returns whether
 * the deletion completed, so the caller's afterEach does not repeat it. The report is never deleted by this run.
 */
export async function feedbackRetentionAfterDeletionRow(
    receipt: RwtReceipt,
    admin: { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ user_id: unknown }> | null; error: { code?: string } | null }> } } },
    reportId: string | null,
    deleteAccount: () => Promise<unknown>,
): Promise<boolean> {
    let deleted = false;
    if (reportId) {
        try { await deleteAccount(); deleted = true; } catch { deleted = false; }
    }
    let read: { error: boolean; rows: Array<{ user_id: unknown }> } | null = null;
    if (reportId && deleted) {
        const { data, error } = await admin.from('user_issue_reports').select('user_id').eq('id', reportId);
        read = { error: Boolean(error), rows: data ?? [] };
    }
    const v = feedbackRetentionVerdict({ reportId, deletion: deleted ? 'deleted' : 'failed', read });
    receipt.row('feedback retention', v.verdict, v.detail, v.evidence);
    return deleted;
}

/**
 * MODEL TRUTH, one row for every product receipt (PM 2026-09-25). REQUESTED is what this run asked for (the deployed
 * default, or the authorized one-run switch target); OBSERVED is what the runtime reports actually ran. A switch run
 * PASSES only when the observed engine and model are the requested candidate with no fallback. A default run records
 * what ran — it is diagnostic, and never evidence for the base_q4 primary (that stays its own HOLD row).
 */
const CANDIDATE_EXPECTATION: Record<string, { engine: string; model: RegExp }> = {
    'v2:base.en': { engine: 'transformers-js', model: /base\.en/i },
    'v4:distil:q4': { engine: 'transformers-js-v4', model: /distil/i },
};

export function modelIdentityRow(receipt: RwtReceipt, run: RunTarget, identity: Record<string, unknown> | null, acquisitionMs: number, cpuRuntime: Record<string, number | boolean | null> | null = null): void {
    const text = (k: string) => (typeof identity?.[k] === 'string' ? identity[k] as string : null);
    const observed = {
        engine: text('engine'), modelId: text('modelId'), runtimeVersion: text('runtimeVersion'),
        resolvedDevice: text('resolvedDevice'), backend: text('backend'), fallback: identity?.fallbackOccurred === true,
    };
    const requested = run.mode === 'switch' ? run.target : 'deployed default';
    receipt.meta.requestedModel = requested;
    receipt.meta.observedModel = observed.modelId;
    receipt.meta.observedEngine = observed.engine;
    receipt.meta.runtimeVersion = observed.runtimeVersion;
    // Flat, prefixed keys: receipt evidence is one level of scalars.
    const cpu = cpuRuntime ? Object.fromEntries(Object.entries(cpuRuntime).map(([k, v]) => [`cpu_${k}`, v])) : {};
    const evidence = { requested, ...observed, acquisitionMs, ...cpu };
    if (!observed.modelId) { receipt.row('model identity', 'FAIL', 'the runtime reported no running model', evidence); return; }
    if (observed.fallback) { receipt.row('model identity', 'FAIL', 'a fallback engine ran instead of the requested model', evidence); return; }
    if (run.mode === 'switch') {
        const want = CANDIDATE_EXPECTATION[run.target];
        const matches = Boolean(want) && observed.engine === want.engine && want.model.test(observed.modelId);
        receipt.row('model identity', matches ? 'PASS' : 'FAIL',
            matches ? `the requested ${run.target} ran (${run.target.startsWith('v4:') ? 'comparison evidence' : 'diagnostic'})` : `requested ${run.target} but a different model ran`, evidence);
        return;
    }
    receipt.row('model identity', 'PASS', 'the deployed default ran and identified itself (diagnostic; not base_q4 evidence)', evidence);
}

/** Words the coaching must never use about a point the matcher did not detect (runbook v12: no certainty of omission). */
const OMISSION_CLAIM = /\b(miss(ed|ing)?|skip(ped)?|forg(o|e)t|left out|didn'?t (mention|cover|say)|never (mentioned|covered|said))\b/i;

/**
 * #1258 (runbook v12 Product 2 row 5) — the Focus Points coaching pair after Stop, as the person sees it. The same
 * contract as Open Mic (two distinct phrases (about 8–10 words: a soft target), visible = saved, server receipt) plus the Focus rules: the
 * request is marked focus_points, and neither phrase claims a point was missed or skipped. Relevance to the chosen
 * points stays a human judgement (HOLD). Text is compared in Node and returned only for the Analytics comparison.
 */
/** #1258 R3b: one coaching phrase by its test id, inside the card, bounded; '' when it is not there. */
export const COACHING_PHRASE_READ_MS = 5_000;
export async function readCoachingPhrase(card: Locator, testId: 'review-what-went-well' | 'review-try-next'): Promise<string> {
    const node = card.getByTestId(testId).first();
    if ((await node.count().catch(() => 0)) === 0) return '';
    return (await node.innerText({ timeout: COACHING_PHRASE_READ_MS }).catch(() => '')).trim();
}

/**
 * #1258 (Codex P1 r4277621600, PM 6182054477) — a BOUNDED tri-state observation of one review phrase node (the shared
 * `PracticeLoopReviewPair` test ids). `absent` only when the node count is a proved zero; `present` when the node exists
 * and its text was read; `unreadable` when the count or the text read failed, timed out or the node detached. Unlike
 * `readCoachingPhrase`, an error is never collapsed into '' — so it can never be taken for a confirmed absence. The text
 * itself is not returned (nothing visible is written to a receipt).
 */
export type PhraseObservation = 'absent' | 'present' | 'unreadable';
export async function observeCoachingPhrase(card: Locator, testId: 'review-what-went-well' | 'review-try-next'): Promise<PhraseObservation> {
    const nodes = card.getByTestId(testId);
    const count = await Promise.race([
        nodes.count(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('phrase count timed out')), COACHING_PHRASE_READ_MS)),
    ]).catch(() => null);
    if (count === null) return 'unreadable';
    if (count === 0) return 'absent';
    return nodes.first().innerText({ timeout: COACHING_PHRASE_READ_MS }).then(() => 'present' as const).catch(() => 'unreadable' as const);
}

/** Confirmed VISIBLE absence of both phrases: true only when both are proved absent; false if either is shown; else unknown. */
export function visibleCoachingAbsence(well: PhraseObservation, next: PhraseObservation): boolean | null {
    if (well === 'present' || next === 'present') return false;
    return well === 'absent' && next === 'absent' ? true : null;
}

/**
 * #1258 (PM 6171519534) — the review card's own handling of a failed generation, read without pressing anything (a
 * press would be another provider request). Bounded reads; a missing control reads as not shown / not enabled.
 */
export async function readCoachingFailureUi(card: Locator): Promise<{ unavailableShown: boolean; retryEnabled: boolean }> {
    const headline = card.getByTestId('ai-suggestions-headline');
    const shown = (await headline.innerText({ timeout: 5_000 }).catch(() => '')).trim();
    const retry = card.getByTestId('ai-suggestions-retry');
    const visible = await retry.isVisible().catch(() => false);
    const enabled = visible && await retry.isEnabled({ timeout: 5_000 }).catch(() => false);
    const label = visible ? (await retry.innerText({ timeout: 5_000 }).catch(() => '')).trim() : '';
    return { unavailableShown: shown === UNAVAILABLE_HEADLINE, retryEnabled: enabled && label === 'Try again' };
}

/**
 * #1258 (Codex P1 r4277023741, PM 6180080622) — the FIRST-TAKE save proof for the Focus suites. Their account is a fresh
 * run-owned account and this checkpoint runs before Practice-again or any product switch, so the account must hold
 * EXACTLY ONE completed session, and it must be this take's exact owner/session row. A count filtered by the session id
 * could never see a duplicate saved under a second id. Any read error, null count, missing row or duplicate is NOT
 * proven — it can never authorize EXTERNAL.
 */
export async function firstTakeSavedExactlyOnce(admin: SupabaseClient, uid: string, sessionId: string): Promise<{
    proven: boolean; accountCompletedSessions: number | null; thisTakeCompleted: boolean | null;
}> {
    const account = await admin.from('sessions').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).eq('status', 'completed');
    const accountCompletedSessions = account.error || typeof account.count !== 'number' ? null : account.count;
    const own = await admin.from('sessions').select('id').eq('id', sessionId).eq('user_id', uid).eq('status', 'completed').maybeSingle();
    const thisTakeCompleted = own.error ? null : (own.data as { id?: unknown } | null)?.id === sessionId;
    return { proven: accountCompletedSessions === 1 && thisTakeCompleted === true, accountCompletedSessions, thisTakeCompleted };
}

export async function focusCoachingRows(
    page: Page,
    receipt: RwtReceipt,
    admin: SupabaseClient,
    sessionId: string,
    uid: string,
    request: {
        product: string | null; status: number | null; acceptedVersions?: unknown; reason?: string | null; reasonRead?: Promise<void> | null;
        /** #1258 (PM 6173420642 §3): the request-boundary authority — each exchange is its own request/response tuple. */
        generations?: CoachingGenerationTap;
        /** #1258 R4: the set's labels and the rail's final statuses, so the advice can be checked against an open point. */
        openPoints?: { labels: readonly string[]; statuses: readonly (string | null)[] };
    },
): Promise<SavedCoaching | null> {
    const card = page.getByTestId('ai-suggestions-card');
    const terminal = await expect.poll(async () => card.getAttribute('data-review-state'), { timeout: 180_000 })
        .toMatch(/^(ready|error|blocked)$/).then(() => true).catch(() => false);
    const state = await card.getAttribute('data-review-state').catch(() => null);
    // The failure response arrives during the terminal wait above, so its reason is settled HERE, after that wait and
    // before any row is written (Codex r4189408865). A read still pending at the bound is UNKNOWN, never `null`.
    if (!(await settleCoachingReason(request.reasonRead))) request.reason = COACHING_REASON_UNKNOWN;
    // PM 6173420642 §3: THIS take's own exchange from the request-boundary tap, after a bounded wait for its body. An
    // exchange still unread at the bound is simply absent, so nothing is proved from it.
    // #1474 (Codex r4305107827, Sam 6243698211): read through the tap's own bounded settle; a 5 s cap read early.
    const take = takeExchangeEvidence(request.generations ? await request.generations.settledForSession(sessionId) : []);
    // #1258 R3b (run 38308997906 hung 24 min here): read each phrase from the review pair's own test id, bounded. The old
    // heading → div → <p> walk waited without limit when its structure did not resolve. A phrase that is absent reads as
    // '' and the row below FAILs; the rendered-vs-saved check is unchanged.
    const phrase = (testId: 'review-what-went-well' | 'review-try-next') => readCoachingPhrase(card, testId);
    const well = await phrase('review-what-went-well');
    const next = await phrase('review-try-next');
    const two = terminal && state === 'ready' && well !== '' && next !== '';
    // #1258 (PO 2026-10-14, PM 6171519534): a PROVED provider outage that the app handled gracefully is EXTERNAL, never PASS.
    // Codex P1 r4277023741: exactly one completed save on the fresh run-owned account, and it is this take's row.
    const firstSave = two ? null : await firstTakeSavedExactlyOnce(admin, uid, sessionId);
    const savedTakeProven = firstSave?.proven ?? false;
    const ui = two ? { unavailableShown: false, retryEnabled: false } : await readCoachingFailureUi(card);
    // External proof comes ONLY from this take's exchange tuple; without one, nothing is proved.
    const parent = coachingParentVerdict({
        rendered: two,
        evidence: take.evidence,
        graceful: { savedTakeProven, reviewState: state, ...ui, requestBoundToSession: take.unique },
    });
    receipt.row('Focus coaching rendered', parent.verdict,
        two ? 'two coaching phrases rendered after Stop without any click' : parent.detail,
        { reviewState: state, httpStatus: take.unique ? take.evidence.httpStatus : request.status, failureReason: take.unique ? take.evidence.reason : request.reason ?? null,
            providerStatus: take.evidence.providerStatus, externalOutcome: parent.external, savedTakeProven: two ? null : savedTakeProven,
            providerErrorStatus: take.evidence.providerErrorStatus ?? null, providerAttempts: take.evidence.providerAttempts ?? null,
            accountCompletedSessions: firstSave?.accountCompletedSessions ?? null, thisTakeCompleted: firstSave?.thisTakeCompleted ?? null,
            unavailableShown: two ? null : ui.unavailableShown, retryEnabled: two ? null : ui.retryEnabled, takeExchangeUnique: take.unique });
    receipt.row('Focus coaching request marked focus_points', request.product === 'focus_points' ? 'PASS' : 'FAIL',
        request.product === 'focus_points' ? 'the request asked for coaching about this take\'s chosen points' : 'the request was not marked focus_points',
        { requestProduct: request.product });
    // PM 6171519534 §4: request provenance is judged on its own, on every path — never waived by an external outcome.
    const binding = request.generations
        ? coachingRequestBindingRow(request.generations, sessionId)
        : { verdict: 'HOLD' as const, detail: 'no coaching request record was attached', bound: null };
    receipt.row('Focus coaching request bound to this take', binding.verdict, binding.detail, { requestBoundToSession: binding.bound });
    if (!two) {
        if (parent.verdict === 'EXTERNAL') {
            // PM 6173420642 §1: the exact owner/session saved coaching is read BEFORE any row may be "not exercised" — an
            // answer saved for a failed request is FAIL, an unreadable one is unproven. The human check stays unobserved.
            const rows = await focusExternalDependentRows(parent, async () => {
                const { data, error: savedErr } = await admin.from('sessions').select('ai_suggestions').eq('id', sessionId).eq('user_id', uid).single();
                if (savedErr) return { ok: false as const };
                return { ok: true as const, raw: (data as { ai_suggestions?: unknown } | null)?.ai_suggestions ?? null };
            }, // Codex P1 r4277621600: a bounded tri-state read of the shared review-pair nodes — unreadable is never absence.
            visibleCoachingAbsence(await observeCoachingPhrase(card, 'review-what-went-well'), await observeCoachingPhrase(card, 'review-try-next')));
            for (const r of rows) receipt.row(r.step, r.verdict, r.detail, r.evidence);
            humanObservation(receipt, 'focus_coaching_covers_points', 'Product 2 row 5', 'Focus coaching helps cover the chosen points',
                'both phrases address covering THESE points (placement, signposting or pace) supported by this speech; no invented miss');
        }
        return null;
    }
    const inTarget = (n: number) => n >= COACHING_PHRASE_TARGET_MIN_WORDS && n <= COACHING_PHRASE_TARGET_WORDS;
    const withinTarget = inTarget(countWords(well)) && inTarget(countWords(next));
    receipt.row('Focus coaching length', 'PASS',
        withinTarget ? `both phrases within the ${COACHING_PHRASE_TARGET_MIN_WORDS}-${COACHING_PHRASE_TARGET_WORDS}-word target`
            : `served whole; a phrase is outside the ${COACHING_PHRASE_TARGET_MIN_WORDS}-${COACHING_PHRASE_TARGET_WORDS}-word band (${bandSide(countWords(well), countWords(next), COACHING_PHRASE_TARGET_MIN_WORDS, COACHING_PHRASE_TARGET_WORDS)}; a quality measure, not a failure)`,
        { wellWords: countWords(well), nextWords: countWords(next), withinTarget });
    const distinct = normalisePhraseText(well) !== normalisePhraseText(next);
    receipt.row('Focus coaching distinct', distinct ? 'PASS' : 'FAIL', distinct ? 'two different suggestions' : 'both headings show the same phrase');
    const claims = OMISSION_CLAIM.test(well) || OMISSION_CLAIM.test(next);
    receipt.row('Focus coaching makes no omission claim', claims ? 'FAIL' : 'PASS',
        claims ? 'a phrase claims a point was missed or skipped (the matcher cannot know that)' : 'neither phrase claims a point was missed or skipped');
    // #1258 R4: the provider schema's own ceiling, and an evident reference to a point that is still open (never a FAIL on
    // wording: the human check decides when no open point is named).
    const ceiling = characterCeilingVerdict(well, next);
    receipt.row('Focus coaching within the character ceiling', ceiling.status, ceiling.detail, { wellChars: well.length, nextChars: next.length });
    const openPoint = request.openPoints
        ? openPointReferenceVerdict({ well, next, labels: request.openPoints.labels, statuses: request.openPoints.statuses })
        : { status: 'HOLD' as const, detail: 'the rail\'s final statuses were not supplied' };
    receipt.row('Focus coaching refers to an open point', openPoint.status, openPoint.detail);
    humanObservation(receipt, 'focus_coaching_covers_points', 'Product 2 row 5', 'Focus coaching helps cover the chosen points',
        'both phrases address covering THESE points (placement, signposting or pace) supported by this speech; no invented miss');

    const { data: row, error } = await admin.from('sessions').select('ai_suggestions').eq('id', sessionId).eq('user_id', uid).single();
    if (error) throw new Error(`saved coaching read failed (fail closed): ${error.code ?? 'unknown'}`);
    const saved = (row?.ai_suggestions ?? null) as { version?: unknown; what_worked?: unknown; what_to_try_next?: unknown } | null;
    const savedWell = typeof saved?.what_worked === 'string' ? saved.what_worked.trim() : '';
    const savedNext = typeof saved?.what_to_try_next === 'string' ? saved.what_to_try_next.trim() : '';
    // #1538 (PROPOSAL): the saved pair's provenance and the request's declared capability. Closed-set values only.
    const provenance = focusCoachingProvenanceVerdict({
        savedVersion: typeof saved?.version === 'string' ? saved.version : null, acceptedVersions: request.acceptedVersions,
    });
    receipt.row('Focus coaching provenance', provenance.verdict, provenance.detail,
        { savedVersion: typeof saved?.version === 'string' ? saved.version : null });
    const matches = savedWell !== '' && savedNext !== ''
        && normalisePhraseText(well) === normalisePhraseText(savedWell) && normalisePhraseText(next) === normalisePhraseText(savedNext);
    receipt.row('Focus coaching visible = saved', matches ? 'PASS' : 'FAIL',
        matches ? 'both visible phrases equal the saved coaching response' : 'a visible phrase differs from, or is missing in, the saved response');
    const { data: authority, error: aErr } = await admin.from('ai_suggestion_authority_receipts')
        .select('session_id,provider_request_made').eq('session_id', sessionId).eq('user_id', uid).maybeSingle();
    if (aErr) throw new Error(`coaching receipt query failed (fail closed): ${aErr.code ?? 'unknown'}`);
    receipt.row('Focus coaching server receipt', authority?.provider_request_made ? 'PASS' : 'FAIL',
        authority ? 'the server recorded the provider request for this session' : 'no server receipt for this session');
    return savedWell !== '' && savedNext !== '' ? { well: savedWell, next: savedNext } : null;
}

/**
 * #1258 (runbook v12 Product 2 row 3) — the rail's visible states: each marker's RENDERED colour (not only
 * data-status) against the product's colour roles, and its visible status word. Colours are read from the page's own
 * `--brand-*` roles so a palette change is followed, not hard-coded.
 */
export async function railStateRows(page: Page, receipt: RwtReceipt, count: number, phase: 'before' | 'after'): Promise<void> {
    const observed = await page.evaluate(({ n }) => {
        const toRgb = (value: string) => {
            const probe = document.createElement('span');
            probe.style.color = value.trim();
            document.body.appendChild(probe);
            const rgb = getComputedStyle(probe).color;
            probe.remove();
            return rgb;
        };
        const root = getComputedStyle(document.documentElement);
        const roles = {
            green: toRgb(root.getPropertyValue('--brand-progress-bar')),
            yellow: toRgb(root.getPropertyValue('--brand-signature')),
            red: toRgb(root.getPropertyValue('--brand-error')),
        };
        const rows = Array.from({ length: n }, (_, i) => {
            const marker = document.querySelector(`[data-testid="focus-point-${i}-marker"]`) as HTMLElement | null;
            const row = document.querySelector(`[data-testid="focus-point-${i}"]`) as HTMLElement | null;
            if (!marker || !row) return null;
            const cs = getComputedStyle(marker);
            return { kind: marker.getAttribute('data-marker'), bg: cs.backgroundColor, border: cs.borderTopColor, text: row.innerText };
        });
        const legend = document.querySelector('[data-testid="focus-points-legend"]') as HTMLElement | null;
        return { roles, rows, legend: legend ? legend.innerText : null };
    }, { n: count });
    const rows = observed.rows;
    if (phase === 'before') {
        const legendOk = observed.legend !== null
            && ['Not heard yet', 'Partly detected', 'Detected', 'Not detected'].every((w) => observed.legend!.includes(w));
        receipt.row('rail legend', legendOk ? 'PASS' : 'FAIL', legendOk ? 'a visible legend explains every state' : 'the legend is missing or incomplete');
        const pendingOk = rows.every((r) => r !== null && r.kind === 'pending' && /Not heard yet/.test(r.text));
        receipt.row('pending points labelled', pendingOk ? 'PASS' : 'FAIL', pendingOk ? 'each point starts pending with a visible "Not heard yet"' : 'a point lacks its visible pending label');
        return;
    }
    const ok = rows.map((r) => {
        if (!r) return false;
        if (r.kind === 'covered') return r.bg === observed.roles.green && /Detected/.test(r.text);
        if (r.kind === 'partial') return r.bg === observed.roles.yellow && /Partly detected/.test(r.text);
        if (r.kind === 'missed') return r.border === observed.roles.red && /Not detected/.test(r.text);
        return false; // a final row may not stay pending
    });
    receipt.row('final rail colours and words', ok.every(Boolean) ? 'PASS' : 'FAIL',
        ok.every(Boolean) ? 'green Detected, yellow Partly detected, red Not detected — each with its visible word'
            : 'a final row\'s rendered colour or visible word is wrong',
        { rows: rows.map((r) => r?.kind ?? 'absent').join(','), matching: ok.filter(Boolean).length });
}
