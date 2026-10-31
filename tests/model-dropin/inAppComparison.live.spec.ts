import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
    injectAlignedFixtureAudio, resetFixtureAudioToStart, playFixtureAudioOnce,
    waitForFixtureAudioEnd, disposeFixtureAudio,
} from '../live/helpers/fixtureAudioStream';
import {
    selectBenchmarkMode, preparePrivateModelIfPrompted, startBenchmarkRecording,
    expectBenchmarkRecordingStarted, stopBenchmarkRecording,
} from '../live/helpers/benchmark-utils';
import { wordErrorRate } from '../evidence/werMetric';
import { attachProductEvidence } from '../../scripts/model-evaluator/product-evidence';
import { readSourceBinding, assertSameSource, servedSourceFiles, viteRawSource } from '../../scripts/model-evaluator/source-binding';
import { ComparisonBudget, elapsedMs, privateTimingMetrics, type ExecutionApproval } from './comparisonBounds';
import { readProductCampaign, verifyCampaignPackages } from '../../scripts/model-evaluator/product-campaign';
import { startCachedModelServer, installChunkedCachedModelFetch, comparisonInitPage } from './cachedModelAssets';
import { observeCompletedSave } from './completionObservation';
import { fetchAdmittedResponse } from './transportBoundary';

const root = fileURLToPath(new URL('../../', import.meta.url));
const campaign = readProductCampaign(root, process.env.EVAL_CAMPAIGN_FILE);
const {corpusPath, corpusBytes, corpus} = campaign;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const approval = JSON.parse(fs.readFileSync(process.env.EVAL_EXECUTION_APPROVAL_FILE || '', 'utf8')) as ExecutionApproval;
const priorCases = new Set((approval.resume?.priorCaseKeys??[]).filter(key=>!approval.resume?.retryCaseKeys?.includes(key)));
const plannedKeys = new Set(campaign.campaign.candidates.flatMap(id=>corpus.clips.flatMap(clip=>Array.from({length:corpus.trials},(_,trial)=>`${id}:${trial+1}:${clip.id}`))));
if([...priorCases].some(key=>!plannedKeys.has(key)))throw Error('bounded_resume_population_invalid');
const budget = new ComparisonBudget(approval);
const source = readSourceBinding(root);
const expectedRelease = process.env.EVAL_RELEASE_SHA || '';
const expectedPatch = process.env.EVAL_SOURCE_DELTA_SHA256 || '';
const expectedUntracked = process.env.EVAL_SOURCE_UNTRACKED_SHA256 || '';
const sourceRoot = process.env.EVAL_SOURCE_ROOT || '';
const apiOrigin = process.env.EVAL_API_ORIGIN || '';
const email = process.env.EVAL_TEST_EMAIL || '';
const password = process.env.EVAL_TEST_PASSWORD || '';
const SHARED_COORDINATOR_ROOT = '/Users/fibonacci/Documents/Codex/2026-10-29';
const coordinatorRoot = process.env.EVAL_COORDINATOR_ROOT || SHARED_COORDINATOR_ROOT;
const driverFiles = ['EXECUTION.md', 'cachedModelAssets.test.ts', 'cachedModelAssets.ts', 'comparisonBounds.test.ts', 'comparisonBounds.ts',
    'completionObservation.test.ts','completionObservation.ts','inAppComparison.live.spec.ts','ownedCleanup.mjs','ownedCleanup.node.test.mjs',
    'playwright.in-app.config.ts', 'productCollectorIntegration.test.ts', 'run-bounded-comparison.mjs','transportBoundary.node.test.mjs','transportBoundary.ts'];
const driverDigest = () => sha(driverFiles.map(file => `${file}:${sha(fs.readFileSync(path.join(root, 'tests/model-dropin', file)))}\n`).join(''));
test.describe.configure({ mode: 'serial' });
let modelCache: Awaited<ReturnType<typeof startCachedModelServer>> | undefined;
test.afterAll(async () => { await modelCache?.close(); budget.finishRun(); });

