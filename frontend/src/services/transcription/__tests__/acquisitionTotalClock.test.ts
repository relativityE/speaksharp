// @vitest-environment jsdom
/**
 * #1259 — `total_ms` MUST COVER THE WHOLE WAIT.
 *
 * The clock started AFTER `probeCache` resolved, so the reported total excluded cache inspection while
 * its contract says it covers the entire acquisition. That is real time the user spends staring at a
 * setup screen — for a candidate with a dozen pinned assets it is a dozen Cache Storage lookups — and
 * omitting it understated setup duration in the flattering direction. Setup duration is a launch
 * decision, so a number that is quietly short is worse than no number.
 *
 * The probe here is DELAYED deliberately and the initialisation is controlled, so the reported total
 * can be compared against a wait the test actually caused. On the returned head this fails: the total
 * comes back without the probe delay in it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { sttRegistry } from '@/services/transcription/STTRegistry';
import { CANDIDATES } from '@/services/transcription/candidateRegistry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetAcquisitionTelemetry, markIdentitySettled } from '@/services/transcription/modelAcquisitionTelemetry';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anon'), __loaded: true },
}));
vi.mock('@/services/transcription/candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return { ...actual, effectiveCandidate: () => ({ candidate: CANDIDATES['v2:base.en'], fallbackCause: null }) };
});

const captured = () => (posthog.capture as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
const success = () => captured().filter((c) => c[0] === 'private_model_acquisition_success').map((c) => c[1]);
const failure = () => captured().filter((c) => c[0] === 'private_model_acquisition_failure').map((c) => c[1]);
async function drain() {
    for (let i = 0; i < 50 && analyticsBuffer.queue.length > 0; i += 1) await new Promise((r) => setTimeout(r, 0));
}

const PROBE_MS = 400;
const INIT_MS = 150;

/** A controllable clock, so the reported total is compared against a wait the test caused. */
let clock = 0;
const advance = (ms: number) => { clock += ms; };

type PrivateAccess = {
    initSelectedEngine: (t: string) => Promise<{ isOk: boolean }>;
    publishResolvedIdentity: () => void;
};

/**
 * Cache Storage that takes real time to answer, as a dozen lookups over pinned assets do.
 * Each `match` advances the clock; that time is part of the user's wait.
 */
function stageDelayedCache(perLookupMs: number) {
    (globalThis as unknown as { caches: unknown }).caches = {
        match: async () => { advance(perLookupMs); return undefined; },
    };
}

async function loadWithControlledTiming({ probeTotal, initMs }: { probeTotal: number; initMs: number }) {
    // 12 pinned v2 assets; spread the probe cost across them.
    stageDelayedCache(probeTotal / 12);
    sttRegistry.clear();
    sttRegistry.register('transformers-js', (() => ({
        init: vi.fn(async () => { advance(initMs); return { isOk: true as const, data: undefined }; }),
        start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
        transcribe: vi.fn(async () => ''),
        getMetadata: () => ({ engineVersion: 'test', modelName: 'test', deviceType: 'browser' }),
    })) as never);
    const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
    stt.publishResolvedIdentity = () => {};
    await stt.initSelectedEngine('transformers-js');
    await drain();
}

