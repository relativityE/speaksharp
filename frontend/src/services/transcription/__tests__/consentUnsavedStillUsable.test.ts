/**
 * #1405 RETURN — a storage failure must not make Private STT unusable.
 *
 * The previous behaviour was worse than the bug it replaced. Refusing to initialize when the receipt
 * could not be written meant a user with blocked site data clicked "Set up Private" and could never
 * transcribe at all — for a failure that is ours, not theirs. Their decision is real; only our record
 * of it failed.
 *
 * The contract proven here: the session continues, the user is told plainly that it was NOT saved, the
 * prompt does not come back inside the same live session, and a NEW facade legitimately asks again —
 * because nothing was persisted, and pretending otherwise would be the same lie in the other direction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NavigateFunction } from 'react-router-dom';
import type { MicStream } from '../utils/types';
import type { SttStatus } from '../../../types/transcription';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

type Grant = () => void;

/** The three real ways persistence fails, named as the user's browser produces them. */
const STORAGE_FAILURES: Array<[string, Grant]> = [
    ['storage unavailable', () => { throw new Error('STT_CONSENT_NOT_PERSISTED: no storage available'); }],
    ['setItem throws', () => { throw new Error('STT_CONSENT_NOT_PERSISTED: QuotaExceededError'); }],
    ['write cannot be read back', () => { throw new Error('STT_CONSENT_NOT_PERSISTED: could not be read back'); }],
];

const EXPECTED_WARNING = 'Setup couldn’t be saved. You may be asked to set up Private again next time.';