type Capture = {
    captureId: string; candidateId: string | null; active: boolean; sampleRateHz: number;
    receivedFrames: number; receivedSamples: number; lastReceivedAtMs: number | null;
};
async function capture(page: Page): Promise<Capture | null> {
    return page.evaluate(() => (window as unknown as {
        __PRIVATE_CAPTURE_RECEIPT__?: () => Capture;
    }).__PRIVATE_CAPTURE_RECEIPT__?.() ?? null);
}
async function identity(page: Page) {
    return page.evaluate(() => {
        const w = window as unknown as {
            __SS_ACTIVE_CANDIDATE__?: () => {
                requested: string; observed: string | null; expected: string; matches: boolean;
            };
            __STT_IDENTITY__?: () => { modelId?: string; runtimeProvider?: string; engine?: string; fallbackOccurred?: boolean };
            __PRIVATE_STT_RUNTIME_DEBUG__?: { provider?: string; runtime?: string; wasmThreadCount?: number; cloudFallbackAttempted?: boolean };
        };
        const selected = w.__SS_ACTIVE_CANDIDATE__?.();
        const runtime = w.__STT_IDENTITY__?.();
        return {
            requested: selected?.requested ?? null, observed: selected?.observed ?? null,
            expected: selected?.expected ?? null, matches: selected?.matches ?? false,
            modelId: runtime?.modelId ?? null,
            provider: w.__PRIVATE_STT_RUNTIME_DEBUG__?.provider ?? null,
            backendClass: w.__PRIVATE_STT_RUNTIME_DEBUG__?.runtime ?? null,
            wasmThreads: w.__PRIVATE_STT_RUNTIME_DEBUG__?.wasmThreadCount ?? null,
            cloudFallbackAttempted: w.__PRIVATE_STT_RUNTIME_DEBUG__?.cloudFallbackAttempted ?? null,
            fallbackOccurred: runtime?.fallbackOccurred ?? null,
        };
    });
}

// Project only fresh content-free acquisition fields inside the page. Never copy
// the queue/envelope or flush analytics to make a missing measurement appear.
async function acquisitions(page: Page, candidate: string, sinceEpochMs: number) {
    return page.evaluate(async ({ candidate, sinceEpochMs, release }) => {
        const modulePath = '/src/services/AnalyticsBuffer.ts';
        const { analyticsBuffer } = await import(modulePath);
        const nonnegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
        return analyticsBuffer.queue.filter((row: { event: string; timestamp: number; properties?: Record<string, unknown> }) =>
            row.event === 'private_model_acquisition_success' && row.timestamp >= sinceEpochMs && row.timestamp <= Date.now()
            && row.properties?.acquired_candidate_id === candidate && row.properties?.release_id === release)
            .map((row: { timestamp: number; properties: Record<string, unknown> }) => ({
                observedAtEpochMs: row.timestamp, totalMs: nonnegative(row.properties.total_ms),
                initMs: row.properties.measurement_completeness === 'complete' ? nonnegative(row.properties.init_ms) : null,
                completeness: ['complete','partial','unobserved'].includes(String(row.properties.measurement_completeness))
                    ? row.properties.measurement_completeness : null,
                cache: ['hit','miss','partial','unobserved'].includes(String(row.properties.cache_result)) ? row.properties.cache_result : null,
            }));
    }, { candidate, sinceEpochMs, release: expectedRelease });
}

