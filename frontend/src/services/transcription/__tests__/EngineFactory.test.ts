import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineFactory } from '../EngineFactory';
import { testRegistry } from '../TestRegistry';
import NativeBrowser from '../modes/NativeBrowser';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { PROD_FREE_POLICY } from '../TranscriptionPolicy';

// Mock dependencies
vi.mock('../modes/NativeBrowser');
vi.mock('../modes/CloudAssemblyAI');
vi.mock('../modes/PrivateWhisper', () => ({
    default: vi.fn(),
}));

describe('EngineFactory', () => {
    const mockConfig = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        testRegistry.clear();
    });

    describe('create', () => {
        it('should create NativeBrowser for native mode', async () => {
            // Act
            await EngineFactory.create('native', mockConfig, PROD_FREE_POLICY);
            expect(NativeBrowser).toHaveBeenCalledWith(mockConfig);
        });

        it('should inject Native engine from Registry if present', async () => {
            const mockNative = { getEngineType: () => 'mock-native' };
            testRegistry.register('native', () => mockNative);

            const engine = await EngineFactory.create('native', mockConfig, PROD_FREE_POLICY);
            expect(engine).toBe(mockNative);
            expect(NativeBrowser).not.toHaveBeenCalled();
        });

        it('should create CloudAssemblyAI for cloud mode', async () => {
            await EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY);
            expect(CloudAssemblyAI).toHaveBeenCalledWith(mockConfig);
        });

        it('should inject Cloud engine from Registry if present', async () => {
            const mockCloud = { getEngineType: () => 'mock-cloud' };
            testRegistry.register('cloud', () => mockCloud);

            const engine = await EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY);
            expect(engine).toBe(mockCloud);
            expect(CloudAssemblyAI).not.toHaveBeenCalled();
        });

        it('should throw error for unknown mode', async () => {
            await expect(EngineFactory.create('unknown' as never, mockConfig, PROD_FREE_POLICY)).rejects.toThrow('Unknown transcription mode');
        });
    });
});