describe('#1405 RETURN — unsaved setup still lets this session run', () => {
    let ServiceClass: typeof import('../TranscriptionService').default;
    let statuses: SttStatus[];

    beforeEach(async () => {
        await setupStrictZero();
        ServiceClass = (await import('../TranscriptionService')).default;
        statuses = [];
    });
    afterEach(() => { vi.restoreAllMocks(); });

    /**
     * A strategy that needs setup, records the grant through `grant`, and reports itself available only
     * once a grant has been accepted — the same shape as the real engine reading its receipt.
     */
    function makeStrategy(grant: Grant, opts: { persists: boolean }) {
        const state = { granted: false, initCalls: 0, prompts: 0 };
        return {
            state,
            strategy: {
                init: vi.fn(async () => { state.initCalls += 1; }),
                startTranscription: vi.fn(async () => {}),
                stopTranscription: vi.fn(async () => ''),
                getTranscript: vi.fn(async () => ''),
                destroy: vi.fn(async () => {}),
                checkAvailability: vi.fn(async () => {
                    if (state.granted && opts.persists) return { isAvailable: true };
                    state.prompts += 1;
                    return { isAvailable: false, reason: 'CONSENT_REQUIRED', message: 'about 305 MB' };
                }),
                grantModelConsent: vi.fn(() => { grant(); state.granted = true; }),
            },
        };
    }

    /**
     * Drive the REAL entry point. `initializeStrategy` preserves an already-assigned strategy
     * (`if (!this.strategy)`), so the double survives and the genuine availability/consent gate runs.
     * `forceExplicit` is the user's click on "Set up Private".
     */
    const initExplicit = (svc: unknown) =>
        (svc as { initializeStrategy: (m: string, isMock: boolean, forceExplicit: boolean) => Promise<void> })
            .initializeStrategy('private', false, true);

    /**
     * Pre-assign the strategy AND the mode. `initializeStrategy` purges an existing strategy when
     * `this.mode !== mode`, and `mode` starts null — so assigning the double alone silently loses it and
     * the real factory runs instead, which is how the first version of this test proved nothing.
     */
    const attach = (svc: unknown, strategy: unknown) => {
        (svc as { strategy: unknown }).strategy = strategy;
        (svc as { mode: string }).mode = 'private';
    };

    function makeService() {
        return new ServiceClass({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onStatusChange: (s: SttStatus) => { statuses.push(s); },
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('token'),
            policy: { allowNative: false, allowPrivate: true, preferredMode: 'private', executionIntent: 'test', allowFallback: false },
            mockMic: { stream: {} as MediaStream, stop: vi.fn(), clone: vi.fn(), onFrame: vi.fn().mockReturnValue(() => {}) } as unknown as MicStream,
        });
    }

    describe.each(STORAGE_FAILURES)('%s', (_label, grant) => {
        it('warns without claiming success, and PERMITS initialization', async () => {
            const { state, strategy } = makeStrategy(grant, { persists: false });
            const svc = makeService();
            attach(svc, strategy);

            await expect(initExplicit(svc)).resolves.not.toThrow();

            const warning = statuses.find((s) => s.type === 'warning');
            expect(warning, 'the user must be told the setup was not saved').toBeTruthy();
            expect(warning?.message).toBe(EXPECTED_WARNING);

            // PERMITS INITIALIZATION — the claim, stated exactly. The consent failure did not abort the
            // run: the service went on to prepare the model and CALLED the strategy's init.
            expect(strategy.init, 'initialization must proceed despite the unsaved receipt').toHaveBeenCalled();
            expect(statuses.some((s) => s.type === 'download-required' && /Preparing/.test(s.message ?? '')),
                'the download/preparation step must still be reached').toBe(true);

            // Not a blocking consent error, and never a claim that the save worked.
            expect(statuses.some((s) => s.type === 'error'), 'a storage failure is not a fatal error').toBe(false);
            expect(statuses.some((s) => /saved|remembered/i.test(s.message ?? '') && s.type !== 'warning'),
                'nothing may claim the setup was saved').toBe(false);
            // The grant was ATTEMPTED. `state.granted` deliberately stays false here: the double sets it
            // only after a successful write, and the write threw — which is exactly the real situation.
            expect(strategy.grantModelConsent, 'the user\'s decision was still acted on').toHaveBeenCalledTimes(1);
            expect(state.granted, 'nothing was persisted, and the double must not pretend otherwise').toBe(false);
            // NOTE: this harness stops at init() — the double does not drive full engine readiness, so
            // this proves initialization was PERMITTED, not that the engine finished warming.
        });

        it('does not ask again inside the SAME live session', async () => {
            const { strategy } = makeStrategy(grant, { persists: false });
            const svc = makeService();
            attach(svc, strategy);
            const call = () => initExplicit(svc);

            await call();
            const grantsAfterFirst = strategy.grantModelConsent.mock.calls.length;
            await call();

            expect(strategy.grantModelConsent.mock.calls.length,
                'the same session must not re-run setup for a decision already made').toBe(grantsAfterFirst);
            expect(grantsAfterFirst, 'the first attempt did happen').toBe(1);
        });
    });

    it('a NEW facade asks again when nothing was persisted — the honest outcome', async () => {
        const grant: Grant = () => { throw new Error('STT_CONSENT_NOT_PERSISTED: no storage available'); };
        const first = makeStrategy(grant, { persists: false });
        const svcA = makeService();
        attach(svcA, first.strategy);
        await initExplicit(svcA);
        expect(first.strategy.grantModelConsent).toHaveBeenCalled();

        // A second facade has no receipt to read, so it must ask — the in-memory grant is per-instance.
        const second = makeStrategy(grant, { persists: false });
        const svcB = makeService();
        attach(svcB, second.strategy);
        await initExplicit(svcB);
        expect(second.strategy.grantModelConsent, 'a new facade must ask again when nothing was saved').toHaveBeenCalled();
    });

    it('POSITIVE CONTROL: successful persistence suppresses setup for the NEXT facade', async () => {
        const ok: Grant = () => {};
        const first = makeStrategy(ok, { persists: true });
        const svcA = makeService();
        attach(svcA, first.strategy);
        await initExplicit(svcA);
        expect(first.strategy.grantModelConsent).toHaveBeenCalledTimes(1);
        // No warning may appear when the receipt really was written.
        expect(statuses.some((s) => s.type === 'warning' && s.message === EXPECTED_WARNING),
            'a successful save must not warn').toBe(false);

        // The next facade reads a real receipt: available immediately, never prompted.
        const second = makeStrategy(ok, { persists: true });
        second.state.granted = true;
        const svcB = makeService();
        attach(svcB, second.strategy);
        await initExplicit(svcB);
        expect(second.strategy.grantModelConsent, 'a persisted receipt must stop the asking').not.toHaveBeenCalled();
    });

    it('audio locality is untouched by any of this — no upload path is introduced', async () => {
        // The whole feature is a local receipt in local storage. A consent change must never become a
        // reason to send anything off-device.
        const { readFileSync } = await import('node:fs');
        const svcSrc = readFileSync('frontend/src/services/transcription/TranscriptionService.ts', 'utf8');
        const at = svcSrc.indexOf('consentGrantedThisSession');
        const region = svcSrc.slice(Math.max(0, at - 2000), at + 4000);
        expect(region).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/);
    });
});