test.beforeAll(async () => {
    const wrapperPid = process.env.SPEAKSHARP_INTERLOCK_HELD;
    if (coordinatorRoot !== SHARED_COORDINATOR_ROOT || !wrapperPid || !/^\d+$/.test(wrapperPid)
        || process.env.SPEAKSHARP_INTERLOCK === 'off' || process.env.GITHUB_ACTIONS === 'true') {
        throw new Error('The allocated local benchmark slot must hold the coordinator host interlock');
    }
    const lock = JSON.parse(fs.readFileSync(path.join(coordinatorRoot, '.host-locks', `benchmark.${wrapperPid}.lock`), 'utf8'));
    if (lock.kind !== 'benchmark' || lock.host !== hostname() || !Number.isInteger(lock.pid)) {
        throw new Error('Coordinator benchmark lock identity differs');
    }
    process.kill(lock.pid, 0);
    if (!email || !password) throw new Error('Existing specifically authorized EVAL_TEST_EMAIL/PASSWORD must be injected');
    const driverSha256 = driverDigest();
    if (approval.sourceHead !== expectedRelease || approval.sourceDeltaSha256 !== expectedPatch
        || approval.sourceUntrackedSha256 !== expectedUntracked || approval.driverSha256 !== driverSha256
        || approval.apiOrigin !== apiOrigin || approval.appOrigin !== process.env.EVAL_APP_URL
        || path.resolve(sourceRoot) !== path.resolve(root)) throw Error('bounded_approval_source_mismatch');
    if (!/^[a-f0-9]{40}$/.test(expectedRelease) || !/^[a-f0-9]{64}$/.test(expectedPatch)
        || !/^[a-f0-9]{64}$/.test(expectedUntracked) || !sourceRoot) {
        throw new Error('Exact serving source root, release SHA, delta and untracked-inventory SHA256 are required');
    }
    if (new URL(apiOrigin).origin !== apiOrigin || new URL(apiOrigin).protocol !== 'https:') {
        throw new Error('EVAL_API_ORIGIN must be the explicitly bound HTTPS auth/persistence origin');
    }
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
    const delta = execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 });
    const otherPaths = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'],
        { cwd: sourceRoot, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
    const untracked = otherPaths.map(relative => `${relative}:${sha(fs.readFileSync(path.join(sourceRoot, relative)))}\n`).join('');
    if (head !== expectedRelease || sha(delta) !== expectedPatch || sha(untracked) !== expectedUntracked) {
        throw new Error('Serving source changed since handback');
    }
    if (campaign.sha256 !== approval.campaignSha256 || campaign.takes !== approval.takes) throw Error('bounded_campaign_binding_mismatch');
    await verifyCampaignPackages(campaign.candidates);
    for (const clip of corpus.clips) {
        if (sha(fs.readFileSync(path.resolve(path.dirname(corpusPath), clip.path))) !== clip.wavSha256) {
            throw new Error('Frozen corpus WAV hash mismatch');
        }
    }
    modelCache = await startCachedModelServer(process.env.EVAL_ASSET_CACHE_RECEIPT || '', approval.assetReceiptSha256, approval.appOrigin, campaign.candidates);
});

