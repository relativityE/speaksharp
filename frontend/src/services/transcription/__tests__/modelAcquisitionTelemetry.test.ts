/**
 * #1259s — the acquisition receipt must come from the cache, not from a stopwatch.
 *
 * The defect it replaces: one total duration, no way to tell a download from an initialisation, and no
 * cache evidence at all. The only inference available was "that was fast, so it was cached", which is
 * not a measurement — a warm profile on a slow machine and a cold profile on a fast one look identical.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const pushed: Array<{ name: string; props: Record<string, unknown> }> = [];
vi.mock('@/services/AnalyticsBuffer', () => ({
    analyticsBuffer: {
        push: (name: string, props: Record<string, unknown>) => { pushed.push({ name, props }); },
    },
}));

import {
    probeCache, markIdentitySettled, recordAcquisitionStart, recordAcquisitionSuccess,
    recordAcquisitionFailure, classifyAcquisitionError, __resetAcquisitionTelemetry, __pendingCount,
    type AcquisitionSubject,
} from '../modelAcquisitionTelemetry';

const SUBJECT: AcquisitionSubject = {
    candidateId: 'moonshine:streaming-medium',
    modelIdentity: 'moonshine-medium@pinned',
    assetPinDigest: 'sha256-abc',
    releaseId: 'rel-1',
    trigger: 'explicit-setup',
};
const ASSETS = [
    { file: 'encoder', url: 'https://cdn.example/enc.onnx' },
    { file: 'decoder', url: 'https://cdn.example/dec.onnx' },
];
const fakeCaches = (present: string[]) => ({
    match: async (url: string) => (present.includes(url) ? ({} as Response) : undefined),
}) as unknown as CacheStorage;

beforeEach(() => { pushed.length = 0; __resetAcquisitionTelemetry(); });
afterEach(() => vi.restoreAllMocks());

describe('#1259s cache result comes from the CACHE BOUNDARY', () => {
    it('all assets present → hit', async () => {
        expect(await probeCache(ASSETS, fakeCaches(ASSETS.map((a) => a.url)))).toBe('hit');
    });

    it('no asset present → miss', async () => {
        expect(await probeCache(ASSETS, fakeCaches([]))).toBe('miss');
    });

    it('some assets present → partial', async () => {
        expect(await probeCache(ASSETS, fakeCaches([ASSETS[0].url]))).toBe('partial');
    });

    it('CASUALTY: no Cache Storage → unobservable, never a guess', async () => {
        expect(await probeCache(ASSETS, undefined)).toBe('unobservable');
    });

    it('CASUALTY: a THROWING cache boundary is unobservable, not a miss', async () => {
        // Reporting `miss` here would manufacture a download that may never have happened.
        const throwing = { match: async () => { throw new Error('opaque'); } } as unknown as CacheStorage;
        expect(await probeCache(ASSETS, throwing)).toBe('unobservable');
    });

    it('CASUALTY: speed is never used to decide cache result', async () => {
        // The whole point. An instant probe that found nothing is still a miss.
        const instantEmpty = { match: async () => undefined } as unknown as CacheStorage;
        expect(await probeCache(ASSETS, instantEmpty)).toBe('miss');
    });
});

describe('#1259s download duration is separated from initialisation', () => {
    it('reports download and init separately, and they sum to the total', () => {
        markIdentitySettled();
        recordAcquisitionSuccess(SUBJECT, {
            completeness: 'complete', reasonCode: null, outOfScopeCount: 0,
            cacheResult: 'miss', networkUsed: true, networkBytes: 1024, assetCount: 2,
            downloadMs: 300, totalMs: 800,
        });
        const e = pushed.find((p) => p.name === 'private_model_acquisition_success')!;
        expect(e.props.download_ms).toBe(300);
        expect(e.props.init_ms).toBe(500);
        expect(e.props.total_ms).toBe(800);
    });

    it('CASUALTY: an unobservable download reports null init rather than inventing one', () => {
        markIdentitySettled();
        recordAcquisitionSuccess(SUBJECT, {
            completeness: 'complete', reasonCode: null, outOfScopeCount: 0,
            cacheResult: 'unobservable', networkUsed: false, networkBytes: null, assetCount: null,
            downloadMs: null, totalMs: 800,
        });
        const e = pushed.find((p) => p.name === 'private_model_acquisition_success')!;
        expect(e.props.download_ms).toBeNull();
        expect(e.props.init_ms, 'subtracting from an unknown download would fabricate a number').toBeNull();
        expect(e.props.total_ms).toBe(800);
    });

    it('a cache HIT that still used the network is recorded honestly', () => {
        // partial hits download. `network_used` is a separate fact from `cache_result`.
        markIdentitySettled();
        recordAcquisitionSuccess(SUBJECT, {
            completeness: 'complete', reasonCode: null, outOfScopeCount: 0,
            cacheResult: 'partial', networkUsed: true, networkBytes: 512, assetCount: 2,
            downloadMs: 100, totalMs: 400,
        });
        const e = pushed.find((p) => p.name === 'private_model_acquisition_success')!;
        expect(e.props.cache_result).toBe('partial');
        expect(e.props.network_used).toBe(true);
    });
});

describe('#1259s identity must settle before an event is classified (#1401)', () => {
    it('CASUALTY: events emitted before identity settles are HELD, not sent anonymously', () => {
        // Model setup begins during page initialisation, before auth resolves. Sending then attributes
        // a returning user's cold load to anonymous traffic, and their warm load to themselves — so the
        // two can never be compared, which is the question this telemetry exists to answer.
        recordAcquisitionStart(SUBJECT, 'miss');
        expect(pushed, 'nothing may be sent before identity settles').toHaveLength(0);
        expect(__pendingCount()).toBe(1);

        markIdentitySettled();
        expect(pushed).toHaveLength(1);
        expect(pushed[0].name).toBe('private_model_acquisition_start');
    });

    it('held events flush IN ORDER once identity settles', () => {
        recordAcquisitionStart(SUBJECT, 'miss');
        recordAcquisitionSuccess(SUBJECT, {
            completeness: 'complete', reasonCode: null, outOfScopeCount: 0,
            cacheResult: 'miss', networkUsed: true, networkBytes: 1, assetCount: 1,
            downloadMs: 1, totalMs: 2,
        });
        markIdentitySettled();
        expect(pushed.map((p) => p.name)).toEqual([
            'private_model_acquisition_start',
            'private_model_acquisition_success',
        ]);
    });

    it('after settling, later events are sent immediately', () => {
        markIdentitySettled();
        recordAcquisitionStart(SUBJECT, 'hit');
        expect(pushed).toHaveLength(1);
        expect(__pendingCount()).toBe(0);
    });
});

describe('#1259s failure is sanitized, bounded and non-blocking', () => {
    it.each([
        ['NetworkError when attempting to fetch', 'network'],
        ['SHA-256 integrity check failed for https://cdn/x.onnx', 'integrity'],
        ['The operation was aborted', 'aborted'],
        ['QuotaExceededError: storage full', 'storage'],
        ['WebGPU is not supported', 'unsupported'],
        ['operation timed out', 'timeout'],
        ['something nobody predicted', 'unknown'],
    ])('reduces %s to a bounded code', (message, code) => {
        expect(classifyAcquisitionError(new Error(message))).toBe(code);
    });

    it('CASUALTY: a failure event carries the CODE and never the raw message', () => {
        markIdentitySettled();
        const raw = 'failed to fetch https://cdn.example/enc.onnx?token=SECRET for user 1234';
        recordAcquisitionFailure(SUBJECT, 'miss', classifyAcquisitionError(new Error(raw)), 900);
        const e = pushed.find((p) => p.name === 'private_model_acquisition_failure')!;
        const serialized = JSON.stringify(e.props);
        expect(e.props.error_code).toBe('network');
        expect(serialized).not.toMatch(/cdn\.example/);
        expect(serialized).not.toMatch(/SECRET/);
        expect(serialized).not.toMatch(/1234/);
    });

    it('CASUALTY: a throwing telemetry transport does not break model readiness', async () => {
        // A model the user can speak into is worth more than a record that they did.
        vi.resetModules();
        vi.doMock('@/services/AnalyticsBuffer', () => ({
            analyticsBuffer: { push: () => { throw new Error('transport down'); } },
        }));
        const mod = await import('../modelAcquisitionTelemetry');
        mod.__resetAcquisitionTelemetry();
        mod.markIdentitySettled();
        expect(() => mod.recordAcquisitionStart(SUBJECT, 'miss')).not.toThrow();
    });
});

describe('#1259s the event body is content-free', () => {
    it('CASUALTY: no asset URL, transcript, audio or raw user id is emitted', () => {
        markIdentitySettled();
        recordAcquisitionStart(SUBJECT, 'miss');
        recordAcquisitionSuccess(SUBJECT, {
            completeness: 'complete', reasonCode: null, outOfScopeCount: 0,
            cacheResult: 'miss', networkUsed: true, networkBytes: 2048, assetCount: 2,
            downloadMs: 100, totalMs: 300,
        });
        const all = JSON.stringify(pushed);
        expect(all).not.toMatch(/https?:\/\//);
        expect(all).not.toMatch(/transcript/i);
        expect(all).not.toMatch(/audio/i);
        // Attribution is by identity, not by a raw id property.
        expect(all).not.toMatch(/user_id|userId|distinct_id/);
    });

    it('CASUALTY: the emitted property set is an ALLOWLIST — a new field cannot slip in', () => {
        // A key-by-key allowlist rather than a search for known-bad strings. Searching for "http" or a
        // user id only catches leaks somebody already imagined; this catches any field at all, which is
        // how an unplanned one (a raw message, a URL, a stack) would actually arrive.
        markIdentitySettled();
        recordAcquisitionStart(SUBJECT, 'miss');
        recordAcquisitionSuccess(SUBJECT, {
            completeness: 'complete', reasonCode: null, outOfScopeCount: 0,
            cacheResult: 'miss', networkUsed: true, networkBytes: 1, assetCount: 1,
            downloadMs: 1, totalMs: 2,
        });
        recordAcquisitionFailure(SUBJECT, 'miss', 'network', 3);

        const ALLOWED = new Set([
            // `acquired_candidate_id`, NOT `candidate_id`: the latter belongs to the analytics envelope,
            // which strips producer values and substitutes what the engine RESOLVED. During a cold load
            // nothing has resolved, so naming the subject there had it overwritten with null.
            'acquired_candidate_id', 'model_identity', 'asset_pin_digest', 'release_id', 'trigger',
            'cache_result', 'network_used', 'network_bytes', 'asset_count',
            'download_ms', 'init_ms', 'total_ms', 'outcome', 'error_code',
            // #1259: the bounded completeness signal. `measurement_reason_code` is a CLOSED vocabulary;
            // the free-form reason is deliberately absent and must never be emitted. The partial fields
            // exist so a measurement covering an unknown fraction is never published as a complete one.
            'measurement_completeness', 'measurement_reason_code', 'out_of_scope_count',
            'partial_network_bytes', 'partial_download_ms',
        ]);
        for (const { name, props } of pushed) {
            for (const key of Object.keys(props)) {
                expect(ALLOWED.has(key), `${name} emitted an unlisted property "${key}"`).toBe(true);
            }
        }
    });

    it('carries the identity fields attribution needs', () => {
        markIdentitySettled();
        recordAcquisitionStart(SUBJECT, 'hit');
        const p = pushed[0].props;
        expect(p.acquired_candidate_id).toBe('moonshine:streaming-medium');
        expect(p.model_identity).toBe('moonshine-medium@pinned');
        expect(p.asset_pin_digest).toBe('sha256-abc');
        expect(p.release_id).toBe('rel-1');
        expect(p.trigger).toBe('explicit-setup');
    });

    it('CASUALTY: switching candidates never attributes one model to another', () => {
        markIdentitySettled();
        recordAcquisitionStart(SUBJECT, 'hit');
        recordAcquisitionStart({ ...SUBJECT, candidateId: 'v2:base.en', modelIdentity: 'whisper-base.en' }, 'miss');
        expect(pushed[0].props.acquired_candidate_id).toBe('moonshine:streaming-medium');
        expect(pushed[1].props.acquired_candidate_id).toBe('v2:base.en');
        expect(pushed[1].props.model_identity).toBe('whisper-base.en');
    });
});
