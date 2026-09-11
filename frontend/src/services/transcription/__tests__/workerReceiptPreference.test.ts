// @vitest-environment jsdom
/**
 * #1259 — THE WORKER'S RECEIPT IS THE OBSERVATION, AND IT IS NEVER BLENDED.
 *
 * v2 and v4 fetch their models inside a worker, so the main window's Resource Timing records nothing
 * for them — proven in a real browser by `tests/e2e/worker-acquisition-timeline.e2e.spec.ts`, where the
 * window sees zero entries for a fetch the worker timeline records with real transferred bytes.
 *
 * These drive the REAL `initSelectedEngine` with engines that do and do not supply a receipt, and read
 * the payload the REAL analytics boundary hands to PostHog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { sttRegistry } from '@/services/transcription/STTRegistry';
import { CANDIDATES, type Candidate } from '@/services/transcription/candidateRegistry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetAcquisitionTelemetry, markIdentitySettled } from '@/services/transcription/modelAcquisitionTelemetry';
import { mintAcquisitionAttempt, type AcquisitionReceipt } from '@/services/transcription/acquisitionAttempt';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anon'), __loaded: true },
}));

let selected: Candidate = CANDIDATES['v2:base.en'];
vi.mock('@/services/transcription/candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return { ...actual, effectiveCandidate: () => ({ candidate: selected, fallbackCause: null }) };
});

const captured = () => (posthog.capture as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
const success = () => captured().filter((c) => c[0] === 'private_model_acquisition_success').map((c) => c[1]);
async function drain() {
    for (let i = 0; i < 50 && analyticsBuffer.queue.length > 0; i += 1) await new Promise((r) => setTimeout(r, 0));
}

/** An engine that reports a worker receipt, as the real transformers-js engine does. */
function engineWithReceipt(receipt: AcquisitionReceipt | null, attempt = mintAcquisitionAttempt('v2:base.en')) {
    return () => ({
        init: vi.fn(async () => ({ isOk: true as const, data: undefined })),
        start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
        transcribe: vi.fn(async () => ''),
        getMetadata: () => ({ engineVersion: 'test', modelName: 'test', deviceType: 'browser' }),
        getAcquisitionReceipt: () => (receipt ? { ...receipt, attemptToken: attempt.token } : null),
        getAcquisitionAttempt: () => attempt,
    });
}

const WORKER_RECEIPT: AcquisitionReceipt = {
    completeness: 'complete', reasonCode: null,
    assetCount: 12, networkBytes: 80_553_222, downloadMs: 4200, networkUsed: true, outOfScopeCount: 0,
    unobservableReason: null, attemptToken: 'replaced-per-engine', candidateId: 'v2:base.en',
};

type PrivateAccess = { initSelectedEngine: (t: string) => Promise<{ isOk: boolean }>; publishResolvedIdentity: () => void };
const drive = async (factory: () => unknown, mode = 'transformers-js') => {
    sttRegistry.clear();
    sttRegistry.register(mode, factory as never);
    const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
    stt.publishResolvedIdentity = () => {};
    await stt.initSelectedEngine(mode);
    await drain();
};

