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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateSync } from 'node:zlib';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
    AUDIO_ARGS,
    expectBenchmarkRecordingStarted,
    startBenchmarkRecording,
    stopBenchmarkRecording,
} from './benchmark-utils';
import { extractUidFromAuthStorage } from './proofAuthority';
import { evaluateThreeRecordingEntitlement } from './entitlementAuthority';

export const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';
/** The disposable-account prefix these suites own; `runOwnedCleanup` refuses any other. */
export const RWT_ACCOUNT_PREFIX = 'rwt-journey-';
/**
 * The exact acknowledgement a dispatch must pass (rc-gates.yml input `rwt_writes_ack`). These suites create and
 * delete a Production account, save sessions, call the coaching function and (Open Mic) file one feedback report.
 * Without this value they refuse before any navigation — an unacknowledged run is a HOLD, never a silent write.
 */
export const RWT_WRITES_ACK_VALUE = 'RWT-DISPOSABLE-ACCOUNT-WRITES';

export type Verdict = 'PASS' | 'FAIL' | 'HOLD';
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
        const signOut = page.getByTestId('sign-out-button').or(page.getByTestId('nav-sign-out-button')).first();
        await expect(signOut, 'the product offers sign-out').toBeVisible({ timeout: 30_000 });
        await signOut.click();
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
    return { uid, signupMs, signOutAndSignIn };
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
export function telemetryClassRows(receipt: RwtReceipt, tap: AnalyticsTap, claimed: boolean): { canaryJourneys: string[]; userJourneys: string[] } {
    const canaryJourneys = tap.journeyIds('canary');
    const userJourneys = tap.journeyIds('user');
    receipt.row('telemetry decodable', tap.undecodable === 0 && tap.events.length > 0 ? 'PASS' : 'FAIL', 'every analytics body decoded',
        { events: tap.events.length, undecodable: tap.undecodable });
    receipt.row('signup-stage telemetry (user class)', userJourneys.length > 0 ? 'PASS' : 'HOLD',
        'pre-claim signup events were sent as ordinary user traffic (sent, not yet received)',
        { userEvents: tap.events.filter((e) => e.trafficType === 'user').length, userJourneys: userJourneys.length });
    receipt.row('signup-stage telemetry received', 'HOLD', 'reported by the report-only user-stage readback step (received counts per family; never qualifying)');
    if (!claimed) {
        receipt.row('journey telemetry (canary class)', 'HOLD', 'the canary claim was not authorized for this run; no journey is readback-eligible');
    } else {
        const stray = tap.trafficTypes().filter((t) => t !== 'user' && t !== 'canary');
        receipt.row('journey telemetry (canary class)', canaryJourneys.length > 0 && stray.length === 0 ? 'PASS' : 'FAIL',
            canaryJourneys.length > 0 ? 'post-claim journey events were sent as canary' : 'no canary-class journey after the claim',
            { canaryEvents: tap.events.filter((e) => e.trafficType === 'canary').length, canaryJourneys: canaryJourneys.length, otherClasses: stray.join(',') });
    }
    receipt.row('journey telemetry received', 'HOLD', 'receipt in PostHog is proven by the readback step, not by this page');
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

/** The pre-credential surface: exact origin, exact deployed SHA, no test/mock injection. Returns failures, content-free. */
export async function approvedSurfaceFailures(page: Page): Promise<string[]> {
    const surface = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown> & { __APP_RELEASE__?: string; __APP_RUNTIME_CONFIG__?: { testMode?: boolean } };
        return {
            origin: location.origin,
            release: w.__APP_RELEASE__ ?? null,
            testMode: w.__APP_RUNTIME_CONFIG__?.testMode ?? false,
            injected: Object.keys(w).some((k) => /__E2E|__MOCK|__MSW|TEST_MODE/i.test(k)),
        };
    });
    const failures: string[] = [];
    if (surface.origin !== APPROVED_ORIGIN) failures.push('origin is not the approved Production origin');
    if (surface.release !== expectedReleaseSha()) failures.push(`deployed release ${String(surface.release)} != EXPECTED_RELEASE_SHA`);
    if (surface.injected) failures.push('a test/mock injection surface is present');
    if (surface.testMode) failures.push('runtime config is in test mode');
    return failures;
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
    journeyId?: string;
    attemptId?: string;
    bootId?: string;
    releaseSha?: string;
    trafficType?: string;
    /** Closed enums / opaque ids only — never content. */
    reason?: string;
    stage?: string;
}

