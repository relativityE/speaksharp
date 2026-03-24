import { describe, it, expect } from 'vitest';
import { validateEngine } from '../STTEngine';

describe('STTEngine Contract Validation (structural-only)', () => {
    it('should pass for a valid engine structure', () => {
        const validEngine = {
            start: async () => {},
            stop: async () => {},
            getEngineType: () => 'mock',
            transcribe: async () => ({ isOk: true, data: 'test' }),
            destroy: async () => {},
            terminate: async () => {}
        };

        expect(() => validateEngine(validEngine)).not.toThrow();
    });

    it('should fail if required methods are missing', () => {
        const invalidEngine = {
            start: async () => {},
            // stop is missing
            getEngineType: () => 'mock'
        };

        expect(() => validateEngine(invalidEngine)).toThrow(/STT_ENGINE_INVALID/);
        expect(() => validateEngine(invalidEngine)).toThrow(/missing required method 'stop'/);
    });

    it('should fail if engine is not an object', () => {
        expect(() => validateEngine(null)).toThrow(/STT_ENGINE_INVALID/);
        expect(() => validateEngine(undefined)).toThrow(/STT_ENGINE_INVALID/);
        expect(() => validateEngine('not an engine')).toThrow(/STT_ENGINE_INVALID/);
    });

    it('should inject default no-op for optional methods if missing', () => {
        const minimalEngine = {
            start: async () => {},
            stop: async () => {},
            getEngineType: () => 'mock',
            transcribe: async () => ({ isOk: true, data: 'test' })
        };

        validateEngine(minimalEngine);
        
        expect(typeof (minimalEngine as unknown as Record<string, unknown>).destroy).toBe('function');
        expect(typeof (minimalEngine as unknown as Record<string, unknown>).terminate).toBe('function');
        
        // Should be safe to call
        expect(() => (minimalEngine as unknown as { destroy: () => void }).destroy()).not.toThrow();
        expect(() => (minimalEngine as unknown as { terminate: () => void }).terminate()).not.toThrow();
    });

    it('should fail if required method is not a function', () => {
        const invalidEngine = {
            start: 'not a function', // Should be a function
            stop: async () => {},
            getEngineType: () => 'mock'
        };

        expect(() => validateEngine(invalidEngine)).toThrow(/STT_ENGINE_INVALID/);
        expect(() => validateEngine(invalidEngine)).toThrow(/missing required method 'start'/);
    });
});
