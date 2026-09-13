// @vitest-environment jsdom
/**
 * #1259 RETURN — WHAT POSTHOG ACTUALLY RECEIVES, FROM A REAL LOAD.
 *
 * The previous integration proof read `PrivateSTT.ts` as TEXT and asserted that call sites existed. It
 * passed while every one of those calls reported nothing: the asset list was permanently empty, so the
 * cache probe always answered `unobservable`; the byte, count, duration and digest fields were declared
 * and never assigned; and `network_used` was derived from the empty cache classification rather than
 * measured. Source text cannot see any of that, because the text was correct.
 *
 * So these drive the engine through its REAL initialisation routes — the registry seam the loaders
 * already provide so a test can reach the real facade without a 318 MB download — and assert on the
 * payload handed to `posthog.capture`, past the real allowlist projection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { sttRegistry } from '@/services/transcription/STTRegistry';
import { CANDIDATES, type Candidate } from '@/services/transcription/candidateRegistry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import {
    __resetAcquisitionTelemetry, markIdentitySettled,
} from '@/services/transcription/modelAcquisitionTelemetry';
import { assetRequestsFor } from '@/services/transcription/candidateAssetRequests';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';

vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(), identify: vi.fn(), reset: vi.fn(),
        get_distinct_id: vi.fn(() => 'anon'), __loaded: true,
    },
}));

let selected: Candidate = CANDIDATES['v2:base.en'];
vi.mock('@/services/transcription/candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return { ...actual, effectiveCandidate: () => ({ candidate: selected, fallbackCause: null }) };
});

const captured = () => (posthog.capture as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
const eventNamed = (name: string) => captured().filter((c) => c[0] === name).map((c) => c[1]);

/**
 * Empty the buffer to PostHog. It flushes in background-scheduled chunks, so the assertions below wait
 * for the real delivery path rather than reading an internal queue the wire never saw.
 */
async function drainToPostHog(): Promise<void> {
    for (let i = 0; i < 50 && analyticsBuffer.queue.length > 0; i += 1) {
        await new Promise((r) => setTimeout(r, 0));
    }
}

/** A registry engine that satisfies the real contract and downloads nothing. */
const fakeEngine = () => ({
    init: vi.fn(async () => ({ isOk: true as const, data: undefined })),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    transcribe: vi.fn(async () => ''),
    getMetadata: () => ({ engineVersion: 'test', modelName: 'test', deviceType: 'browser' }),
});

/** Cache Storage whose contents the test controls, so hit and miss are staged, never guessed. */
function stageCache(presentUrls: string[]) {
    const set = new Set(presentUrls);
    (globalThis as unknown as { caches: unknown }).caches = {
        match: async (url: string) => (set.has(String(url)) ? new Response('') : undefined),
    };
}

/**
 * A deterministic clock. The observation window is bounded by `performance.now()` at load start, so
 * without a fixed origin the staged entries would sit before or after the window by accident and the
 * assertions would be measuring the test harness rather than the code.
 */
const LOAD_START = 1_000;
function stageClock() {
    vi.spyOn(performance, 'now').mockImplementation(() => LOAD_START);
}

/** Resource Timing entries for a load, as the browser would record them. */
function stageResourceTiming(entries: Array<Partial<PerformanceResourceTiming> & { name: string }>) {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(((type: string) => (
        type === 'resource'
            ? entries.map((e) => ({
                startTime: LOAD_START, duration: 100, responseEnd: LOAD_START + 100,
                transferSize: 0, encodedBodySize: 0, ...e,
            }))
            : []
    )) as typeof performance.getEntriesByType);
}

type PrivateAccess = {
    initSelectedEngine: (t: string, ms?: number, mock?: boolean) => Promise<{ isOk: boolean }>;
    publishResolvedIdentity: () => void;
};
const engineFor = (c: Candidate) => {
    selected = c;
    const stt = new PrivateSTT({} as never) as unknown as PrivateAccess;
    // Identity publication reads runtime state this test does not stage; it is not what is under test.
    stt.publishResolvedIdentity = () => {};
    return stt;
};

beforeEach(() => {
    vi.clearAllMocks();
    __resetAcquisitionTelemetry();
    analyticsBuffer.resetIdentity();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    markIdentitySettled();
    sttRegistry.clear();
    for (const mode of ['transformers-js', 'transformers-js-v4', 'moonshine-streaming']) {
        sttRegistry.register(mode, fakeEngine as never);
    }
    performance.clearResourceTimings?.();
    stageClock();
});
afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { caches?: unknown }).caches;
});

const V2 = CANDIDATES['v2:base.en'];
const MOONSHINE = CANDIDATES['moonshine:streaming-medium'];
const DISTIL = CANDIDATES['v4:distil:q4'];