/** Reads correlation keys from the page's own PostHog requests. "Sent", not "received". */
export class AnalyticsTap {
    readonly events: SentEvent[] = [];
    undecodable = 0;

    attach(page: Page): void {
        page.on('request', (request) => {
            let host = '';
            try { host = new URL(request.url()).host; } catch { host = ''; }
            if (!/posthog\.com$/i.test(host)) return;
            for (const entry of this.decode(request.postDataBuffer())) {
                const record = entry as { event?: unknown; properties?: Record<string, unknown> };
                if (typeof record?.event !== 'string') continue;
                const props = record.properties ?? {};
                const text = (key: string) => (typeof props[key] === 'string' ? props[key] as string : undefined);
                this.events.push({
                    event: record.event,
                    at: Date.now(),
                    journeyId: text('journey_id'),
                    attemptId: text('attempt_id'),
                    bootId: text('boot_id'),
                    releaseSha: text('release_sha'),
                    trafficType: text('traffic_type'),
                    reason: text('reason'),
                    stage: text('stage'),
                });
            }
        });
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

export const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

export interface ReceiptRow { step: string; verdict: Verdict; detail: string; evidence?: Record<string, string | number | boolean | null> }

/**
 * One product's receipt. A FAIL is recorded AND raised as a soft expectation, so the suite keeps collecting the
 * remaining rows and still ends red; a HOLD is recorded and never raised (it is not a pass and not a finding).
 */
export class RwtReceipt {
    readonly rows: ReceiptRow[] = [];
    readonly meta: Record<string, string | number | boolean | null> = {};

    constructor(readonly suite: string) {}

    row(step: string, verdict: Verdict, detail: string, evidence?: ReceiptRow['evidence']): void {
        this.rows.push({ step, verdict, detail, evidence });
        if (verdict === 'FAIL') expect.soft(verdict, `${step}: ${detail}`).toBe('PASS');
    }

    write(testInfo: TestInfo, journeyIds: string[], trafficTypes: string[], stages: string[], userStageJourneyIds: string[] = []): void {
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
            },
            // For the readback step: which journeys to read back, under which traffic class and declared stages.
            readback: { journeyIds, trafficType: 'canary', trafficTypes, stages, userStageJourneyIds },
            testStatus: testInfo.status ?? null,
        };
        writeFileSync(path.join(dir, `${this.suite}.receipt.json`), `${JSON.stringify(body, null, 2)}\n`);
        console.log(`RWT_RECEIPT ${JSON.stringify(body)}`);
    }
}

