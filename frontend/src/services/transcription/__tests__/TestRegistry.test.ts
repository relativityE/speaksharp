import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testRegistry, getEngine } from '../TestRegistry';
import { ITranscriptionEngine } from '../modes/types';

describe('TestRegistry (Synchronous SSOT)', () => {
    beforeEach(() => {
        // Clear global state
        if (typeof window !== 'undefined') {
            delete (window as { __SS_E2E__?: unknown }).__SS_E2E__;
        }
        vi.clearAllMocks();
    });

    it('should register and retrieve an engine factory synchronously', () => {
        const mockFactory = () => ({ type: 'mock' } as unknown as ITranscriptionEngine);
        testRegistry.register('mock-mode', mockFactory);

        const factory = testRegistry.get('mock-mode');
        expect(factory).toBe(mockFactory);
        
        // Verify it was placed on the window manifest
        expect(window.__SS_E2E__?.registry?.['mock-mode']).toBe(mockFactory);
    });

    it('should return undefined if engine is not registered', () => {
        expect(testRegistry.get('non-existent')).toBeUndefined();
    });

    it('should return true/false for has()', () => {
        testRegistry.register('exists', () => ({}) as unknown as ITranscriptionEngine);
        expect(testRegistry.has('exists')).toBe(true);
        expect(testRegistry.has('missing')).toBe(false);
    });

    it('should clear all registrations', () => {
        testRegistry.register('a', () => ({}) as unknown as ITranscriptionEngine);
        testRegistry.register('b', () => ({}) as unknown as ITranscriptionEngine);
        
        testRegistry.clear();
        
        expect(testRegistry.has('a')).toBe(false);
        expect(testRegistry.has('b')).toBe(false);
        expect(window.__SS_E2E__?.registry).toEqual({});
    });

    it('should handle missing window gracefully (SSR safety)', () => {
        // This is a bit tricky to test in vitest/happy-dom, but we can verify it doesn't throw
        const originalWindow = global.window;
        delete (global as { window?: unknown }).window;
        
        expect(getEngine('any')).toBeUndefined();
        
        (global as { window: unknown }).window = originalWindow;
    });

    it('should initialize __SS_E2E__ manifest if it does not exist on register', () => {
        expect(window.__SS_E2E__).toBeUndefined();
        
        testRegistry.register('auto-init', () => ({}) as unknown as ITranscriptionEngine);
        
        expect(window.__SS_E2E__).toBeDefined();
        expect(window.__SS_E2E__?.isActive).toBe(true);
        expect(window.__SS_E2E__?.registry?.['auto-init']).toBeDefined();
    });
});