for (let trial = 0; trial < corpus.trials; trial++) for (const clip of corpus.clips) for (const definition of campaign.candidates) {
    const candidate = definition.id;
    if(priorCases.has(`${candidate}:${trial+1}:${clip.id}`))continue;
    test(`${candidate} trial ${trial + 1} ${clip.id} through SpeakSharp Start-Stop-save-reopen`, async ({ page }, info) => {
        let phase = 'preflight';
        budget.beginTake();
        let collector: Awaited<ReturnType<typeof attachProductEvidence>> | undefined;
        let collectorFinished = false;
        const receipt: Record<string, unknown> = {
            candidate, packageDigest: definition.modelPackage?.digest ?? null, campaignSha256: campaign.sha256,
            trial: trial + 1, clip: clip.id, wavSha256: clip.wavSha256,
            corpusSha256: sha(corpusBytes), releaseSha: expectedRelease, sourceDeltaSha256: expectedPatch,
            sourceUntrackedInventorySha256: expectedUntracked,
            driverSha256: approval.driverSha256,
            runId: approval.runId,
            scope: 'SpeakSharp Open Mic through PrivateSTT; existing synthetic corpus; paid endpoints blocked',
            acceptance: 'HOLD', limits: ['synthetic_single_speaker_corpus', 'focus_not_run',
                'database_wide_uniqueness_not_observed', 'loaded_weight_identity_not_introspected',
                'paid_coaching_deliberately_unavailable'],
        };
        const blocked = { edgeRequests: 0, providerRequests: 0 };
        let transportFailures = 0;
        try {
            await page.context().routeWebSocket('**/*',
                socket => {
                    try { budget.admitWebSocket(socket.url()); socket.connectToServer(); }
                    catch { blocked.providerRequests++; socket.close(); }
                });
            // Block Edge/paid inference, preserving real auth and REST persistence. No fake transcripts/responses.
            await page.context().route('**/*', async route => {
                const url = new URL(route.request().url());
                let response: Awaited<ReturnType<typeof fetchAdmittedResponse>> | undefined;
                try {
                    response = await fetchAdmittedResponse(route, budget, modelCache);
                    if (url.origin === apiOrigin && (url.pathname === '/rest/v1/rpc/create_session_and_update_usage'
                        || url.pathname === '/auth/v1/token')) {
                        // Observe identity BEFORE the response reaches the product. Never log a body or token.
                        if (!response.ok()) { await route.abort(); throw Error('bounded_auth_or_creation_failed'); }
                        const data = await response.json();
                        if (url.pathname === '/auth/v1/token') {
                            if (data?.user?.id !== approval.expectedUserId) { await route.abort(); throw Error('bounded_account_identity_mismatch'); }
                        } else budget.bindSession(data?.new_session?.id);
                    }
                    await route.fulfill({ response });
                } catch {
                    blocked.edgeRequests++;
                    await route.abort().catch(() => {});
                    // Transport errors are sticky even when the app treats a rejected request as nonfatal.
                    transportFailures++;
                    try { budget.rejectTransport('bounded_transport_error'); } catch { /* sticky, sanitized */ }
                } finally {
                    await response?.dispose();
                }
            });
            const fixturePage=comparisonInitPage(page);
            await fixturePage.addInitScript(installChunkedCachedModelFetch,modelCache!.rangeOptions());
            receipt.assetDelivery='verified_cache; main-thread assets above256MiB use32MiB bounded HTTP ranges; not Internet cold download';
            await injectAlignedFixtureAudio(fixturePage, path.resolve(path.dirname(corpusPath), clip.path), { playback: 'controlled-once' });
            await page.goto('/auth/signin');
            const fixtureInstalled=await page.evaluate(()=>typeof (window as unknown as {__ss_playFixtureOnce__?:unknown}).__ss_playFixtureOnce__==='function'
                && navigator.mediaDevices.getUserMedia.toString().includes('__ss_fixtureGumCalls__'));
            expect(fixtureInstalled,'approved controlled fixture must replace getUserMedia before model preparation').toBe(true);
            receipt.fixtureControlVerified=true;
            expect(await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__) === expectedRelease,
                'served app release must match handback').toBe(true);
            // Reuse the shared evaluator's source parser and source inventory. Loopback source reads only.
            for (const file of servedSourceFiles(source)) {
                const url = `${approval.appOrigin}/${file.path.replace(/^frontend\//, '')}?raw&import`;
                budget.admit({url,method:'GET'});
                const response = await page.request.get(url,
                    { maxRedirects: 0, timeout: 30_000 });
                if (!response.ok() || sha(viteRawSource(await response.text())) !== file.sha256) throw Error('bounded_served_source_mismatch');
            }
            phase = 'existing-account-signin';
            await page.getByTestId('email-input').fill(email);
            await page.getByTestId('password-input').fill(password);
            const login = page.waitForResponse(response => response.url().startsWith(apiOrigin + '/auth/v1/token')
                && response.request().method() === 'POST');
            await page.getByTestId('sign-in-submit').click();
            expect((await login).ok(), 'existing identity authenticates').toBe(true);
            await expect(page).not.toHaveURL(/\/auth\//, { timeout: 30_000 });
            const existing = await page.evaluate(async expectedUserId => {
                const modulePath = '/src/lib/supabaseClient.ts';
                const { getSupabaseClient } = await import(modulePath);
                const client = getSupabaseClient();
                const auth = await client.auth.getUser();
                if (auth.error || auth.data.user?.id !== expectedUserId) throw Error('bounded_account_identity_mismatch');
                const rows = await client.from('sessions').select('id').eq('user_id', expectedUserId).limit(19);
                if (rows.error || !Array.isArray(rows.data)) throw Error('bounded_empty_account_check_failed');
                return rows.data.map((row: { id: string }) => row.id);
            }, approval.expectedUserId);
            budget.assertExistingSessions(existing);
            budget.assertHealthy();
            await page.goto('/session');
            await selectBenchmarkMode(page, 'private');
            phase = 'candidate-selection';
            const selectionStartedEpochMs = await page.evaluate(() => Date.now());
            const selectionStartedMs = performance.now();
            await page.waitForFunction(() => typeof (window as unknown as { __SS_SWITCH_CANDIDATE__?: unknown }).__SS_SWITCH_CANDIDATE__ === 'function');
            const switched = await page.evaluate(async id => (window as unknown as {
                __SS_SWITCH_CANDIDATE__: (id: string, journey: string) => Promise<{ ok: boolean; code?: string }>;
            }).__SS_SWITCH_CANDIDATE__(id, 'open_mic'), candidate);
            receipt.switchOutcome=switched;
            expect(switched.ok, 'shared product candidate switch succeeds without fallback').toBe(true);
            receipt.selectionWallMs = elapsedMs(selectionStartedMs, performance.now());
            receipt.acquisitions = await acquisitions(page, candidate, selectionStartedEpochMs);
            receipt.runtimeConditions = await page.evaluate(() => ({ userAgent: navigator.userAgent,
                hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated, headed: true, freshContext: true }));
            receipt.selection = await identity(page);
            expect((receipt.selection as { matches: boolean }).matches, 'requested and resolved candidate agree').toBe(true);
            collector = await attachProductEvidence(page, { source, candidateId: candidate, candidate: definition,
                backend: definition.model.device as 'webgpu' | 'wasm',
                journey: 'open_mic', fixtureWavSha256: clip.wavSha256 }, apiOrigin);
            phase = 'recording';
            await resetFixtureAudioToStart(page);
            await preparePrivateModelIfPrompted(page, 180_000);
            await startBenchmarkRecording(page, 'independent-model-comparison', 180_000);
            await expectBenchmarkRecordingStarted(page, 'independent-model-comparison');
            await expect.poll(async () => {
                const c = await capture(page); return Boolean(c?.active && c.candidateId === candidate && c.receivedFrames > 0);
            }, { timeout: 30_000 }).toBe(true);
            const before = (await capture(page))!;
            const playing = await playFixtureAudioOnce(page);
            const ended = await waitForFixtureAudioEnd(page, 120_000);
            await expect.poll(async () => (await capture(page))?.lastReceivedAtMs ?? 0,
                { timeout: 10_000 }).toBeGreaterThanOrEqual(ended.endedAtMs!);
            const after = (await capture(page))!;
            expect(after.captureId === before.captureId, 'same product capture receives full playback').toBe(true);
            expect(after.receivedSamples - before.receivedSamples).toBeGreaterThanOrEqual(
                Math.floor(playing.durationSeconds! * after.sampleRateHz * 0.98));
            receipt.capture = { receivedFrames: after.receivedFrames - before.receivedFrames,
                receivedSamples: after.receivedSamples - before.receivedSamples, sampleRateHz: after.sampleRateHz,
                sourceSeconds: playing.durationSeconds, sourceEnded: ended.phase === 'ended' };
            receipt.runningIdentity = await identity(page);
            expect((receipt.runningIdentity as { matches: boolean }).matches).toBe(true);
            phase = 'stop-and-save';
            const completion = page.waitForResponse(response => {
                const request = response.request();
                if (request.url() !== apiOrigin + '/rest/v1/rpc/complete_session_v2' || request.method() !== 'POST') return false;
                try { return request.postDataJSON().p_status === 'completed'; } catch { return false; }
            }, { timeout: 120_000 }).catch(() => null);
            await stopBenchmarkRecording(page, 'independent-model-comparison', 120_000);
            const saved = await completion;
            if (!saved) throw new Error('completion_response_unavailable');
            const completed = await observeCompletedSave(saved, apiOrigin);
            const body = { p_final_transcript: completed.transcript, p_session_id: completed.sessionId };
            receipt.transcriptSha256 = sha(body.p_final_transcript);
            receipt.trackA = wordErrorRate(clip.reference, body.p_final_transcript, { track: 'track_a' });
            receipt.trackB = wordErrorRate(clip.reference, body.p_final_transcript, { track: 'track_b' });
            const timeline = await collector.freezeTake();
            // Network completion epoch comes from the actual request, not the delayed
            // return of click(). Read full-body timing only once it has finished.
            const finishedError = await saved.finished();
            const network = saved.request().timing();
            const completionEpochMs = !finishedError && network.responseEnd >= 0
                ? network.startTime + network.responseEnd : null;
            receipt.startToRecordingMs = elapsedMs(timeline.startClickMs, timeline.startMs);
            receipt.stopToCompletionMs = elapsedMs(timeline.timeOriginMs != null && timeline.stopClickMs != null
                ? timeline.timeOriginMs + timeline.stopClickMs : null, completionEpochMs);
            const timing = await page.evaluate(() => ({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin,
                summary: (window as unknown as { __PRIVATE_TIMING__?: Record<string, unknown> }).__PRIVATE_TIMING__ ?? null }));
            const finalCapture = await capture(page);
            receipt.privateTiming = privateTimingMetrics(timing.summary, timeline.startMs, timeline.stopMs, timing.nowMs,
                timing.timeOriginMs === timeline.timeOriginMs && finalCapture?.captureId === after.captureId
                && finalCapture?.candidateId === candidate);
            phase = 'persisted-read-and-authority';
            const readStartedMs = performance.now();
            const persisted = await page.evaluate(async id => {
                const modulePath = '/src/lib/supabaseClient.ts';
                const { getSupabaseClient } = await import(modulePath);
                const rows = await getSupabaseClient().from('sessions')
                    .select('id,transcript,product,engine,engine_version,model_name,device_type,attribution_status').eq('id', id);
                return !rows.error && Array.isArray(rows.data) && rows.data.length === 1;
            }, completed.sessionId);
            receipt.persistedReadRoundTripMs = persisted ? elapsedMs(readStartedMs, performance.now()) : null;
            if (!persisted) throw Error('bounded_exact_persisted_read_failed');
            let authorityFound = false;
            // Terminal attestation is asynchronous. Empty reads may wait within the
            // existing read/deadline caps; a nonempty contradictory row is never retried.
            for (let attempt = 0; attempt < 8; attempt++) {
                budget.assertHealthy();
                const count = await page.evaluate(async id => {
                    const modulePath = '/src/lib/supabaseClient.ts';
                    const { getSupabaseClient } = await import(modulePath);
                    const rows = await getSupabaseClient().from('session_attribution_authority')
                        .select('session_id,authority_version,engine_class,engine,engine_version,model_id,provider,resolved_device').eq('session_id', id);
                    if (rows.error || !Array.isArray(rows.data)) throw Error('bounded_authority_read_failed');
                    return rows.data.length;
                }, completed.sessionId);
                if (count) { authorityFound = true; break; }
                if (attempt < 7) await page.waitForTimeout(500);
            }
            if (!authorityFound) throw Error('bounded_authority_unavailable');
            phase = 'reopen';
            if (!/^[a-f0-9-]{36}$/i.test(body.p_session_id)) throw new Error('completion_session_id_unavailable');
            const reopenStartedMs = performance.now();
            await page.goto(`/progress/${body.p_session_id}`);
            const detail = page.getByTestId('session-detail-transcript');
            await expect(detail).toBeVisible({ timeout: 45_000 });
            await expect.poll(async () => sha(await detail.innerText()) === receipt.transcriptSha256, { timeout: 45_000 }).toBe(true);
            receipt.reopenToTranscriptMs = elapsedMs(reopenStartedMs, performance.now());
            expect(sha(await detail.innerText()) === receipt.transcriptSha256, 'reopened final bytes equal completion').toBe(true);
            receipt.reopenedContentEqual = true;
            await collector.observeReopened();
            const product = await collector.finish(); collectorFinished = true;
            receipt.productEvidence = product;
            expect(product.productProof.verdict, 'existing collector must PASS with persisted verified identity').toBe('PASS');
            if (transportFailures || blocked.providerRequests) throw Error('bounded_transport_failed');
            budget.finishTake();
            assertSameSource(source, readSourceBinding(root));
            if (driverDigest() !== approval.driverSha256) throw Error('bounded_driver_changed_during_run');
            receipt.budget = budget.snapshot();
            receipt.cachedAssetDelivery = modelCache?.snapshot();
            receipt.measured = true;
            receipt.blocked = blocked;
            phase = 'complete';
        } catch (error) {
            receipt.measured = false; receipt.failurePhase = phase; receipt.blocked = blocked;
            receipt.failureCode = error instanceof Error && /^[a-zA-Z0-9_:]{1,120}$/.test(error.message)
                ? error.message : 'sanitized_assertion_or_runtime_failure';
            // Never expose credential-bearing request bodies or the account's unrelated history in errors.
            throw new Error(`independent_app_comparison_failed:${phase}`);
        } finally {
            if (collector && !collectorFinished) {
                receipt.productEvidence = await collector.finish().catch(() => ({ collectorFailure: 'sanitized_collection_failure' }));
            }
            receipt.budget = budget.snapshot();
            await disposeFixtureAudio(page).catch(() => {});
            const retained = info.outputPath('attachments', 'independent-app-comparison.json');
            await fs.promises.mkdir(path.dirname(retained), { recursive: true, mode: 0o700 });
            await fs.promises.writeFile(retained + '.tmp', JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
            await fs.promises.rename(retained + '.tmp', retained);
            await info.attach('independent-app-comparison.json', { path: retained, contentType: 'application/json' });
        }
    });
}
