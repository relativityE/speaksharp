import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEngine, sttRegistry } from '@/services/transcription/STTRegistry';
import { ITranscriptionEngine } from '../modes/types';

describe('STTRegistry (Singleton SSOT)', () => {
    beforeEach(() => {
        // Clear internal registry state between tests
        sttRegistry.clear();
        vi.clearAllMocks();
    });

    it('should register and retrieve an engine factory', () => {
        const mockFactory = () => ({ type: 'mock' } as unknown as ITranscriptionEngine);
        
        sttRegistry.register('mock-mode', mockFactory);

        const factory = sttRegistry.get('mock-mode');
        expect(factory).toBe(mockFactory);
        
        // Test compatibility wrapper
        expect(getEngine('mock-mode')).toBe(mockFactory);
    });

    it('should return undefined for unregistered engines', () => {
        expect(sttRegistry.get('unknown')).toBeUndefined();
        expect(getEngine('unknown')).toBeUndefined();
    });

    it('should be idempotent: multiple calls to clear() are safe', () => {
        sttRegistry.clear();
        sttRegistry.clear();
        expect(sttRegistry.get('any-mode')).toBeUndefined();
    });
});
