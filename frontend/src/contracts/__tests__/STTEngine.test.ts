import { describe, it, expect } from 'vitest';
import { STTEngine, validateEngine } from '../STTEngine';
import { Result } from '@/services/transcription/modes/types';
import type { EngineType } from '../IPrivateSTTEngine';

class ReusableTestEngine extends STTEngine {
    public readonly type = 'mock' as EngineType;
    public starts = 0;
    protected async onInit() { return Result.ok(undefined); }
    protected async onStart() { this.starts += 1; }
    protected async onStop() {}
    protected async onDestroy() {}
    async transcribe() { return Result.ok('test'); }
}

describe('STTEngine Contract Validation (structural-only)', () => {
    it('should pass for a valid engine structure', () => {
        const validEngine = {
            init: async () => Result.ok(undefined),
            start: async () => {},
            stop: async () => {},
            pause: async () => {},
            resume: async () => {},
            getEngineType: () => 'mock',
            transcribe: async () => Result.ok('test'),
            destroy: async () => {},
            terminate: async () => {},
            checkAvailability: async () => ({ isAvailable: true })
        };

        expect(() => validateEngine(validEngine)).not.toThrow();
    });

    it('should fail if required methods are missing', () => {
        const invalidEngine = {
            init: async () => Result.ok(undefined),
            start: async () => {},
            // stop is missing
            pause: async () => {},
            resume: async () => {},
            getEngineType: () => 'mock',
            destroy: async () => {}
        };

        expect(() => validateEngine(invalidEngine)).toThrow(/STT_ENGINE_INVALID/);
        expect(() => validateEngine(invalidEngine)).toThrow(/missing required method 'stop'/);
    });

    it('should fail if engine is not an object', () => {
        expect(() => validateEngine(null)).toThrow(/STT_ENGINE_INVALID: Engine must be an object/);
        expect(() => validateEngine(undefined)).toThrow(/STT_ENGINE_INVALID: Engine must be an object/);
        expect(() => validateEngine('not an engine')).toThrow(/STT_ENGINE_INVALID: Engine must be an object/);
    });

    it('should inject default no-op for optional methods if missing', () => {
        const minimalEngine = {
            init: async () => Result.ok(undefined),
            start: async () => {},
            stop: async () => {},
            pause: async () => {},
            resume: async () => {},
            getEngineType: () => 'mock',
            transcribe: async () => Result.ok('test'),
            destroy: async () => {}
        };

        validateEngine(minimalEngine);
        
        // terminate is optional but should be injected as a no-op function if missing
        expect(typeof (minimalEngine as unknown as Record<string, unknown>).terminate).toBe('function');
    });

    it('should fail if required method is not a function', () => {
        const invalidEngine = {
            init: async () => Result.ok(undefined),
            start: 'not a function', // Should be a function
            stop: async () => {},
            pause: async () => {},
            resume: async () => {},
            getEngineType: () => 'mock',
            destroy: async () => {}
        };

        expect(() => validateEngine(invalidEngine)).toThrow(/STT_ENGINE_INVALID/);
        expect(() => validateEngine(invalidEngine)).toThrow(/missing required method 'start'/);
    });

    it('clears the terminated flag on init so a warm-up engine can be reused', async () => {
        const engine = new ReusableTestEngine();

        await engine.init();
        await engine.destroy();
        await engine.init();
        await engine.start();

        expect(engine.starts).toBe(1);
    });
});

