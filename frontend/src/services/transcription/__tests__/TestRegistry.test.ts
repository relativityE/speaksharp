import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEngine } from '../TestRegistry';
import { ITranscriptionEngine } from '../modes/types';

describe('TestRegistry (Synchronous SSOT)', () => {
    beforeEach(() => {
        // Clear global state between tests
        if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__SS_E2E__ = undefined;
        }
        vi.clearAllMocks();
    });

    it('should retrieve an engine factory from window manifest', () => {
        const mockFactory = () => ({ type: 'mock' } as unknown as ITranscriptionEngine);
        
        // Populate manifest at T=0
        (window as unknown as Record<string, unknown>).__SS_E2E__ = {
            registry: {
                'mock-mode': mockFactory
            }
        };

        const factory = getEngine('mock-mode');
        expect(factory).toBe(mockFactory);
    });

    it('should return undefined if manifest is missing', () => {
        expect(getEngine('any')).toBeUndefined();
    });

    it('should return undefined if registry is missing', () => {
        (window as unknown as Record<string, unknown>).__SS_E2E__ = { isActive: true };
        expect(getEngine('any')).toBeUndefined();
    });

    it('should return undefined for unregistered engines', () => {
        (window as unknown as Record<string, unknown>).__SS_E2E__ = { registry: {} };
        expect(getEngine('unknown')).toBeUndefined();
    });
});