beforeEach(() => {
    vi.clearAllMocks();
    __resetAcquisitionTelemetry();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    analyticsBuffer.resetIdentity();
    markIdentitySettled();
    selected = CANDIDATES['v2:base.en'];
    (globalThis as unknown as { caches: unknown }).caches = { match: async () => undefined };
    // The main window sees NOTHING for a worker load — the real condition, not a staged one.
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((() => []) as typeof performance.getEntriesByType);
});
afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('#1259 the worker receipt is what reaches analytics', () => {
    it('CASUALTY: a COLD worker load reports the worker-measured bytes and duration', async () => {
        // Without this the main-window read returns an absent observation and the event carries nulls
        // for the two candidates that matter most.
        await drive(engineWithReceipt(WORKER_RECEIPT));
        const [ok] = success();
        expect(ok.network_bytes).toBe(80_553_222);
        expect(ok.download_ms).toBe(4200);
        expect(ok.asset_count).toBe(12);
        expect(ok.network_used).toBe(true);
    });

    it('CASUALTY: a WARM worker load is distinguished from a cold one BY THE WORKER DATA', async () => {
        await drive(engineWithReceipt({
            ...WORKER_RECEIPT, networkBytes: 0, networkUsed: false, downloadMs: 40,
        }));
        const [ok] = success();
        expect(ok.network_used, 'zero transfer with a real body is proof of cache').toBe(false);
        expect(ok.network_bytes).toBe(0);
        expect(ok.download_ms).toBe(40);
    });

    it('CASUALTY: acquisition duration stays SEPARATE from total initialisation', async () => {
        await drive(engineWithReceipt({ ...WORKER_RECEIPT, downloadMs: 4200 }));
        const [ok] = success();
        expect(ok.download_ms).toBe(4200);
        expect(ok.total_ms).toEqual(expect.any(Number));
        expect(ok.init_ms, 'init is what remains after the download, never the whole thing')
            .toBe(Math.max(0, (ok.total_ms as number) - 4200));
    });

    it('CASUALTY: restricted worker timing stays null — never a fabricated zero', async () => {
        await drive(engineWithReceipt({
            ...WORKER_RECEIPT, networkBytes: null, downloadMs: null, networkUsed: null,
            unobservableReason: 'every matching response hid its size',
        }));
        const [ok] = success();
        expect(ok.network_bytes).toBeNull();
        expect(ok.download_ms).toBeNull();
        expect(ok.network_used).toBeNull();
    });

    it('CASUALTY: main-window and worker observations are NEVER blended', async () => {
        // The window is staged with entries that would give a different, wrong answer. If any of them
        // reached the payload alongside the worker's numbers, the row would describe no single load.
        vi.spyOn(performance, 'getEntriesByType').mockImplementation(((type: string) => (
            type === 'resource'
                ? [{ name: 'http://localhost/models/x', startTime: 0, responseEnd: 999_999,
                     transferSize: 123, encodedBodySize: 123, duration: 999_999 }]
                : []
        )) as unknown as typeof performance.getEntriesByType);

        await drive(engineWithReceipt(WORKER_RECEIPT));
        const [ok] = success();
        expect(ok.network_bytes, 'the worker receipt wins whole, or not at all').toBe(80_553_222);
        expect(ok.download_ms).toBe(4200);
    });

    it('CASUALTY: a receipt whose attempt does not match falls back, it does not merge', async () => {
        const stale = mintAcquisitionAttempt('v2:base.en');
        const current = mintAcquisitionAttempt('v2:base.en');
        await drive(() => ({
            ...(engineWithReceipt(WORKER_RECEIPT, current)() as Record<string, unknown>),
            // The receipt names the STALE attempt while the engine reports the current one.
            getAcquisitionReceipt: () => ({ ...WORKER_RECEIPT, attemptToken: stale.token }),
            getAcquisitionAttempt: () => current,
        }));
        const [ok] = success();
        expect(ok.network_bytes, 'a superseded receipt must not be attributed to this load').toBeNull();
    });

    it('CASUALTY: the attempt token and candidate echo NEVER reach analytics', async () => {
        // They exist to authenticate the receipt in-process. A token in a telemetry row is a correlator
        // nobody approved.
        await drive(engineWithReceipt(WORKER_RECEIPT));
        const serialized = JSON.stringify(captured());
        expect(serialized).not.toMatch(/attemptToken|attempt_token/);
        expect(serialized).not.toMatch(/unobservableReason/);
    });

    it('CASUALTY: a THROWING telemetry transport never blocks model readiness', async () => {
        (posthog.capture as unknown as { mockImplementation: (f: () => void) => void })
            .mockImplementation(() => { throw new Error('transport down'); });
        sttRegistry.clear();
        sttRegistry.register('transformers-js', engineWithReceipt(WORKER_RECEIPT) as never);
        const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
        stt.publishResolvedIdentity = () => {};
        const outcome = await stt.initSelectedEngine('transformers-js');
        expect(outcome.isOk, 'a model the user can speak into outranks a record that they did').toBe(true);
    });
});