/** Serialized evidence must never carry these; a match is itself a FAIL row. */
export function receiptContentLeaks(receipt: RwtReceipt, forbidden: readonly string[]): string[] {
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
}> {
    const FINISHING_UP = /Finishing up your last session/;
    await page.goto('/session');
    try {
        await expect(page.getByTestId('mic-status')).toContainText('Mic ready on this device', { timeout: 60_000 });
    } catch {
        return { holdSeen: false, nextStartMs: null, stopped: false, liveTracksAfterStop: null, reason: 'the session page did not reach rest (mic-status)' };
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
        const tracks = await boundedTeardown(page, label);
        return { holdSeen, nextStartMs: null, stopped: false, liveTracksAfterStop: tracks, reason: 'the next Start did not begin recording' };
    }
    clearInterval(watch);
    try {
        await stopBenchmarkRecording(page, label);
    } catch {
        const tracks = await boundedTeardown(page, label);
        return { holdSeen, nextStartMs, stopped: false, liveTracksAfterStop: tracks, reason: 'the next take could not be stopped' };
    }
    const live = await expect.poll(() => liveMicTracks(page), { timeout: 10_000 }).toBe(0).then(() => 0).catch(async () => liveMicTracks(page));
    return { holdSeen, nextStartMs, stopped: true, liveTracksAfterStop: live, reason: live === 0 ? null : 'the microphone stayed live after Stop' };
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

/** Two rows from one next-Start attempt: the Start itself, and the Stop with the microphone confirmed off. */
export function nextStartRows(receipt: RwtReceipt, next: Awaited<ReturnType<typeof nextStartEvidence>>): void {
    const started = next.nextStartMs !== null;
    const startOk = started && !next.holdSeen && next.nextStartMs! < 15_000;
    receipt.row('next Start', startOk ? 'PASS' : 'FAIL',
        startOk ? 'the next take started without "Finishing up"'
            : !started ? (next.reason ?? 'the next Start did not begin') : next.holdSeen ? '"Finishing up" was shown' : 'the next Start exceeded the 15 s ceiling',
        { nextStartMs: next.nextStartMs, holdSeen: next.holdSeen });
    const offOk = next.stopped && next.liveTracksAfterStop === 0;
    receipt.row('next take stopped, microphone off', offOk ? 'PASS' : 'FAIL',
        offOk ? 'the take stopped and every microphone track ended'
            : !next.stopped ? (next.reason ?? 'the take could not be stopped') : 'the microphone stayed live after Stop',
        { stopped: next.stopped, liveTracksAfterStop: next.liveTracksAfterStop });
}

/**
 * ANALYTICS THROUGH THE CONTROLS THE PERSON USES (PM 2026-09-25). From the post-save screen: click the on-screen
 * Analytics action, confirm the destination lists THIS saved session, open it through its own control and compare
 * the rendered transcript to the saved one by digest; then reload and compare again. No direct URL navigation into
 * the detail — that would skip the button the PO clicks. Digests only; the text is never returned.
 */
export async function analyticsThroughActions(page: Page, sessionId: string, savedDigest: string): Promise<{
    actionClicked: boolean; listed: boolean; detailOpened: boolean; detailMatches: boolean; reloadMatches: boolean;
}> {
    const result = { actionClicked: false, listed: false, detailOpened: false, detailMatches: false, reloadMatches: false };
    const action = page.getByTestId('post-save-review-session-link');
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
    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = await page.getByTestId('session-detail-transcript').waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    result.reloadMatches = again && sha256Hex(await page.getByTestId('session-detail-transcript').innerText()) === savedDigest;
    return result;
}

export function analyticsRows(receipt: RwtReceipt, a: Awaited<ReturnType<typeof analyticsThroughActions>>): void {
    receipt.row('Analytics action', a.actionClicked && a.listed ? 'PASS' : 'FAIL',
        a.actionClicked ? (a.listed ? 'the on-screen Analytics action opened Analytics and it lists this session' : 'Analytics opened but does not list this session')
            : 'the post-save Analytics action was not shown or did not open Analytics');
    receipt.row('analytics session detail', a.detailOpened && a.detailMatches ? 'PASS' : 'FAIL',
        a.detailMatches ? 'the session opened from its own control with the saved transcript (digest equal)'
            : a.detailOpened ? 'the opened transcript differs from the saved one' : 'the session detail did not open from its control');
    receipt.row('reopen after reload', a.reloadMatches ? 'PASS' : 'FAIL',
        a.reloadMatches ? 'after a hard reload the detail still shows the saved transcript' : 'after reload the detail was missing or differed');
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
 * The marked automated report is retained by product policy after account deletion (user_id SET NULL) and is
 * reported as retained — never deleted by the run, never reported as deleted.
 */
export async function shareFeedbackRows(
    page: Page,
    receipt: RwtReceipt,
    admin: { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ data: Array<{ id: unknown }> | null; error: { code?: string } | null }> } } } },
    uid: string,
): Promise<void> {
    const since = new Date(Date.now() - 1_000).toISOString();
    await page.getByTestId('nav-report-issue-button').first().click();
    await expect(page.getByTestId('issue-report-dialog')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('feedback-type-praise').click();
    await page.getByTestId('issue-report-description').fill('RWT automated journey check from a disposable account. Please ignore.');
    await page.getByTestId('issue-report-submit').click();
    const acknowledged = await page.getByText('Thanks — we’ve got it.').first()
        .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    const { data, error } = await admin.from('user_issue_reports').select('id').eq('user_id', uid).gte('created_at', since);
    if (error) throw new Error(`feedback read failed (fail closed): ${error.code ?? 'unknown'}`);
    const storedOnce = data?.length === 1;
    receipt.row('feedback', acknowledged && storedOnce ? 'PASS' : 'FAIL',
        acknowledged ? (storedOnce ? 'acknowledged and stored once' : 'acknowledged but not stored exactly once') : 'no acknowledgement shown',
        { stored: data?.length ?? 0 });
    receipt.row('feedback retention', storedOnce ? 'PASS' : 'HOLD',
        'the marked automated report is retained by product policy after account deletion (not deleted by this run)',
        { retainedReports: data?.length ?? 0 });
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

export function modelIdentityRow(receipt: RwtReceipt, run: RunTarget, identity: Record<string, unknown> | null, acquisitionMs: number): void {
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
    const evidence = { requested, ...observed, acquisitionMs };
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
