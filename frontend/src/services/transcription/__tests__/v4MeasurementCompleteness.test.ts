// @vitest-environment jsdom
/**
 * #1259 RETURN — COMPLETENESS MUST SURVIVE THE WHOLE CHAIN.
 *
 * The v4 worker measured correctly and then the honesty signal was thrown away. `PrivateSTT` dropped
 * `outOfScopeCount`, `AcquisitionOutcome` had nowhere to put a completeness status, and PostHog
 * received real bytes and a real duration with no way to know they covered an unknown fraction of the
 * download. A v4 load whose requests were partly redirected out of the declared scope therefore looked
 * exactly like a small, fast, complete one — and a small fast number is an argument for shipping that
 * model. A partial measurement presented as complete is worse than no measurement.
 *
 * These run the REAL chain for v4: a worker observation over staged worker-timeline entries, through
 * the real v4 engine handler, into the real `PrivateSTT` acquisition path, out to the payload the real
 * analytics boundary hands to `posthog.capture`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { sttRegistry } from '@/services/transcription/STTRegistry';
import { CANDIDATES } from '@/services/transcription/candidateRegistry';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetAcquisitionTelemetry, markIdentitySettled } from '@/services/transcription/modelAcquisitionTelemetry';
import { observeAcquisitionNetwork } from '@/services/transcription/acquisitionNetworkObservation';
import { acquisitionScopeFor } from '@/services/transcription/candidateAssetRequests';
import {
    mintAcquisitionAttempt, composeAcquisitionReceipt, type AcquisitionReceipt,
} from '@/services/transcription/acquisitionAttempt';
import { TransformersJSV4Engine } from '@/services/transcription/engines/TransformersJSV4Engine';
import { PrivateSTT } from '@/services/transcription/engines/PrivateSTT';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anon'), __loaded: true },
}));

const V4 = CANDIDATES['v4:distil:q4'];
vi.mock('@/services/transcription/candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return { ...actual, effectiveCandidate: () => ({ candidate: CANDIDATES['v4:distil:q4'], fallbackCause: null }) };
});

const LOAD_START = 1_000;
const captured = () => (posthog.capture as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
const success = () => captured().filter((c) => c[0] === 'private_model_acquisition_success').map((c) => c[1]);
async function drain() {
    for (let i = 0; i < 50 && analyticsBuffer.queue.length > 0; i += 1) await new Promise((r) => setTimeout(r, 0));
}

/** Entries as the WORKER's timeline would record them. */
type Entry = { name: string; transferSize: number; encodedBodySize: number; responseEnd: number };
const inScope = (n: number, bytes = 1_000_000, end = LOAD_START + 3100): Entry[] =>
    Array.from({ length: n }, (_, i) => ({
        name: `https://huggingface.co/${V4.model.id}/resolve/main/onnx/part${i}.onnx`,
        transferSize: bytes, encodedBodySize: bytes, responseEnd: end,
    }));
/** Matched, served from cache: a real body with nothing over the wire. */
const cached = (n: number, bytes = 1_000_000): Entry[] =>
    Array.from({ length: n }, (_, i) => ({
        name: `https://huggingface.co/${V4.model.id}/resolve/main/onnx/part${i}.onnx`,
        transferSize: 0, encodedBodySize: bytes, responseEnd: LOAD_START + 40,
    }));
const redirected = (n: number, bytes = 1_000_000): Entry[] =>
    Array.from({ length: n }, (_, i) => ({
        // A CDN destination whose path no longer carries the repository id — the redirect case.
        name: `https://cdn-lfs.example.net/repos/abc/def/part${i}.onnx`,
        transferSize: bytes, encodedBodySize: bytes, responseEnd: LOAD_START + 3100,
    }));

/** Take a REAL observation over a worker-shaped performance source, then compose the real receipt. */
function workerReceipt(entries: Entry[], token: string, perfAvailable = true): AcquisitionReceipt | null {
    // A worker always HAS `self.performance`; what can be missing is Resource Timing on it. Passing
    // `undefined` here would mean "use the default source" and silently fall back to the main window,
    // which is a different condition entirely — so the unavailable case is an object without the API.
    const perf = (perfAvailable
        ? {
            getEntriesByType: (type: string) => (type === 'resource'
                ? entries.map((e) => ({ startTime: LOAD_START, duration: 100, ...e }))
                : []),
        }
        : {}) as unknown as Performance;
    const observation = observeAcquisitionNetwork(acquisitionScopeFor(V4), LOAD_START, perf);
    return composeAcquisitionReceipt(observation, { token, candidateId: V4.id });
}