describe('#1259 the acquisition payload carries real measurements', () => {
    it('CASUALTY: a COLD v2 load reports a cache MISS, real bytes, count and duration', async () => {
        // Nothing in the cache, and the browser recorded twelve transferred responses.
        const assets = assetRequestsFor(V2).assets;
        expect(assets.length, 'the asset list must not be empty — this is the returned defect')
            .toBeGreaterThan(0);
        stageCache([]);
        stageResourceTiming(assets.map((a) => ({
            name: a.url, transferSize: (a.bytes ?? 0) + 300, encodedBodySize: a.bytes ?? 0,
            startTime: LOAD_START, responseEnd: LOAD_START + 2500,
        })));

        await engineFor(V2).initSelectedEngine('transformers-js');

        await drainToPostHog();

        const [start] = eventNamed('private_model_acquisition_start');
        expect(start.cache_result, 'an empty asset list always answered unobservable').toBe('miss');
        expect(start.acquired_candidate_id).toBe('v2:base.en');

        const [ok] = eventNamed('private_model_acquisition_success');
        expect(ok.network_used, 'measured from transferSize, not predicted from the probe').toBe(true);
        expect(ok.network_bytes as number).toBeGreaterThan(0);
        expect(ok.asset_count).toBe(assets.length);
        expect(ok.download_ms).toBe(2500);
        expect(ok.asset_pin_digest).toBe(V2.assets.pinDigest);
    });

    it('CASUALTY: a WARM v2 load reports a cache HIT and no network use', async () => {
        const assets = assetRequestsFor(V2).assets;
        stageCache(assets.map((a) => a.url));
        // Served from cache: a real body, nothing over the wire.
        stageResourceTiming(assets.map((a) => ({
            name: a.url, transferSize: 0, encodedBodySize: a.bytes ?? 1,
        })));

        await engineFor(V2).initSelectedEngine('transformers-js');

        await drainToPostHog();

        expect(eventNamed('private_model_acquisition_start')[0].cache_result).toBe('hit');
        const [ok] = eventNamed('private_model_acquisition_success');
        expect(ok.network_used, 'a zero transfer with a real body is proof of cache').toBe(false);
        expect(ok.network_bytes).toBe(0);
    });

    it('CASUALTY: a PARTIAL cache is reported as partial, not rounded to hit or miss', async () => {
        const assets = assetRequestsFor(V2).assets;
        stageCache(assets.slice(0, 3).map((a) => a.url));
        stageResourceTiming(assets.map((a) => ({ name: a.url, transferSize: 100, encodedBodySize: 90 })));
        await engineFor(V2).initSelectedEngine('transformers-js');
        await drainToPostHog();
        expect(eventNamed('private_model_acquisition_start')[0].cache_result).toBe('partial');
    });

    it('CASUALTY: a Moonshine load measures its OWN pinned assets', async () => {
        const assets = assetRequestsFor(MOONSHINE).assets;
        expect(assets.length, 'Moonshine ships its own pin file and must be observable').toBeGreaterThan(0);
        stageCache([]);
        stageResourceTiming(assets.map((a) => ({
            name: a.url, transferSize: (a.bytes ?? 0) + 100, encodedBodySize: a.bytes ?? 0,
            startTime: LOAD_START, responseEnd: LOAD_START + 5000,
        })));

        await engineFor(MOONSHINE).initSelectedEngine('moonshine-streaming');

        await drainToPostHog();

        const [ok] = eventNamed('private_model_acquisition_success');
        expect(ok.acquired_candidate_id).toBe('moonshine:streaming-medium');
        expect(ok.model_identity, 'repository plus pinned revision, never a bare moving tag')
            .toContain('@');
        expect(ok.asset_count).toBe(assets.length);
        expect(ok.download_ms).toBe(5000);
        expect(ok.network_used).toBe(true);
    });

    it('distil is unobservable for CACHE only — its identity and timing are still real', async () => {
        // Its pins are test material and are not shipped, so inventing URLs would be a guess dressed as
        // a measurement. Exactly one field goes unobservable; the candidate does not.
        expect(assetRequestsFor(DISTIL).unobservableReason).toBeTruthy();
        stageCache([]);
        stageResourceTiming([]);

        await engineFor(DISTIL).initSelectedEngine('transformers-js-v4');

        await drainToPostHog();

        const [ok] = eventNamed('private_model_acquisition_success');
        expect(ok.cache_result).toBe('unobservable');
        expect(ok.acquired_candidate_id, 'the candidate is still named').toBe('v4:distil:q4');
        expect(ok.model_identity).toContain('distil-small.en');
        expect(ok.total_ms, 'total time is always measurable').toEqual(expect.any(Number));
    });

    it('CASUALTY: a cross-origin response that hides its size yields NULL bytes, not zero', async () => {
        // Zero here would invent a cache hit out of a missing Timing-Allow-Origin header.
        const assets = assetRequestsFor(MOONSHINE).assets;
        stageCache([]);
        stageResourceTiming(assets.map((a) => ({ name: a.url, transferSize: 0, encodedBodySize: 0 })));

        await engineFor(MOONSHINE).initSelectedEngine('moonshine-streaming');

        await drainToPostHog();

        const [ok] = eventNamed('private_model_acquisition_success');
        expect(ok.network_bytes).toBeNull();
        expect(ok.network_used, 'unknowable is null, never the flattering answer').toBeNull();
    });

    it('CASUALTY: a FAILED load still names the candidate it was loading', async () => {
        // The pre-init subject used to come from post-init metadata, so the two events that describe a
        // load which never completed both reported `unknown`.
        sttRegistry.clear();
        sttRegistry.register('transformers-js', (() => ({
            ...fakeEngine(),
            init: vi.fn(async () => ({ isOk: false as const, error: new Error('network fetch failed') })),
        })) as never);
        stageCache([]);
        stageResourceTiming([]);

        await engineFor(V2).initSelectedEngine('transformers-js');

        await drainToPostHog();

        const [fail] = eventNamed('private_model_acquisition_failure');
        expect(fail.acquired_candidate_id, 'the requested candidate was known before the load began').toBe('v2:base.en');
        expect(fail.model_identity).not.toBe('unknown');
        expect(fail.error_code).toBe('network');
    });

    it('the payload reaching PostHog carries no URL, path or asset name', async () => {
        stageCache([]);
        stageResourceTiming(assetRequestsFor(V2).assets.map((a) => ({ name: a.url, transferSize: 10 })));
        await engineFor(V2).initSelectedEngine('transformers-js');
        await drainToPostHog();
        const serialized = JSON.stringify(captured());
        expect(serialized).not.toMatch(/https?:\/\//);
        expect(serialized).not.toMatch(/\.onnx/);
    });
});
