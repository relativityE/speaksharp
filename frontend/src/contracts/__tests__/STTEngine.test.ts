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