/** Drive the REAL v4 engine handler, then the REAL PrivateSTT acquisition path. */
async function publishThroughV4(entries: Entry[], perfAvailable = true) {
    const attempt = mintAcquisitionAttempt(V4.id);
    const v4 = new TransformersJSV4Engine({} as never) as unknown as {
        handleWorkerMessage: (r: unknown, m: unknown) => void;
        activeAttempt: unknown;
        acquisitionReceipt: AcquisitionReceipt | null;
        init: (t?: number, m?: boolean) => Promise<unknown>;
        getAcquisitionReceipt: () => AcquisitionReceipt | null;
        getAcquisitionAttempt: () => unknown;
        settledAttempt: unknown;
    };
    v4.activeAttempt = attempt;
    v4.settledAttempt = attempt;
    v4.acquisitionReceipt = null;
    v4.handleWorkerMessage(
        {
            id: 1, type: 'loaded', loadTimeMs: 5200, model: V4.model.id, device: 'wasm',
            acquisition: workerReceipt(entries, attempt.token, perfAvailable),
        },
        { MODEL_ID: V4.model.id, DTYPE: {} },
    );
    v4.init = vi.fn(async () => ({ isOk: true as const, data: undefined }));

    sttRegistry.clear();
    sttRegistry.register('transformers-js-v4', (() => v4) as never);
    const stt = new PrivateSTT({} as never) as unknown as {
        initSelectedEngine: (t: string) => Promise<{ isOk: boolean }>;
        publishResolvedIdentity: () => void;
    };
    stt.publishResolvedIdentity = () => {};
    await stt.initSelectedEngine('transformers-js-v4');
    await drain();
    return success()[0];
}

beforeEach(() => {
    vi.clearAllMocks();
    __resetAcquisitionTelemetry();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    analyticsBuffer.resetIdentity();
    markIdentitySettled();
    (globalThis as unknown as { caches: unknown }).caches = { match: async () => undefined };
    vi.spyOn(performance, 'now').mockImplementation(() => LOAD_START);
    // The MAIN window sees nothing for a worker load — the real condition.
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((() => []) as typeof performance.getEntriesByType);
});
afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('#1259 v4 completeness reaches analytics', () => {
    it('CASUALTY: a COMPLETE scope publishes the complete fields', async () => {
        const p = await publishThroughV4(inScope(7));
        expect(p.measurement_completeness).toBe('complete');
        expect(p.out_of_scope_count).toBe(0);
        expect(p.network_bytes).toBe(7_000_000);
        expect(p.download_ms).toBe(3100);
        expect(p.asset_count).toBe(7);
        expect(p.partial_network_bytes, 'nothing partial about a complete measurement').toBeNull();
        expect(p.partial_download_ms).toBeNull();
    });

    it('CASUALTY: a MIXED matched/redirected scope is PARTIAL, and never fills the complete fields', async () => {
        // The defect: five matched requests and three redirected out of scope published 5MB and a
        // duration as though they were the whole download.
        const p = await publishThroughV4([...inScope(5), ...redirected(3)]);
        expect(p.measurement_completeness).toBe('partial');
        expect(p.measurement_reason_code).toBe('requests_outside_scope');
        expect(p.out_of_scope_count).toBe(3);
        expect(p.network_bytes, 'a partial figure must never occupy the complete field').toBeNull();
        expect(p.download_ms).toBeNull();
        expect(p.init_ms, 'init cannot be derived from a download figure that is not the whole download').toBeNull();
        expect(p.partial_network_bytes, 'the real number survives, under an honest name').toBe(5_000_000);
        expect(p.partial_download_ms).toBe(3100);
        expect(p.asset_count, 'the matched count IS observed').toBe(5);
    });

    it('CASUALTY: an ENTIRELY MISSED scope is UNOBSERVABLE with every measurement null', async () => {
        const p = await publishThroughV4(redirected(6));
        expect(p.measurement_completeness).toBe('unobservable');
        expect(p.measurement_reason_code).toBe('scope_matched_nothing');
        expect(p.out_of_scope_count, 'the count is retained — it is how the mismatch is visible').toBe(6);
        expect(p.network_bytes).toBeNull();
        expect(p.download_ms).toBeNull();
        expect(p.partial_network_bytes).toBeNull();
        expect(p.partial_download_ms).toBeNull();
        expect(p.asset_count, 'nothing was observed, so there is no count').toBeNull();
    });

    it('CASUALTY: UNAVAILABLE timing is unobservable, not a zero', async () => {
        const p = await publishThroughV4(inScope(7), false);
        expect(p.measurement_completeness).toBe('unobservable');
        expect(p.measurement_reason_code).toBe('timing_unavailable');
        expect(p.network_bytes).toBeNull();
        expect(p.download_ms).toBeNull();
        expect(p.asset_count).toBeNull();
    });

    it('CASUALTY: the configured component count NEVER replaces an absent observation', async () => {
        // `observed.assetCount ?? candidate.assets.componentCount` mixed expected inventory with
        // observed behaviour: a load that watched nothing reported a full asset count.
        const p = await publishThroughV4(redirected(6));
        expect(p.asset_count).toBeNull();
        expect(p.asset_count, 'the registry inventory must not leak in').not.toBe(V4.assets.componentCount);
    });

    it('CASUALTY: opaque sizes are PARTIAL, and total_ms stays available', async () => {
        const opaque = inScope(4).map((e) => ({ ...e, transferSize: 0, encodedBodySize: 0 }));
        const p = await publishThroughV4(opaque);
        expect(p.measurement_completeness).toBe('partial');
        expect(p.measurement_reason_code).toBe('sizes_opaque');
        expect(p.network_bytes).toBeNull();
        expect(p.total_ms, 'wall time around the acquisition is always measurable').toEqual(expect.any(Number));
    });

    it('CASUALTY: the free-form reason is not in the analytics ALLOWLIST', async () => {
        // The emitter not passing it is one guard; the allowlist refusing it is the boundary. Without
        // this the allowlist could admit it and nothing would notice until a future producer did pass
        // it — a sentence field is unbounded cardinality and carries whatever an edit puts in it.
        const { PRIVATE_TELEMETRY_ALLOWED_PROPS } = await import('../privateTelemetrySanitizer');
        const allowed = PRIVATE_TELEMETRY_ALLOWED_PROPS as readonly string[];
        expect(allowed).not.toContain('unobservableReason');
        expect(allowed).not.toContain('unobservable_reason');
        // The bounded replacement IS allowed, so the honesty signal still travels.
        expect(allowed).toContain('measurement_reason_code');
        expect(allowed).toContain('measurement_completeness');
        expect(allowed).toContain('out_of_scope_count');
    });

    it('CASUALTY: the free-form reason NEVER reaches analytics', async () => {
        await publishThroughV4([...inScope(5), ...redirected(3)]);
        const serialized = JSON.stringify(captured());
        expect(serialized).not.toMatch(/unobservableReason|unobservable_reason/);
        expect(serialized, 'a sentence is unbounded cardinality').not.toMatch(/no longer describes what the loader/);
        expect(serialized).not.toMatch(/attemptToken|attempt_token/);
    });
});

