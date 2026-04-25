import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineFactory } from '../EngineFactory';
import NativeBrowser from '../modes/NativeBrowser';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import { PROD_FREE_POLICY, TranscriptionMode } from '../TranscriptionPolicy';
import { TranscriptionModeOptions } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';

// Mock dependencies
vi.mock('../modes/NativeBrowser');
vi.mock('../modes/CloudAssemblyAI');
vi.mock('../engines/PrivateSTT', () => {
    const mockEngine = {
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
        init: vi.fn().mockResolvedValue({ isOk: true }),
        getEngineType: () => 'private',
        type: 'private'
    };
    return {
        PrivateSTT: vi.fn().mockImplementation(() => mockEngine)
    };
});

describe('EngineFactory', () => {
    // Correct TranscriptionModeOptions for type safety
    const mockConfig: TranscriptionModeOptions = {
        onTranscriptUpdate: vi.fn(),
        onModelLoadProgress: vi.fn(),
        onReady: vi.fn(),
        session: null,
        navigate: vi.fn() as unknown as NavigateFunction,
        getAssemblyAIToken: vi.fn().mockResolvedValue('token')
    };

    beforeEach(() => {
        vi.clearAllMocks();
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            win.__SS_E2E__ = undefined;
        }
    });

    describe('create', () => {
        it('should create NativeBrowser for native mode', async () => {
            // Act
            await EngineFactory.create('native', mockConfig, PROD_FREE_POLICY);
            expect(NativeBrowser).toHaveBeenCalledWith(mockConfig);
        });

        it('should create CloudAssemblyAI for cloud mode', async () => {
            await EngineFactory.create('cloud', mockConfig, PROD_FREE_POLICY);
            expect(CloudAssemblyAI).toHaveBeenCalledWith(mockConfig);
        });

        it('should throw error for unsupported mode', async () => {
            // Cast to TranscriptionMode to test runtime validation
            const unsupportedMode = 'unknown' as TranscriptionMode;
            await expect(EngineFactory.create(unsupportedMode, mockConfig, PROD_FREE_POLICY)).rejects.toThrow('Unsupported transcription mode');
        });
    });
});