beforeEach(() => {
    vi.clearAllMocks();
    __resetAcquisitionTelemetry();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    analyticsBuffer.resetIdentity();
    markIdentitySettled();
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((() => []) as typeof performance.getEntriesByType);
});
afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('#1259 the total acquisition clock spans the cache probe', () => {
    it('CASUALTY: total_ms INCLUDES the cache-inspection wait', async () => {
        // THE RETURNED DEFECT. Starting the clock after the probe reported `INIT_MS` and hid `PROBE_MS`
        // of real waiting.
        await loadWithControlledTiming({ probeTotal: PROBE_MS, initMs: INIT_MS });
        const [ok] = success();
        expect(ok.total_ms, 'the probe delay must be inside the total').toBe(PROBE_MS + INIT_MS);
        expect(ok.total_ms as number, 'a total that omits the probe is the defect')
            .toBeGreaterThan(INIT_MS);
    });

    it('CASUALTY: a LONGER probe moves the total by exactly that much', async () => {
        // Proves the probe is measured rather than approximated by a constant.
        await loadWithControlledTiming({ probeTotal: 1200, initMs: INIT_MS });
        expect(success()[0].total_ms).toBe(1200 + INIT_MS);
    });

    it('CASUALTY: probe time is NOT reported as download time', async () => {
        // `download_ms` comes only from Resource Timing. Folding a local cache lookup into it would
        // invent transfer duration out of something that never touched the network.
        await loadWithControlledTiming({ probeTotal: PROBE_MS, initMs: INIT_MS });
        const [ok] = success();
        expect(ok.download_ms, 'no resource entries were recorded, so there is no download figure').toBeNull();
        expect(ok.partial_download_ms).toBeNull();
    });

    it('CASUALTY: a request made DURING the probe is not counted as part of the download', async () => {
        // The two clocks are separate for a reason. The total spans the probe; the DOWNLOAD window does
        // not. If the observation window started at the acquisition clock, anything the page happened to
        // fetch while the cache was being inspected would be attributed to the model transfer — a
        // download figure assembled from requests the load never made.
        stageDelayedCache(PROBE_MS / 12);
        vi.spyOn(performance, 'getEntriesByType').mockImplementation(((type: string) => (
            type === 'resource'
                ? [
                    // Absolute URLs, as Resource Timing records them and as the self-hosted scope is
                    // built. A bare path would match nothing and prove nothing.
                    // Recorded WHILE the cache was being inspected — before the load began.
                    { name: `${location.origin}/models/whisper-base.en/onnx/stray.onnx`, startTime: PROBE_MS / 2,
                      responseEnd: PROBE_MS / 2 + 10, duration: 10, transferSize: 9_999, encodedBodySize: 9_999 },
                    // The real load's own request.
                    { name: `${location.origin}/models/whisper-base.en/onnx/encoder.onnx`, startTime: PROBE_MS + 10,
                      responseEnd: PROBE_MS + 60, duration: 50, transferSize: 1_000, encodedBodySize: 1_000 },
                  ]
                : []
        )) as unknown as typeof performance.getEntriesByType);

        sttRegistry.clear();
        sttRegistry.register('transformers-js', (() => ({
            init: vi.fn(async () => { advance(INIT_MS); return { isOk: true as const, data: undefined }; }),
            start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
            transcribe: vi.fn(async () => ''),
            getMetadata: () => ({ engineVersion: 'test', modelName: 'test', deviceType: 'browser' }),
        })) as never);
        const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
        stt.publishResolvedIdentity = () => {};
        await stt.initSelectedEngine('transformers-js');
        await drain();

        const [ok] = success();
        expect(ok.asset_count, 'only the request made after the load began belongs to the download').toBe(1);
        expect(ok.network_bytes, 'the stray probe-window request must not inflate the transfer').toBe(1_000);
        expect(ok.total_ms, 'while the total still spans the probe').toBe(PROBE_MS + INIT_MS);
    });

    it('CASUALTY: a FAILED acquisition also reports a total that spans the probe', async () => {
        stageDelayedCache(PROBE_MS / 12);
        sttRegistry.clear();
        sttRegistry.register('transformers-js', (() => ({
            init: vi.fn(async () => {
                advance(INIT_MS);
                return { isOk: false as const, error: new Error('network fetch failed') };
            }),
            start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
            transcribe: vi.fn(async () => ''),
            getMetadata: () => ({ engineVersion: 'test', modelName: 'test', deviceType: 'browser' }),
        })) as never);
        const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
        stt.publishResolvedIdentity = () => {};
        await stt.initSelectedEngine('transformers-js');
        await drain();

        const [fail] = failure();
        expect(fail.total_ms, 'a failed setup wasted the same wait and must say so').toBe(PROBE_MS + INIT_MS);
    });
});
