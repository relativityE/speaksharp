// @vitest-environment jsdom
/**
 * #1259 RETURN — THE v4 PRODUCTION WORKER, INSTRUMENTED AND GUARDED.
 *
 * The previous head instrumented `TransformersJSEngine` and its worker and claimed v2 AND v4 were
 * covered. They were not. `TransformersJSV4Engine` carried no attempt, no receipt and no worker-local
 * timing, its request carried no scope, and `acquisitionScopeFor` returned an empty list for it — so
 * `PrivateSTT` fell back to main-window Resource Timing for v4, the exact boundary the browser proof
 * shows cannot observe a worker's fetches. v4 therefore reported nothing while CI was green.
 *
 * These drive the REAL v4 engine handler with REAL `loaded` messages from the worker's own message
 * contract. Nothing here is a generic fake engine: the decision under test is the one v4 ships.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransformersJSV4Engine } from '../engines/TransformersJSV4Engine';
import { acquisitionScopeFor } from '../candidateAssetRequests';
import { CANDIDATES } from '../candidateRegistry';
import {
    mintAcquisitionAttempt, composeAcquisitionReceipt, type AcquisitionReceipt,
} from '../acquisitionAttempt';

vi.mock('../../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// The v4 engine mints from the EFFECTIVE candidate — the same selection authority PrivateSTT used to
// reach this engine, so in production the two agree by construction. The suite states that pairing
// explicitly rather than relying on the checked-in default, which names v2.
vi.mock('../candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return {
        ...actual,
        effectiveCandidate: () => ({ candidate: CANDIDATES['v4:distil:q4'], fallbackCause: null }),
    };
});

const V4 = CANDIDATES['v4:distil:q4'];

const receipt = (over: Partial<AcquisitionReceipt> = {}): AcquisitionReceipt => ({
    assetCount: 7, networkBytes: 41_233_000, downloadMs: 3100, networkUsed: true,
    outOfScopeCount: 0, unobservableReason: null,
    attemptToken: 'acq-x', candidateId: 'v4:distil:q4', ...over,
});

/** The worker's real `loaded` message shape. */
const loaded = (acquisition: AcquisitionReceipt | null) => ({
    id: 1, type: 'loaded' as const, loadTimeMs: 5200,
    model: 'onnx-community/distil-small.en', device: 'wasm', acquisition,
});

type V4Private = {
    handleWorkerMessage: (r: unknown, m: unknown) => void;
    activeAttempt: { token: string; candidateId: string } | null;
    acquisitionReceipt: AcquisitionReceipt | null;
    getAcquisitionReceipt: () => AcquisitionReceipt | null;
    getAcquisitionAttempt: () => { token: string; candidateId: string } | null;
    initWorker: (isMock: boolean | undefined, m: { MODEL_ID: string; DTYPE: unknown }, d?: string) => Promise<void>;
    sendWorkerRequest: (r: unknown) => Promise<unknown>;
    worker: unknown;
};

let engine: V4Private;
const V4_MODEL = { MODEL_ID: 'onnx-community/distil-small.en', DTYPE: {} };
const deliver = (msg: unknown) => engine.handleWorkerMessage(msg, V4_MODEL);

beforeEach(() => {
    engine = new TransformersJSV4Engine({} as never) as unknown as V4Private;
    engine.acquisitionReceipt = null;
    engine.activeAttempt = null;
});

describe('#1259 v4 has a real request scope', () => {
    it('CASUALTY: the v4 scope is NOT empty', () => {
        // It returned `[]`, so every v4 observation was unobservable before it began.
        expect(acquisitionScopeFor(V4).length).toBeGreaterThan(0);
    });

    it('CASUALTY: the scope is the model REPOSITORY from the registry, not a file table', () => {
        // A hand-written list of asset names would go stale the moment the loader asked for one more.
        expect(acquisitionScopeFor(V4)).toEqual([V4.model.id]);
    });

    it("the pre-load cache probe stays honestly unobservable for v4", () => {
        // Sanctioned: nothing can be looked up in a cache before the load names the files it wants.
        // That is a DIFFERENT field from the download measurement, which v4 now has.
        expect(V4.assets.provenance).not.toBe('self_hosted');
    });
});

describe('#1259 the v4 worker REQUEST carries what the worker needs', () => {
    it('CASUALTY: the init request carries a NON-EMPTY scope and an attempt', async () => {
        // Without either, the worker measures nothing and returns an anonymous receipt — which the
        // engine then correctly rejects, so v4 reports null while every engine-side test still passes.
        let sent: { assetPrefixes?: string[]; attempt?: { token: string; candidateId: string } } | null = null;
        engine.sendWorkerRequest = vi.fn(async (r) => {
            sent = r as typeof sent;
            return { id: 1, type: 'ready' };
        });
        await engine.initWorker(true, V4_MODEL);

        expect(sent, 'the init request must be sent').not.toBeNull();
        expect(sent!.assetPrefixes?.length, 'an empty scope makes the worker observation vacuous')
            .toBeGreaterThan(0);
        expect(sent!.attempt?.token, 'without a token the receipt cannot be authenticated').toBeTruthy();
        expect(sent!.attempt?.candidateId).toBe(V4.id);
    });
});