describe('#1259 `network_used` claims only what was proven', () => {
    it('CASUALTY: a COMPLETE cache-only acquisition is false', async () => {
        // Every request was matched and every one reported a zero transfer with a real body. Nothing
        // crossed the wire, and the observation covers everything, so `false` is a claim it can make.
        const p = await publishThroughV4(cached(6));
        expect(p.measurement_completeness).toBe('complete');
        expect(p.network_used).toBe(false);
    });

    it('CASUALTY: PARTIAL with matched-cached plus out-of-scope requests is NULL, never false', async () => {
        // THE DEFECT. Every MATCHED request was cached, so the old rule concluded "cache-only" — while
        // three requests fell outside the scope entirely and each could have been a download. `false` is
        // a claim about every request, and this observation cannot see every request.
        const p = await publishThroughV4([...cached(5), ...redirected(3)]);
        expect(p.measurement_completeness).toBe('partial');
        expect(p.out_of_scope_count).toBe(3);
        expect(p.network_used, 'an unproven cache-only result is unknown, not a cache hit').toBeNull();
    });

    it('CASUALTY: PARTIAL with any proven transfer is TRUE', async () => {
        // Proof of the wire is LOCAL: one transferred byte anywhere proves the network was used,
        // whatever else went unobserved. So `true` survives an incomplete measurement.
        const p = await publishThroughV4([...inScope(2), ...redirected(4)]);
        expect(p.measurement_completeness).toBe('partial');
        expect(p.network_used).toBe(true);
    });

    it('CASUALTY: an UNOBSERVABLE acquisition is NULL', async () => {
        const p = await publishThroughV4(redirected(6));
        expect(p.measurement_completeness).toBe('unobservable');
        expect(p.network_used).toBeNull();
    });

    it('CASUALTY: opaque sizes cannot prove cache-only either', async () => {
        const opaque = cached(4).map((e) => ({ ...e, encodedBodySize: 0 }));
        const p = await publishThroughV4(opaque);
        expect(p.network_used, 'a response that hid its size proves nothing in either direction').toBeNull();
    });
});
