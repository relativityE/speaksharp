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
    protected onInit(): Promise<Result<void, Error>> {
        this.inits += 1;
        return new Promise((resolve, reject) => {
            this.gates.push((outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome)));
        });
    }
    protected async onStart() {}
    protected async onStop() {}
    protected async onDestroy() { this.destroys += 1; }
    async transcribe() { return Result.ok('test'); }
}

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

    it('an init begun after destroy started is a fresh attempt; the cancelled one still settles as cancelled', async () => {
        const engine = new GatedEngine();
        const old = engine.init();
        const destroying = engine.destroy();
        const joined = engine.init(); // destroy already invalidated the old attempt at entry
        await destroying;
        expect(engine.inits).toBe(2);
        engine.gates[0](Result.ok(undefined));
        engine.gates[1](Result.ok(undefined));
        expect((await old).isOk).toBe(false);
        expect((await joined).isOk).toBe(true);
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