describe('#1259 the worker composes a receipt only WITH an identity', () => {
    const observation = {
        assetCount: 7, networkBytes: 41_233_000, downloadMs: 3100,
        networkUsed: true, outOfScopeCount: 0, unobservableReason: null,
    };

    it('CASUALTY: an attempt produces a receipt carrying the token and candidate echo', () => {
        const attempt = mintAcquisitionAttempt('v4:distil:q4');
        const composed = composeAcquisitionReceipt(observation, attempt);
        expect(composed?.attemptToken).toBe(attempt.token);
        expect(composed?.candidateId).toBe('v4:distil:q4');
        expect(composed?.downloadMs, 'the measurement survives composition').toBe(3100);
    });

    it('CASUALTY: NO attempt yields NO receipt, rather than an anonymous one', () => {
        // An anonymous receipt cannot say which load it describes, so it is indistinguishable from a
        // stale one. Withholding it is the honest answer; sending it invites a wrong attribution.
        expect(composeAcquisitionReceipt(observation, undefined)).toBeNull();
    });

    it('CASUALTY: a half-formed attempt yields no receipt', () => {
        expect(composeAcquisitionReceipt(observation, { token: '', candidateId: 'v4:distil:q4' })).toBeNull();
        expect(composeAcquisitionReceipt(observation, { token: 'acq-1', candidateId: '' })).toBeNull();
    });
});

describe('#1259 the real v4 handler accepts one receipt, and only its own', () => {
    it('CASUALTY: a receipt matching the active attempt is accepted and EXPOSED', () => {
        const attempt = mintAcquisitionAttempt('v4:distil:q4');
        engine.activeAttempt = attempt;
        deliver(loaded(receipt({ attemptToken: attempt.token })));
        expect(engine.getAcquisitionReceipt()?.downloadMs).toBe(3100);
        expect(engine.getAcquisitionReceipt()?.networkBytes).toBe(41_233_000);
    });

    it('CASUALTY: a DUPLICATE cannot overwrite the accepted receipt', () => {
        const attempt = mintAcquisitionAttempt('v4:distil:q4');
        engine.activeAttempt = attempt;
        deliver(loaded(receipt({ attemptToken: attempt.token, downloadMs: 3100 })));
        deliver(loaded(receipt({ attemptToken: attempt.token, downloadMs: 99_999 })));
        expect(engine.getAcquisitionReceipt()?.downloadMs, 'exactly once').toBe(3100);
    });

    it('CASUALTY: a PREVIOUS attempt at the same candidate is rejected', () => {
        const first = mintAcquisitionAttempt('v4:distil:q4');
        const second = mintAcquisitionAttempt('v4:distil:q4');
        engine.activeAttempt = second;
        deliver(loaded(receipt({ attemptToken: first.token })));
        expect(engine.getAcquisitionReceipt(), 'the retry must not inherit the failed load').toBeNull();
    });

    it('CASUALTY: a WRONG-candidate receipt is rejected', () => {
        const attempt = mintAcquisitionAttempt('v4:distil:q4');
        engine.activeAttempt = attempt;
        deliver(loaded(receipt({ attemptToken: attempt.token, candidateId: 'v2:base.en' })));
        expect(engine.getAcquisitionReceipt()).toBeNull();
    });

    it('CASUALTY: a POST-TEARDOWN receipt is rejected', () => {
        engine.activeAttempt = null; // what terminate() and settlement both leave behind
        deliver(loaded(receipt()));
        expect(engine.getAcquisitionReceipt()).toBeNull();
    });

    it('CASUALTY: rejecting a receipt does not disturb readiness', () => {
        // The message is still processed as a normal `loaded`; only the telemetry is declined.
        const attempt = mintAcquisitionAttempt('v4:distil:q4');
        engine.activeAttempt = attempt;
        expect(() => deliver(loaded(receipt({ attemptToken: 'someone-elses' })))).not.toThrow();
        expect(engine.getAcquisitionReceipt()).toBeNull();
    });

    it('a `loaded` with NO receipt leaves the state absent, not zero', () => {
        engine.activeAttempt = mintAcquisitionAttempt('v4:distil:q4');
        deliver(loaded(null));
        expect(engine.getAcquisitionReceipt()).toBeNull();
    });

    it('CASUALTY: the v4 engine RETIRES the attempt when the load settles', async () => {
        // Proving the rule is not proving that anything applies it: without retirement a late receipt
        // would still match the attempt that produced it. A FAILED load must retire too — that is the
        // retry case, where the stale receipt describes the attempt that did not succeed.
        engine.sendWorkerRequest = vi.fn(async () => { throw new Error('worker died'); });
        await expect(engine.initWorker(true, V4_MODEL)).rejects.toThrow();
        expect(engine.activeAttempt, 'a settled load leaves no attempt in flight').toBeNull();
    });
});
