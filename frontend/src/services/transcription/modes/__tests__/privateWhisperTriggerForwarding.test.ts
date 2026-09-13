// @vitest-environment jsdom
/**
 * #1259 — THE REAL `PrivateWhisper` FORWARDS THE ACQUISITION TRIGGER.
 *
 * `TranscriptionService` names the trigger on the STRATEGY, because that is the object it holds. The
 * telemetry lives on the `PrivateSTT` facade the strategy owns. Without this hop the service's
 * optional call landed on a method that did not exist and silently no-opped — every acquisition would
 * have gone on reporting `explicit-setup`, including the cached warm-ups the distinction exists to
 * separate, and nothing would have failed to say so.
 *
 * The unit suite globally replaces this module with a double, so the REAL class is imported here
 * explicitly. A test that asserted the double would prove only that the double forwards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('#1259 PrivateWhisper hands the trigger to the facade that emits it', () => {
    let RealPrivateWhisper: new (options: unknown, privateSTT: unknown) => {
        setAcquisitionTrigger?: (t: 'warmup' | 'explicit-setup') => void;
    };

    beforeEach(async () => {
        // The ACTUAL module, not the suite-wide double.
        const actual = await vi.importActual<{ default: typeof RealPrivateWhisper }>(
            '@/services/transcription/modes/PrivateWhisper');
        RealPrivateWhisper = actual.default;
    });

    it('CASUALTY: the real strategy exposes the seam the service calls', () => {
        const facade = { setAcquisitionTrigger: vi.fn() };
        const strategy = new RealPrivateWhisper({}, facade);
        expect(typeof strategy.setAcquisitionTrigger,
            'the service calls this on the strategy; absent, its optional call no-ops').toBe('function');
    });

    it('CASUALTY: `warmup` reaches the facade unchanged', () => {
        const facade = { setAcquisitionTrigger: vi.fn() };
        const strategy = new RealPrivateWhisper({}, facade);
        strategy.setAcquisitionTrigger?.('warmup');
        expect(facade.setAcquisitionTrigger).toHaveBeenCalledWith('warmup');
    });

    it('CASUALTY: `explicit-setup` reaches the facade unchanged', () => {
        const facade = { setAcquisitionTrigger: vi.fn() };
        const strategy = new RealPrivateWhisper({}, facade);
        strategy.setAcquisitionTrigger?.('explicit-setup');
        expect(facade.setAcquisitionTrigger).toHaveBeenCalledWith('explicit-setup');
    });

    it('a facade without the seam is tolerated, not fatal', () => {
        // Telemetry must never break a model load. A facade that cannot record the trigger simply does
        // not record it.
        const strategy = new RealPrivateWhisper({}, {});
        expect(() => strategy.setAcquisitionTrigger?.('warmup')).not.toThrow();
    });
});