/** An engine whose every onInit waits on its own gate, so a test controls when each acquisition settles. */
class GatedEngine extends STTEngine {
    public readonly type = 'mock' as EngineType;
    public inits = 0;
    public destroys = 0;
    public readonly gates: Array<(result: Result<void, Error> | Error) => void> = [];
    /** When set, the next onDestroy waits on a gate pushed here (a slow teardown). */
    public holdTeardown = false;
    public readonly teardownGates: Array<() => void> = [];
    /** When set, the next onDestroy rejects with it (a failed release). */
    public failTeardown: Error | null = null;
    /** One-shot hooks that run SYNCHRONOUSLY inside onInit / onStop (a child callback re-entering the engine). */
    public onInitHook: (() => void) | null = null;
    public onStopHook: (() => void) | null = null;
    protected onInit(): Promise<Result<void, Error>> {
        this.inits += 1;
        const hook = this.onInitHook;
        this.onInitHook = null;
        hook?.();
        return new Promise((resolve, reject) => {
            this.gates.push((outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome)));
        });
    }
    protected async onStart() {}
    protected async onStop() {
        const hook = this.onStopHook;
        this.onStopHook = null;
        hook?.();
    }
    protected async onDestroy() {
        this.destroys += 1;
        if (this.holdTeardown) {
            this.holdTeardown = false;
            await new Promise<void>((resolve) => { this.teardownGates.push(resolve); });
        }
        if (this.failTeardown) {
            const failure = this.failTeardown;
            this.failTeardown = null;
            throw failure;
        }
    }
    async transcribe() { return Result.ok('test'); }
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe('#1635 STTEngine init/destroy lifecycle', () => {
    it('overlapping init() calls join ONE acquisition instead of starting a second', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        const second = engine.init();
        expect(engine.inits).toBe(1);
        engine.gates[0](Result.ok(undefined));
        expect((await first).isOk).toBe(true);
        expect((await second).isOk).toBe(true);
        expect(engine.inits).toBe(1);
    });

    it.each(['destroy', 'terminate'] as const)('a %s while init is in flight cancels it: never initialised, cannot start', async (teardown) => {
        const engine = new GatedEngine();
        const pending = engine.init();
        await engine[teardown]();
        engine.gates[0](Result.ok(undefined));
        const result = await pending;
        expect(result.isOk).toBe(false);
        expect(result.isOk ? '' : result.error.message).toMatch(/init cancelled by destroy\/terminate/);
        await expect(engine.start()).rejects.toThrow(/not initialized/);
    });

    it('destroy then re-init: the old acquisition settling later cannot revive or override the new one', async () => {
        const engine = new GatedEngine();
        const old = engine.init();
        await engine.destroy();
        const fresh = engine.init();
        expect(engine.inits).toBe(2); // the re-init did not join the cancelled attempt
        engine.gates[1](Result.ok(undefined));
        expect((await fresh).isOk).toBe(true);
        engine.gates[0](Result.ok(undefined));
        expect((await old).isOk).toBe(false);
        await engine.start(); // still the fresh, initialised engine
        await engine.destroy();
        expect(engine.destroys).toBe(2);
    });

    it('a fresh init waits for a slow teardown, then starts; that teardown never touches it', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        expect((await first).isOk).toBe(true);
        engine.holdTeardown = true;
        const destroying = engine.destroy();
        const fresh = engine.init();
        await flush();
        expect(engine.inits).toBe(1); // no onInit while the teardown is still in progress
        engine.teardownGates[0]();
        await destroying;
        await flush();
        expect(engine.inits).toBe(2);
        engine.gates[1](Result.ok(undefined));
        expect((await fresh).isOk).toBe(true);
        expect(engine.destroys).toBe(1); // the old teardown ran once and did not destroy the fresh engine
        await engine.start();
    });

    it('a destroy that arrives while an init waits on a teardown cancels that init', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        await first;
        engine.holdTeardown = true;
        const destroying = engine.destroy();
        const waiting = engine.init();
        const second = engine.destroy(); // already terminating: invalidates the waiting init, waits for the teardown
        await flush(); // the first destroy reaches its held onDestroy
        expect(engine.teardownGates).toHaveLength(1);
        engine.teardownGates[0]();
        await destroying;
        await second;
        const result = await waiting;
        expect(result.isOk).toBe(false);
        expect(engine.inits).toBe(1); // the cancelled init never reached onInit
        expect(engine.destroys).toBe(1); // teardown ran exactly once
        await expect(engine.start()).rejects.toThrow(/not initialized/);
    });

    it('a failed teardown rejects destroy, every concurrent destroy/terminate waiter and a later repeat', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        await first;
        const failure = new Error('dispose failed');
        engine.failTeardown = failure;
        const outcomes = await Promise.allSettled([engine.destroy(), engine.terminate(), engine.destroy()]);
        expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected', 'rejected']);
        for (const outcome of outcomes) expect((outcome as PromiseRejectedResult).reason).toBe(failure);
        await expect(engine.destroy()).rejects.toBe(failure); // replayed after it settled, never a success
        await expect(engine.terminate()).rejects.toBe(failure);
        expect(engine.destroys).toBe(1);
    });

    it('an init that waited on a FAILED teardown refuses (release uncertain) instead of proceeding', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        await first;
        engine.holdTeardown = true;
        engine.failTeardown = new Error('dispose failed');
        const destroying = engine.destroy().catch((error: Error) => error);
        const waiting = engine.init(); // waits on the in-flight teardown, which then FAILS
        await flush();
        engine.teardownGates[0]();
        expect(await destroying).toBeInstanceOf(Error);
        const result = await waiting;
        expect(result.isOk).toBe(false);
        expect(result.isOk ? '' : result.error.message).toMatch(/previous teardown failed \(release uncertain\).*dispose failed/);
        expect(engine.inits).toBe(1); // never reached onInit
        const later = await engine.init(); // and the uncertainty is not cleared merely because time passed
        expect(later.isOk).toBe(false);
        expect(engine.inits).toBe(1);
        await expect(engine.start()).rejects.toThrow(/not initialized/);
    });

    it('preservation: reuse stays valid after a genuinely SUCCESSFUL teardown', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        await first;
        await engine.destroy();
        const again = engine.init();
        engine.gates[1](Result.ok(undefined));
        expect((await again).isOk).toBe(true);
        await engine.start();
        expect(engine.inits).toBe(2);
    });

    it('Jensen (1): an onInit hook that re-enters init() synchronously joins the SAME acquisition', async () => {
        const engine = new GatedEngine();
        let reentrant: Promise<Result<void, Error>> | null = null;
        engine.onInitHook = () => { reentrant = engine.init(); };
        const outer = engine.init();
        expect(engine.inits).toBe(1); // the re-entrant call joined the published attempt: no second acquisition
        expect(reentrant).not.toBeNull();
        engine.gates[0](Result.ok(undefined));
        expect(await outer).toEqual(Result.ok(undefined));
        expect(await (reentrant as unknown as Promise<Result<void, Error>>)).toEqual(Result.ok(undefined));
        expect(engine.inits).toBe(1);
        expect(engine.gates).toHaveLength(1);
    });

    it('Jensen (2): an onStop hook that re-enters destroy() during a held, then FAILING, cleanup gets the same failure', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        await first;
        await engine.start();
        const failure = new Error('release failed late');
        engine.holdTeardown = true;
        engine.failTeardown = failure;
        let nested: Promise<void> | null = null;
        engine.onStopHook = () => { nested = engine.destroy(); };
        const outer = engine.destroy();
        expect(nested).not.toBeNull();
        let nestedSettled = false;
        void (nested as unknown as Promise<void>).then(() => { nestedSettled = true; }, () => { nestedSettled = true; });
        await flush();
        expect(nestedSettled).toBe(false); // still waiting on the real release, not a premature success
        engine.teardownGates[0]();
        const outcomes = await Promise.allSettled([outer, nested as unknown as Promise<void>]);
        expect(outcomes).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
        expect(engine.destroys).toBe(1);
    });

    it('Jensen (3): a synchronous init() from inside cleanup does not reach onInit until the release SUCCEEDS', async () => {
        const engine = new GatedEngine();
        const first = engine.init();
        engine.gates[0](Result.ok(undefined));
        await first;
        await engine.start();
        engine.holdTeardown = true;
        let reinit: Promise<Result<void, Error>> | null = null;
        engine.onStopHook = () => { reinit = engine.init(); };
        const outer = engine.destroy();
        await flush();
        expect(reinit).not.toBeNull();
        expect(engine.inits).toBe(1); // cleanup still in progress: no acquisition yet
        engine.teardownGates[0]();
        await outer;
        await flush();
        expect(engine.inits).toBe(2);
        engine.gates[1](Result.ok(undefined));
        expect(await (reinit as unknown as Promise<Result<void, Error>>)).toEqual(Result.ok(undefined));
        await engine.start();
    });

    it('preservation: a Result failure and a thrown rejection both clear single-flight, so a retry runs', async () => {
        const engine = new GatedEngine();
        const failed = engine.init();
        engine.gates[0](Result.err(new Error('load failed')));
        expect((await failed).isOk).toBe(false);
        const thrown = engine.init();
        expect(engine.inits).toBe(2);
        engine.gates[1](new Error('import exploded'));
        await expect(thrown).rejects.toThrow('import exploded');
        const retry = engine.init();
        expect(engine.inits).toBe(3);
        engine.gates[2](Result.ok(undefined));
        expect((await retry).isOk).toBe(true);
    });
});
