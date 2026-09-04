// @vitest-environment jsdom
/**
 * #1259 — WHICH LOAD DOES THIS RECEIPT DESCRIBE?
 *
 * The worker's receipt arrived with no identity on it, so the engine stored whatever showed up. A
 * receipt from a superseded attempt — a candidate switch, a retry after failure, a torn-down worker
 * answering late — would be accepted and attributed to the load that happened to be current. That is
 * worse than missing telemetry: the numbers still look like measurements, and model selection is the
 * decision they would corrupt. A download time recorded against the wrong candidate is an argument for
 * shipping the wrong model.
 *
 * These drive the ENGINE'S REAL worker-message handler with real `loaded` messages, so acceptance and
 * rejection are properties of the shipped code rather than of the order a test happens to use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mintAcquisitionAttempt, receiptMatches, type AcquisitionReceipt } from '../acquisitionAttempt';

const observation = (over: Partial<AcquisitionReceipt> = {}): AcquisitionReceipt => ({
    assetCount: 12, networkBytes: 80_553_222, downloadMs: 2500, networkUsed: true,
    unobservableReason: null, attemptToken: 'acq-1-x', candidateId: 'v2:base.en', ...over,
});

describe('#1259 an attempt is unique, and a receipt must name it', () => {
    it('CASUALTY: two loads of the SAME candidate mint different tokens', () => {
        // Otherwise a retry after a failure could not be told from the attempt that failed — and the
        // stale receipt describes the load that did NOT succeed.
        const a = mintAcquisitionAttempt('v2:base.en');
        const b = mintAcquisitionAttempt('v2:base.en');
        expect(a.token).not.toBe(b.token);
        expect(a.candidateId).toBe(b.candidateId);
    });

    it('CASUALTY: a matching receipt is accepted', () => {
        const attempt = mintAcquisitionAttempt('v2:base.en');
        expect(receiptMatches(observation({ attemptToken: attempt.token }), attempt)).toBe(true);
    });

    it('CASUALTY: a PREVIOUS attempt at the same candidate is rejected', () => {
        const first = mintAcquisitionAttempt('v2:base.en');
        const second = mintAcquisitionAttempt('v2:base.en');
        const stale = observation({ attemptToken: first.token, candidateId: 'v2:base.en' });
        expect(receiptMatches(stale, second), 'the token is what separates a retry from its failure').toBe(false);
    });

    it('CASUALTY: the WRONG candidate is rejected even with a matching token', () => {
        const attempt = mintAcquisitionAttempt('v2:base.en');
        const wrong = observation({ attemptToken: attempt.token, candidateId: 'moonshine:streaming-medium' });
        expect(receiptMatches(wrong, attempt)).toBe(false);
    });

    it('CASUALTY: a receipt with no attempt to match against is rejected', () => {
        // This is the state after settlement or teardown: nothing is in flight, so nothing is accepted.
        expect(receiptMatches(observation(), null)).toBe(false);
        expect(receiptMatches(null, mintAcquisitionAttempt('v2:base.en'))).toBe(false);
    });
});

describe("#1259 the engine's real handler accepts exactly one, and only its own", () => {
    /**
     * Drive the engine's actual `worker.onmessage`. A fake Worker stands in for the browser's, because
     * the message CONTENT and the handler's decision are what is under test; the worker's own
     * measurement is proven separately at the real boundary.
     */
    type EnginePrivate = {
        activeAttempt: { token: string; candidateId: string } | null;
        acquisitionReceipt: AcquisitionReceipt | null;
        getAcquisitionReceipt: () => AcquisitionReceipt | null;
        /** The REAL handler the live worker's onmessage delegates to. */
        handleWorkerMessage: (response: unknown, options: unknown) => void;
    };

    let engine: EnginePrivate;
    /** Deliver a message exactly as `worker.onmessage` does. */
    const deliver = (data: unknown) => engine.handleWorkerMessage(data, {});

    beforeEach(async () => {
        vi.resetModules();
        const { TransformersJSEngine } = await import('../engines/TransformersJSEngine');
        engine = new TransformersJSEngine({} as never) as unknown as EnginePrivate;
    });

    const loaded = (receipt: AcquisitionReceipt | null) => ({
        id: 1, type: 'loaded', loadTimeMs: 3000, model: 'whisper-base.en',
        device: 'wasm-singlethread', requestedThreads: 1, configuredThreads: 1,
        workerReportedThreads: null, crossOriginIsolated: true, acquisition: receipt,
    });

    it('CASUALTY: a receipt matching the active attempt is accepted', () => {
        const attempt = mintAcquisitionAttempt('v2:base.en');
        engine.activeAttempt = attempt;
        engine.acquisitionReceipt = null;
        deliver(loaded(observation({ attemptToken: attempt.token })));
        expect(engine.getAcquisitionReceipt()?.downloadMs).toBe(2500);
    });

    it('CASUALTY: a DUPLICATE receipt cannot overwrite the accepted one', () => {
        const attempt = mintAcquisitionAttempt('v2:base.en');
        engine.activeAttempt = attempt;
        engine.acquisitionReceipt = null;
        deliver(loaded(observation({ attemptToken: attempt.token, downloadMs: 2500 })));
        deliver(loaded(observation({ attemptToken: attempt.token, downloadMs: 99_999 })));
        expect(engine.getAcquisitionReceipt()?.downloadMs, 'exactly once').toBe(2500);
    });

    it('CASUALTY: a receipt arriving after settlement is IGNORED', () => {
        // `activeAttempt` is retired when the load settles, so a late worker message matches nothing.
        engine.activeAttempt = null;
        engine.acquisitionReceipt = null;
        deliver(loaded(observation()));
        expect(engine.getAcquisitionReceipt(), 'a late receipt describes a load nobody is waiting for').toBeNull();
    });

    it('CASUALTY: a receipt for a DIFFERENT candidate is ignored', () => {
        const attempt = mintAcquisitionAttempt('v2:base.en');
        engine.activeAttempt = attempt;
        engine.acquisitionReceipt = null;
        deliver(loaded(observation({
            attemptToken: attempt.token, candidateId: 'v4:distil:q4',
        })));
        expect(engine.getAcquisitionReceipt()).toBeNull();
    });

    it('CASUALTY: the engine RETIRES the attempt when the load settles', async () => {
        // The rejection tests above set `activeAttempt` to null themselves, which proves the RULE but
        // not that anything ever applies it. If the code stopped retiring, a receipt from a finished
        // load would still match the attempt that produced it — and every one of those tests would go
        // on passing while late receipts were silently accepted.
        const priv = engine as unknown as {
            initWorker: (isMock?: boolean) => Promise<void>;
            sendWorkerRequest: (r: unknown) => Promise<unknown>;
            activeAttempt: unknown;
        };
        // A load that FAILS must retire the token too — that is the retry case, where the stale receipt
        // describes the attempt that did not succeed.
        priv.sendWorkerRequest = vi.fn(async () => { throw new Error('worker died'); });
        await priv.initWorker(true).catch(() => {});
        expect(priv.activeAttempt, 'a settled load must leave no attempt in flight').toBeNull();
    });

    it('a `loaded` message with NO receipt leaves the state absent, not zero', () => {
        const attempt = mintAcquisitionAttempt('v2:base.en');
        engine.activeAttempt = attempt;
        engine.acquisitionReceipt = null;
        deliver(loaded(null));
        expect(engine.getAcquisitionReceipt(), 'absent is not a measured zero').toBeNull();
    });
});
